import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { seesWholeSalesTeam } from "../../middleware/crmAccess";
import { recordAudit } from "../../services/audit.service";
import { recordBankTxn } from "../../services/finance/bankLedger";
import { createCommissionPayable } from "../../services/finance/commission";
import { createSalesBonusIfCrossed } from "../../services/finance/salesTarget";
import { sumAmounts, invoiceTotal } from "../../services/finance/calc";
import {
  quoteCreateSchema,
  quoteUpdateSchema,
  quotePendingPaymentSchema,
  quoteApprovalSchema,
  quoteConvertSchema,
} from "../../validation/crm.schemas";

const INCLUDE = { items: true, pendingPayments: true, client: true, lead: true } as const;

async function nextQuoteCode(): Promise<string> {
  const last = await prisma.quote.findFirst({ orderBy: { quoteCode: "desc" } });
  const lastNum = last ? Number(last.quoteCode.replace("QUO-", "")) : 0;
  return `QUO-${String(lastNum + 1).padStart(2, "0")}`;
}
async function nextAutoInvoiceNo(): Promise<string> {
  const count = await prisma.invoice.count();
  return `DG-${new Date().getFullYear()}-${1000 + count + 1}`;
}

// Mounted behind requireCrmUser (ADMIN, SALES_HEAD or SALES). A plain Sales caller only
// ever sees the quotes they personally prepared (createdBy) — same
// "narrow self-service slice" as listClients/listInvoices — ADMIN and the Sales Head see everyone's.
export const listQuotes: RequestHandler = asyncHandler(async (req, res) => {
  const admin = seesWholeSalesTeam(req.user?.roles);
  const quotes = await prisma.quote.findMany({
    where: admin ? undefined : { createdBy: req.user!.name },
    include: INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  res.json({ quotes });
});

export const createQuote: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = quoteCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const quote = await prisma.quote.create({
    data: { quoteCode: await nextQuoteCode(), clientId: d.clientId, leadId: d.leadId, title: d.title, createdBy: req.user!.name, items: { create: d.items } },
    include: INCLUDE,
  });

  await recordAudit({ userId: req.user!.sub, action: "CRM_QUOTE_CREATE", entityType: "Quote", entityId: quote.id, afterData: d });
  res.status(201).json({ quote });
});

export const updateQuote: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = quoteUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const before = await prisma.quote.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Quote not found" });
  if (before.status === "INVOICED" || before.status === "LOST") {
    return res.status(409).json({ error: `Can't edit a quote that's already ${before.status.toLowerCase()}` });
  }

  const quote = await prisma.$transaction(async (tx) => {
    if (d.items) await tx.quoteItem.deleteMany({ where: { quoteId: before.id } });
    return tx.quote.update({
      where: { id: before.id },
      data: { clientId: d.clientId, leadId: d.leadId, title: d.title, items: d.items ? { create: d.items } : undefined },
      include: INCLUDE,
    });
  });

  await recordAudit({ userId: req.user!.sub, action: "CRM_QUOTE_UPDATE", entityType: "Quote", entityId: quote.id, afterData: d });
  res.json({ quote });
});

export const sendQuote: RequestHandler = asyncHandler(async (req, res) => {
  const quote = await prisma.quote.update({ where: { id: req.params.id }, data: { status: "SENT", sentAt: new Date() } }).catch(() => null);
  if (!quote) return res.status(404).json({ error: "Quote not found" });
  await recordAudit({ userId: req.user!.sub, action: "CRM_QUOTE_SENT", entityType: "Quote", entityId: quote.id });
  res.json({ quote });
});

export const markQuoteLost: RequestHandler = asyncHandler(async (req, res) => {
  const quote = await prisma.quote.update({ where: { id: req.params.id }, data: { status: "LOST" } }).catch(() => null);
  if (!quote) return res.status(404).json({ error: "Quote not found" });
  await recordAudit({ userId: req.user!.sub, action: "CRM_QUOTE_LOST", entityType: "Quote", entityId: quote.id });
  res.json({ quote });
});

