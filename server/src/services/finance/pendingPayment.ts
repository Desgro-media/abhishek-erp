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

// The received date decides which month a payment counts in (sales total, target, bonus, commission),
// so it is checked server-side whoever supplies it: not in the future, not older than MAX_BACKDATE_DAYS.
// "Today" is India time, matching how months are shown.
export const MAX_BACKDATE_DAYS = 120;
export function assertReceivedDate(date: Date) {
  const day = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const today = day(new Date());
  const given = date.toISOString().slice(0, 10);
  const oldest = new Date(new Date(today + "T00:00:00Z").getTime() - MAX_BACKDATE_DAYS * 86400_000).toISOString().slice(0, 10);
  if (given > today) throw Object.assign(new Error("The received date can't be in the future"), { status: 400 });
  if (given < oldest) throw Object.assign(new Error(`The received date can't be more than ${MAX_BACKDATE_DAYS} days ago`), { status: 400 });
}
