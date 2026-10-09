import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { nextSequentialCode } from "../utils/sequentialCode";
import { invoiceTotal, sumAmounts } from "./finance/calc";
import { recordAudit } from "./audit.service";

// Everything about a lead's advance payments lives here, so there is exactly one place that decides how a
// lead becomes a client and how an advance reaches an invoice.
//
// THE RULE: a lead payment is only a record Sales reports. It creates no bank entry, no revenue and no
// commission. It reaches the books only when an invoice exists for the client the lead became: then each
// unattached payment is carried onto that invoice as an ordinary InvoicePendingPayment, and Finance approves
// it through the existing, unchanged approval — choosing the bank account and the true received date,
// which is also what commission and the sales bonus follow (cash basis). Nothing here writes to
// invoice_payments, the bank ledger, payables or any report.

type Db = Prisma.TransactionClient;

export const DEFAULT_LEAD_CONVERSION_THRESHOLD = 5000;
export const LEAD_PAYMENT_MODE_LABEL = { BANK_TRANSFER: "Bank transfer", UPI: "UPI", CASH: "Cash", CHEQUE: "Cheque" } as const;
const cents = (n: number) => Math.round(n * 100);

export async function getLeadConversionThreshold(db: Pick<Db, "salesPolicy"> = prisma): Promise<number> {
  const p = await db.salesPolicy.findUnique({ where: { id: 1 }, select: { leadConversionThreshold: true } });
  return Number(p?.leadConversionThreshold ?? DEFAULT_LEAD_CONVERSION_THRESHOLD);
}

// Row lock so two requests touching the same lead (two payments at once, a payment racing a convert) run one
// after the other and can't both create a client.
export async function lockLead(tx: Db, leadId: string) {
  await tx.$queryRaw`SELECT id FROM leads WHERE id = ${leadId} FOR UPDATE`;
}

export type ConvertOptions = {
  name?: string;
  industry?: string;
  city?: string;
  services?: string[];
  billingType?: "PREPAID" | "POSTPAID";
  onboardedAt: Date;
  via: string; // shown as who/what converted it, e.g. "Converted manually" / "Auto-converted — paid ₹5,500"
};

// The single place a lead becomes a client. Links to an existing client of the same name (case-insensitive)
// instead of creating a duplicate — the same rule quote -> invoice conversion has always used.
export async function convertLeadToClient(tx: Db, lead: { id: string; name: string; serviceInterested: string; leadOwner: string | null }, opts: ConvertOptions) {
  const name = (opts.name ?? lead.name).trim();
  const existing = await tx.client.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  let clientId: string;
  let created = false;
  if (existing) {
    clientId = existing.id;
  } else {
    const clientCode = nextSequentialCode("CLI-", (await tx.client.findMany({ select: { clientCode: true } })).map((c) => c.clientCode));
    const client = await tx.client.create({
      data: {
        clientCode, name, industry: opts.industry || "—", city: opts.city || "—",
        services: opts.services?.length ? opts.services : [lead.serviceInterested],
        status: "ACTIVE", billingType: opts.billingType ?? "PREPAID", onboardedAt: opts.onboardedAt,
        accountManager: lead.leadOwner, salesPerson: lead.leadOwner,
      },
    });
    clientId = client.id;
    created = true;
  }
  await tx.lead.update({
    where: { id: lead.id },
    data: { status: "CONVERTED", convertedClientId: clientId, stage: "WON", lostReason: null, lostNote: null, stageChangedAt: new Date(), stageSetBy: opts.via },
  });
  return { clientId, created };
}

// Called inside the transaction that just recorded a payment (lead row already locked): converts the lead
// once what it has paid reaches the threshold. Counts what Sales RECORDED — nothing can be Finance-approved
// before an invoice exists — and converting moves no money, it only makes a client record.
export async function autoConvertIfDue(tx: Db, leadId: string, actorUserId: string | null) {
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
  if (lead.convertedClientId) return null;
  const paid = Number((await tx.leadPayment.aggregate({ where: { leadId }, _sum: { amount: true } }))._sum.amount ?? 0);
  const threshold = await getLeadConversionThreshold(tx);
  if (paid <= 0 || cents(paid) < cents(threshold)) return null;
  const res = await convertLeadToClient(tx, lead, { onboardedAt: new Date(), via: `Auto-converted — paid ₹${paid.toLocaleString("en-IN")}` });
  await recordAudit({ userId: actorUserId, action: "CRM_LEAD_AUTO_CONVERTED", entityType: "Lead", entityId: leadId, afterData: { clientId: res.clientId, paid, threshold, createdClient: res.created } }, tx);
  return res;
}

// Called inside the transaction that just created an invoice for `clientId`. Carries each advance the
// client's lead(s) paid, that isn't on an invoice yet, onto this one as a pending payment — oldest first,
// whole payments only, and only while they still fit in what's left to pay. What doesn't fit stays
// "awaiting invoice" for the next one. "What's left" counts approved payments, pending payments and any
// unapproved quote payment on this invoice's quote, so carrying can never push an invoice into over-payment.
export async function carryLeadAdvances(tx: Db, params: { clientId: string; invoiceId: string; actorUserId: string | null }) {
  const leads = await tx.lead.findMany({ where: { convertedClientId: params.clientId }, select: { id: true, leadCode: true } });
  if (!leads.length) return [];
  const payments = await tx.leadPayment.findMany({
    where: { leadId: { in: leads.map((l) => l.id) }, invoicePendingPaymentId: null },
    orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
  });
  if (!payments.length) return [];

  await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${params.invoiceId} FOR UPDATE`;
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: params.invoiceId }, include: { items: true, payments: true, pendingPayments: true } });
  const quotePending = await tx.quotePendingPayment.findMany({ where: { approved: false, quote: { invoiceId: params.invoiceId } }, select: { amount: true } });
  let remaining = cents(invoiceTotal(inv.items) - sumAmounts(inv.payments) - sumAmounts(inv.pendingPayments.filter((p) => !p.approved)) - sumAmounts(quotePending));

  const leadCode = new Map(leads.map((l) => [l.id, l.leadCode]));
  const carried: { leadPaymentId: string; pendingId: string; amount: number }[] = [];
  for (const p of payments) {
    const amount = Number(p.amount);
    if (cents(amount) > remaining) continue; // doesn't fit whole — waits for the next invoice
    const pending = await tx.invoicePendingPayment.create({
      data: {
        invoiceId: params.invoiceId, amount: p.amount, paymentDate: p.paymentDate, salesPerson: p.salesPerson,
        note: `Advance received while a lead (${LEAD_PAYMENT_MODE_LABEL[p.mode]}) — ${leadCode.get(p.leadId)}${p.note ? ` — ${p.note}` : ""}`,
      },
    });
    // Claim conditionally: if a concurrent carry got there first, undo ours rather than double-count.
    const claimed = await tx.leadPayment.updateMany({ where: { id: p.id, invoicePendingPaymentId: null }, data: { invoicePendingPaymentId: pending.id, carriedAt: new Date() } });
    if (claimed.count !== 1) { await tx.invoicePendingPayment.delete({ where: { id: pending.id } }); continue; }
    remaining -= cents(amount);
    carried.push({ leadPaymentId: p.id, pendingId: pending.id, amount });
    await recordAudit({ userId: params.actorUserId, action: "CRM_LEAD_ADVANCE_CARRIED", entityType: "Invoice", entityId: params.invoiceId, afterData: { leadPaymentId: p.id, pendingPaymentId: pending.id, amount, reportedDate: p.paymentDate.toISOString().slice(0, 10) } }, tx);
  }
  return carried;
}
