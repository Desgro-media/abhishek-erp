import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { recordBankTxn } from "../../services/finance/bankLedger";
import { isFinanceAdmin } from "../../middleware/financeAccess";
import { seesWholeSalesTeam } from "../../middleware/crmAccess";
import { sumAmounts, invoiceTotal, invoicePaidAsOf, invoiceStatus } from "../../services/finance/calc";
import { createCommissionPayable } from "../../services/finance/commission";
import { createSalesBonusIfCrossed } from "../../services/finance/salesTarget";
import {
  invoiceCreateSchema,
  invoiceUpdateSchema,
  invoicePaymentSchema,
  invoicePendingPaymentSchema,
  invoicePendingApprovalSchema,
} from "../../validation/finance.schemas";

function withComputed(inv: { items: { amount: unknown }[]; payments: { amount: unknown; paidDate: Date }[]; dueAt: Date }) {
  const total = invoiceTotal(inv.items);
  const paid = invoicePaidAsOf(inv.payments);
  return { ...inv, total, paid, balance: total - paid, status: invoiceStatus(total, paid, inv.dueAt, new Date()) };
}

const INCLUDE = { items: true, payments: true, pendingPayments: true } as const;

// Sales sees only invoices for clients where they're the salesPerson — the
// "narrow self-service slice" this route's comment (finance.routes.ts)
// promises; Finance/Admin see everything, same as before.
export const listInvoices: RequestHandler = asyncHandler(async (req, res) => {
  const invoices = await prisma.invoice.findMany({
    where: {
      clientId: (req.query.clientId as string) || undefined,
      client: isFinanceAdmin(req.user?.roles) || seesWholeSalesTeam(req.user?.roles) ? undefined : { salesPerson: req.user!.name },
    },
    include: INCLUDE,
    orderBy: { issuedAt: "desc" },
  });
  res.json({ invoices: invoices.map(withComputed) });
});

export const getInvoice: RequestHandler = asyncHandler(async (req, res) => {
  const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: { ...INCLUDE, client: true } });
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  if (!isFinanceAdmin(req.user?.roles) && !seesWholeSalesTeam(req.user?.roles) && invoice.client.salesPerson !== req.user!.name) {
    return res.status(403).json({ error: "Forbidden — not your client" });
  }
  res.json({ invoice: withComputed(invoice) });
});

export const createInvoice: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = invoiceCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const existing = await prisma.invoice.findUnique({ where: { invoiceNo: d.invoiceNo } });
  if (existing) return res.status(409).json({ error: "That invoice number is already in use" });

  const invoice = await prisma.invoice.create({
    data: {
      clientId: d.clientId, invoiceNo: d.invoiceNo, issuedAt: new Date(d.issuedAt), dueAt: new Date(d.dueAt),
      items: { create: d.items },
    },
    include: INCLUDE,
  });

  await recordAudit({ userId: req.user!.sub, action: "FIN_INVOICE_CREATE", entityType: "Invoice", entityId: invoice.id, afterData: d, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.status(201).json({ invoice: withComputed(invoice) });
});

export const updateInvoice: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = invoiceUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const before = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: INCLUDE });
  if (!before) return res.status(404).json({ error: "Invoice not found" });
  if (d.items && invoiceTotal(d.items) < sumAmounts(before.payments)) {
    return res.status(400).json({ error: "Total can't be less than what's already been paid" });
  }

  const invoice = await prisma.$transaction(async (tx) => {
    if (d.items) await tx.invoiceItem.deleteMany({ where: { invoiceId: before.id } });
    return tx.invoice.update({
      where: { id: before.id },
      data: {
        clientId: d.clientId, invoiceNo: d.invoiceNo, issuedAt: d.issuedAt ? new Date(d.issuedAt) : undefined,
        dueAt: d.dueAt ? new Date(d.dueAt) : undefined,
        items: d.items ? { create: d.items } : undefined,
      },
      include: INCLUDE,
    });
  });

  await recordAudit({ userId: req.user!.sub, action: "FIN_INVOICE_UPDATE", entityType: "Invoice", entityId: invoice.id, afterData: d, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.json({ invoice: withComputed(invoice) });
});

// Finance directly confirming money that's already landed — no approval
// step, unlike the Sales-submitted pending-payment flow below. Append-only.
export const recordInvoicePayment: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = invoicePaymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const invoiceId = req.params.id;

  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { items: true, payments: true } });
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  const balance = invoiceTotal(invoice.items) - sumAmounts(invoice.payments);
  if (d.amount > balance + 0.01) return res.status(400).json({ error: "Amount exceeds the remaining balance" });

  const payment = await prisma.$transaction(async (tx) => {
    const p = await tx.invoicePayment.create({
      data: { invoiceId, amount: d.amount, paidDate: new Date(d.paidDate), accountId: d.accountId, note: d.note, recordedBy: req.user!.sub },
    });
    await recordBankTxn(tx, { accountId: d.accountId, date: new Date(d.paidDate), type: "CREDIT", amount: d.amount, note: `Invoice ${invoice.invoiceNo}`, refType: "INVOICE_PAYMENT", refId: p.id });
    return p;
  });

  await recordAudit({ userId: req.user!.sub, action: "FIN_INVOICE_PAYMENT", entityType: "Invoice", entityId: invoiceId, afterData: d, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.status(201).json({ payment });
});

