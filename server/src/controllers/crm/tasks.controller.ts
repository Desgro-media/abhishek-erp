import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { taskCreateSchema, taskUpdateSchema } from "../../validation/crm.schemas";

// Same "narrow self-service slice" as listClients — a plain Sales caller
// only ever sees tasks on their own book of clients, ADMIN sees everyone's.
export const listTasks: RequestHandler = asyncHandler(async (req, res) => {
  const admin = req.user?.roles?.includes("ADMIN") ?? false;
  const tasks = await prisma.clientTask.findMany({
    where: {
      clientId: (req.query.clientId as string) || undefined,
      assignedTo: (req.query.assignedTo as string) || undefined,
      client: admin ? undefined : { salesPerson: req.user!.name },
    },
    include: { attachments: true, client: { select: { id: true, name: true } } },
    orderBy: { dueAt: "asc" },
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

  const task = await prisma.clientTask.create({ data: { clientId, title: d.title, assignedTo: d.assignedTo, dueAt: new Date(d.dueAt) }, include: { attachments: true } });
  await recordAudit({ userId: req.user!.sub, action: "CRM_TASK_CREATE", entityType: "ClientTask", entityId: task.id, afterData: d });
  res.status(201).json({ task });
});

export const updateTask: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = taskUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const before = await prisma.clientTask.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Task not found" });

  // Stamp/clear doneAt exactly when status crosses in/out of Done — same
  // rule as the old prototype's moveTask().
  let doneAt: Date | null | undefined = undefined;
  if (d.status && d.status !== before.status) {
    doneAt = d.status === "DONE" ? new Date() : null;
  }

  const task = await prisma.clientTask.update({
    where: { id: req.params.id },
    data: { title: d.title, assignedTo: d.assignedTo, dueAt: d.dueAt ? new Date(d.dueAt) : undefined, status: d.status, revisions: d.revisions, doneAt },
    include: { attachments: true },
  });

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

  const attachment = await prisma.taskAttachment.create({ data: { taskId: task.id, name, size } });
  res.status(201).json({ attachment });
});

export const removeTaskAttachment: RequestHandler = asyncHandler(async (req, res) => {
  const attachment = await prisma.taskAttachment.delete({ where: { id: req.params.attachmentId } }).catch(() => null);
  if (!attachment) return res.status(404).json({ error: "Attachment not found" });
  res.status(204).send();
});
