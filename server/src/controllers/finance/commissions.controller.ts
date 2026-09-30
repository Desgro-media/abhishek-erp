import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { recordBankTxn } from "../../services/finance/bankLedger";
import { isFinanceAdmin } from "../../middleware/financeAccess";
import { sumAmounts } from "../../services/finance/calc";
import { commissionWithdrawalCreateSchema, commissionWithdrawalApproveSchema, commissionSettleSchema } from "../../validation/finance.schemas";

// Read-only rollup: every Commission-category payable, grouped by salesperson.
export const listCommissionsByPerson: RequestHandler = asyncHandler(async (req, res) => {
  const payables = await prisma.payable.findMany({ where: { category: "COMMISSION" }, include: { payments: true } });
  const bySalesPerson = new Map<string, { earned: number; paid: number; balance: number }>();
  for (const p of payables) {
    if (!p.salesPerson) continue;
    const row = bySalesPerson.get(p.salesPerson) ?? { earned: 0, paid: 0, balance: 0 };
    const amount = Number(p.amount);
    const paid = sumAmounts(p.payments);
    row.earned += amount;
    row.paid += paid;
    row.balance += amount - paid;
    bySalesPerson.set(p.salesPerson, row);
  }
  res.json({ commissions: Object.fromEntries(bySalesPerson) });
});

export const listCommissionWithdrawals: RequestHandler = asyncHandler(async (req, res) => {
  const requestedEmployeeId = req.query.employeeId as string | undefined;
  const admin = isFinanceAdmin(req.user?.roles);
  const employeeId = admin ? requestedEmployeeId : req.user?.employeeId ?? undefined;
  if (!admin && !employeeId) return res.json({ withdrawals: [] });

  const withdrawals = await prisma.commissionWithdrawal.findMany({
    where: { employeeId },
    include: admin ? { employee: { select: { id: true, name: true, employeeCode: true } } } : undefined,
    orderBy: { requestedAt: "desc" },
  });
  res.json({ withdrawals });
});

// Sales requests against their own name's outstanding commission balance;
// Finance/Admin can request on anyone's behalf.
export const requestCommissionWithdrawal: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = commissionWithdrawalCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const admin = isFinanceAdmin(req.user?.roles);
  const employeeId = admin ? d.employeeId : req.user?.employeeId;
  if (!employeeId) return res.status(admin ? 400 : 403).json({ error: admin ? "employeeId is required" : "No HR record is linked to your login" });

  const withdrawal = await prisma.commissionWithdrawal.create({ data: { employeeId, amount: d.amount, note: d.note } });
  await recordAudit({ userId: req.user!.sub, action: "FIN_COMMISSION_WITHDRAWAL_REQUEST", entityType: "CommissionWithdrawal", entityId: withdrawal.id, afterData: d });
  res.status(201).json({ withdrawal });
});

