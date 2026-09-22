import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { recordBankTxn } from "../../services/finance/bankLedger";
import { isFinanceAdmin } from "../../middleware/financeAccess";
import { sumAmounts, payableStatus } from "../../services/finance/calc";
import { payableCreateSchema, payableUpdateSchema, payablePaymentSchema } from "../../validation/finance.schemas";

function withComputed(p: { amount: unknown; payments: { amount: unknown }[] }) {
  const amount = Number(p.amount);
  const paid = sumAmounts(p.payments);
  return { ...p, amount, paid, balance: amount - paid, status: payableStatus(amount, paid) };
}

// Finance/Admin sees every payable; Sales only ever sees their own
// Commission/Sales Bonus entries — never Salary/Rent/Vendor/Internal Loan,
// and never another salesperson's — same "narrow self-service slice"
// pattern as invoices.listInvoices.
export const listPayables: RequestHandler = asyncHandler(async (req, res) => {
  const admin = isFinanceAdmin(req.user?.roles);
  const payables = await prisma.payable.findMany({
    where: admin
      ? { category: req.query.category as any }
      : { category: { in: ["COMMISSION", "SALES_BONUS"] }, salesPerson: req.user!.name },
    include: { payments: true },
    orderBy: { dueAt: "desc" },
  });
  res.json({ payables: payables.map(withComputed) });
});

export const createPayable: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = payableCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const payable = await prisma.payable.create({
    data: { category: d.category, payee: d.payee, salesPerson: d.salesPerson, amount: d.amount, dueAt: new Date(d.dueAt) },
  });

  await recordAudit({ userId: req.user!.sub, action: "FIN_PAYABLE_CREATE", entityType: "Payable", entityId: payable.id, afterData: d, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.status(201).json({ payable: withComputed({ ...payable, payments: [] }) });
});

export const updatePayable: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = payableUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });

  const before = await prisma.payable.findUnique({ where: { id: req.params.id }, include: { payments: true } });
  if (!before) return res.status(404).json({ error: "Payable not found" });
  const d = parsed.data;
  if (d.amount != null && d.amount < sumAmounts(before.payments)) {
    return res.status(400).json({ error: "Amount can't be less than what's already been paid" });
  }

  const payable = await prisma.payable.update({
    where: { id: req.params.id },
    data: { category: d.category, payee: d.payee, salesPerson: d.salesPerson, amount: d.amount, dueAt: d.dueAt ? new Date(d.dueAt) : undefined },
    include: { payments: true },
  });

  await recordAudit({ userId: req.user!.sub, action: "FIN_PAYABLE_UPDATE", entityType: "Payable", entityId: payable.id, afterData: d, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.json({ payable: withComputed(payable) });
});

// Append-only.
export const recordPayablePayment: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = payablePaymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const payableId = req.params.id;

  const payable = await prisma.payable.findUnique({ where: { id: payableId }, include: { payments: true } });
  if (!payable) return res.status(404).json({ error: "Payable not found" });
  const balance = Number(payable.amount) - sumAmounts(payable.payments);
  if (d.amount > balance + 0.01) return res.status(400).json({ error: "Amount exceeds the remaining balance" });

  const payment = await prisma.$transaction(async (tx) => {
    const p = await tx.payablePayment.create({
      data: { payableId, amount: d.amount, paidDate: new Date(d.paidDate), accountId: d.accountId, note: d.note, recordedBy: req.user!.sub },
    });
    await recordBankTxn(tx, { accountId: d.accountId, date: new Date(d.paidDate), type: "DEBIT", amount: d.amount, note: `${payable.category} — ${payable.payee}`, refType: "PAYABLE_PAYMENT", refId: p.id });
    return p;
  });

  await recordAudit({ userId: req.user!.sub, action: "FIN_PAYABLE_PAYMENT", entityType: "Payable", entityId: payableId, afterData: d, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.status(201).json({ payment });
});

// Same rule as deleteInvoice: only before any payment has been recorded
// against it — PayablePayment is append-only, so a paid-out payable is
// corrected, never deleted out from under its own ledger entries.
export const deletePayable: RequestHandler = asyncHandler(async (req, res) => {
  const payable = await prisma.payable.findUnique({ where: { id: req.params.id }, include: { payments: true } });
  if (!payable) return res.status(404).json({ error: "Payable not found" });
  if (payable.payments.length > 0) {
    return res.status(409).json({ error: "Can't delete a payable with recorded payments — the payment ledger is append-only." });
  }

  await prisma.payable.delete({ where: { id: payable.id } });

  await recordAudit({ userId: req.user!.sub, action: "FIN_PAYABLE_DELETE", entityType: "Payable", entityId: payable.id, beforeData: { category: payable.category, payee: payable.payee }, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.status(204).send();
});
