import { RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { SALES_COMMISSION_RATE } from "../../services/finance/commission";
import { sumAmounts, invoiceTotal } from "../../services/finance/calc";
import { approvedReceiptUpdateSchema } from "../../validation/finance.schemas";

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

// ---------------------------------------------------------------------------------------------
// Editing / deleting an APPROVED payment.
//
// An approved payment has already fed the bank ledger, the invoice balance, revenue and (for a
// Sales-pushed one) a commission, so neither operation is a plain row update — each keeps all of
// that in sync inside one transaction, or refuses with a reason and changes nothing. The payment
// row is locked first so two edits/deletes (or an edit racing a delete) can't interleave.
// ---------------------------------------------------------------------------------------------
type Tx = Prisma.TransactionClient;
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

async function loadReceiptContext(tx: Tx, paymentId: string) {
  await tx.$queryRaw`SELECT id FROM invoice_payments WHERE id = ${paymentId} FOR UPDATE`;
  const payment = await tx.invoicePayment.findUnique({ where: { id: paymentId }, include: { invoice: { include: { items: true, payments: true } } } });
  if (!payment) throw httpError(404, "Payment not found");
  const [ip, qp, linked, bankTxn] = await Promise.all([
    tx.invoicePendingPayment.findFirst({ where: { invoicePayment: paymentId } }),
    tx.quotePendingPayment.findFirst({ where: { invoicePayment: paymentId }, include: { quote: true } }),
    tx.payable.findMany({ where: { sourcePaymentId: paymentId }, include: { payments: true } }),
    tx.bankTransaction.findFirst({ where: { refType: "INVOICE_PAYMENT", refId: paymentId } }),
  ]);
  return {
    payment, ip, qp, bankTxn,
    commissions: linked.filter((c) => c.category === "COMMISSION"),
    bonuses: linked.filter((c) => c.category === "SALES_BONUS"),
    salesPerson: ip?.salesPerson ?? qp?.quote.createdBy ?? null,
    approvedAt: ip?.approvedAt ?? qp?.approvedAt ?? payment.createdAt,
  };
}
type ReceiptCtx = Awaited<ReturnType<typeof loadReceiptContext>>;

// The monthly target bonus is computed from that month's running total of approved sales, so changing
// or removing ONE payment can invalidate a bonus that was generated by it or by a later one. Rather
// than silently recompute money already owed, refuse until Finance has dealt with the bonus in Payables.
async function assertNoSalesBonus(tx: Tx, ctx: ReceiptCtx) {
  if (!ctx.salesPerson) return;
  const month = ctx.approvedAt.toISOString().slice(0, 7);
  const n = await tx.payable.count({ where: { category: "SALES_BONUS", salesPerson: ctx.salesPerson, payee: { contains: `(${month})` } } });
  if (n > 0 || ctx.bonuses.length > 0) {
    throw httpError(409, `${ctx.salesPerson}'s ${month} sales bonus was generated from this month's approved payments — reverse or adjust that bonus in Accounts > Payables first.`);
  }
}

// "Untouched" = the single auto-generated commission: one row, still exactly the flat rate of the
// current amount, nothing paid against it. Anything else means someone edited, split or paid it, and
// this must not overwrite that work.
const commissionIsUntouched = (ctx: ReceiptCtx, amount: number) =>
  ctx.commissions.length === 1 &&
  ctx.commissions[0].payments.length === 0 &&
  Number(ctx.commissions[0].amount) === Math.round(amount * SALES_COMMISSION_RATE) &&
  ctx.commissions[0].salesPerson === ctx.salesPerson;

export const updateApprovedReceipt: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = approvedReceiptUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const paymentId = req.params.id;

  const payment = await prisma.$transaction(async (tx) => {
    const ctx = await loadReceiptContext(tx, paymentId);
    const oldAmount = Number(ctx.payment.amount);
    const amount = d.amount ?? oldAmount;
    const amountChanged = Math.abs(amount - oldAmount) > 0.001;
    const date = d.paidDate ? new Date(d.paidDate) : ctx.payment.paidDate;
    const dateChanged = d.paidDate !== undefined && date.getTime() !== ctx.payment.paidDate.getTime();

    if (d.accountId) {
      const acct = await tx.bankAccount.findUnique({ where: { id: d.accountId } });
      if (!acct) throw httpError(400, "Bank account not found");
    }

    const untouched = commissionIsUntouched(ctx, oldAmount);
    if (amountChanged) {
      const others = sumAmounts(ctx.payment.invoice.payments) - oldAmount;
      if (others + amount > invoiceTotal(ctx.payment.invoice.items) + 0.01) throw httpError(400, "That would put the invoice over-paid — the amount can't exceed what's left on it");
      await assertNoSalesBonus(tx, ctx);
      if (ctx.commissions.length > 0 && !untouched) {
        const why = ctx.commissions.length > 1 ? "was split" : ctx.commissions[0].payments.length > 0 ? "has already been paid out" : "was edited";
        throw httpError(409, `Can't change the amount — the commission from this payment ${why}. Adjust it in Accounts > Commissions first, or edit only the date, bank account or note.`);
      }
    }

    const updated = await tx.invoicePayment.update({
      where: { id: paymentId },
      data: { amount: d.amount, paidDate: d.paidDate ? date : undefined, accountId: d.accountId, note: d.note === undefined ? undefined : d.note },
    });

    // The ledger row this payment posted moves with it.
    if (ctx.bankTxn) {
      await tx.bankTransaction.update({ where: { id: ctx.bankTxn.id }, data: { amount: d.amount, date: d.paidDate ? date : undefined, accountId: d.accountId } });
    }

    // Commission follows the payment only when it's still the untouched auto-generated one.
    if (untouched && (amountChanged || dateChanged)) {
      const c = ctx.commissions[0];
      const newCommission = Math.round(amount * SALES_COMMISSION_RATE);
      if (newCommission > 0) await tx.payable.update({ where: { id: c.id }, data: { amount: newCommission, dueAt: date } });
      else await tx.payable.delete({ where: { id: c.id } });
    }

    // Keep the approved pending row in step: the monthly sales-target figures sum its amount.
    if (amountChanged) {
      if (ctx.ip) await tx.invoicePendingPayment.update({ where: { id: ctx.ip.id }, data: { amount } });
      if (ctx.qp) {
        await tx.quotePendingPayment.update({ where: { id: ctx.qp.id }, data: { amount } });
        const balance = invoiceTotal(ctx.payment.invoice.items) - (sumAmounts(ctx.payment.invoice.payments) - oldAmount + amount);
        await tx.quote.update({ where: { id: ctx.qp.quoteId }, data: { status: balance <= 0.01 ? "INVOICED" : "SUBMITTED_TO_FINANCE" } });
      }
    }

    await recordAudit(
      { userId: req.user!.sub, action: "FIN_RECEIPT_EDIT", entityType: "InvoicePayment", entityId: paymentId,
        beforeData: { amount: oldAmount, paidDate: ctx.payment.paidDate, accountId: ctx.payment.accountId, note: ctx.payment.note }, afterData: d, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null },
      tx
    );
    return updated;
  });

  res.json({ payment });
});