// Alternative to the pay-first flow below (submitQuotePendingPayment ->
// Finance's approveQuotePendingPayment) — invoices a sent quote directly,
// with no payment required yet. For Postpaid-style engagements where
// billing happens before collection. Payments against the resulting
// invoice are then recorded the normal way, through the Invoices module.
export const convertQuoteToInvoice: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = quoteConvertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const quote = await prisma.quote.findUnique({ where: { id: req.params.id }, include: { items: true, lead: true } });
  if (!quote) return res.status(404).json({ error: "Quote not found" });
  if (quote.status !== "SENT") return res.status(409).json({ error: "Only a sent quote can be converted to an invoice this way" });

  const result = await prisma.$transaction(async (tx) => {
    let clientId = quote.clientId;

    // Same lead-to-client promotion as approveQuotePendingPayment, just
    // triggered by a direct conversion instead of a first approved payment.
    let convertedClientName: string | null = null;
    if (!clientId && quote.leadId && quote.lead) {
      const existing = await tx.client.findFirst({ where: { name: { equals: quote.lead.name, mode: "insensitive" } } });
      if (existing) {
        clientId = existing.id;
      } else {
        const last = await tx.client.findFirst({ orderBy: { clientCode: "desc" } });
        const lastNum = last ? Number(last.clientCode.replace("CLI-", "")) : 0;
        const services = [...new Set([quote.lead.serviceInterested, ...quote.items.map((i) => i.dept)])];
        const newClient = await tx.client.create({
          data: {
            clientCode: `CLI-${String(lastNum + 1).padStart(2, "0")}`,
            name: quote.lead.name, industry: "—", city: "—", services,
            status: "ACTIVE", onboardedAt: new Date(d.issuedAt), accountManager: quote.lead.leadOwner, salesPerson: quote.lead.leadOwner,
          },
        });
        clientId = newClient.id;
        convertedClientName = quote.lead.name;
      }
      await tx.lead.update({ where: { id: quote.leadId }, data: { status: "CONVERTED", convertedClientId: clientId } });
      await tx.quote.update({ where: { id: quote.id }, data: { clientId } });
    }

    const invoice = await tx.invoice.create({
      data: {
        clientId: clientId!, invoiceNo: await nextAutoInvoiceNo(),
        issuedAt: new Date(d.issuedAt), dueAt: new Date(d.dueAt),
        items: { create: quote.items.map((i) => ({ dept: i.dept, amount: i.amount })) },
      },
    });
    await tx.quote.update({ where: { id: quote.id }, data: { invoiceId: invoice.id, status: "INVOICED" } });

    return { invoiceId: invoice.id, invoiceNo: invoice.invoiceNo, clientId, convertedClientName };
  });

  await recordAudit({ userId: req.user!.sub, action: "CRM_QUOTE_CONVERTED_TO_INVOICE", entityType: "Quote", entityId: quote.id, afterData: result, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.status(201).json(result);
});

// Sales-side: log a payment the client made against this quote and push it
// to Finance — mirrors Invoice's submitPendingPayment exactly.
export const submitQuotePendingPayment: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = quotePendingPaymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const quoteId = req.params.id;

  const quote = await prisma.quote.findUnique({ where: { id: quoteId } });
  if (!quote) return res.status(404).json({ error: "Quote not found" });

  const [pending] = await prisma.$transaction([
    prisma.quotePendingPayment.create({ data: { quoteId, amount: d.amount, paymentDate: new Date(d.paymentDate), note: d.note } }),
    prisma.quote.update({ where: { id: quoteId }, data: { status: "SUBMITTED_TO_FINANCE" } }),
  ]);

  await recordAudit({ userId: req.user!.sub, action: "CRM_QUOTE_PAYMENT_SUBMITTED", entityType: "Quote", entityId: quoteId, afterData: { amount: d.amount } });
  res.status(201).json({ pending });
});

// Same rule as invoices' deletePendingPayment: only a not-yet-approved
// entry can be discarded — once approved it's a real InvoicePayment.
export const deleteQuotePendingPayment: RequestHandler = asyncHandler(async (req, res) => {
  const { id: quoteId, pendingId } = req.params;
  const pending = await prisma.quotePendingPayment.findUnique({ where: { id: pendingId } });
  if (!pending || pending.quoteId !== quoteId) return res.status(404).json({ error: "Pending payment not found" });
  if (pending.approved) return res.status(409).json({ error: "Already approved — it's a real payment now, not a pending entry." });

  await prisma.quotePendingPayment.delete({ where: { id: pendingId } });

  await recordAudit({ userId: req.user!.sub, action: "CRM_QUOTE_PENDING_PAYMENT_DELETE", entityType: "Quote", entityId: quoteId, beforeData: { pendingId, amount: pending.amount } });
  res.status(204).send();
});

