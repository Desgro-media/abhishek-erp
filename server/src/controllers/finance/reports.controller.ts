import { RequestHandler } from "express";
import type { PayableCategory, AccountType } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { getAccountBalance } from "../../services/finance/bankLedger";
import { sumAmounts, invoiceTotal } from "../../services/finance/calc";
import { SALES_COMMISSION_RATE } from "../../services/finance/commission";

// Mirrors app.js's DEPARTMENTS/SERVICE_DEPARTMENTS/OVERHEAD_DEPTS exactly —
// duplicated here (not imported, there's nothing to import from) because
// the frontend hasn't been migrated to read department lists from the
// server. Keep in sync with app.js if that list ever changes.
const DEPARTMENTS = ["Marketing Consultation", "Web Development", "Production", "Graphic Design", "Performance Marketing", "Sales", "Administrative"];
const SERVICE_DEPARTMENTS = DEPARTMENTS.filter((d) => d !== "Administrative" && d !== "Sales");
const OVERHEAD_DEPTS = ["Administrative", "Sales"];
const PAYABLE_LIABILITY_CATEGORIES: PayableCategory[] = ["RENT", "COMMISSION", "SALES_BONUS", "VENDOR"];

function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0, 23, 59, 59));
  return { start, end };
}

async function employeeMonthlyCost(employeeId: string, salary: number, month: string): Promise<number> {
  const entry = await prisma.payrollEntry.findUnique({ where: { employeeId_month: { employeeId, month } } });
  return entry ? Number(entry.gross) : salary;
}

// Read-only, HR/Admin-or-Finance-Admin — see routes. Overhead split by
// headcount across service departments, both month-scoped.
//
// Revenue is real money in the door, not the amount billed — only invoice
// payments Finance has approved (InvoicePayment rows), for payments
// received THIS month, split across that invoice's department-tagged line
// items in proportion to each item's share of the invoice total. An
// invoice with nothing approved yet contributes zero. Sales earns a flat
// SALES_COMMISSION_RATE on every payment approved, company-wide, regardless
// of department — deducted straight from revenue here (not a separate cost
// line) so a department's profit/margin is calculated from its real,
// commission-net revenue.
export const deptProfitability: RequestHandler = asyncHandler(async (req, res) => {
  const month = req.query.month as string;
  if (!month) return res.status(400).json({ error: "month (YYYY-MM) is required" });
  const { start, end } = monthBounds(month);

  const employees = await prisma.employee.findMany({ where: { employmentStatus: { not: "LEFT" } } });
  const costs = await Promise.all(employees.map(async (e) => ({ dept: e.dept, cost: await employeeMonthlyCost(e.id, Number(e.salary), month) })));

  const expenses = await prisma.expense.findMany({ where: { date: { gte: start, lte: end } } });
  const rentPayables = await prisma.payable.findMany({ where: { category: "RENT" } });
  const rentTotal = sumAmounts(rentPayables);

  const invoices = await prisma.invoice.findMany({ include: { items: true, payments: true } });
  const grossRevenueByDept = new Map<string, number>();
  for (const inv of invoices) {
    const total = invoiceTotal(inv.items);
    if (total <= 0) continue;
    for (const p of inv.payments) {
      if (isoMonth(p.paidDate) !== month) continue;
      for (const item of inv.items) {
        grossRevenueByDept.set(item.dept, (grossRevenueByDept.get(item.dept) ?? 0) + Number(p.amount) * (Number(item.amount) / total));
      }
    }
  }

  const directPayrollByDept = new Map<string, number>();
  for (const c of costs) directPayrollByDept.set(c.dept, (directPayrollByDept.get(c.dept) ?? 0) + c.cost);
  const directExpenseByDept = new Map<string, number>();
  for (const e of expenses) if (e.dept) directExpenseByDept.set(e.dept, (directExpenseByDept.get(e.dept) ?? 0) + Number(e.amount));

  const overheadHeadcount = employees.filter((e) => OVERHEAD_DEPTS.includes(e.dept)).length;
  const overheadPayroll = costs.filter((c) => OVERHEAD_DEPTS.includes(c.dept)).reduce((s, c) => s + c.cost, 0);
  const sharedExpenses = expenses.filter((e) => !e.dept).reduce((s, e) => s + Number(e.amount), 0);
  const overheadPool = overheadPayroll + rentTotal + sharedExpenses;

  const serviceDeptHeadcount = new Map<string, number>();
  for (const e of employees) if (SERVICE_DEPARTMENTS.includes(e.dept)) serviceDeptHeadcount.set(e.dept, (serviceDeptHeadcount.get(e.dept) ?? 0) + 1);
  const totalServiceHeadcount = [...serviceDeptHeadcount.values()].reduce((a, b) => a + b, 0) || 1;
  const perHeadOverhead = overheadPool / totalServiceHeadcount;

  const rows = SERVICE_DEPARTMENTS.map((dept) => {
    const headcount = serviceDeptHeadcount.get(dept) ?? 0;
    const grossRevenue = grossRevenueByDept.get(dept) ?? 0;
    const commission = Math.round(grossRevenue * SALES_COMMISSION_RATE);
    const revenue = grossRevenue - commission;
    const directPayroll = directPayrollByDept.get(dept) ?? 0;
    const directExpense = directExpenseByDept.get(dept) ?? 0;
    const overheadShare = Math.round(perHeadOverhead * headcount);
    const totalCost = directPayroll + directExpense + overheadShare;
    const profit = revenue - totalCost;
    const margin = revenue ? (profit / revenue) * 100 : null;
    return { dept, headcount, grossRevenue, commission, revenue, directPayroll, directExpense, overheadShare, totalCost, profit, margin };
  });

  res.json({ month, overheadPayroll, overheadHeadcount, rent: rentTotal, sharedExpenses, overheadPool, totalHeadcount: totalServiceHeadcount, perHeadOverhead, rows });
});

