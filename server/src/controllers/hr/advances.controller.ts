import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { isHRAdmin, resolveScopedEmployeeId } from "../../middleware/hrAccess";
import { advanceCreateSchema, advanceDecisionSchema } from "../../validation/hr.schemas";

export const listAdvances: RequestHandler = asyncHandler(async (req, res) => {
  const requestedEmployeeId = req.query.employeeId as string | undefined;
  const scoped = resolveScopedEmployeeId(req, requestedEmployeeId);
  if (!isHRAdmin(req.user?.roles) && !scoped) return res.json({ advances: [] });

  const advances = await prisma.advance.findMany({
    where: {
      employeeId: isHRAdmin(req.user?.roles) ? requestedEmployeeId : scoped!,
      status: req.query.status as any,
    },
    include: isHRAdmin(req.user?.roles) ? { employee: { select: { id: true, name: true, employeeCode: true } } } : undefined,
    orderBy: { requestedAt: "desc" },
  });
  res.json({ advances });
});

export const createAdvance: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = advanceCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const employeeId = resolveScopedEmployeeId(req, d.employeeId);
  if (!employeeId) {
    return res.status(isHRAdmin(req.user?.roles) ? 400 : 403).json({
      error: isHRAdmin(req.user?.roles) ? "employeeId is required" : "No HR record is linked to your login",
    });
  }

  const monthlyDeduction = Math.ceil(d.amount / d.installments);
  const advance = await prisma.advance.create({
    data: {
      employeeId,
      amount: d.amount,
      reason: d.reason,
      installments: d.installments,
      monthlyDeduction,
      balance: d.amount,
      status: "PENDING",
    },
  });

  await recordAudit({
    userId: req.user!.sub,
    action: "HR_ADVANCE_REQUEST",
    entityType: "Advance",
    entityId: advance.id,
    afterData: { employeeId, amount: d.amount, installments: d.installments },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
  });

  res.status(201).json({ advance });
});

// HR/Admin only (mounted behind requireHRAdmin).
export const decideAdvance: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = advanceDecisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const before = await prisma.advance.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Advance not found" });
  if (before.status !== "PENDING") return res.status(409).json({ error: "This advance has already been decided" });

  const advance = await prisma.advance.update({
    where: { id: req.params.id },
    data: { status: d.status, decidedBy: req.user!.sub, decidedAt: new Date() },
  });

  await recordAudit({
    userId: req.user!.sub,
    action: "HR_ADVANCE_DECIDE",
    entityType: "Advance",
    entityId: advance.id,
    beforeData: { status: before.status },
    afterData: { status: d.status },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
  });

  res.json({ advance });
});