// Reverses an approved payment: the payment, its bank-ledger entry and its unpaid commission are removed,
// and a Sales-pushed payment goes back to Pending so it can be re-approved (or discarded there). A Direct
// payment has nothing to go back to and is simply removed. Refused if any of its commission has already
// been paid out, or a sales bonus depends on it — money that's left the building isn't quietly undone.
export const deleteApprovedReceipt: RequestHandler = asyncHandler(async (req, res) => {
  const paymentId = req.params.id;

  await prisma.$transaction(async (tx) => {
    const ctx = await loadReceiptContext(tx, paymentId);
    if ([...ctx.commissions, ...ctx.bonuses].some((c) => c.payments.length > 0)) {
      throw httpError(409, "Can't delete — commission from this payment has already been paid out. Reverse that payout in Accounts > Payables first.");
    }
    await assertNoSalesBonus(tx, ctx);

    await tx.payable.deleteMany({ where: { sourcePaymentId: paymentId } });
    await tx.bankTransaction.deleteMany({ where: { refType: "INVOICE_PAYMENT", refId: paymentId } });
    await tx.invoicePayment.delete({ where: { id: paymentId } });

    // Back to the Pending queue, exactly as Sales pushed it.
    if (ctx.ip) await tx.invoicePendingPayment.update({ where: { id: ctx.ip.id }, data: { approved: false, approvedAt: null, invoicePayment: null } });
    if (ctx.qp) {
      await tx.quotePendingPayment.update({ where: { id: ctx.qp.id }, data: { approved: false, approvedAt: null, invoicePayment: null } });
      await tx.quote.update({ where: { id: ctx.qp.quoteId }, data: { status: "SUBMITTED_TO_FINANCE" } });
    }

    await recordAudit(
      { userId: req.user!.sub, action: "FIN_RECEIPT_REVERSED", entityType: "InvoicePayment", entityId: paymentId,
        beforeData: { invoiceNo: ctx.payment.invoice.invoiceNo, amount: Number(ctx.payment.amount), paidDate: ctx.payment.paidDate, accountId: ctx.payment.accountId,
          source: ctx.qp ? "Quote" : ctx.ip ? "Invoice" : "Direct", returnedToPending: !!(ctx.ip || ctx.qp), commissionsRemoved: ctx.commissions.map((c) => Number(c.amount)) },
        ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null },
      tx
    );
  });

  res.status(204).send();
});