function isoMonth(d: Date): string {
  return d.toISOString().slice(0, 7);
}

// Accrual basis: income when invoiced, expenses when incurred.
export const profitAndLoss: RequestHandler = asyncHandler(async (req, res) => {
  const month = req.query.month as string;
  if (!month) return res.status(400).json({ error: "month (YYYY-MM) is required" });
  const { start, end } = monthBounds(month);

  const invoices = await prisma.invoice.findMany({ where: { issuedAt: { gte: start, lte: end } }, include: { items: true } });
  const invoicedIncome = invoices.reduce((s, i) => s + invoiceTotal(i.items), 0);
  // clientId only — clients aren't migrated yet (Phase 4), so the frontend
  // enriches this with a display name from its own client list.
  const incomeDetail = invoices.map((i) => ({ invoiceNo: i.invoiceNo, clientId: i.clientId, amount: invoiceTotal(i.items), date: i.issuedAt }));

  const incomeAccounts = await prisma.chartOfAccount.findMany({ where: { type: "INCOME" } });
  const journalIncomeByAccount = await Promise.all(
    incomeAccounts.map(async (a) => ({ name: a.name, amount: await journalAccountBalanceInMonth(a.id, month, "INCOME") }))
  );
  const journalIncome = journalIncomeByAccount.reduce((s, a) => s + a.amount, 0);

  const nonSalesEmployees = await prisma.employee.findMany({ where: { dept: { not: "Sales" }, employmentStatus: { not: "LEFT" } } });
  const payrollCost = (await Promise.all(nonSalesEmployees.map((e) => employeeMonthlyCost(e.id, Number(e.salary), month)))).reduce((a, b) => a + b, 0);

  const payables = await prisma.payable.findMany({ where: { dueAt: { gte: start, lte: end }, category: { not: "SALARY" } } });
  const expenses = await prisma.expense.findMany({ where: { date: { gte: start, lte: end } }, include: { coaAccount: true } });
  const expenseAccounts = await prisma.chartOfAccount.findMany({ where: { type: "EXPENSE" } });

  const pool = new Map<string, number>();
  const poolDetail = new Map<string, { desc: string; amount: number; date: Date | null }[]>();
  const addDetail = (cat: string, item: { desc: string; amount: number; date: Date | null }) => {
    if (!poolDetail.has(cat)) poolDetail.set(cat, []);
    poolDetail.get(cat)!.push(item);
  };
  pool.set("Salaries", payrollCost);
  for (const p of payables) {
    const cat = categoryLabel(p.category);
    pool.set(cat, (pool.get(cat) ?? 0) + Number(p.amount));
    addDetail(cat, { desc: p.payee, amount: Number(p.amount), date: p.dueAt });
  }
  for (const e of expenses) {
    const cat = e.coaAccount.name;
    pool.set(cat, (pool.get(cat) ?? 0) + Number(e.amount));
    addDetail(cat, { desc: e.description, amount: Number(e.amount), date: e.date });
  }
  for (const a of expenseAccounts) {
    const journalAmt = await journalAccountBalanceInMonth(a.id, month, "EXPENSE");
    if (journalAmt) {
      pool.set(a.name, (pool.get(a.name) ?? 0) + journalAmt);
      addDetail(a.name, { desc: "Manual journal adjustment", amount: journalAmt, date: null });
    }
  }

  const commissionRows = payables.filter((p) => p.category === "COMMISSION" && p.salesPerson);
  const commissionBySales = new Map<string, number>();
  for (const c of commissionRows) commissionBySales.set(c.salesPerson!, (commissionBySales.get(c.salesPerson!) ?? 0) + Number(c.amount));

  const lines = [...pool.entries()].map(([name, amount]) => ({ name, amount, detail: poolDetail.get(name) ?? [] }));
  const totalExpense = lines.reduce((s, l) => s + l.amount, 0);
  const income = invoicedIncome + journalIncome;

  res.json({
    month, income, invoicedIncome, incomeDetail, journalIncome, lines, totalExpense, netProfit: income - totalExpense,
    commissionBySales: Object.fromEntries(commissionBySales),
  });
});

