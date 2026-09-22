import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { isHRAdmin, resolveScopedEmployeeId } from "../../middleware/hrAccess";
import { leaveRequestCreateSchema, leaveDecisionSchema } from "../../validation/hr.schemas";
import { computeMonthlyLeaveUsage } from "../../services/hr/leaveBalance";

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

// Every date from `from` to `to` inclusive, at UTC midnight — matches how
// @db.Date columns come back from Prisma, so these compare/upsert cleanly
// against AttendanceRecord.date.
function eachDateInclusive(from: Date, to: Date): Date[] {
  const dates: Date[] = [];
  let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const last = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cursor <= last) {
    dates.push(cursor);
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return dates;
}

// HR/Admin only (mounted behind requireHRAdmin) — the leave summary table
// needs every employee's usage at once; this does the N computations
// server-side in one request instead of the frontend firing N of them.
// Defaults to the current month — this is a monthly cap, not a running
// balance, so there's nothing meaningful to show "as of no particular month".
export const listAllLeaveBalances: RequestHandler = asyncHandler(async (req, res) => {
  const month = (req.query.month as string) || currentMonth();
  const employeeList = await prisma.employee.findMany({ select: { id: true } });
  const entries = await Promise.all(
    employeeList.map(async (e) => [e.id, await computeMonthlyLeaveUsage(e.id, month)] as const)
  );
  res.json({ month, balances: Object.fromEntries(entries) });
});

export const listLeaveRequests: RequestHandler = asyncHandler(async (req, res) => {
  const requestedEmployeeId = req.query.employeeId as string | undefined;
  const scoped = resolveScopedEmployeeId(req, requestedEmployeeId);

  if (!isHRAdmin(req.user?.roles) && !scoped) {
    return res.json({ leaveRequests: [] }); // no linked employee record — nothing to show
  }

  const requests = await prisma.leaveRequest.findMany({
    where: {
      employeeId: isHRAdmin(req.user?.roles) ? requestedEmployeeId : scoped!,
      status: req.query.status as any,
    },
    include: isHRAdmin(req.user?.roles) ? { employee: { select: { id: true, name: true, employeeCode: true } } } : undefined,
    orderBy: { appliedAt: "desc" },
  });
  res.json({ leaveRequests: requests });
});

export const createLeaveRequest: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = leaveRequestCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const employeeId = resolveScopedEmployeeId(req, d.employeeId);
  if (!employeeId) {
    return res.status(isHRAdmin(req.user?.roles) ? 400 : 403).json({
      error: isHRAdmin(req.user?.roles) ? "employeeId is required" : "No HR record is linked to your login",
    });
  }

  const leaveRequest = await prisma.leaveRequest.create({
    data: {
      employeeId,
      type: d.type,
      duration: d.fromDate === d.toDate ? d.duration : "FULL_DAY",
      fromDate: new Date(d.fromDate),
      toDate: new Date(d.toDate),
      days: d.days,
      reason: d.reason,
      status: "PENDING",
    },
  });

  await recordAudit({
    userId: req.user!.sub,
    action: "HR_LEAVE_REQUEST_CREATE",
    entityType: "LeaveRequest",
    entityId: leaveRequest.id,
    afterData: { employeeId, type: d.type, days: d.days },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
  });

  res.status(201).json({ leaveRequest });
});

// HR/Admin only (mounted behind requireHRAdmin). Approving a Full Day
// request writes Attendance for every date in range (ON_LEAVE for
// CASUAL_SICK, WFH for WFH) in the same transaction as the decision —
// Loss of Pay/WFH pay-cut are computed from Attendance, not from this
// request, so the two must never be left to drift apart as separate facts.
// Half/Quarter Day requests don't touch Attendance at all — there's no
// fractional "leave" status to mark (see the LeaveType enum comment).
export const decideLeaveRequest: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = leaveDecisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const before = await prisma.leaveRequest.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Leave request not found" });
  if (before.status !== "PENDING") return res.status(409).json({ error: "This request has already been decided" });

  const leaveRequest = await prisma.$transaction(async (tx) => {
    const updated = await tx.leaveRequest.update({
      where: { id: req.params.id },
      data: { status: d.status, note: d.note, decidedBy: req.user!.sub, decidedAt: new Date() },
    });

    if (d.status === "APPROVED" && before.duration === "FULL_DAY") {
      const attendanceStatus = before.type === "WFH" ? "WFH" : "ON_LEAVE";
      for (const date of eachDateInclusive(before.fromDate, before.toDate)) {
        await tx.attendanceRecord.upsert({
          where: { employeeId_date: { employeeId: before.employeeId, date } },
          create: { employeeId: before.employeeId, date, status: attendanceStatus, markedBy: req.user!.sub },
          update: { status: attendanceStatus, markedBy: req.user!.sub },
        });
      }
    }

    return updated;
  });

  await recordAudit({
    userId: req.user!.sub,
    action: "HR_LEAVE_REQUEST_DECIDE",
    entityType: "LeaveRequest",
    entityId: leaveRequest.id,
    beforeData: { status: before.status },
    afterData: { status: d.status, note: d.note },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
  });

  res.json({ leaveRequest });
});

// Defaults to the current month — see listAllLeaveBalances.
export const getLeaveBalance: RequestHandler = asyncHandler(async (req, res) => {
  const targetId = req.params.employeeId;
  const scoped = resolveScopedEmployeeId(req, targetId);
  if (!scoped || scoped !== targetId) {
    return res.status(403).json({ error: "Forbidden — you can only view your own leave balance" });
  }
  const month = (req.query.month as string) || currentMonth();
  const balance = await computeMonthlyLeaveUsage(targetId, month);
  res.json({ balance });
});
