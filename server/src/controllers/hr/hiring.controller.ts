import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { nextSequentialCode } from "../../utils/sequentialCode";
import {
  positionCreateSchema,
  positionUpdateSchema,
  candidateCreateSchema,
  candidateUpdateSchema,
} from "../../validation/hr.schemas";

// Everything in this file is HR/Admin only (mounted behind requireHRAdmin).

async function nextPositionCode(): Promise<string> {
  return nextSequentialCode("POS-", (await prisma.openPosition.findMany({ select: { positionCode: true } })).map((p) => p.positionCode));
}

// Returns both active and archived positions/candidates in one shot — the
// client (loadHiring()) fetches this once and splits active vs. archived
// itself, the same way it already does for status/stage.
export const listPositions: RequestHandler = asyncHandler(async (req, res) => {
  const positions = await prisma.openPosition.findMany({
    where: { status: req.query.status as any },
    include: { candidates: true },
    orderBy: { postedDate: "desc" },
  });
  res.json({ positions });
});

export const createPosition: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = positionCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const position = await prisma.openPosition.create({
    data: { positionCode: await nextPositionCode(), role: d.role, dept: d.dept, openings: d.openings, status: "OPEN" },
  });

  await recordAudit({ userId: req.user!.sub, action: "HR_POSITION_CREATE", entityType: "OpenPosition", entityId: position.id, afterData: d });
  res.status(201).json({ position });
});

export const updatePosition: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = positionUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });

  const position = await prisma.openPosition.update({ where: { id: req.params.id }, data: parsed.data }).catch(() => null);
  if (!position) return res.status(404).json({ error: "Position not found" });

  await recordAudit({ userId: req.user!.sub, action: "HR_POSITION_UPDATE", entityType: "OpenPosition", entityId: position.id, afterData: parsed.data });
  res.json({ position });
});

export const createCandidate: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = candidateCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const position = await prisma.openPosition.findUnique({ where: { id: d.positionId } });
  if (!position) return res.status(404).json({ error: "Position not found" });

  const candidate = await prisma.candidate.create({
    data: { positionId: d.positionId, name: d.name, phone: d.phone, email: d.email, stage: "APPLIED" },
  });

  await recordAudit({ userId: req.user!.sub, action: "HR_CANDIDATE_CREATE", entityType: "Candidate", entityId: candidate.id, afterData: d });
  res.status(201).json({ candidate });
});

export const updateCandidate: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = candidateUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });

  const before = await prisma.candidate.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Candidate not found" });

  const candidate = await prisma.candidate.update({ where: { id: req.params.id }, data: parsed.data });

  await recordAudit({
    userId: req.user!.sub,
    action: "HR_CANDIDATE_UPDATE",
    entityType: "Candidate",
    entityId: candidate.id,
    beforeData: { stage: before.stage },
    afterData: parsed.data,
  });
  res.json({ candidate });
});