export const balanceSheet: RequestHandler = asyncHandler(async (req, res) => {
  const month = req.query.month as string;
  if (!month) return res.status(400).json({ error: "month (YYYY-MM) is required" });
  const { end } = monthBounds(month);
  const asOf = end < new Date() ? end : new Date();

  const bankAccounts = await prisma.bankAccount.findMany();
  const cashAndBank = await Promise.all(bankAccounts.map(async (a) => ({ name: a.name, balance: await getAccountBalance(a.id, asOf) })));
  const cashAndBankTotal = cashAndBank.reduce((s, a) => s + a.balance, 0);

  const invoices = await prisma.invoice.findMany({ where: { issuedAt: { lte: asOf } }, include: { items: true, payments: { where: { paidDate: { lte: asOf } } } } });
  const receivableDetail = invoices
    .map((i) => ({ invoiceNo: i.invoiceNo, balance: invoiceTotal(i.items) - sumAmounts(i.payments) }))
    .filter((i) => i.balance > 0.01);
  const receivable = receivableDetail.reduce((s, i) => s + i.balance, 0);

  const arAccount = await prisma.chartOfAccount.findFirst({ where: { name: "Accounts Receivable" } });
  const assetAccounts = await prisma.chartOfAccount.findMany({ where: { type: "ASSET", id: { not: arAccount?.id } } });
  const otherAssetAdj = (await Promise.all(assetAccounts.map((a) => journalAccountBalance(a.id, asOf, "ASSET")))).reduce((a, b) => a + b, 0);
  const totalAssets = cashAndBankTotal + receivable + otherAssetAdj;

  const nonSalesEmployees = await prisma.employee.findMany({ where: { dept: { not: "Sales" }, employmentStatus: { not: "LEFT" } } });
  const payrollPayableDetail: { name: string; balance: number }[] = [];
  for (const e of nonSalesEmployees) {
    const entry = await prisma.payrollEntry.findUnique({ where: { employeeId_month: { employeeId: e.id, month } }, include: { payments: true } });
    if (!entry) continue;
    const balance = Number(entry.gross) - sumAmounts(entry.payments);
    if (balance > 0.01) payrollPayableDetail.push({ name: e.name, balance });
  }
  const payrollPayable = payrollPayableDetail.reduce((s, p) => s + p.balance, 0);

  const liabilityPayables = await prisma.payable.findMany({
    where: { category: { in: PAYABLE_LIABILITY_CATEGORIES }, dueAt: { lte: asOf } },
    include: { payments: { where: { paidDate: { lte: asOf } } } },
  });
  const payableLinesMap = new Map<string, { amount: number; detail: { desc: string; amount: number; date: Date }[] }>();
  for (const p of liabilityPayables) {
    const balance = Number(p.amount) - sumAmounts(p.payments);
    if (balance <= 0.01) continue;
    const key = categoryLabel(p.category) + " Payable";
    if (!payableLinesMap.has(key)) payableLinesMap.set(key, { amount: 0, detail: [] });
    const line = payableLinesMap.get(key)!;
    line.amount += balance;
    line.detail.push({ desc: p.payee, amount: balance, date: p.dueAt });
  }
  const payableLines = [...payableLinesMap.entries()].map(([name, l]) => ({ name, amount: l.amount, detail: l.detail }));
  const accountsPayable = payableLines.reduce((s, l) => s + l.amount, 0);

  const internalLoanPayables = await prisma.payable.findMany({ where: { category: "INTERNAL_LOAN", dueAt: { lte: asOf } }, include: { payments: true } });
  const internalLoanDetail = internalLoanPayables.map((p) => ({ payee: p.payee, balance: Number(p.amount) - sumAmounts(p.payments) })).filter((p) => p.balance > 0.01);
  const internalLoan = internalLoanDetail.reduce((s, p) => s + p.balance, 0);

  const liabilityAccounts = await prisma.chartOfAccount.findMany({ where: { type: "LIABILITY" } });
  const journalLiabilityAdj = (await Promise.all(liabilityAccounts.map((a) => journalAccountBalance(a.id, asOf, "LIABILITY")))).reduce((a, b) => a + b, 0);
  const totalLiabilities = payrollPayable + accountsPayable + internalLoan + journalLiabilityAdj;

  res.json({
    asOf, cashAndBank, cashAndBankTotal, receivable, receivableDetail, otherAssetAdj, totalAssets,
    payrollPayable, payrollPayableDetail, payableLines, accountsPayable,
    internalLoan, internalLoanDetail, journalLiabilityAdj, totalLiabilities, equity: totalAssets - totalLiabilities,
  });
});

