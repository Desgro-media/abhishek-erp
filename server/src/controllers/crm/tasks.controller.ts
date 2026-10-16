import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { isCrmUser } from "../../middleware/crmAccess";
import { tasksForUser, departmentTasksForUser, resolveAssignee, notifyUser } from "../../services/taskAccess.service";
import { recordAudit } from "../../services/audit.service";
import { taskCreateSchema, taskUpdateSchema } from "../../validation/crm.schemas";

// Open to every signed-in login; tasksForUser decides what each one gets (assignee / creator / book / all).
export const listTasks: RequestHandler = asyncHandler(async (req, res) => {
  // ?scope=department — everything assigned to people in the caller's own department (read-only; for the calendar).
  if (req.query.scope === "department") return res.json({ tasks: await departmentTasksForUser(req.user!) });
  const tasks = await tasksForUser(req.user!, {
    clientId: (req.query.clientId as string) || undefined,
    assigneeUserId: (req.query.assigneeUserId as string) || undefined,
  });
  res.json({ tasks });
});

export const createTask: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = taskCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const clientId = req.params.clientId;

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return res.status(404).json({ error: "Client not found" });

  const who = await resolveAssignee({ assigneeUserId: d.assigneeUserId, name: d.assignedTo });
  if (d.assigneeUserId && !who) return res.status(400).json({ error: "Assignee not found or inactive" });
  const task = await prisma.clientTask.create({
    data: { clientId, title: d.title, assignedTo: who?.name, assigneeUserId: who?.userId, createdByUserId: req.user!.sub, dueAt: new Date(d.dueAt) },
    include: { attachments: true },
  });
  await notifyUser(who?.userId, { kind: "TASK_ASSIGNED", title: "New task assigned to you", body: `${task.title} — ${client.name}`, link: "workspace/tasks" }, req.user!.sub);
  await recordAudit({ userId: req.user!.sub, action: "CRM_TASK_CREATE", entityType: "ClientTask", entityId: task.id, afterData: d });
  res.status(201).json({ task });
});

export const updateTask: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = taskUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const before = await prisma.clientTask.findUnique({ where: { id: req.params.id }, include: { client: { select: { name: true } } } });
  if (!before) return res.status(404).json({ error: "Task not found" });

  // Sales/Admin keep full edit rights. Everyone else may only move the task between stages, and only if it's theirs.
  if (!isCrmUser(req.user!.roles)) {
    if (before.assigneeUserId !== req.user!.sub) return res.status(403).json({ error: "Forbidden — this task isn't assigned to you" });
    const touchesMoreThanStatus = ["title", "assignedTo", "assigneeUserId", "dueAt", "revisions"].some((k) => (d as any)[k] !== undefined);
    if (touchesMoreThanStatus) return res.status(403).json({ error: "Forbidden — you can only change the stage of your own task" });
  }

  const reassign = d.assigneeUserId !== undefined || d.assignedTo !== undefined;
  const who = reassign ? await resolveAssignee({ assigneeUserId: d.assigneeUserId, name: d.assignedTo }) : undefined;
  if (reassign && d.assigneeUserId && !who) return res.status(400).json({ error: "Assignee not found or inactive" });

  // Stamp/clear doneAt exactly when status crosses in/out of Done — same
  // rule as the old prototype's moveTask().
  let doneAt: Date | null | undefined = undefined;
  if (d.status && d.status !== before.status) {
    doneAt = d.status === "DONE" ? new Date() : null;
  }

  const task = await prisma.clientTask.update({
    where: { id: req.params.id },
    data: { title: d.title, ...(who ? { assignedTo: who.name, assigneeUserId: who.userId } : {}), dueAt: d.dueAt ? new Date(d.dueAt) : undefined, status: d.status, revisions: d.revisions, doneAt },
    include: { attachments: true },
  });

  if (who && who.userId !== before.assigneeUserId) {
    await notifyUser(who.userId, { kind: "TASK_ASSIGNED", title: "A task was assigned to you", body: `${task.title} — ${before.client.name}`, link: "workspace/tasks" }, req.user!.sub);
    await notifyUser(before.assigneeUserId, { kind: "TASK_REASSIGNED", title: "A task was reassigned away from you", body: `${task.title} — ${before.client.name}` }, req.user!.sub);
  }
  await recordAudit({ userId: req.user!.sub, action: "CRM_TASK_UPDATE", entityType: "ClientTask", entityId: task.id, afterData: d });
  res.json({ task });
});

// Metadata only — no real file storage exists yet, same caveat as the old
// prototype (it never uploaded real bytes either, just name/size).
export const addTaskAttachment: RequestHandler = asyncHandler(async (req, res) => {
  const { name, size } = req.body || {};
  if (!name || typeof size !== "number") return res.status(400).json({ error: "name and size are required" });

  const task = await prisma.clientTask.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ error: "Task not found" });
  if (!isCrmUser(req.user!.roles) && task.assigneeUserId !== req.user!.sub) return res.status(403).json({ error: "Forbidden — this task isn't assigned to you" });

  const attachment = await prisma.taskAttachment.create({ data: { taskId: task.id, name, size } });
  res.status(201).json({ attachment });
});

export const removeTaskAttachment: RequestHandler = asyncHandler(async (req, res) => {
  if (!isCrmUser(req.user!.roles)) {
    const own = await prisma.taskAttachment.findUnique({ where: { id: req.params.attachmentId }, include: { task: { select: { assigneeUserId: true } } } });
    if (own && own.task.assigneeUserId !== req.user!.sub) return res.status(403).json({ error: "Forbidden — this task isn't assigned to you" });
  }
  const attachment = await prisma.taskAttachment.delete({ where: { id: req.params.attachmentId } }).catch(() => null);
  if (!attachment) return res.status(404).json({ error: "Attachment not found" });
  res.status(204).send();
});
