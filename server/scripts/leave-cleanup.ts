// One-off: finds past approved leave / WFH that was wrongly charged on a weekly off or a company holiday. SAFE BY DEFAULT.
//
// Before the leave fix, approving a multi-day request marked EVERY calendar date in its range, so a Friday-to-Monday request also
// marked the Sunday — and a day that was never a working day counted against the employee's allowance / pay.
//
//   npx tsx scripts/leave-cleanup.ts                  DRY RUN (default). Read-only. Lists, per employee and month, the attendance
//                                                     days that came from an approved leave request but fall on the weekly off or a
//                                                     holiday, and what removing them changes (leave days, Loss of Pay days, WFH
//                                                     pay-cut days, and an estimated amount). Also says whether that month's payroll
//                                                     has already been paid, since removing a day changes that month's net.
//   npx tsx scripts/leave-cleanup.ts --month 2026-09  Limit to one month.
//   npx tsx scripts/leave-cleanup.ts --apply          Removes exactly those attendance days, writes a backup file first, and records
//                                                     one audit entry per employee.
//   npx tsx scripts/leave-cleanup.ts --undo FILE      Puts back every day listed in a backup file.
//
// In Docker: docker compose exec api npx tsx scripts/leave-cleanup.ts
// It only ever touches attendance rows that (a) have a leave status, (b) sit on a non-working day, and (c) are covered by an APPROVED
// full-day request of the matching type. It never edits leave requests, payroll rows or payments.
import fs from "node:fs";
import { PrismaClient, type AttendanceStatus } from "@prisma/client";
import { recordAudit } from "../src/services/audit.service";
import { computeMonthlyLeaveUsage } from "../src/services/hr/leaveBalance";
import { workingDaysInMonth } from "../src/services/hr/workingDays";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const UNDO = args.includes("--undo") ? args[args.indexOf("--undo") + 1] : null;
const ONLY_MONTH = args.includes("--month") ? args[args.indexOf("--month") + 1] : null;

const STATUS_FOR: Record<string, AttendanceStatus> = { CASUAL_SICK: "ON_LEAVE", WFH: "WFH", PARTIAL_WFH: "WFH_PARTIAL", UNPAID_LEAVE: "UNPAID_LEAVE" };
const day = (d: Date) => d.toISOString().slice(0, 10);
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

type Hit = { id: string; employeeId: string; date: string; status: AttendanceStatus; markedBy: string | null; requestId: string };

async function find(): Promise<Hit[]> {
  const policy = await prisma.hrPolicy.findUnique({ where: { id: 1 } });
  const weeklyOff = policy?.weeklyOff ?? 0;
  const holidays = new Set((await prisma.holiday.findMany({ select: { date: true } })).map((h) => day(h.date)));
  const nonWorking = (ds: string) => new Date(`${ds}T00:00:00.000Z`).getUTCDay() === weeklyOff || holidays.has(ds);

  const reqs = await prisma.leaveRequest.findMany({ where: { status: "APPROVED", duration: "FULL_DAY" } });
  const hits: Hit[] = [];
  for (const r of reqs) {
    const want = STATUS_FOR[r.type];
    const dates: Date[] = [];
    for (let d = new Date(r.fromDate); d <= r.toDate; d = new Date(d.getTime() + 86400000)) if (nonWorking(day(d)) && (!ONLY_MONTH || day(d).startsWith(ONLY_MONTH))) dates.push(new Date(d));
    if (!dates.length) continue;
    const rows = await prisma.attendanceRecord.findMany({ where: { employeeId: r.employeeId, date: { in: dates }, status: want } });
    for (const a of rows) hits.push({ id: a.id, employeeId: a.employeeId, date: day(a.date), status: a.status, markedBy: a.markedBy, requestId: r.id });
  }
  return hits;
}

