import { z } from "zod";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const monthStr = z.string().regex(/^\d{4}-\d{2}$/, "Expected YYYY-MM");

export const invoiceItemSchema = z.object({ dept: z.string().min(1), amount: z.number().positive() });

export const invoiceCreateSchema = z.object({
  clientId: z.string().min(1),
  invoiceNo: z.string().min(1),
  issuedAt: dateStr,
  dueAt: dateStr,
  items: z.array(invoiceItemSchema).min(1),
});

export const invoiceUpdateSchema = z.object({
  clientId: z.string().min(1).optional(),
  invoiceNo: z.string().min(1).optional(),
  issuedAt: dateStr.optional(),
  dueAt: dateStr.optional(),
  items: z.array(invoiceItemSchema).min(1).optional(),
});

export const invoicePaymentSchema = z.object({
  amount: z.number().positive(),
  paidDate: dateStr,
  accountId: z.string().uuid(),
  note: z.string().optional(),
});

export const invoicePendingPaymentSchema = z.object({
  amount: z.number().positive(),
  paymentDate: dateStr,
  salesPerson: z.string().optional(),
  note: z.string().optional(),
});

export const invoicePendingApprovalSchema = z.object({
  accountId: z.string().uuid(),
  date: dateStr.optional(),
});

export const payableCreateSchema = z.object({
  category: z.enum(["SALARY", "RENT", "COMMISSION", "SALES_BONUS", "INTERNAL_LOAN", "VENDOR"]),
  payee: z.string().min(1),
  salesPerson: z.string().optional(),
  amount: z.number().positive(),
  dueAt: dateStr,
});

export const payableUpdateSchema = payableCreateSchema.partial();

export const payablePaymentSchema = z.object({
  amount: z.number().positive(),
  paidDate: dateStr,
  accountId: z.string().uuid(),
  note: z.string().optional(),
});

export const expenseCreateSchema = z.object({
  category: z.enum(["SOFTWARE", "EQUIPMENT", "TRAVEL", "UTILITIES", "MISC"]),
  description: z.string().min(1),
  amount: z.number().positive(),
  date: dateStr,
  accountId: z.string().uuid(),
  dept: z.string().optional(),
});

export const expenseUpdateSchema = expenseCreateSchema.partial();

export const bankAccountCreateSchema = z.object({
  name: z.string().min(1),
  bank: z.string().min(1),
  number: z.string().min(1),
  opening: z.number(),
});

export const bankAccountUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  bank: z.string().min(1).optional(),
  number: z.string().min(1).optional(),
});

export const transferCreateSchema = z.object({
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  amount: z.number().positive(),
  date: dateStr,
  note: z.string().optional(),
}).refine((d) => d.fromAccountId !== d.toAccountId, { message: "Source and destination accounts must differ" });

export const coaCreateSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["ASSET", "LIABILITY", "INCOME", "EXPENSE"]).optional(),
  parentId: z.string().uuid().optional(),
}).refine((d) => d.parentId || d.type, { message: "type is required for a main account" });

export const coaUpdateSchema = z.object({ type: z.enum(["ASSET", "LIABILITY", "INCOME", "EXPENSE"]) });

export const journalLineSchema = z.object({
  // "coa:<uuid>" or "bank:<uuid>" — mirrors the old prototype's prefixed
  // account-reference scheme so the frontend's existing account picker
  // barely has to change.
  account: z.string().regex(/^(coa|bank):.+/),
  side: z.enum(["DEBIT", "CREDIT"]),
  amount: z.number().positive(),
});

export const journalEntryCreateSchema = z.object({
  date: dateStr,
  memo: z.string().min(1),
  lines: z.array(journalLineSchema).min(2).refine(
    (lines) => {
      const debit = lines.filter((l) => l.side === "DEBIT").reduce((s, l) => s + l.amount, 0);
      const credit = lines.filter((l) => l.side === "CREDIT").reduce((s, l) => s + l.amount, 0);
      return Math.round((debit - credit) * 100) === 0;
    },
    { message: "Total debits must equal total credits" }
  ),
});

export const commissionWithdrawalCreateSchema = z.object({
  employeeId: z.string().uuid().optional(), // Finance/Admin only — self-service infers from the caller
  amount: z.number().positive(),
  note: z.string().optional(),
});

export const commissionWithdrawalApproveSchema = z.object({
  accountId: z.string().uuid(),
  date: dateStr.optional(),
});

export const paymentRequestCreateSchema = z.object({
  category: z.enum(["REIMBURSEMENT", "TRAVEL", "PURCHASE_VENDOR", "OTHER"]),
  // Upper bound keeps a fat-fingered amount from overflowing DECIMAL(12,2).
  amount: z.number().positive().max(100_000_000),
  reason: z.string().trim().min(1).max(500),
});

export const paymentRequestApproveSchema = z.object({
  accountId: z.string().uuid(),
  date: dateStr,
});

// Only an amount — the month is derived server-side (see closedPayrollMonth) and the
// amount is re-checked against the earned-but-unpaid balance, never trusted.
export const withdrawalRequestCreateSchema = z.object({
  amount: z.number().positive().max(100_000_000),
});

export const salesPolicyUpdateSchema = z.object({
  monthlyTarget: z.number().positive().optional(),
  bonusRate: z.number().min(0).max(1).optional(),
});

export { monthStr };
