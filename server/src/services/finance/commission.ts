import type { Prisma } from "@prisma/client";

// Flat 10% — hardcoded in the old prototype too (not per-employee or
// per-client configurable anywhere), kept as-is rather than inventing
// configurability nobody asked for.
export const SALES_COMMISSION_RATE = 0.1;

// Commission is modeled as a Payable with category=COMMISSION, not its own
// entity — matches the old prototype's shape. Exported so Phase 4's quote-
// payment approval can create one the same way once quotes are migrated.
export async function createCommissionPayable(
  tx: Prisma.TransactionClient,
  params: { salesPerson: string; sourceLabel: string; paymentAmount: number; dueAt: Date; sourcePaymentId: string }
) {
  const commissionAmount = Math.round(params.paymentAmount * SALES_COMMISSION_RATE);
  if (commissionAmount <= 0) return null;
  return tx.payable.create({
    data: {
      category: "COMMISSION",
      payee: `${params.salesPerson} — commission on ${params.sourceLabel}`,
      salesPerson: params.salesPerson,
      amount: commissionAmount,
      dueAt: params.dueAt,
      sourcePaymentId: params.sourcePaymentId,
    },
  });
}
