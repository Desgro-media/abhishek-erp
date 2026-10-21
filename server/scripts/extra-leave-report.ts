// Read-only report: who has taken MORE leave / WFH than their monthly allowance, and what that costs.
//
//   npx tsx scripts/extra-leave-report.ts                 The last 6 months plus this one, every employee.
//   npx tsx scripts/extra-leave-report.ts --month 2026-10 One month.
//   npx tsx scripts/extra-leave-report.ts --months 12     The last 12 months plus this one.
//
// In Docker: docker compose exec api npx tsx scripts/extra-leave-report.ts
//
// Uses the same figures payroll deducts from (computeMonthlyLeaveUsage), so it matches payslips. Paid leave beyond the monthly allowance
// is Loss of Pay (a full day's pay each), exactly like Unpaid leave; WFH beyond the allowance is paid at 75%. It writes nothing.
import { PrismaClient } from "@prisma/client";
import { computeMonthlyLeaveUsage, prevMonth, thisMonth } from "../src/services/hr/leaveBalance";
import { workingDaysInMonth } from "../src/services/hr/workingDays";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const f = (n: number) => String(Math.round(n * 100) / 100);

(async () => {
  const months: string[] = [];
  if (opt("--month")) months.push(opt("--month")!);
  else { let m = thisMonth(); for (let i = 0; i <= Number(opt("--months") ?? 6); i++) { months.push(m); m = prevMonth(m); } }
  const emps = await prisma.employee.findMany({ where: { employmentStatus: { not: "LEFT" } }, orderBy: { employeeCode: "asc" }, select: { id: true, employeeCode: true, name: true, salary: true } });

  let rows = 0, total = 0;
  for (const month of months.sort().reverse()) {
    const wd = await workingDaysInMonth(month);
    const lines: string[] = [];
    for (const e of emps) {
      const u = await computeMonthlyLeaveUsage(e.id, month);
      if (u.lopDays <= 0 && u.wfhExcessDays <= 0) continue;
      const rate = wd ? Number(e.salary ?? 0) / wd : 0;
      const cost = u.lopDays * rate + u.wfhExcessDays * rate * 0.25;
      const over = Math.max(0, u.leaveDays - u.leaveCap);
      const pay = await prisma.payrollEntry.findUnique({ where: { employeeId_month: { employeeId: e.id, month } }, include: { payments: { select: { amount: true } } } });
      const paid = pay ? pay.payments.reduce((s, p) => s + Number(p.amount), 0) : 0;
      rows++; total += cost;
      lines.push([
        `${e.employeeCode}  ${e.name}`,
        `   paid leave ${f(u.leaveDays)} of ${f(u.leaveCap)} (${over > 0 ? `${f(over)} extra` : "within allowance"})   unpaid leave ${f(u.unpaidLeaveDays)}   => Loss of Pay ${f(u.lopDays)} day(s)`,
        `   WFH ${f(u.wfhDays)} of ${f(u.wfhCap)}   partially-paid WFH ${f(u.partialWfhDays)}   => 25% pay cut on ${f(u.wfhExcessDays)} day(s)`,
        `   estimated salary cut: ${inr(cost)}   payroll: ${pay ? (paid > 0 ? "processed, partly/fully paid" : "processed, nothing paid yet") : "not processed yet"}`,
      ].join("\n"));
    }
    if (lines.length) console.log(`\n=== ${month} — ${lines.length} employee(s) with extra leave / WFH ===\n\n${lines.join("\n\n")}`);
  }
  if (!rows) console.log("\nNo one has taken leave or WFH beyond their allowance in the months checked.");
  else console.log(`\n${rows} employee-month(s) in total. Estimated salary cut across all of them: ${inr(total)}.`);
  console.log("Read-only: nothing was changed.");
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
