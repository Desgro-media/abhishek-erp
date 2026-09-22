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

  const record = await prisma.attendanceRecord.upsert({
    where: { employeeId_date: { employeeId: d.employeeId, date: new Date(d.date) } },
    create: { employeeId: d.employeeId, date: new Date(d.date), status: d.status, checkIn: d.checkIn, markedBy: req.user!.sub },
    update: { status: d.status, checkIn: d.checkIn, markedBy: req.user!.sub },
  });

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
    where: { date: { gte: start, lt: end }, status: { in: ["ON_LEAVE", "WFH"] } },
    _count: { _all: true },
  });

  const byEmployee: Record<string, { leave: number; wfh: number }> = {};
  for (const row of grouped) {
    byEmployee[row.employeeId] ??= { leave: 0, wfh: 0 };
    if (row.status === "ON_LEAVE") byEmployee[row.employeeId].leave = row._count._all;
    else byEmployee[row.employeeId].wfh = row._count._all;
  }

  res.json({ month, byEmployee });
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
