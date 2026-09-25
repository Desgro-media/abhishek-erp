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

function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0, 23, 59, 59));
  return { start, end };
}

// Raw approved sales volume for one salesperson in one month — the actual
// payment amounts Finance confirmed, not the 10% commission on them (that's
// a different, already-existing figure — see commission.ts). Pulled from
// the two approval tables directly rather than from Commission payables,
// since a Commission payable only ever stores the discounted amount.
export async function monthlyApprovedSales(
  tx: Prisma.TransactionClient | typeof prisma,
  salesPerson: string,
  month: string
): Promise<number> {
  const { start, end } = monthBounds(month);
  const [invoiceTotal, quoteTotal] = await Promise.all([
    tx.invoicePendingPayment.aggregate({
      where: { salesPerson, approved: true, approvedAt: { gte: start, lte: end } },
      _sum: { amount: true },
    }),
    tx.quotePendingPayment.aggregate({
      where: { approved: true, approvedAt: { gte: start, lte: end }, quote: { createdBy: salesPerson } },
      _sum: { amount: true },
    }),
  ]);
  return Number(invoiceTotal._sum.amount ?? 0) + Number(quoteTotal._sum.amount ?? 0);
}

// Flat bonusRate on whatever's past target — mathematically identical to
// 10% per ₹1L slab past target, just without looping over slabs.
export function bonusForTotal(total: number, target: number, bonusRate: number): number {
  return Math.max(0, total - target) * bonusRate;
}

// Called right after the existing flat-commission payable is created, in
// the same transaction, at both approval points (invoice pending-payment
// and quote pending-payment). priorTotal is queried BEFORE this payment
// counts (it isn't marked approved yet at this point in either caller), so
// bonusForTotal(before) vs bonusForTotal(after) — not a fresh sum each
// time — is what makes crossing the line mid-approval land exactly on the
// newly-earned slice, never double- or under-counted against earlier
// approvals this month.
export async function createSalesBonusIfCrossed(
  tx: Prisma.TransactionClient,
  params: { salesPerson: string; paymentAmount: number; date: Date; sourcePaymentId: string }
) {
  const { monthlyTarget, bonusRate } = await getSalesPolicy();
  const month = params.date.toISOString().slice(0, 7);

  const priorTotal = await monthlyApprovedSales(tx, params.salesPerson, month);
  const newTotal = priorTotal + params.paymentAmount;
  const bonusDelta = bonusForTotal(newTotal, monthlyTarget, bonusRate) - bonusForTotal(priorTotal, monthlyTarget, bonusRate);

  const roundedDelta = Math.round(bonusDelta);
  if (roundedDelta <= 0) return null;

  return tx.payable.create({
    data: {
      category: "SALES_BONUS",
      payee: `${params.salesPerson} — monthly target bonus (${month})`,
      salesPerson: params.salesPerson,
      amount: roundedDelta,
      dueAt: params.date,
      sourcePaymentId: params.sourcePaymentId,
    },
  });
}