// Pays down that salesperson's oldest-due-first outstanding Commission
// payables up to the withdrawal amount — mirrors the old prototype's
// payCommissionWithdrawal(), factored out there specifically for testability.
export const approveCommissionWithdrawal: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = commissionWithdrawalApproveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const withdrawal = await prisma.commissionWithdrawal.findUnique({ where: { id: req.params.id }, include: { employee: true } });
  if (!withdrawal) return res.status(404).json({ error: "Withdrawal not found" });
  if (withdrawal.status !== "PENDING") return res.status(409).json({ error: "Already decided" });

  const date = d.date ? new Date(d.date) : new Date();
  const paidAmount = await prisma.$transaction(async (tx) => {
    const outstanding = await tx.payable.findMany({
      where: { category: { in: ["COMMISSION", "SALES_BONUS"] }, salesPerson: withdrawal.employee.name },
      include: { payments: true },
      orderBy: { dueAt: "asc" },
    });
    let remaining = Number(withdrawal.amount);
    for (const p of outstanding) {
      if (remaining <= 0) break;
      const balance = Number(p.amount) - sumAmounts(p.payments);
      if (balance <= 0) continue;
      const pay = Math.min(balance, remaining);
      await tx.payablePayment.create({ data: { payableId: p.id, amount: pay, paidDate: date, accountId: d.accountId, note: "Commission withdrawal", recordedBy: req.user!.sub } });
      await recordBankTxn(tx, { accountId: d.accountId, date, type: "DEBIT", amount: pay, note: `Commission withdrawal — ${withdrawal.employee.name}`, refType: "PAYABLE_PAYMENT", refId: p.id });
      remaining -= pay;
    }
    const paid = Number(withdrawal.amount) - remaining;
    await tx.commissionWithdrawal.update({ where: { id: withdrawal.id }, data: { status: "APPROVED", decidedAt: new Date(), accountId: d.accountId, paidAmount: paid } });
    return paid;
  });

  await recordAudit({ userId: req.user!.sub, action: "FIN_COMMISSION_WITHDRAWAL_APPROVE", entityType: "CommissionWithdrawal", entityId: withdrawal.id, afterData: { paidAmount }, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.json({ paidAmount });
});

export const rejectCommissionWithdrawal: RequestHandler = asyncHandler(async (req, res) => {
  const withdrawal = await prisma.commissionWithdrawal.update({ where: { id: req.params.id }, data: { status: "REJECTED", decidedAt: new Date() } }).catch(() => null);
  if (!withdrawal) return res.status(404).json({ error: "Withdrawal not found" });
  await recordAudit({ userId: req.user!.sub, action: "FIN_COMMISSION_WITHDRAWAL_REJECT", entityType: "CommissionWithdrawal", entityId: withdrawal.id });
  res.json({ withdrawal });
});

const round2 = (n: number) => Math.round(n * 100) / 100;
const todayIso = () => new Date().toISOString().slice(0, 10);

// Everything on the Sales Commissions page comes from here — computed from the actual Commission
// payables and their payments, never from client-side sums.
//   ?period=all | today | YYYY-MM   (entries are bucketed by their due date, same as the page always did)
// Per sales person:
//   previousBalance = still-unpaid balance of entries due BEFORE the period starts (live, not stored)
//   earned / paid / balance = entries due inside the period, and what has been paid against them
//   totalOutstanding = everything they're still owed, regardless of the period (what "Settle all" pays)
export const getCommissionSummary: RequestHandler = asyncHandler(async (req, res) => {
  const period = String(req.query.period ?? "all");
  if (period !== "all" && period !== "today" && !/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: "period must be all, today or YYYY-MM" });

  const payables = await prisma.payable.findMany({ where: { category: "COMMISSION", salesPerson: { not: null } }, include: { payments: true }, orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }] });

  const day = (d: Date) => d.toISOString().slice(0, 10);
  const inPeriod = (due: string) => period === "all" || (period === "today" ? due === todayIso() : due.slice(0, 7) === period);
  const beforePeriod = (due: string) => period === "all" ? false : period === "today" ? due < todayIso() : due.slice(0, 7) < period;

  type Entry = { id: string; payee: string; due: string; amount: number; paid: number; balance: number; hasPayments: boolean };
  const people = new Map<string, { salesPerson: string; previousBalance: number; earned: number; paid: number; balance: number; totalOutstanding: number; entries: Entry[] }>();
  const totals = { earned: 0, paid: 0, balance: 0, entries: 0, salesPersons: new Set<string>() };
  const months = new Set<string>();

  for (const p of payables) {
    const name = p.salesPerson!;
    const due = day(p.dueAt);
    const amount = Number(p.amount);
    const paid = sumAmounts(p.payments);
    const balance = round2(amount - paid);
    months.add(due.slice(0, 7));
    totals.earned += amount; totals.paid += paid; totals.balance += balance; totals.entries += 1; totals.salesPersons.add(name);

    const row = people.get(name) ?? { salesPerson: name, previousBalance: 0, earned: 0, paid: 0, balance: 0, totalOutstanding: 0, entries: [] };
    row.totalOutstanding += balance;
    if (beforePeriod(due)) row.previousBalance += balance;
    if (inPeriod(due)) {
      row.earned += amount; row.paid += paid; row.balance += balance;
      row.entries.push({ id: p.id, payee: p.payee, due, amount, paid, balance, hasPayments: p.payments.length > 0 });
    }
    people.set(name, row);
  }

  const rows = [...people.values()]
    // A person appears if anything happened in the period OR they carry a balance into it.
    .filter((r) => r.entries.length > 0 || r.previousBalance > 0.005)
    .map((r) => ({ ...r, previousBalance: round2(r.previousBalance), earned: round2(r.earned), paid: round2(r.paid), balance: round2(r.balance), totalOutstanding: round2(r.totalOutstanding) }))
    .sort((a, b) => b.totalOutstanding - a.totalOutstanding || b.earned - a.earned);

  res.json({
    period,
    months: [...months].sort().reverse(),
    totals: { earned: round2(totals.earned), paid: round2(totals.paid), balance: round2(totals.balance), entries: totals.entries, salesPersons: totals.salesPersons.size },
    rows,
  });
});

