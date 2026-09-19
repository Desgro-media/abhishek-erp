import { RequestHandler } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { isFinanceAdmin } from "../../middleware/financeAccess";
import { computePayrollRow, closedPayrollMonth, applyAdvanceRecovery } from "../../services/hr/payrollCalc";
import { withdrawalRequestCreateSchema } from "../../validation/finance.schemas";

// Salary already earned in a CLOSED month, paid out early. Not an Advance (that's
// against the still-open month) — see WithdrawalRequest in schema.prisma.

const EPS = 0.005;
const EMPLOYEE_SELECT = { select: { id: true, name: true, employeeCode: true } } as const;
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

type Db = Prisma.TransactionClient;

// What the employee has earned in `month` and still not been paid, minus what
// they've already got pending requests for (so the same rupee can't be
// requested twice while the first is under review). Mirrors earnedUnpaidFor()
// in the mockup, but computed from the real payroll entry — the same net figure
// HR sees in Payroll.
async function earnedUnpaid(db: Db, employeeId: string, month: string) {
  const row = await computePayrollRow(employeeId, month, db);
  if (!row) return { month, hasEntry: false, net: 0, paid: 0, balance: 0, pending: 0, requestable: 0 };
  const agg = await db.withdrawalRequest.aggregate({ where: { employeeId, month, status: "PENDING" }, _sum: { amount: true } });
  const pending = Number(agg._sum.amount ?? 0);
  return { month, hasEntry: true, net: row.net, paid: row.paid, balance: row.balance, pending, requestable: Math.max(0, row.balance - pending) };
}

// Serialises everything that touches one employee-month's balance — raising a
// request, approving one — so two of them can't both pass the balance check
// against the same rupees. Held until the surrounding transaction ends.
async function lockPayrollEntry(tx: Prisma.TransactionClient, employeeId: string, month: string): Promise<string | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM payroll_entries WHERE employee_id = ${employeeId} AND month = ${month} FOR UPDATE`;
  return rows[0]?.id ?? null;
}

// Finance/Admin decide these, and HR (who run payroll) can see them; everyone
// else sees only their own, resolved from the login's linked Employee.
export const listWithdrawalRequests: RequestHandler = asyncHandler(async (req, res) => {
  const roles = req.user?.roles ?? [];
  const seesAll = isFinanceAdmin(roles) || roles.includes("HR");
  const ownEmployeeId = req.user?.employeeId ?? undefined;
  if (!seesAll && !ownEmployeeId) return res.json({ requests: [] });

  const status = req.query.status as string | undefined;
  const requests = await prisma.withdrawalRequest.findMany({
    where: {
      employeeId: seesAll ? (req.query.employeeId as string | undefined) : ownEmployeeId,
      month: (req.query.month as string | undefined) || undefined,
      status: status && ["PENDING", "APPROVED", "REJECTED"].includes(status) ? (status as "PENDING" | "APPROVED" | "REJECTED") : undefined,
    },
    include: { employee: EMPLOYEE_SELECT },
    orderBy: { requestedAt: "desc" },
  });
  res.json({ requests: isFinanceAdmin(roles) ? requests : requests.map(({ decidedBy, payrollPaymentId, ...rest }) => rest) });
});

// The caller's own figures for the closed month — drives the "Withdrawal" chooser
// (is there anything to withdraw?) and the request form's max.
export const getWithdrawalEligibility: RequestHandler = asyncHandler(async (req, res) => {
  const month = closedPayrollMonth();
  const employeeId = req.user?.employeeId;
  if (!employeeId) return res.json({ month, hasEntry: false, net: 0, paid: 0, balance: 0, pending: 0, requestable: 0 });
  res.json(await earnedUnpaid(prisma, employeeId, month));
});

// Always raised for the caller themselves (no employeeId in the body). The
// month is the most recently closed one, chosen here — the client only names an
// amount, and it must fit within what's earned-and-unpaid.
export const createWithdrawalRequest: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = withdrawalRequestCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const employeeId = req.user?.employeeId;
  if (!employeeId) return res.status(403).json({ error: "No HR record is linked to your login" });
  const month = closedPayrollMonth();

  const result = await prisma.$transaction(async (tx) => {
    const entryId = await lockPayrollEntry(tx, employeeId, month);
    if (!entryId) return { status: 409 as const, error: `You have no payroll entry for ${month}, so there's nothing earned to withdraw against` };
    const eu = await earnedUnpaid(tx, employeeId, month);
    if (d.amount > eu.requestable + EPS) {
      return { status: 409 as const, error: eu.requestable > 0 ? `You can withdraw at most ${inr(eu.requestable)} right now` : "There's no earned, unpaid salary from the closed month to withdraw" };
    }
    const request = await tx.withdrawalRequest.create({ data: { employeeId, month, amount: d.amount }, include: { employee: EMPLOYEE_SELECT } });
    await recordAudit({
      userId: req.user!.sub, action: "FIN_WITHDRAWAL_REQUEST_CREATE", entityType: "WithdrawalRequest", entityId: request.id,
      afterData: { month, amount: d.amount, balanceAtRequest: eu.balance, requestable: eu.requestable },
      ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null,
    }, tx);
    return { status: 201 as const, request };
  }, { timeout: 15000 });

  if (result.status !== 201) return res.status(result.status).json({ error: result.error });
  res.status(201).json({ request: result.request });
});

