import type { Prisma, PayableCategory, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

// Internal "kind" for a liability account — drives commission/bonus automation and the reports until
// the category enum is retired. Any liability without a dedicated kind is a general (VENDOR) payable.
const KIND_BY_ACCOUNT: Record<string, PayableCategory> = {
  "Rent Payable": "RENT",
  "Commission Payable": "COMMISSION",
  "Sales Bonus Payable": "SALES_BONUS",
  "Internal Loan": "INTERNAL_LOAN",
};

export function categoryForAccountName(name: string): PayableCategory {
  return KIND_BY_ACCOUNT[name] ?? "VENDOR";
}

// Server-side gate: the account must exist and be typed Liability. Returns the derived category, or an error string.
export async function resolvePayableAccount(db: Db, accountId: string): Promise<{ category: PayableCategory } | { error: string }> {
  const acct = await db.chartOfAccount.findUnique({ where: { id: accountId } });
  if (!acct) return { error: "Account not found" };
  if (acct.type !== "LIABILITY") return { error: "Payables can only be booked to a Liability account" };
  return { category: categoryForAccountName(acct.name) };
}

// For system-generated payables (commission / sales bonus): look the account up by name.
export async function accountIdByName(db: Db, name: string): Promise<string | null> {
  const acct = await db.chartOfAccount.findFirst({ where: { name, type: "LIABILITY" }, select: { id: true } });
  return acct?.id ?? null;
}