// "Settle all" for one sales person. Still one PayablePayment (and one bank debit) PER commission
// entry, so each entry keeps its own audit trail exactly as if Finance had clicked Record payment on
// it — the whole batch is a single transaction (all or nothing). With no `amount` it clears every
// outstanding entry; with an amount it's applied oldest-due-first (FIFO) and stops when it runs out,
// leaving the newest entries untouched (the last one paid may be partial). Same order the
// withdrawal-approval flow already uses.
export const settleCommissions: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = commissionSettleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const date = new Date(d.paidDate);

  const result = await prisma.$transaction(async (tx) => {
    const entries = await tx.payable.findMany({
      where: { category: "COMMISSION", salesPerson: d.salesPerson },
      include: { payments: true },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    });
    const open = entries.map((p) => ({ p, balance: round2(Number(p.amount) - sumAmounts(p.payments)) })).filter((x) => x.balance > 0.005);
    const outstanding = round2(open.reduce((s, x) => s + x.balance, 0));
    if (outstanding <= 0) return { error: `${d.salesPerson} has no outstanding commission` } as const;
    if (d.amount != null && d.amount > outstanding + 0.01) return { error: `Amount exceeds the outstanding commission (${outstanding})` } as const;

    let remaining = d.amount != null ? d.amount : outstanding;
    const payments: { payableId: string; payee: string; amount: number }[] = [];
    for (const { p, balance } of open) {
      if (remaining <= 0.005) break;
      const pay = round2(Math.min(balance, remaining));
      const payment = await tx.payablePayment.create({
        data: { payableId: p.id, amount: pay, paidDate: date, accountId: d.accountId, note: d.amount == null ? "Settle all" : "Settle (oldest first)", recordedBy: req.user!.sub },
      });
      await recordBankTxn(tx, { accountId: d.accountId, date, type: "DEBIT", amount: pay, note: `${p.category} — ${p.payee}`, refType: "PAYABLE_PAYMENT", refId: payment.id });
      payments.push({ payableId: p.id, payee: p.payee, amount: pay });
      remaining = round2(remaining - pay);
    }
    return { payments, paid: round2(payments.reduce((s, x) => s + x.amount, 0)), remaining: round2(outstanding - payments.reduce((s, x) => s + x.amount, 0)) } as const;
  });

  if ("error" in result) return res.status(400).json({ error: result.error });
  await recordAudit({
    userId: req.user!.sub, action: "FIN_COMMISSION_SETTLE", entityType: "Commission", entityId: d.salesPerson,
    afterData: { salesPerson: d.salesPerson, requested: d.amount ?? "all", paid: result.paid, entries: result.payments.length, remaining: result.remaining },
    ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null,
  });
  res.status(201).json(result);
});
