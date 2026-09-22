import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { Decimal } from "@prisma/client/runtime/library";

function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

// Loss-of-pay days for a given employee + payroll month = days marked
// ON_LEAVE in Attendance that month, beyond hrPolicy.paidLeavesPerMonth.
// Computed from Attendance, not LeaveRequest — approving a request writes
// Attendance (see decideLeaveRequest), so a later correction made directly
// to attendance stays correct even without touching the original request.
// `db` lets a caller already inside a transaction run this on that same connection.
export async function computeLopDays(employeeId: string, month: string, db: Prisma.TransactionClient = prisma): Promise<number> {
  const policy = await db.hrPolicy.findUnique({ where: { id: 1 } });
  const cap = policy?.paidLeavesPerMonth ?? 1;
  const { start, end } = monthRange(month);

  const leaveCount = await db.attendanceRecord.count({
    where: { employeeId, status: "ON_LEAVE", date: { gte: start, lt: end } },
  });

  return Math.max(0, leaveCount - cap);
}

// WFH days beyond hrPolicy.paidWfhPerMonth in a given payroll month, paid at
// 75% (a 25% cut per excess day) instead of a full Loss of Pay — see
// computePayrollRow(). Counted from actual attendance records, same
// "derive from real history" approach computeLopDays takes for leave.
export async function computeWfhExcessDays(employeeId: string, month: string, db: Prisma.TransactionClient = prisma): Promise<number> {
  const policy = await db.hrPolicy.findUnique({ where: { id: 1 } });
  const cap = policy?.paidWfhPerMonth ?? 1;
  const { start, end } = monthRange(month);

  const wfhCount = await db.attendanceRecord.count({
    where: { employeeId, status: "WFH", date: { gte: start, lt: end } },
  });

  return Math.max(0, wfhCount - cap);
}

// Both leave and WFH usage for a month in one shot, against the org-wide
// caps — powers HR's "Leave & WFH this month" panel and an employee's own
// pre-submit pay-impact preview on Apply for Leave, so both read the exact
// same figures payroll actually deducts against (computeLopDays/computeWfhExcessDays).
export async function computeMonthlyLeaveUsage(employeeId: string, month: string, db: Prisma.TransactionClient = prisma) {
  const policy = await db.hrPolicy.findUnique({ where: { id: 1 } });
  const leaveCap = policy?.paidLeavesPerMonth ?? 1;
  const wfhCap = policy?.paidWfhPerMonth ?? 1;
  const { start, end } = monthRange(month);

  const grouped = await db.attendanceRecord.groupBy({
    by: ["status"],
    where: { employeeId, status: { in: ["ON_LEAVE", "WFH"] }, date: { gte: start, lt: end } },
    _count: { _all: true },
  });
  const leaveDays = grouped.find((g) => g.status === "ON_LEAVE")?._count._all ?? 0;
  const wfhDays = grouped.find((g) => g.status === "WFH")?._count._all ?? 0;

  return {
    month,
    leaveDays,
    leaveCap,
    leaveRemaining: Math.max(0, leaveCap - leaveDays),
    lopDays: Math.max(0, leaveDays - leaveCap),
    wfhDays,
    wfhCap,
    wfhRemaining: Math.max(0, wfhCap - wfhDays),
    wfhExcessDays: Math.max(0, wfhDays - wfhCap),
  };
}

export function decimalToNumber(d: Decimal | number | null | undefined): number {
  if (d == null) return 0;
  return typeof d === "number" ? d : Number(d);
}
