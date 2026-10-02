import { ensureCarryForward, ensureCarryForwardAll, thisMonth } from "../../services/hr/leaveBalance";
import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { resolveScopedEmployeeId } from "../../middleware/hrAccess";
import { attendanceMarkSchema } from "../../validation/hr.schemas";

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// HR/Admin only (mounted behind requireHRAdmin) — company-wide roll call for
// a given day, defaulting to today.
export const listAttendanceForDate: RequestHandler = asyncHandler(async (req, res) => {
  const date = (req.query.date as string) || todayStr();
  const records = await prisma.attendanceRecord.findMany({
    where: { date: new Date(date) },
    include: { employee: { select: { id: true, name: true, dept: true, employeeCode: true } } },
  });
  res.json({ date, records });
});

// Upsert — one record per (employee, date). Replaces the old prototype's
// "cycle to next status" button with a direct set, which is what a real API
// should expose; the frontend can still offer a click-to-cycle control that
// computes the next status and calls this.
export const markAttendance: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = attendanceMarkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const previous = await prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: d.employeeId, date: new Date(d.date) } }, select: { status: true } });
  const record = await prisma.attendanceRecord.upsert({
    where: { employeeId_date: { employeeId: d.employeeId, date: new Date(d.date) } },
    create: { employeeId: d.employeeId, date: new Date(d.date), status: d.status, checkIn: d.checkIn, markedBy: req.user!.sub },
    update: { status: d.status, checkIn: d.checkIn, markedBy: req.user!.sub },
  });

  // A correction to a CLOSED month's leave days changes what carried into the months after it.
  if ((previous?.status === "ON_LEAVE" || d.status === "ON_LEAVE") && d.date.slice(0, 7) < thisMonth()) {
    await ensureCarryForward(d.employeeId, thisMonth(), prisma, { reconcile: true });
  }

  await recordAudit({
    userId: req.user!.sub,
    action: "HR_ATTENDANCE_MARK",
    entityType: "AttendanceRecord",
    entityId: record.id,
    afterData: { employeeId: d.employeeId, date: d.date, status: d.status },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
  });

  res.json({ record });
});

// HR/Admin only — company-wide per-employee ON_LEAVE/WFH day counts for a
// month, straight from Attendance. Powers the "Leave & WFH this month" panel
// on HR > Leave Requests — a read-only overview alongside the annual leave
// balance (computeLeaveBalance) and payroll's Loss of Pay (computeLopDays),
// not a replacement for either.
export const getMonthlySummary: RequestHandler = asyncHandler(async (req, res) => {
  const month = (req.query.month as string) || todayStr().slice(0, 7);
  const start = new Date(`${month}-01`);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);

  const grouped = await prisma.attendanceRecord.groupBy({
    by: ["employeeId", "status"],
    where: { date: { gte: start, lt: end }, status: { in: ["ON_LEAVE", "WFH", "WFH_PARTIAL"] } },
    _count: { _all: true },
  });

  const byEmployee: Record<string, { leave: number; wfh: number; partialWfh: number }> = {};
  for (const row of grouped) {
    byEmployee[row.employeeId] ??= { leave: 0, wfh: 0, partialWfh: 0 };
    if (row.status === "ON_LEAVE") byEmployee[row.employeeId].leave = row._count._all;
    else if (row.status === "WFH_PARTIAL") byEmployee[row.employeeId].partialWfh = row._count._all;
    else byEmployee[row.employeeId].wfh = row._count._all;
  }

  // Effective paid-leave cap per employee that differs from the org default (carried-in days / HR
  // adjustments), so the client's LOP preview matches what payroll will deduct.
  await ensureCarryForwardAll(month);
  const policy = await prisma.hrPolicy.findUnique({ where: { id: 1 } });
  const ledgerRows = await prisma.leaveLedgerEntry.findMany({ where: { month, supersededAt: null } });
  const caps: Record<string, number> = {};
  for (const r of ledgerRows) caps[r.employeeId] = (caps[r.employeeId] ?? policy?.paidLeavesPerMonth ?? 1) + Number(r.days);

  res.json({ month, byEmployee, caps });
});

// HR/Admin can view any employee's history; anyone else only their own.
export const getAttendanceHistory: RequestHandler = asyncHandler(async (req, res) => {
  const targetId = req.params.employeeId;
  const scoped = resolveScopedEmployeeId(req, targetId);
  if (!scoped || scoped !== targetId) {
    return res.status(403).json({ error: "Forbidden — you can only view your own attendance" });
  }
  const month = (req.query.month as string) || todayStr().slice(0, 7);
  const start = new Date(`${month}-01`);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);

  const records = await prisma.attendanceRecord.findMany({
    where: { employeeId: targetId, date: { gte: start, lt: end } },
    orderBy: { date: "asc" },
  });
  res.json({ month, records });
});