function categoryLabel(cat: string): string {
  return cat.split("_").map((w) => w[0] + w.slice(1).toLowerCase()).join(" ");
}

// Debit-normal for Asset/Expense, credit-normal for Liability/Income —
// mirrors app.js's journalAccountBalance() exactly. Every call site here
// only ever passes accounts already filtered to one type, so the sign is
// fixed per call rather than looked up per line.
function signFor(type: AccountType, debit: number, credit: number): number {
  return type === "ASSET" || type === "EXPENSE" ? debit - credit : credit - debit;
}

async function journalAccountBalance(coaAccountId: string, asOf: Date, type: AccountType): Promise<number> {
  const lines = await prisma.journalLine.findMany({ where: { coaAccountId, journalEntry: { date: { lte: asOf } } } });
  const debit = lines.filter((l) => l.side === "DEBIT").reduce((s, l) => s + Number(l.amount), 0);
  const credit = lines.filter((l) => l.side === "CREDIT").reduce((s, l) => s + Number(l.amount), 0);
  return signFor(type, debit, credit);
}
async function journalAccountBalanceInMonth(coaAccountId: string, month: string, type: AccountType): Promise<number> {
  const { start, end } = monthBounds(month);
  const lines = await prisma.journalLine.findMany({ where: { coaAccountId, journalEntry: { date: { gte: start, lte: end } } } });
  const debit = lines.filter((l) => l.side === "DEBIT").reduce((s, l) => s + Number(l.amount), 0);
  const credit = lines.filter((l) => l.side === "CREDIT").reduce((s, l) => s + Number(l.amount), 0);
  return signFor(type, debit, credit);
}
