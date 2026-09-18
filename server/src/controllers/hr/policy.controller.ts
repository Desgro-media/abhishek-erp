import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { policyUpdateSchema, holidayCreateSchema } from "../../validation/hr.schemas";

// Readable by anyone authenticated — weeklyOff/holidays feed calendar and
// working-day math used across the whole app, not just HR.
export const getPolicy: RequestHandler = asyncHandler(async (_req, res) => {
  const policy = (await prisma.hrPolicy.findUnique({ where: { id: 1 } })) ?? (await prisma.hrPolicy.create({ data: { id: 1 } }));
  const holidays = await prisma.holiday.findMany({ orderBy: { date: "asc" } });
  res.json({ policy, holidays });
});

// HR/Admin only from here down (mounted behind requireHRAdmin).
export const updatePolicy: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = policyUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });

  const policy = await prisma.hrPolicy.upsert({
    where: { id: 1 },
    create: { id: 1, ...parsed.data },
    update: parsed.data,
  });

  await recordAudit({ userId: req.user!.sub, action: "HR_POLICY_UPDATE", entityType: "HrPolicy", entityId: "1", afterData: parsed.data });
  res.json({ policy });
});

export const addHoliday: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = holidayCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const holiday = await prisma.holiday.create({ data: { date: new Date(d.date), name: d.name } }).catch(() => null);
  if (!holiday) return res.status(409).json({ error: "A holiday is already set for that date" });

  await recordAudit({ userId: req.user!.sub, action: "HR_HOLIDAY_ADD", entityType: "Holiday", entityId: holiday.id, afterData: d });
  res.status(201).json({ holiday });
});

export const removeHoliday: RequestHandler = asyncHandler(async (req, res) => {
  const holiday = await prisma.holiday.delete({ where: { date: new Date(req.params.date) } }).catch(() => null);
  if (!holiday) return res.status(404).json({ error: "Holiday not found" });

  await recordAudit({ userId: req.user!.sub, action: "HR_HOLIDAY_REMOVE", entityType: "Holiday", entityId: holiday.id });
  res.status(204).send();
});
