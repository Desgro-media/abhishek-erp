import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { recordBankTxn } from "../../services/finance/bankLedger";
import { journalEntryCreateSchema } from "../../validation/finance.schemas";

const INCLUDE = { lines: { include: { coaAccount: true } } } as const;

export const listJournalEntries: RequestHandler = asyncHandler(async (req, res) => {
  const entries = await prisma.journalEntry.findMany({ include: INCLUDE, orderBy: { date: "desc" } });
  res.json({ entries });
});

// No update endpoint — a correction is still meant to be a new entry (e.g. a
// reversing entry), not an edit to history. Deletion is allowed (below) for
// a genuine mistake, same as Expenses/Payables.
export const createJournalEntry: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = journalEntryCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  // Resolve every "coa:<id>"/"bank:<id>" reference up front so a bad id
  // fails before anything is written.
  for (const line of d.lines) {
    const [kind, id] = line.account.split(":", 2);
    if (kind === "coa") {
      const acc = await prisma.chartOfAccount.findUnique({ where: { id } });
      if (!acc) return res.status(400).json({ error: `Chart of accounts entry not found: ${id}` });
    } else {
      const acc = await prisma.bankAccount.findUnique({ where: { id } });
      if (!acc) return res.status(400).json({ error: `Bank account not found: ${id}` });
    }
  }

  const entry = await prisma.$transaction(async (tx) => {
    const e = await tx.journalEntry.create({
      data: {
        date: new Date(d.date),
        memo: d.memo,
        createdBy: req.user!.sub,
        lines: {
          create: d.lines.map((l) => {
            const [kind, id] = l.account.split(":", 2);
            return { coaAccountId: kind === "coa" ? id : null, bankAccountId: kind === "bank" ? id : null, side: l.side, amount: l.amount };
          }),
        },
      },
      include: INCLUDE,
    });

    // A line against a bank account is also a real cash movement — post the
    // matching ledger row. Debit on a bank account = money in (credit on
    // the ledger); Credit = money out — same polarity flip as the old
    // prototype, explicitly, since "debit/credit" on a bank line reads
    // backwards from the ledger's own credit/debit vocabulary.
    for (const line of d.lines) {
      const [kind, id] = line.account.split(":", 2);
      if (kind !== "bank") continue;
      await recordBankTxn(tx, {
        accountId: id,
        date: new Date(d.date),
        type: line.side === "DEBIT" ? "CREDIT" : "DEBIT",
        amount: line.amount,
        note: d.memo,
        refType: "JOURNAL",
        refId: e.id,
      });
    }

    return e;
  });

  await recordAudit({ userId: req.user!.sub, action: "FIN_JOURNAL_ENTRY_CREATE", entityType: "JournalEntry", entityId: entry.id, afterData: d, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.status(201).json({ entry });
});

// Deletes the entry and, since a bank-account line also posted a real
// BankTransaction (refType=JOURNAL, refId=entry.id) when it was created,
// that transaction too — otherwise it'd be an orphaned cash movement still
// counted in the account balance with no journal entry to explain it.
export const deleteJournalEntry: RequestHandler = asyncHandler(async (req, res) => {
  const before = await prisma.journalEntry.findUnique({ where: { id: req.params.id }, include: INCLUDE });
  if (!before) return res.status(404).json({ error: "Journal entry not found" });

  await prisma.$transaction(async (tx) => {
    await tx.bankTransaction.deleteMany({ where: { refType: "JOURNAL", refId: before.id } });
    await tx.journalEntry.delete({ where: { id: before.id } });
  });

  await recordAudit({
    userId: req.user!.sub, action: "FIN_JOURNAL_ENTRY_DELETE", entityType: "JournalEntry", entityId: before.id,
    beforeData: { ...before, lines: before.lines.map((l) => ({ ...l, amount: l.amount.toString() })) },
    ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null,
  });
  res.status(204).send();
});
