import { accountIdByName } from "./payableAccounts";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";

const DEFAULT_MONTHLY_TARGET = 500000;
const DEFAULT_BONUS_RATE = 0.1;

export async function getSalesPolicy() {
  const policy = await prisma.salesPolicy.findUnique({ where: { id: 1 } });
  return {
    monthlyTarget: Number(policy?.monthlyTarget ?? DEFAULT_MONTHLY_TARGET),
    bonusRate: Number(policy?.bonusRate ?? DEFAULT_BONUS_RATE),
  };
}

// Raw approved sales volume for one salesperson in one month, on a cash basis by the date the client's
// money was RECEIVED (InvoicePayment.paidDate, which Finance sets/confirms at approval) — not when it was
// approved, quoted or invoiced. Approval only gates whether a payment counts at all. This is the same
// date Department Profitability and the P&L (revenue.ts) bucket on, so no two screens can place one
// payment in different months. Always computed from the records, never stored. The amount is the real
// payment's, so a later edit of an approved payment is picked up too. Unapproved pending rows have no
// payment row yet (invoice_payment_id is null) and so never count.
export async function monthlyApprovedSales(
  tx: Prisma.TransactionClient | typeof prisma,
  salesPerson: string,
  month: string
): Promise<number> {
  const rows = await tx.$queryRaw<{ total: unknown }[]>`
    SELECT COALESCE(SUM(t.amount), 0) AS total FROM (
      SELECT ip.amount FROM invoice_pending_payments pp
        JOIN invoice_payments ip ON ip.id = pp.invoice_payment_id
        WHERE pp.approved AND pp.sales_person = ${salesPerson} AND to_char(ip.paid_date, 'YYYY-MM') = ${month}
      UNION ALL
      SELECT ip.amount FROM quote_pending_payments qp
        JOIN quotes q ON q.id = qp.quote_id
        JOIN invoice_payments ip ON ip.id = qp.invoice_payment_id
        WHERE qp.approved AND q.created_by = ${salesPerson} AND to_char(ip.paid_date, 'YYYY-MM') = ${month}
    ) t`;
  return Number(rows[0]?.total ?? 0);
}

// Flat bonusRate on whatever's past target — mathematically identical to
// 10% per ₹1L slab past target, just without looping over slabs.
export function bonusForTotal(total: number, target: number, bonusRate: number): number {
  return Math.max(0, total - target) * bonusRate;
}

// Called right after the existing flat-commission payable is created, in
// the same transaction, at both approval points (invoice pending-payment
// and quote pending-payment). priorTotal is queried BEFORE this payment
// counts (its pending row isn't marked approved/linked yet at this point in either caller), so
// bonusForTotal(before) vs bonusForTotal(after) — not a fresh sum each
// time — is what makes crossing the line mid-approval land exactly on the
// newly-earned slice, never double- or under-counted against earlier
// approvals this month.
export async function createSalesBonusIfCrossed(
  tx: Prisma.TransactionClient,
  params: { salesPerson: string; paymentAmount: number; date: Date; sourcePaymentId: string }
) {
  const { monthlyTarget, bonusRate } = await getSalesPolicy();
  // params.date is the payment's RECEIVED date, so a late approval of an October payment adds an October
  // line (an unpaid one — anything already settled for October is left alone).
  const month = params.date.toISOString().slice(0, 7);

  const priorTotal = await monthlyApprovedSales(tx, params.salesPerson, month);
  const newTotal = priorTotal + params.paymentAmount;
  const bonusDelta = bonusForTotal(newTotal, monthlyTarget, bonusRate) - bonusForTotal(priorTotal, monthlyTarget, bonusRate);

  const roundedDelta = Math.round(bonusDelta);
  if (roundedDelta <= 0) return null;

  return tx.payable.create({
    data: {
      category: "SALES_BONUS",
      accountId: await accountIdByName(tx, "Sales Bonus Payable"),
      payee: `${params.salesPerson} — monthly target bonus (${month})`,
      salesPerson: params.salesPerson,
      amount: roundedDelta,
      dueAt: params.date,
      sourcePaymentId: params.sourcePaymentId,
    },
  });
}
