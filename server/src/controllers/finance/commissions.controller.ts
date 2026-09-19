import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { recordBankTxn } from "../../services/finance/bankLedger";
import { isFinanceAdmin } from "../../middleware/financeAccess";
import { sumAmounts } from "../../services/finance/calc";
import { commissionWithdrawalCreateSchema, commissionWithdrawalApproveSchema } from "../../validation/finance.schemas";

// Read-only rollup: every Commission-category payable, grouped by salesperson.
export const listCommissionsByPerson: RequestHandler = asyncHandler(async (req, res) => {
  const payables = await prisma.payable.findMany({ where: { category: "COMMISSION" }, include: { payments: true } });
  const bySalesPerson = new Map<string, { earned: number; paid: number; balance: number }>();
  for (const p of payables) {
    if (!p.salesPerson) continue;
    const row = bySalesPerson.get(p.salesPerson) ?? { earned: 0, paid: 0, balance: 0 };
    const amount = Number(p.amount);
    const paid = sumAmounts(p.payments);
    row.earned += amount;
    row.paid += paid;
    row.balance += amount - paid;
    bySalesPerson.set(p.salesPerson, row);
  }
  res.json({ commissions: Object.fromEntries(bySalesPerson) });
});

export const listCommissionWithdrawals: RequestHandler = asyncHandler(async (req, res) => {
  const requestedEmployeeId = req.query.employeeId as string | undefined;
  const admin = isFinanceAdmin(req.user?.roles);
  const employeeId = admin ? requestedEmployeeId : req.user?.employeeId ?? undefined;
  if (!admin && !employeeId) return res.json({ withdrawals: [] });

  const withdrawals = await prisma.commissionWithdrawal.findMany({
    where: { employeeId },
    include: admin ? { employee: { select: { id: true, name: true, employeeCode: true } } } : undefined,
    orderBy: { requestedAt: "desc" },
  });
  res.json({ withdrawals });
});

// Sales requests against their own name's outstanding commission balance;
// Finance/Admin can request on anyone's behalf.
export const requestCommissionWithdrawal: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = commissionWithdrawalCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const admin = isFinanceAdmin(req.user?.roles);
  const employeeId = admin ? d.employeeId : req.user?.employeeId;
  if (!employeeId) return res.status(admin ? 400 : 403).json({ error: admin ? "employeeId is required" : "No HR record is linked to your login" });

  const withdrawal = await prisma.commissionWithdrawal.create({ data: { employeeId, amount: d.amount, note: d.note } });
  await recordAudit({ userId: req.user!.sub, action: "FIN_COMMISSION_WITHDRAWAL_REQUEST", entityType: "CommissionWithdrawal", entityId: withdrawal.id, afterData: d });
  res.status(201).json({ withdrawal });
});

// Pays down that salesperson's oldest-due-first outstanding Commission
// payables up to the withdrawal amount — mirrors the old prototype's
// payCommissionWithdrawal(), factored out there specifically for testability.
export const approveCommissionWithdrawal: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = commissionWithdrawalApproveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const withdrawal = await prisma.commissionWithdrawal.findUnique({ where: { id: req.params.id }, include: { employee: true } });
  if (!withdrawal) return res.status(404).json({ error: "Withdrawal not found" });
  if (withdrawal.status !== "PENDING") return res.status(409).json({ error: "Already decided" });

  const date = d.date ? new Date(d.date) : new Date();
  const paidAmount = await prisma.$transaction(async (tx) => {
    const outstanding = await tx.payable.findMany({
      where: { category: { in: ["COMMISSION", "SALES_BONUS"] }, salesPerson: withdrawal.employee.name },
      include: { payments: true },
      orderBy: { dueAt: "asc" },
    });
    let remaining = Number(withdrawal.amount);
    for (const p of outstanding) {
      if (remaining <= 0) break;
      const balance = Number(p.amount) - sumAmounts(p.payments);
      if (balance <= 0) continue;
      const pay = Math.min(balance, remaining);
      await tx.payablePayment.create({ data: { payableId: p.id, amount: pay, paidDate: date, accountId: d.accountId, note: "Commission withdrawal", recordedBy: req.user!.sub } });
      await recordBankTxn(tx, { accountId: d.accountId, date, type: "DEBIT", amount: pay, note: `Commission withdrawal — ${withdrawal.employee.name}`, refType: "PAYABLE_PAYMENT", refId: p.id });
      remaining -= pay;
    }
    const paid = Number(withdrawal.amount) - remaining;
    await tx.commissionWithdrawal.update({ where: { id: withdrawal.id }, data: { status: "APPROVED", decidedAt: new Date(), accountId: d.accountId, paidAmount: paid } });
    return paid;
  });

  await recordAudit({ userId: req.user!.sub, action: "FIN_COMMISSION_WITHDRAWAL_APPROVE", entityType: "CommissionWithdrawal", entityId: withdrawal.id, afterData: { paidAmount }, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.json({ paidAmount });
});

export const rejectCommissionWithdrawal: RequestHandler = asyncHandler(async (req, res) => {
  const withdrawal = await prisma.commissionWithdrawal.update({ where: { id: req.params.id }, data: { status: "REJECTED", decidedAt: new Date() } }).catch(() => null);
  if (!withdrawal) return res.status(404).json({ error: "Withdrawal not found" });
  await recordAudit({ userId: req.user!.sub, action: "FIN_COMMISSION_WITHDRAWAL_REJECT", entityType: "CommissionWithdrawal", entityId: withdrawal.id });
  res.json({ withdrawal });
});
