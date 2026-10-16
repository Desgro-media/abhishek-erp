import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { resolveAssignee, notifyUser, contentItemsForUser, departmentContentForUser } from "../../services/taskAccess.service";
import { contentItemCreateSchema, contentItemUpdateSchema } from "../../validation/crm.schemas";

export const listContentItems: RequestHandler = asyncHandler(async (req, res) => {
  const items = await prisma.contentItem.findMany({ where: { stage: req.query.stage as any }, orderBy: { dueAt: "asc" } });
  res.json({ items });
});

export const listMyContentItems: RequestHandler = asyncHandler(async (req, res) => {
  if (req.query.scope === "department") return res.json({ items: await departmentContentForUser(req.user!) });
  res.json({ items: await contentItemsForUser(req.user!) });
});

// The assignee moves their own card between stages — nothing else, and only if it's theirs.
export const moveMyContentItem: RequestHandler = asyncHandler(async (req, res) => {
  const stage = req.body?.stage;
  if (!["IDEA", "SCRIPTING", "PRODUCTION", "EDIT", "GRAPHIC", "REVIEW", "SCHEDULED", "PUBLISHED"].includes(stage)) return res.status(400).json({ error: "Invalid stage" });
  const before = await prisma.contentItem.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Content item not found" });
  if (before.assigneeUserId !== req.user!.sub) return res.status(403).json({ error: "Forbidden — this card isn't assigned to you" });
  const item = await prisma.contentItem.update({ where: { id: before.id }, data: { stage } });
  await recordAudit({ userId: req.user!.sub, action: "CONTENT_ITEM_UPDATE", entityType: "ContentItem", entityId: item.id, afterData: { stage } });
  res.json({ item });
});

export const createContentItem: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = contentItemCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const { assigneeUserId: _id, assignee: _name, ...rest } = d;
  const who = await resolveAssignee({ assigneeUserId: d.assigneeUserId, name: d.assignee });
  if (d.assigneeUserId && !who) return res.status(400).json({ error: "Assignee not found or inactive" });
  const item = await prisma.contentItem.create({ data: { ...rest, assignee: who?.name, assigneeUserId: who?.userId, dueAt: new Date(d.dueAt) } });
  await notifyUser(who?.userId, { kind: "CONTENT_ASSIGNED", title: "A content card was assigned to you", body: item.title, link: "workspace/tasks" }, req.user!.sub);
  await recordAudit({ userId: req.user!.sub, action: "CONTENT_ITEM_CREATE", entityType: "ContentItem", entityId: item.id, afterData: d });
  res.status(201).json({ item });
});

export const updateContentItem: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = contentItemUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const before = await prisma.contentItem.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Content item not found" });
  const { assigneeUserId: _id, assignee: _name, ...rest } = d;
  const reassign = d.assigneeUserId !== undefined || d.assignee !== undefined;
  const who = reassign ? await resolveAssignee({ assigneeUserId: d.assigneeUserId, name: d.assignee }) : undefined;
  if (reassign && d.assigneeUserId && !who) return res.status(400).json({ error: "Assignee not found or inactive" });
  const item = await prisma.contentItem.update({ where: { id: before.id }, data: { ...rest, ...(who ? { assignee: who.name, assigneeUserId: who.userId } : {}), dueAt: d.dueAt ? new Date(d.dueAt) : undefined } });
  if (who && who.userId !== before.assigneeUserId) {
    await notifyUser(who.userId, { kind: "CONTENT_ASSIGNED", title: "A content card was assigned to you", body: item.title, link: "workspace/tasks" }, req.user!.sub);
    await notifyUser(before.assigneeUserId, { kind: "CONTENT_REASSIGNED", title: "A content card was reassigned away from you", body: item.title }, req.user!.sub);
  }

  await recordAudit({ userId: req.user!.sub, action: "CONTENT_ITEM_UPDATE", entityType: "ContentItem", entityId: item.id, afterData: d });
  res.json({ item });
});

export const deleteContentItem: RequestHandler = asyncHandler(async (req, res) => {
  const item = await prisma.contentItem.delete({ where: { id: req.params.id } }).catch(() => null);
  if (!item) return res.status(404).json({ error: "Content item not found" });
  await recordAudit({ userId: req.user!.sub, action: "CONTENT_ITEM_DELETE", entityType: "ContentItem", entityId: item.id });
  res.status(204).send();
});
