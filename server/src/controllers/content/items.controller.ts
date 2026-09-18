import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { contentItemCreateSchema, contentItemUpdateSchema } from "../../validation/crm.schemas";

export const listContentItems: RequestHandler = asyncHandler(async (req, res) => {
  const items = await prisma.contentItem.findMany({ where: { stage: req.query.stage as any }, orderBy: { dueAt: "asc" } });
  res.json({ items });
});

export const createContentItem: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = contentItemCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const item = await prisma.contentItem.create({ data: { ...d, dueAt: new Date(d.dueAt) } });
  await recordAudit({ userId: req.user!.sub, action: "CONTENT_ITEM_CREATE", entityType: "ContentItem", entityId: item.id, afterData: d });
  res.status(201).json({ item });
});

export const updateContentItem: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = contentItemUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const item = await prisma.contentItem.update({ where: { id: req.params.id }, data: { ...d, dueAt: d.dueAt ? new Date(d.dueAt) : undefined } }).catch(() => null);
  if (!item) return res.status(404).json({ error: "Content item not found" });

  await recordAudit({ userId: req.user!.sub, action: "CONTENT_ITEM_UPDATE", entityType: "ContentItem", entityId: item.id, afterData: d });
  res.json({ item });
});

export const deleteContentItem: RequestHandler = asyncHandler(async (req, res) => {
  const item = await prisma.contentItem.delete({ where: { id: req.params.id } }).catch(() => null);
  if (!item) return res.status(404).json({ error: "Content item not found" });
  await recordAudit({ userId: req.user!.sub, action: "CONTENT_ITEM_DELETE", entityType: "ContentItem", entityId: item.id });
  res.status(204).send();
});
