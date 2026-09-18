import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { getAccountBalance, recordBankTxn } from "../../services/finance/bankLedger";
import { bankAccountCreateSchema, bankAccountUpdateSchema, transferCreateSchema } from "../../validation/finance.schemas";

export const listBankAccounts: RequestHandler = asyncHandler(async (req, res) => {
  const accounts = await prisma.bankAccount.findMany({ orderBy: { name: "asc" } });
  const asOf = req.query.asOf ? new Date(req.query.asOf as string) : undefined;
  const withBalance = await Promise.all(accounts.map(async (a) => ({ ...a, balance: await getAccountBalance(a.id, asOf) })));
  res.json({ accounts: withBalance });
});

export const createBankAccount: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = bankAccountCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const account = await prisma.bankAccount.create({
    data: { name: d.name, bank: d.bank, number: d.number, opening: d.opening, openedAt: new Date() },
  });

  await recordAudit({ userId: req.user!.sub, action: "FIN_BANK_ACCOUNT_CREATE", entityType: "BankAccount", entityId: account.id, afterData: d });
  res.status(201).json({ account });
});

// opening is deliberately not editable here — see schema comment: changing
// it after transactions exist would silently reshape every derived
// historical balance.
export const updateBankAccount: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = bankAccountUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });

  const account = await prisma.bankAccount.update({ where: { id: req.params.id }, data: parsed.data }).catch(() => null);
  if (!account) return res.status(404).json({ error: "Bank account not found" });

  await recordAudit({ userId: req.user!.sub, action: "FIN_BANK_ACCOUNT_UPDATE", entityType: "BankAccount", entityId: account.id, afterData: parsed.data });
  res.json({ account });
});

export const getLedger: RequestHandler = asyncHandler(async (req, res) => {
  const accountId = req.params.id;
  const account = await prisma.bankAccount.findUnique({ where: { id: accountId } });
  if (!account) return res.status(404).json({ error: "Bank account not found" });

  const transactions = await prisma.bankTransaction.findMany({ where: { accountId }, orderBy: { date: "asc" } });
  let running = Number(account.opening);
  const withRunning = transactions.map((t) => {
    running += t.type === "CREDIT" ? Number(t.amount) : -Number(t.amount);
    return { ...t, runningBalance: running };
  });
  res.json({ account, transactions: withRunning.reverse() });
});

// A real entity generating two linked ledger legs atomically, instead of
// two unrelated rows matched by guessing from note text. Append-only —
// a wrong transfer is corrected with a new reversing transfer.
export const createTransfer: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = transferCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const [from, to] = await Promise.all([
    prisma.bankAccount.findUnique({ where: { id: d.fromAccountId } }),
    prisma.bankAccount.findUnique({ where: { id: d.toAccountId } }),
  ]);
  if (!from || !to) return res.status(404).json({ error: "Bank account not found" });

  const transfer = await prisma.$transaction(async (tx) => {
    const t = await tx.transfer.create({
      data: { fromAccountId: d.fromAccountId, toAccountId: d.toAccountId, amount: d.amount, date: new Date(d.date), note: d.note, createdBy: req.user!.sub },
    });
    await recordBankTxn(tx, { accountId: d.fromAccountId, date: new Date(d.date), type: "DEBIT", amount: d.amount, note: `Transfer to ${to.name}${d.note ? " — " + d.note : ""}`, refType: "TRANSFER", refId: t.id });
    await recordBankTxn(tx, { accountId: d.toAccountId, date: new Date(d.date), type: "CREDIT", amount: d.amount, note: `Transfer from ${from.name}${d.note ? " — " + d.note : ""}`, refType: "TRANSFER", refId: t.id });
    return t;
  });

  await recordAudit({ userId: req.user!.sub, action: "FIN_TRANSFER", entityType: "Transfer", entityId: transfer.id, afterData: d, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.status(201).json({ transfer });
});
