import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { isHRAdmin, resolveScopedEmployeeId } from "../../middleware/hrAccess";
import { leaveRequestCreateSchema, leaveDecisionSchema, leaveBalanceAdjustmentSchema } from "../../validation/hr.schemas";
import { computeLeaveBalance } from "../../services/hr/leaveBalance";

// HR/Admin only (mounted behind requireHRAdmin) — the leave summary table
// needs every employee's balance at once; this does the N computations
// server-side in one request instead of the frontend firing N of them.
export const listAllLeaveBalances: RequestHandler = asyncHandler(async (_req, res) => {
  const employeeList = await prisma.employee.findMany({ select: { id: true } });
  const entries = await Promise.all(
    employeeList.map(async (e) => [e.id, await computeLeaveBalance(e.id)] as const)
  );
  res.json({ balances: Object.fromEntries(entries) });
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

// HR/Admin only (mounted behind requireHRAdmin).
export const decideLeaveRequest: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = leaveDecisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const before = await prisma.leaveRequest.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Leave request not found" });
  if (before.status !== "PENDING") return res.status(409).json({ error: "This request has already been decided" });

  const leaveRequest = await prisma.leaveRequest.update({
    where: { id: req.params.id },
    data: { status: d.status, note: d.note, decidedBy: req.user!.sub, decidedAt: new Date() },
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

export const getLeaveBalance: RequestHandler = asyncHandler(async (req, res) => {
  const targetId = req.params.employeeId;
  const scoped = resolveScopedEmployeeId(req, targetId);
  if (!scoped || scoped !== targetId) {
    return res.status(403).json({ error: "Forbidden — you can only view your own leave balance" });
  }
  const balance = await computeLeaveBalance(targetId);
  res.json({ balance });
});

// HR/Admin only (mounted behind requireHRAdmin) — append-only ledger entry.
export const addLeaveBalanceAdjustment: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = leaveBalanceAdjustmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const adjustment = await prisma.leaveBalanceAdjustment.create({
    data: { employeeId: d.employeeId, type: d.type, days: d.days, note: d.note, createdBy: req.user!.sub },
  });

  await recordAudit({
    userId: req.user!.sub,
    action: "HR_LEAVE_BALANCE_ADJUST",
    entityType: "Employee",
    entityId: d.employeeId,
    afterData: { type: d.type, days: d.days, note: d.note },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
  });

  res.status(201).json({ adjustment });
});
