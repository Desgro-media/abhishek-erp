import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { recordBankTxn } from "../../services/finance/bankLedger";
import { isFinanceAdmin } from "../../middleware/financeAccess";
import { sumAmounts, invoiceTotal } from "../../services/finance/calc";
import { getSalesPolicy, monthlyApprovedSales } from "../../services/finance/salesTarget";
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
    const scoped = d.month ? entries.filter((p) => p.dueAt.toISOString().slice(0, 7) === d.month) : entries;
    const open = scoped.map((p) => ({ p, balance: round2(Number(p.amount) - sumAmounts(p.payments)) })).filter((x) => x.balance > 0.005);
    const outstanding = round2(open.reduce((s, x) => s + x.balance, 0));
    if (outstanding <= 0) return { error: `${d.salesPerson} has no outstanding commission${d.month ? " for " + d.month : ""}` } as const;
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
    afterData: { salesPerson: d.salesPerson, month: d.month ?? "all months", requested: d.amount ?? "all", paid: result.paid, entries: result.payments.length, remaining: result.remaining },
    ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null,
  });
  res.status(201).json(result);
});

// ---------------------------------------------------------------------------------------------
// Everything in the expanded sales person panel — summary cards, per-client list and per-transaction
// rows grouped by month — in ONE response, all computed here from the records.
//   ?salesPerson=NAME&period=all|today|YYYY-MM
// Cash basis: an entry belongs to the month its payment was RECEIVED (entries are dated to the received
// date), only approved payments exist as payments at all. Earned / Paid / Balance are summed from the same
// commission rows the main table uses (category COMMISSION), so the two always agree; target-bonus rows
// are listed separately and never mixed into those totals.
// A Sales caller is pinned to their own name; Finance/Admin pick anyone.
// ---------------------------------------------------------------------------------------------
export const getCommissionPersonDetail: RequestHandler = asyncHandler(async (req, res) => {
  const admin = isFinanceAdmin(req.user?.roles);
  const salesPerson = admin ? String(req.query.salesPerson ?? "") : req.user!.name;
  if (!salesPerson) return res.status(400).json({ error: "salesPerson is required" });
  const period = String(req.query.period ?? "all");
  if (period !== "all" && period !== "today" && !/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: "period must be all, today or YYYY-MM" });

  const day = (d: Date) => d.toISOString().slice(0, 10);
  const inPeriod = (iso: string) => period === "all" || (period === "today" ? iso === todayIso() : iso.slice(0, 7) === period);

  const [payables, ipRows, qpRows, policy] = await Promise.all([
    prisma.payable.findMany({ where: { category: { in: ["COMMISSION", "SALES_BONUS"] }, salesPerson }, include: { payments: true }, orderBy: [{ dueAt: "desc" }, { createdAt: "desc" }] }),
    prisma.invoicePendingPayment.findMany({ where: { approved: true, salesPerson, invoicePayment: { not: null } }, select: { invoicePayment: true } }),
    prisma.quotePendingPayment.findMany({ where: { approved: true, invoicePayment: { not: null }, quote: { createdBy: salesPerson } }, include: { quote: { select: { quoteCode: true, title: true } } } }),
    getSalesPolicy(),
  ]);
  const quoteByPayment = new Map(qpRows.map((q) => [q.invoicePayment!, q.quote]));
  const attributedIds = new Set([...ipRows.map((x) => x.invoicePayment!), ...qpRows.map((x) => x.invoicePayment!)]);
  const paymentIds = [...new Set([...attributedIds, ...payables.map((p) => p.sourcePaymentId).filter((x): x is string => !!x)])];
  const quoteOfAny = paymentIds.length ? await prisma.quotePendingPayment.findMany({ where: { invoicePayment: { in: paymentIds } }, include: { quote: { select: { quoteCode: true, title: true } } } }) : [];
  for (const q of quoteOfAny) if (!quoteByPayment.has(q.invoicePayment!)) quoteByPayment.set(q.invoicePayment!, q.quote);

  const payments = paymentIds.length ? await prisma.invoicePayment.findMany({ where: { id: { in: paymentIds } }, include: { invoice: { include: { items: true, payments: true, client: { select: { id: true, name: true } } } } } }) : [];
  const paymentById = new Map(payments.map((p) => [p.id, p]));

  // ---- transaction rows: one per commission / bonus entry in the period ----
  type Tx = { payableId: string; kind: "Commission" | "Target bonus"; date: string; month: string; clientId: string | null; clientName: string | null; reference: string | null; invoiceNo: string | null; quoteCode: string | null; paymentAmount: number | null; rate: number | null; edited: boolean; earned: number; paid: number; balance: number; hasPayments: boolean };
  const txs: Tx[] = [];
  for (const p of payables) {
    const pay = p.sourcePaymentId ? paymentById.get(p.sourcePaymentId) : undefined;
    const date = pay ? day(pay.paidDate) : day(p.dueAt);
    const due = day(p.dueAt);
    if (!inPeriod(due)) continue;
    const amount = Number(p.amount), paid = sumAmounts(p.payments);
    const rate = p.commissionRate != null ? Number(p.commissionRate) : null;
    const q = pay ? quoteByPayment.get(pay.id) : undefined;
    txs.push({
      payableId: p.id, kind: p.category === "SALES_BONUS" ? "Target bonus" : "Commission", date, month: due.slice(0, 7),
      clientId: pay?.invoice.client.id ?? null, clientName: pay?.invoice.client.name ?? null,
      reference: q?.quoteCode ?? pay?.invoice.invoiceNo ?? null, invoiceNo: pay?.invoice.invoiceNo ?? null, quoteCode: q?.quoteCode ?? null,
      paymentAmount: pay ? Number(pay.amount) : null, rate,
      // Amount no longer matches rate x payment => it was edited or split after creation; flagged, not re-derived.
      edited: p.category === "COMMISSION" && rate != null && !!pay && Math.abs(Math.round(Number(pay.amount) * rate / 100) - amount) > 0.5,
      earned: amount, paid, balance: round2(amount - paid), hasPayments: p.payments.length > 0,
    });
  }

  // ---- approved payments attributed to this person in the period (cash basis, by received date) ----
  const salesPayments = payments.filter((p) => attributedIds.has(p.id) && inPeriod(day(p.paidDate)));

  // ---- by month ----
  const monthKeys = new Set<string>([...txs.map((t) => t.month), ...salesPayments.map((p) => day(p.paidDate).slice(0, 7))]);
  const months = [...monthKeys].sort().reverse().map((m) => {
    const rows = txs.filter((t) => t.month === m);
    const com = rows.filter((t) => t.kind === "Commission"), bon = rows.filter((t) => t.kind === "Target bonus");
    return {
      month: m, rows,
      paymentsReceived: round2(salesPayments.filter((p) => day(p.paidDate).slice(0, 7) === m).reduce((s, p) => s + Number(p.amount), 0)),
      earned: round2(com.reduce((s, t) => s + t.earned, 0)), paid: round2(com.reduce((s, t) => s + t.paid, 0)), balance: round2(com.reduce((s, t) => s + t.balance, 0)),
      bonusEarned: round2(bon.reduce((s, t) => s + t.earned, 0)), bonusPaid: round2(bon.reduce((s, t) => s + t.paid, 0)), bonusBalance: round2(bon.reduce((s, t) => s + t.balance, 0)),
    };
  });

  // ---- clients: invoices with an attributed payment in the period, plus unpaid invoices of their clients ----
  const invoiceMap = new Map<string, (typeof payments)[number]["invoice"]>();
  for (const p of salesPayments) invoiceMap.set(p.invoiceId, p.invoice);
  const unpaid = await prisma.invoice.findMany({
    where: { payments: { none: {} }, client: { salesPerson } },
    include: { items: true, payments: true, client: { select: { id: true, name: true } } },
  });
  for (const inv of unpaid) if (inPeriod(day(inv.issuedAt))) invoiceMap.set(inv.id, inv);

  const quoteOfInvoice = invoiceMap.size ? await prisma.quote.findMany({ where: { invoiceId: { in: [...invoiceMap.keys()] } }, select: { invoiceId: true, quoteCode: true, title: true } }) : [];
  type ClientRow = { clientId: string; clientName: string; services: Set<string>; titles: Set<string>; references: Set<string>; totalDeal: number; received: number; earned: number; lastDate: string };
  const byClient = new Map<string, ClientRow>();
  for (const inv of invoiceMap.values()) {
    const c = byClient.get(inv.client.id) ?? { clientId: inv.client.id, clientName: inv.client.name, services: new Set(), titles: new Set(), references: new Set(), totalDeal: 0, received: 0, earned: 0, lastDate: "" };
    inv.items.forEach((i) => c.services.add(i.dept));
    c.references.add(inv.invoiceNo);
    quoteOfInvoice.filter((q) => q.invoiceId === inv.id).forEach((q) => { c.references.add(q.quoteCode); c.titles.add(q.title); });
    c.totalDeal += invoiceTotal(inv.items);
    c.received += sumAmounts(inv.payments); // every approved payment on the invoice; pending = total - this
    const last = [...inv.payments.map((p) => day(p.paidDate)), day(inv.issuedAt)].sort().pop()!;
    if (last > c.lastDate) c.lastDate = last;
    byClient.set(inv.client.id, c);
  }
  for (const t of txs) if (t.kind === "Commission" && t.clientId && byClient.has(t.clientId)) byClient.get(t.clientId)!.earned += t.earned;
  const clients = [...byClient.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate)).map((c) => {
    const pending = Math.max(0, round2(c.totalDeal - c.received));
    return {
      clientId: c.clientId, clientName: c.clientName, services: [...c.services], titles: [...c.titles], references: [...c.references],
      totalDeal: round2(c.totalDeal), received: round2(c.received), pending, commissionEarned: round2(c.earned),
      status: pending <= 0.005 ? "Fully paid" : c.received > 0.005 ? "Partially paid" : "Unpaid",
    };
  });

  // ---- summary ----
  const commission = txs.filter((t) => t.kind === "Commission");
  const targetMonth = /^\d{4}-\d{2}$/.test(period) ? period : todayIso().slice(0, 7);
  const [monthSales, bonusRows] = await Promise.all([
    monthlyApprovedSales(prisma, salesPerson, targetMonth),
    prisma.payable.findMany({ where: { category: "SALES_BONUS", salesPerson }, select: { amount: true, dueAt: true } }),
  ]);
  res.json({
    salesPerson, period,
    summary: {
      totalSales: round2(salesPayments.reduce((s, p) => s + Number(p.amount), 0)),
      deals: new Set(salesPayments.map((p) => p.invoiceId)).size,
      clients: new Set(salesPayments.map((p) => p.invoice.clientId)).size,
      earned: round2(commission.reduce((s, t) => s + t.earned, 0)),
      paid: round2(commission.reduce((s, t) => s + t.paid, 0)),
      balance: round2(commission.reduce((s, t) => s + t.balance, 0)),
      clientPending: round2(clients.reduce((s, c) => s + c.pending, 0)),
      target: { month: targetMonth, sales: monthSales, target: policy.monthlyTarget, bonusRate: policy.bonusRate, bonusEarned: round2(bonusRows.filter((b) => day(b.dueAt).slice(0, 7) === targetMonth).reduce((s, b) => s + Number(b.amount), 0)) },
    },
    clients, months,
  });
});
