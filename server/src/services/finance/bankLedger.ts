import type { Prisma, BankTxnRefType, BankTxnType } from "@prisma/client";
import { prisma } from "../../db/prisma";

type Tx = Prisma.TransactionClient;

// The single choke point every cash-affecting mutation goes through —
// mirrors the old prototype's pushBankTxn(), the one place it funneled all
// ledger writes through even before this was a real database.
export async function recordBankTxn(
  tx: Tx,
  params: { accountId: string; date: Date; type: BankTxnType; amount: number; note?: string | null; refType: BankTxnRefType; refId?: string | null }
) {
  return tx.bankTransaction.create({
    data: {
      accountId: params.accountId,
      date: params.date,
      type: params.type,
      amount: params.amount,
      note: params.note ?? null,
      refType: params.refType,
      refId: params.refId ?? null,
    },
  });
}

// Balances are always derived (opening + sum(credits) - sum(debits)),
// never stored, so they can never drift out of sync with the ledger —
// same deliberate design as the old prototype's bankAccountBalance().
export async function getAccountBalance(accountId: string, asOf?: Date): Promise<number> {
  const account = await prisma.bankAccount.findUniqueOrThrow({ where: { id: accountId } });
  const where = { accountId, ...(asOf ? { date: { lte: asOf } } : {}) };
  const [credits, debits] = await Promise.all([
    prisma.bankTransaction.aggregate({ where: { ...where, type: "CREDIT" }, _sum: { amount: true } }),
    prisma.bankTransaction.aggregate({ where: { ...where, type: "DEBIT" }, _sum: { amount: true } }),
  ]);
  return Number(account.opening) + Number(credits._sum.amount ?? 0) - Number(debits._sum.amount ?? 0);
}
