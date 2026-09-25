import { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

// Serialises approvals of one pending payment. The controllers' up-front `approved` check
// runs outside the transaction, so a double-click (or two Finance users) could pass it
// together and both post a ledger credit and a commission. Taking a row lock as the first
// step of the transaction makes the second approval wait, then see approved=true and bail —
// the whole transaction (including anything already written) rolls back on the throw.
export async function lockUnapprovedPending(tx: Tx, table: "invoice_pending_payments" | "quote_pending_payments", id: string) {
  const rows = await tx.$queryRaw<{ approved: boolean }[]>(Prisma.sql`SELECT approved FROM ${Prisma.raw(table)} WHERE id = ${id} FOR UPDATE`);
  if (!rows[0]) throw Object.assign(new Error("Pending payment not found"), { status: 404 });
  if (rows[0].approved) throw Object.assign(new Error("Already approved"), { status: 409 });
}