// Finance-side: the one real fix this migration owes the old prototype —
// approving a quote payment now goes through the actual Finance transaction
// machinery (recordBankTxn, createCommissionPayable) instead of directly
// mutating in-memory invoices/payables arrays with no ledger entry at all.
// Converts a lead to a client and/or creates the invoice on the first
// approved payment, exactly like the old client-side logic did — just for
// real, in one DB transaction.
export const approveQuotePendingPayment: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = quoteApprovalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const { id: quoteId, pendingId } = req.params;

  const quote = await prisma.quote.findUnique({ where: { id: quoteId }, include: { items: true, lead: true } });
  const pending = await prisma.quotePendingPayment.findUnique({ where: { id: pendingId } });
  if (!quote || !pending || pending.quoteId !== quoteId) return res.status(404).json({ error: "Pending payment not found" });
  if (pending.approved) return res.status(409).json({ error: "Already approved" });

  const date = d.date ? new Date(d.date) : pending.paymentDate;
  const approvedAt = new Date();

  const result = await prisma.$transaction(async (tx) => {
    let clientId = quote.clientId;

    // First approved payment for a lead-targeted quote converts that lead
    // into a client (matching an existing one by name first) — same rule
    // as the old prototype, now a real, persisted conversion.
    if (!clientId && quote.leadId && quote.lead) {
      const existing = await tx.client.findFirst({ where: { name: { equals: quote.lead.name, mode: "insensitive" } } });
      if (existing) {
        clientId = existing.id;
      } else {
        const last = await tx.client.findFirst({ orderBy: { clientCode: "desc" } });
        const lastNum = last ? Number(last.clientCode.replace("CLI-", "")) : 0;
        const services = [...new Set([quote.lead.serviceInterested, ...quote.items.map((i) => i.dept)])];
        const newClient = await tx.client.create({
          data: {
            clientCode: `CLI-${String(lastNum + 1).padStart(2, "0")}`,
            name: quote.lead.name, industry: "—", city: "—", services,
            status: "ACTIVE", onboardedAt: date, accountManager: quote.lead.leadOwner, salesPerson: quote.lead.leadOwner,
          },
        });
        clientId = newClient.id;
      }
      await tx.lead.update({ where: { id: quote.leadId }, data: { status: "CONVERTED", convertedClientId: clientId } });
      await tx.quote.update({ where: { id: quoteId }, data: { clientId } });
    }

    // Create the invoice on the first approved payment, then top it up on
    // every later one — same rule as the old prototype.
    let invoiceId = quote.invoiceId;
    if (!invoiceId) {
      const invoice = await tx.invoice.create({
        data: {
          clientId: clientId!, invoiceNo: d.invoiceNo || (await nextAutoInvoiceNo()),
          issuedAt: date, dueAt: date, items: { create: quote.items.map((i) => ({ dept: i.dept, amount: i.amount })) },
        },
      });
      invoiceId = invoice.id;
      await tx.quote.update({ where: { id: quoteId }, data: { invoiceId } });
    }

    const payment = await tx.invoicePayment.create({
      data: { invoiceId, amount: pending.amount, paidDate: date, accountId: d.accountId, note: `Quote ${quote.quoteCode} — payment confirmed by Finance`, recordedBy: req.user!.sub },
    });
    await recordBankTxn(tx, { accountId: d.accountId, date, type: "CREDIT", amount: Number(pending.amount), note: `Invoice from quote ${quote.quoteCode}`, refType: "INVOICE_PAYMENT", refId: payment.id });

    let commission = null;
    let salesBonus = null;
    if (quote.createdBy) {
      commission = await createCommissionPayable(tx, { salesPerson: quote.createdBy, sourceLabel: quote.quoteCode, paymentAmount: Number(pending.amount), dueAt: date });
      // Must run BEFORE this row is marked approved below — same reasoning as
      // the invoice pending-payment approval path, see salesTarget.ts.
      salesBonus = await createSalesBonusIfCrossed(tx, { salesPerson: quote.createdBy, paymentAmount: Number(pending.amount), date: approvedAt });
    }
    await tx.quotePendingPayment.update({ where: { id: pendingId }, data: { approved: true, approvedAt, invoicePayment: payment.id } });

    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { items: true, payments: true } });
    const balance = invoiceTotal(invoice.items) - sumAmounts(invoice.payments);
    if (balance <= 0.01) await tx.quote.update({ where: { id: quoteId }, data: { status: "INVOICED" } });

    return { payment, commission, salesBonus, invoiceId, clientId, balance };
  });

  await recordAudit({ userId: req.user!.sub, action: "CRM_QUOTE_PAYMENT_APPROVED", entityType: "Quote", entityId: quoteId, afterData: { pendingId, amount: pending.amount }, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.status(201).json(result);
});

// Blocked once a payment has been approved against this quote — that's
// exactly when invoiceId gets set (see approveQuotePendingPayment above),
// so it doubles as "has any money actually moved" without a second query.
// Cascades items/pendingPayments (schema) — an unconfirmed pending payment
// still just gets discarded along with the quote, same as it would if
// Finance rejected it outright.
export const deleteQuote: RequestHandler = asyncHandler(async (req, res) => {
  const quote = await prisma.quote.findUnique({ where: { id: req.params.id } });
  if (!quote) return res.status(404).json({ error: "Quote not found" });
  if (quote.invoiceId) {
    return res.status(409).json({ error: "Can't delete a quote that's already been invoiced — its payment ledger is append-only." });
  }

  await prisma.quote.delete({ where: { id: quote.id } });

  await recordAudit({ userId: req.user!.sub, action: "CRM_QUOTE_DELETE", entityType: "Quote", entityId: quote.id, beforeData: { quoteCode: quote.quoteCode } });
  res.status(204).send();
});
