import { RequestHandler } from "express";
import type { PaymentRequestCategory } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { recordBankTxn } from "../../services/finance/bankLedger";
import { isFinanceAdmin } from "../../middleware/financeAccess";
import { paymentRequestCreateSchema, paymentRequestApproveSchema } from "../../validation/finance.schemas";

const CATEGORY_LABEL: Record<PaymentRequestCategory, string> = {
  REIMBURSEMENT: "Reimbursement",
  TRAVEL: "Travel",
  PURCHASE_VENDOR: "Purchase / Vendor",
  OTHER: "Other",
};

const EMPLOYEE_SELECT = { select: { id: true, name: true, employeeCode: true } } as const;

// Finance/Admin sees every request (optionally filtered by ?status= /
// ?employeeId=); everyone else sees only their own, resolved from the login's
// linked Employee — never from a client-supplied id. Requests from employees
// who have since left stay listed: they may still need settling.
export const listPaymentRequests: RequestHandler = asyncHandler(async (req, res) => {
  const admin = isFinanceAdmin(req.user?.roles);
  const ownEmployeeId = req.user?.employeeId ?? undefined;
  if (!admin && !ownEmployeeId) return res.json({ requests: [] });

  const status = req.query.status as string | undefined;
  const requests = await prisma.paymentRequest.findMany({
    where: {
      employeeId: admin ? (req.query.employeeId as string | undefined) : ownEmployeeId,
      status: status && ["PENDING", "APPROVED", "REJECTED"].includes(status) ? (status as "PENDING" | "APPROVED" | "REJECTED") : undefined,
    },
    include: { employee: EMPLOYEE_SELECT },
    orderBy: { requestedAt: "desc" },
  });

  // Who paid from which account is Finance's business, not the requester's.
  res.json({ requests: admin ? requests : requests.map(({ decidedBy, accountId, ...own }) => own) });
});

// Any employee with a linked login. Always raised for the caller themselves —
// there is no employeeId in the body, so nobody can file on someone else's
// behalf (and Finance/Admin raise their own the same way).
export const createPaymentRequest: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = paymentRequestCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const employeeId = req.user?.employeeId;
  if (!employeeId) return res.status(403).json({ error: "No HR record is linked to your login" });

  const request = await prisma.paymentRequest.create({
    data: { employeeId, category: d.category, amount: d.amount, reason: d.reason },
    include: { employee: EMPLOYEE_SELECT },
  });
  await recordAudit({ userId: req.user!.sub, action: "FIN_PAYMENT_REQUEST_CREATE", entityType: "PaymentRequest", entityId: request.id, afterData: d, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.status(201).json({ request });
});

// Approve == pay: flips PENDING -> APPROVED, debits the chosen bank account
// and writes the audit row in ONE transaction. The status flip is a
// compare-and-set (updateMany ... where status = PENDING), so two Finance users
// clicking at once — or a double-submit — can only ever debit once.
export const approvePaymentRequest: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = paymentRequestApproveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const id = req.params.id;

  const request = await prisma.paymentRequest.findUnique({ where: { id }, include: { employee: EMPLOYEE_SELECT } });
  if (!request) return res.status(404).json({ error: "Payment request not found" });
  if (request.status !== "PENDING") return res.status(409).json({ error: "Already decided" });
  const account = await prisma.bankAccount.findUnique({ where: { id: d.accountId } });
  if (!account) return res.status(400).json({ error: "Bank account not found" });

  const date = new Date(d.date);
  const decidedAt = new Date();
  const outcome = await prisma.$transaction(async (tx) => {
    const claimed = await tx.paymentRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "APPROVED", decidedBy: req.user!.sub, decidedAt, paidDate: date, accountId: d.accountId },
    });
    if (claimed.count === 0) return null;
    await recordBankTxn(tx, {
      accountId: d.accountId, date, type: "DEBIT", amount: Number(request.amount),
      note: `${CATEGORY_LABEL[request.category]} — ${request.employee.name} (${request.employee.employeeCode})`,
      refType: "PAYMENT_REQUEST", refId: id,
    });
    await recordAudit({
      userId: req.user!.sub, action: "FIN_PAYMENT_REQUEST_APPROVE", entityType: "PaymentRequest", entityId: id,
      beforeData: { status: "PENDING", amount: Number(request.amount), category: request.category, employeeId: request.employeeId },
      afterData: { status: "APPROVED", amount: Number(request.amount), accountId: d.accountId, paidDate: d.date },
      ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null,
    }, tx);
    return tx.paymentRequest.findUniqueOrThrow({ where: { id }, include: { employee: EMPLOYEE_SELECT } });
  });
  if (!outcome) return res.status(409).json({ error: "Already decided" });
  res.json({ request: outcome });
});

export const rejectPaymentRequest: RequestHandler = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const request = await prisma.paymentRequest.findUnique({ where: { id } });
  if (!request) return res.status(404).json({ error: "Payment request not found" });
  if (request.status !== "PENDING") return res.status(409).json({ error: "Already decided" });

  const outcome = await prisma.$transaction(async (tx) => {
    const claimed = await tx.paymentRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "REJECTED", decidedBy: req.user!.sub, decidedAt: new Date() },
    });
    if (claimed.count === 0) return null;
    await recordAudit({
      userId: req.user!.sub, action: "FIN_PAYMENT_REQUEST_REJECT", entityType: "PaymentRequest", entityId: id,
      beforeData: { status: "PENDING", amount: Number(request.amount), category: request.category, employeeId: request.employeeId },
      afterData: { status: "REJECTED" },
      ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null,
    }, tx);
    return tx.paymentRequest.findUniqueOrThrow({ where: { id }, include: { employee: EMPLOYEE_SELECT } });
  });
  if (!outcome) return res.status(409).json({ error: "Already decided" });
  res.json({ request: outcome });
});