// Sales-side: a payment they've collected but Finance hasn't confirmed yet.
export const submitPendingPayment: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = invoicePendingPaymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const invoiceId = req.params.id;

  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });

  const salesPerson = isFinanceAdmin(req.user?.roles) ? d.salesPerson : req.user!.name;
  const pending = await prisma.invoicePendingPayment.create({
    data: { invoiceId, amount: d.amount, paymentDate: new Date(d.paymentDate), salesPerson, note: d.note },
  });

  await recordAudit({ userId: req.user!.sub, action: "FIN_INVOICE_PAYMENT_SUBMITTED", entityType: "Invoice", entityId: invoiceId, afterData: { amount: d.amount, salesPerson } });
  res.status(201).json({ pending });
});

// Discards a Sales-submitted payment nothing's been posted for yet — for a
// duplicate or mistaken submission, not a real payment Finance just hasn't
// gotten to. Once approved it's a real InvoicePayment (append-only), so this
// refuses to touch it — approving is a one-way door.
export const deletePendingPayment: RequestHandler = asyncHandler(async (req, res) => {
  const { id: invoiceId, pendingId } = req.params;
  const pending = await prisma.invoicePendingPayment.findUnique({ where: { id: pendingId } });
  if (!pending || pending.invoiceId !== invoiceId) return res.status(404).json({ error: "Pending payment not found" });
  if (pending.approved) return res.status(409).json({ error: "Already approved — it's a real payment now, not a pending entry." });
  if (!isFinanceAdmin(req.user?.roles) && pending.salesPerson !== req.user!.name) {
    return res.status(403).json({ error: "Forbidden — you can only delete your own pending payment" });
  }

  await prisma.invoicePendingPayment.delete({ where: { id: pendingId } });

  await recordAudit({ userId: req.user!.sub, action: "FIN_INVOICE_PENDING_PAYMENT_DELETE", entityType: "Invoice", entityId: invoiceId, beforeData: { pendingId, amount: pending.amount } });
  res.status(204).send();
});

// Finance-side: confirms a Sales-submitted payment actually landed —
// creates the real InvoicePayment + ledger row + (if a salesperson is
// attached) a Commission payable, all in one transaction.
export const approvePendingPayment: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = invoicePendingApprovalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const { id: invoiceId, pendingId } = req.params;

  const [invoice, pending] = await Promise.all([
    prisma.invoice.findUnique({ where: { id: invoiceId } }),
    prisma.invoicePendingPayment.findUnique({ where: { id: pendingId } }),
  ]);
  if (!invoice || !pending || pending.invoiceId !== invoiceId) return res.status(404).json({ error: "Pending payment not found" });
  if (pending.approved) return res.status(409).json({ error: "Already approved" });

  const date = d.date ? new Date(d.date) : pending.paymentDate;
  const approvedAt = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.invoicePayment.create({
      data: { invoiceId, amount: pending.amount, paidDate: date, accountId: d.accountId, note: pending.note ?? undefined, recordedBy: req.user!.sub },
    });
    await recordBankTxn(tx, { accountId: d.accountId, date, type: "CREDIT", amount: Number(pending.amount), note: `Invoice ${invoice.invoiceNo}`, refType: "INVOICE_PAYMENT", refId: payment.id });
    let commission = null;
    let salesBonus = null;
    if (pending.salesPerson) {
      commission = await createCommissionPayable(tx, { salesPerson: pending.salesPerson, sourceLabel: invoice.invoiceNo, paymentAmount: Number(pending.amount), dueAt: date });
      // Must run BEFORE this row is marked approved below — monthlyApprovedSales()
      // sums approved=true rows, so flipping this one first would make it count
      // itself as "prior" sales and double it into the new total. Month bucket
      // must match approvedAt (what that query filters by), not the possibly-
      // backdated ledger `date`.
      salesBonus = await createSalesBonusIfCrossed(tx, { salesPerson: pending.salesPerson, paymentAmount: Number(pending.amount), date: approvedAt });
    }
    await tx.invoicePendingPayment.update({ where: { id: pendingId }, data: { approved: true, approvedAt, invoicePayment: payment.id } });
    return { payment, commission, salesBonus };
  });

  await recordAudit({ userId: req.user!.sub, action: "FIN_INVOICE_PAYMENT_APPROVED", entityType: "Invoice", entityId: invoiceId, afterData: { pendingId, amount: pending.amount }, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.status(201).json(result);
});

// Only allowed before any money has moved against this invoice — payments
// are append-only (see InvoicePayment) and never get silently deleted out
// from under a real ledger entry. Once a payment exists, correct via Finance
// rather than deleting the invoice. Cascades items/pendingPayments (schema).
export const deleteInvoice: RequestHandler = asyncHandler(async (req, res) => {
  const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: { payments: true } });
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  if (invoice.payments.length > 0) {
    return res.status(409).json({ error: "Can't delete an invoice with recorded payments — the payment ledger is append-only." });
  }

  await prisma.invoice.delete({ where: { id: invoice.id } });

  await recordAudit({ userId: req.user!.sub, action: "FIN_INVOICE_DELETE", entityType: "Invoice", entityId: invoice.id, beforeData: { invoiceNo: invoice.invoiceNo }, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.status(204).send();
});
