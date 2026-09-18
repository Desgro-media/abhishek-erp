import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { recordBankTxn } from "../../services/finance/bankLedger";
import { expenseCreateSchema, expenseUpdateSchema } from "../../validation/finance.schemas";

export const listExpenses: RequestHandler = asyncHandler(async (req, res) => {
  const expenses = await prisma.expense.findMany({
    where: { category: req.query.category as any, dept: (req.query.dept as string) || undefined },
    orderBy: { date: "desc" },
  });
  res.json({ expenses });
});

export const createExpense: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = expenseCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const expense = await prisma.$transaction(async (tx) => {
    const e = await tx.expense.create({
      data: { category: d.category, description: d.description, amount: d.amount, date: new Date(d.date), accountId: d.accountId, dept: d.dept || null },
    });
    await recordBankTxn(tx, { accountId: d.accountId, date: new Date(d.date), type: "DEBIT", amount: d.amount, note: d.description, refType: "EXPENSE", refId: e.id });
    return e;
  });

  await recordAudit({ userId: req.user!.sub, action: "FIN_EXPENSE_CREATE", entityType: "Expense", entityId: expense.id, afterData: d, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.status(201).json({ expense });
});

// The linked bank transaction is a single-shot record of the same expense,
// not an append-only payment ledger — correcting a typo'd amount/date here
// updates that one row in place, same as the old prototype's find-by-ref
// update. This is intentionally different from invoice/payable payments,
// which are never edited once recorded.
export const updateExpense: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = expenseUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const before = await prisma.expense.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Expense not found" });

  const expense = await prisma.$transaction(async (tx) => {
    const e = await tx.expense.update({
      where: { id: req.params.id },
      data: { category: d.category, description: d.description, amount: d.amount, date: d.date ? new Date(d.date) : undefined, accountId: d.accountId, dept: d.dept },
    });
    const txn = await tx.bankTransaction.findFirst({ where: { refType: "EXPENSE", refId: e.id } });
    if (txn) {
      await tx.bankTransaction.update({
        where: { id: txn.id },
        data: { accountId: e.accountId, date: e.date, amount: e.amount, note: e.description },
      });
    } else {
      await recordBankTxn(tx, { accountId: e.accountId, date: e.date, type: "DEBIT", amount: Number(e.amount), note: e.description, refType: "EXPENSE", refId: e.id });
    }
    return e;
  });

  await recordAudit({
    userId: req.user!.sub, action: "FIN_EXPENSE_UPDATE", entityType: "Expense", entityId: expense.id,
    beforeData: { ...before, amount: before.amount.toString() }, afterData: d, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null,
  });
  res.json({ expense });
});
