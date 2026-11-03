import type { Prisma } from "@prisma/client";
import { accountIdByName } from "./payableAccounts";
import { invoiceTotal, sumAmounts } from "./calc";

// The upsell Sales tagged on payments (InvoicePendingPayment.upsellAmount) is owed to that salesperson once the
// invoice is FULLY paid — on top of the normal commission. It is a Payable with category UPSELL, one per
// salesperson per invoice, so Finance settles it from Accounts > Commissions / Payables like any other.
// Call this inside the approval transaction AFTER the pending row has been marked approved. Safe to call again:
// it only ever creates the part not already owed (top-up), never a duplicate.
export const upsellPayee = (salesPerson: string, invoiceNo: string) => `${salesPerson} — upsell on ${invoiceNo}`;

export async function createUpsellPayablesIfFullyPaid(
  tx: Prisma.TransactionClient,
  params: { invoiceId: string; invoiceNo: string; sourcePaymentId: string; date: Date }
) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: params.invoiceId }, include: { items: true, payments: true } });
  if (invoiceTotal(inv.items) - sumAmounts(inv.payments) > 0.01) return [];

  const rows = await tx.invoicePendingPayment.findMany({
    where: { invoiceId: params.invoiceId, approved: true, upsellAmount: { gt: 0 }, salesPerson: { not: null } },
    select: { salesPerson: true, upsellAmount: true },
  });
  const owedBy = new Map<string, number>();
  for (const r of rows) owedBy.set(r.salesPerson!, (owedBy.get(r.salesPerson!) ?? 0) + Number(r.upsellAmount));

  const created = [];
  for (const [salesPerson, total] of owedBy) {
    const payee = upsellPayee(salesPerson, params.invoiceNo);
    const existing = await tx.payable.findMany({ where: { category: "UPSELL", payee }, select: { amount: true } });
    const delta = Math.round(total - sumAmounts(existing));
    if (delta <= 0) continue;
    created.push(await tx.payable.create({
      data: {
        category: "UPSELL",
        accountId: await accountIdByName(tx, "Upsell Payable"),
        payee,
        salesPerson,
        amount: delta,
        dueAt: params.date,
        sourcePaymentId: params.sourcePaymentId,
      },
    }));
  }
  return created;
}