async function report(hits: Hit[]) {
  const emps = await prisma.employee.findMany({ where: { id: { in: [...new Set(hits.map((h) => h.employeeId))] } }, select: { id: true, name: true, employeeCode: true, salary: true } });
  const byEmp = new Map(emps.map((e) => [e.id, e]));
  const groups = new Map<string, Hit[]>();
  for (const h of hits) groups.set(`${h.employeeId}|${h.date.slice(0, 7)}`, [...(groups.get(`${h.employeeId}|${h.date.slice(0, 7)}`) ?? []), h]);

  let totalSaving = 0;
  console.log(`\n${hits.length} attendance day(s) on a weekly off or holiday, across ${groups.size} employee-month(s):\n`);
  for (const [key, list] of [...groups].sort()) {
    const [empId, month] = key.split("|");
    const e = byEmp.get(empId)!;
    const u = await computeMonthlyLeaveUsage(empId, month);
    const n = (s: AttendanceStatus) => list.filter((h) => h.status === s).length;
    const leave = n("ON_LEAVE"), wfh = n("WFH"), pw = n("WFH_PARTIAL"), unpaid = n("UNPAID_LEAVE");
    // After removal: same formulas payroll uses (computeLopDays / computeWfhExcessDays), with those days taken out.
    const lopAfter = Math.max(0, u.leaveDays - leave - u.leaveCap) + (u.unpaidLeaveDays - unpaid);
    const wfhAfter = Math.max(0, u.wfhDays - wfh - u.wfhCap) + (u.partialWfhDays - pw);
    const wd = await workingDaysInMonth(month);
    const rate = wd ? Number(e.salary ?? 0) / wd : 0;
    const saving = (u.lopDays - lopAfter) * rate + (u.wfhExcessDays - wfhAfter) * rate * 0.25;
    totalSaving += saving;
    const pay = await prisma.payrollEntry.findUnique({ where: { employeeId_month: { employeeId: empId, month } }, include: { payments: { select: { amount: true } } } });
    const paid = pay ? pay.payments.reduce((s, p) => s + Number(p.amount), 0) : 0;
    console.log(`${e.employeeCode}  ${e.name}  ${month}`);
    console.log(`   days: ${list.map((h) => `${h.date} (${h.status})`).join(", ")}`);
    console.log(`   Loss of Pay days ${u.lopDays} -> ${lopAfter}   WFH pay-cut days ${u.wfhExcessDays} -> ${wfhAfter}   est. salary back: ${inr(saving)}`);
    console.log(`   payroll for ${month}: ${pay ? (paid > 0 ? `exists, ${inr(paid)} already paid — net pay changes after the fact` : "exists, nothing paid yet") : "not processed yet"}`);
  }
  console.log(`\nEstimated total salary returned to employees: ${inr(totalSaving)}`);
  console.log(`Nothing was changed. Re-run with --apply to remove these days (a backup file is written first).`);
}

async function apply(hits: Hit[]) {
  const file = `leave-cleanup-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const rows = await prisma.attendanceRecord.findMany({ where: { id: { in: hits.map((h) => h.id) } } });
  fs.writeFileSync(file, JSON.stringify(rows, null, 2));
  console.log(`Backup written: ${file} (${rows.length} rows)`);
  const byEmp = new Map<string, Hit[]>();
  for (const h of hits) byEmp.set(h.employeeId, [...(byEmp.get(h.employeeId) ?? []), h]);
  await prisma.$transaction(async (tx) => {
    await tx.attendanceRecord.deleteMany({ where: { id: { in: hits.map((h) => h.id) } } });
    for (const [employeeId, list] of byEmp) {
      await recordAudit({ userId: null, action: "HR_LEAVE_CLEANUP", entityType: "Employee", entityId: employeeId, beforeData: list.map((h) => ({ date: h.date, status: h.status })), afterData: { removed: list.length, reason: "weekly off / holiday had been marked as leave by an approved request", backup: file } }, tx);
    }
  });
  console.log(`Removed ${hits.length} attendance day(s) for ${byEmp.size} employee(s). Undo with: npx tsx scripts/leave-cleanup.ts --undo ${file}`);
}

async function undo(file: string) {
  const rows = JSON.parse(fs.readFileSync(file, "utf8")) as { employeeId: string; date: string; status: AttendanceStatus; markedBy: string | null }[];
  let n = 0;
  for (const r of rows) {
    const date = new Date(r.date);
    const exists = await prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: r.employeeId, date } } });
    if (exists) continue; // someone has marked that day since — leave it alone
    await prisma.attendanceRecord.create({ data: { employeeId: r.employeeId, date, status: r.status, markedBy: r.markedBy } });
    n++;
  }
  console.log(`Restored ${n} of ${rows.length} day(s) (days marked again since the cleanup were left alone).`);
}

(async () => {
  if (UNDO) return undo(UNDO);
  const hits = await find();
  if (!hits.length) return console.log("Nothing to fix: no approved leave is marked on a weekly off or holiday.");
  if (APPLY) await apply(hits); else await report(hits);
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