// Approve == pay early: records a PayrollPayment against that month's entry (so
// the scheduled run only owes the remainder), links it to the request, and
// audit-logs it — one transaction. The balance is RE-CHECKED here under the same
// row lock: if HR paid part of the month in the meantime, an approval that would
// now overpay is refused rather than silently trimmed.
export const approveWithdrawalRequest: RequestHandler = asyncHandler(async (req, res) => {
  const id = req.params.id;

  const result = await prisma.$transaction(async (tx) => {
    const found = await tx.withdrawalRequest.findUnique({ where: { id } });
    if (!found) return { status: 404 as const, error: "Withdrawal request not found" };
    const entryId = await lockPayrollEntry(tx, found.employeeId, found.month);
    if (!entryId) return { status: 409 as const, error: `No payroll entry for ${found.month} to pay against` };

    // Re-read under the lock: a concurrent approve/reject may have decided it.
    const request = await tx.withdrawalRequest.findUniqueOrThrow({ where: { id } });
    if (request.status !== "PENDING") return { status: 409 as const, error: "Already decided" };

    const amount = Number(request.amount);
    const row = await computePayrollRow(request.employeeId, request.month, tx);
    if (!row || amount > row.balance + EPS) {
      return { status: 409 as const, error: `${inr(amount)} is more than the ${inr(row?.balance ?? 0)} still unpaid for ${request.month} — reject it and let the employee re-request` };
    }

    const now = new Date();
    const payment = await tx.payrollPayment.create({
      data: { payrollEntryId: entryId, amount, paidDate: now, note: `Early payout — withdrawal request ${id.slice(0, 8)}`, recordedBy: req.user!.sub },
    });
    // Same side effect as HR clearing the balance by hand: this month's advance
    // deduction was already taken out of net pay, so it must now be applied.
    const clearsBalance = amount >= row.balance - EPS;
    if (clearsBalance) await applyAdvanceRecovery(tx, request.employeeId);

    const updated = await tx.withdrawalRequest.update({
      where: { id },
      data: { status: "APPROVED", decidedBy: req.user!.sub, decidedAt: now, payrollPaymentId: payment.id },
      include: { employee: EMPLOYEE_SELECT },
    });
    await recordAudit({
      userId: req.user!.sub, action: "FIN_WITHDRAWAL_REQUEST_APPROVE", entityType: "WithdrawalRequest", entityId: id,
      beforeData: { status: "PENDING", month: request.month, amount, employeeId: request.employeeId, balanceBefore: row.balance },
      afterData: { status: "APPROVED", payrollPaymentId: payment.id, balanceAfter: Math.max(0, row.balance - amount), clearsBalance },
      ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null,
    }, tx);
    return { status: 200 as const, request: updated };
  }, { timeout: 15000 });

  if (result.status !== 200) return res.status(result.status).json({ error: result.error });
  res.json({ request: result.request });
});

export const rejectWithdrawalRequest: RequestHandler = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const found = await prisma.withdrawalRequest.findUnique({ where: { id } });
  if (!found) return res.status(404).json({ error: "Withdrawal request not found" });
  if (found.status !== "PENDING") return res.status(409).json({ error: "Already decided" });

  const request = await prisma.$transaction(async (tx) => {
    const claimed = await tx.withdrawalRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "REJECTED", decidedBy: req.user!.sub, decidedAt: new Date() } });
    if (claimed.count === 0) return null;
    await recordAudit({
      userId: req.user!.sub, action: "FIN_WITHDRAWAL_REQUEST_REJECT", entityType: "WithdrawalRequest", entityId: id,
      beforeData: { status: "PENDING", month: found.month, amount: Number(found.amount), employeeId: found.employeeId },
      afterData: { status: "REJECTED" }, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null,
    }, tx);
    return tx.withdrawalRequest.findUniqueOrThrow({ where: { id }, include: { employee: EMPLOYEE_SELECT } });
  });
  if (!request) return res.status(409).json({ error: "Already decided" });
  res.json({ request });
});
