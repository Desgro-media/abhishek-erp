import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";

// Accounts > Payment Receipts > Approved: every payment Finance has confirmed, newest first — whether
// Sales pushed it (against an invoice or a quote) or Finance recorded it straight on the invoice
// ("Direct", no push). One row per InvoicePayment, which is the source of truth for "confirmed":
// approval creates it, the pending rows just point at it (invoicePayment) once approved.
//
// The pending tables link by plain id rather than a Prisma relation, and `recordedBy` is a bare user
// id, so those are resolved with a handful of batched lookups keyed on this page's payment ids
// (not per row), then stitched together here.
export const listApprovedReceipts: RequestHandler = asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const [total, payments] = await Promise.all([
    prisma.invoicePayment.count(),
    prisma.invoicePayment.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: offset,
      take: limit,
      include: { invoice: { include: { client: true } }, account: true },
    }),
  ]);
  const ids = payments.map((p) => p.id);

  const [invoicePending, quotePending, commissions, approvers] = await Promise.all([
    prisma.invoicePendingPayment.findMany({ where: { invoicePayment: { in: ids } } }),
    prisma.quotePendingPayment.findMany({ where: { invoicePayment: { in: ids } }, include: { quote: true } }),
    prisma.payable.findMany({ where: { sourcePaymentId: { in: ids }, category: "COMMISSION" }, orderBy: { createdAt: "asc" } }),
    prisma.user.findMany({ where: { id: { in: [...new Set(payments.map((p) => p.recordedBy).filter((x): x is string => !!x))] } }, select: { id: true, name: true } }),
  ]);

  const invoicePendingByPayment = new Map(invoicePending.map((x) => [x.invoicePayment!, x]));
  const quotePendingByPayment = new Map(quotePending.map((x) => [x.invoicePayment!, x]));
  const approverName = new Map(approvers.map((u) => [u.id, u.name]));

  const rows = payments.map((p) => {
    const ip = invoicePendingByPayment.get(p.id);
    const qp = quotePendingByPayment.get(p.id);
    return {
      paymentId: p.id,
      source: qp ? "Quote" : ip ? "Invoice" : "Direct",
      invoiceId: p.invoiceId,
      invoiceNo: p.invoice.invoiceNo,
      quoteCode: qp?.quote.quoteCode ?? null,
      clientId: p.invoice.clientId,
      clientName: p.invoice.client.name,
      amount: Number(p.amount),
      paidDate: p.paidDate,
      approvedAt: ip?.approvedAt ?? qp?.approvedAt ?? p.createdAt,
      // "—" in the UI for Direct: there's no Sales person behind it.
      pushedBy: ip?.salesPerson ?? qp?.quote.createdBy ?? null,
      approvedBy: p.recordedBy ? approverName.get(p.recordedBy) ?? null : null,
      bankAccount: { id: p.accountId, name: p.account.name },
      note: p.note,
      // Zero, one, or several (a split) — each is a real Payable row, so an edit to its amount shows here.
      commissions: commissions
        .filter((c) => c.sourcePaymentId === p.id)
        .map((c) => ({ payableId: c.id, amount: Number(c.amount), salesPerson: c.salesPerson })),
    };
  });

  res.json({ total, limit, offset, receipts: rows });
});
