import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { noticeCreateSchema, noticeUpdateSchema } from "../../validation/hr.schemas";

// Visible to every authenticated user regardless of role — company-wide
// broadcast, same as the old prototype's behavior.
export const listNotices: RequestHandler = asyncHandler(async (_req, res) => {
  const notices = await prisma.notice.findMany({
    orderBy: { postedDate: "desc" },
    include: { postedByUser: { select: { name: true } } },
  });
  res.json({ notices });
});

// HR/Admin only from here down (mounted behind requireHRAdmin). postedBy is
// always the real authenticated user — not a free-text field like the old
// prototype, which let HR type any name in.
export const createNotice: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = noticeCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const notice = await prisma.notice.create({
    data: { title: d.title, message: d.message, postedById: req.user!.sub },
  });

  await recordAudit({ userId: req.user!.sub, action: "HR_NOTICE_CREATE", entityType: "Notice", entityId: notice.id, afterData: d });
  res.status(201).json({ notice });
});

export const updateNotice: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = noticeUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });

  const notice = await prisma.notice.update({ where: { id: req.params.id }, data: parsed.data }).catch(() => null);
  if (!notice) return res.status(404).json({ error: "Notice not found" });

  await recordAudit({ userId: req.user!.sub, action: "HR_NOTICE_UPDATE", entityType: "Notice", entityId: notice.id, afterData: parsed.data });
  res.json({ notice });
});

export const deleteNotice: RequestHandler = asyncHandler(async (req, res) => {
  const notice = await prisma.notice.delete({ where: { id: req.params.id } }).catch(() => null);
  if (!notice) return res.status(404).json({ error: "Notice not found" });

  await recordAudit({ userId: req.user!.sub, action: "HR_NOTICE_DELETE", entityType: "Notice", entityId: notice.id });
  res.status(204).send();
});
