import { RequestHandler } from "express";
import { randomUUID } from "crypto";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { resolveAssignee, notifyUser } from "../../services/taskAccess.service";
import { loadBoards, boardStageStatus, cycleTasks } from "../../services/serviceBoards";
import { boardCardCreateSchema, boardCardUpdateSchema, boardProjectCreateSchema, boardCycleCreateSchema } from "../../validation/crm.schemas";
import { loadClientFor } from "./clientCollab.controller";

// The cards on a client's Services boards (Client > Services). A card is a ClientTask with a service and a column (stage); its
// status always follows the column. Guarded exactly like the client page (loadClientFor: Admin / Sales Head / Clients role see every
// client, a plain Sales rep only their own).

export const getServiceBoards: RequestHandler = asyncHandler(async (_req, res) => { res.json({ boards: await loadBoards() }); });

const toDate = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00.000Z`) : null);
const realDate = (d: string) => { const x = new Date(`${d}T00:00:00.000Z`); return !Number.isNaN(x.getTime()) && x.toISOString().slice(0, 10) === d; };
const today = () => new Date().toISOString().slice(0, 10);

// Who a card is assigned to: the client itself (a "client action"), or a login / bare name resolved like any other task.
async function assigneeFor(client: { name: string }, d: { assignedTo?: string; assigneeUserId?: string; clientAssigned?: boolean }) {
  if (d.clientAssigned) return { name: client.name, userId: null as string | null, ok: true };
  if (d.assigneeUserId === undefined && d.assignedTo === undefined) return null;
  const who = await resolveAssignee({ assigneeUserId: d.assigneeUserId, name: d.assignedTo });
  if (d.assigneeUserId && !who) return { name: null, userId: null, ok: false };
  return { name: who?.name ?? null, userId: who?.userId ?? null, ok: true };
}

const shape = (t: any) => ({ ...t, platforms: t.platforms ?? [] });

export const createBoardCard: RequestHandler = asyncHandler(async (req, res) => {
  const client = await loadClientFor(req, res);
  if (!client) return;
  const parsed = boardCardCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const board = (await loadBoards())[d.service];
  if (!board) return res.status(400).json({ error: "That service has no board" });
  if (!client.services.includes(d.service)) return res.status(400).json({ error: `${client.name} doesn't take ${d.service}` });
  const stage = d.stage ?? board.stages[0];
  if (!board.stages.includes(stage)) return res.status(400).json({ error: "Unknown column" });
  if (d.type && !board.types.includes(d.type)) return res.status(400).json({ error: "Unknown type" });
  if ((d.platforms ?? []).some((p) => !board.platforms.includes(p))) return res.status(400).json({ error: "Unknown platform" });
  for (const x of [d.start, d.due]) if (x && !realDate(x)) return res.status(400).json({ error: "Invalid date" });
  if (d.start && d.due && d.due < d.start) return res.status(400).json({ error: "Due date can't be before the start date" });
  const who = await assigneeFor(client, d);
  if (who && !who.ok) return res.status(400).json({ error: "Assignee not found or inactive" });

  const status = boardStageStatus(board, stage);
  const task = await prisma.clientTask.create({
    data: {
      clientId: client.id, title: d.title, service: d.service, stage, status, taskType: d.type || null, platforms: d.platforms ?? [],
      assignedTo: who?.name ?? null, assigneeUserId: who?.userId ?? null, clientAssigned: !!d.clientAssigned, createdByUserId: req.user!.sub,
      startAt: toDate(d.start), dueAt: toDate(d.due ?? d.start ?? today())!, notes: d.notes || null, doneAt: status === "DONE" ? new Date() : null,
    },
    include: { attachments: true },
  });
  await notifyUser(who?.userId, { kind: "TASK_ASSIGNED", title: "New task assigned to you", body: `${task.title} — ${client.name}`, link: "workspace/tasks" }, req.user!.sub);
  await recordAudit({ userId: req.user!.sub, action: "CRM_BOARD_CARD_CREATE", entityType: "ClientTask", entityId: task.id, afterData: d });
  res.status(201).json({ task: shape(task) });
});

// Loads a card the caller may touch: found by id, then its client is checked with the same guard as the client page.
async function loadCard(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) {
  const task = await prisma.clientTask.findFirst({ where: { id: req.params.id, service: { not: null } }, include: { client: true } });
  if (!task) { res.status(404).json({ error: "Card not found" }); return null; }
  req.params.id = task.clientId;
  if (!(await loadClientFor(req, res))) return null;
  return task;
}

export const updateBoardCard: RequestHandler = asyncHandler(async (req, res) => {
  const cardId = req.params.id;
  const before = await loadCard(req, res);
  if (!before) return;
  const parsed = boardCardUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const service = before.service!;
  const board = (await loadBoards())[service]!;
  if (d.stage !== undefined && !board.stages.includes(d.stage)) return res.status(400).json({ error: "Unknown column" });
  if (d.type && !board.types.includes(d.type)) return res.status(400).json({ error: "Unknown type" });
  if ((d.platforms ?? []).some((p) => !board.platforms.includes(p))) return res.status(400).json({ error: "Unknown platform" });
  for (const x of [d.start, d.due]) if (x && !realDate(x)) return res.status(400).json({ error: "Invalid date" });
  const start = d.start === undefined ? before.startAt?.toISOString().slice(0, 10) : d.start;
  const due = d.due === undefined ? before.dueAt.toISOString().slice(0, 10) : d.due;
  if (start && due && due < start) return res.status(400).json({ error: "Due date can't be before the start date" });
  const who = await assigneeFor(before.client, d);
  if (who && !who.ok) return res.status(400).json({ error: "Assignee not found or inactive" });

  const stage = d.stage ?? before.stage ?? board.stages[0];
  const status = boardStageStatus(board, stage);
  const task = await prisma.clientTask.update({
    where: { id: cardId },
    data: {
      title: d.title, taskType: d.type === undefined ? undefined : d.type || null, platforms: d.platforms, notes: d.notes === undefined ? undefined : d.notes || null,
      ...(who ? { assignedTo: who.name, assigneeUserId: who.userId, clientAssigned: !!d.clientAssigned } : d.clientAssigned === false ? { clientAssigned: false } : {}),
      startAt: d.start === undefined ? undefined : toDate(d.start), dueAt: d.due ? toDate(d.due)! : undefined,
      stage, status, doneAt: status === before.status ? undefined : status === "DONE" ? new Date() : null,
    },
    include: { attachments: true },
  });
  if (who?.userId && who.userId !== before.assigneeUserId) {
    await notifyUser(who.userId, { kind: "TASK_ASSIGNED", title: "A task was assigned to you", body: `${task.title} — ${before.client.name}`, link: "workspace/tasks" }, req.user!.sub);
    await notifyUser(before.assigneeUserId, { kind: "TASK_REASSIGNED", title: "A task was reassigned away from you", body: `${task.title} — ${before.client.name}` }, req.user!.sub);
  }
  await recordAudit({ userId: req.user!.sub, action: "CRM_BOARD_CARD_UPDATE", entityType: "ClientTask", entityId: task.id, beforeData: { stage: before.stage, title: before.title }, afterData: d });
  res.json({ task: shape(task) });
});

export const deleteBoardCard: RequestHandler = asyncHandler(async (req, res) => {
  const before = await loadCard(req, res);
  if (!before) return;
  await prisma.clientTask.delete({ where: { id: before.id } });
  await recordAudit({ userId: req.user!.sub, action: "CRM_BOARD_CARD_DELETE", entityType: "ClientTask", entityId: before.id, beforeData: { title: before.title, service: before.service, stage: before.stage } });
  res.status(204).send();
});

// "Start project": creates the project type's tasks in the first column, back-to-back, all tied by one project id.
export const createBoardProject: RequestHandler = asyncHandler(async (req, res) => {
  const client = await loadClientFor(req, res);
  if (!client) return;
  const parsed = boardProjectCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const board = (await loadBoards())[d.service];
  const list = board?.projectTasks?.[d.type];
  if (!board || !list) return res.status(400).json({ error: "That service has no project of this type" });
  if (!client.services.includes(d.service)) return res.status(400).json({ error: `${client.name} doesn't take ${d.service}` });
  if (d.tasks.length !== list.length || d.tasks.some((t, i) => t.title !== list[i].name)) return res.status(400).json({ error: "The tasks don't match this project type" });
  if (!realDate(d.start) || d.tasks.some((t) => !realDate(t.start) || !realDate(t.due) || t.due < t.start)) return res.status(400).json({ error: "Invalid date" });
  const who = await resolveAssignee({ assigneeUserId: d.assigneeUserId, name: d.assignedTo });
  if (d.assigneeUserId && !who) return res.status(400).json({ error: "Assignee not found or inactive" });

  const projectId = randomUUID();
  const stage = board.stages[0];
  const tasks = await prisma.$transaction(
    d.tasks.map((t, i) => prisma.clientTask.create({
      data: {
        clientId: client.id, title: t.title, service: d.service, stage, status: boardStageStatus(board, stage), taskType: d.type, platforms: [],
        assignedTo: who?.name ?? null, assigneeUserId: who?.userId ?? null, createdByUserId: req.user!.sub, startAt: toDate(t.start), dueAt: toDate(t.due)!,
        maxDays: list[i].days, projectId, projectName: d.name, projectKind: d.type,
      },
      include: { attachments: true },
    })),
  );
  await notifyUser(who?.userId, { kind: "TASK_ASSIGNED", title: `${tasks.length} tasks assigned to you`, body: `${d.name} — ${client.name}`, link: "workspace/tasks" }, req.user!.sub);
  await recordAudit({ userId: req.user!.sub, action: "CRM_BOARD_PROJECT_CREATE", entityType: "Client", entityId: client.id, afterData: { projectId, service: d.service, type: d.type, name: d.name, tasks: tasks.length } });
  res.status(201).json({ projectId, tasks: tasks.map(shape) });
});

export const deleteBoardProject: RequestHandler = asyncHandler(async (req, res) => {
  const client = await loadClientFor(req, res);
  if (!client) return;
  // Matched on BOTH ids so a project of another client can never be removed through this client's URL.
  const where = { clientId: client.id, projectId: req.params.projectId };
  const first = await prisma.clientTask.findFirst({ where });
  if (!first) return res.status(404).json({ error: "Project not found" });
  const { count } = await prisma.clientTask.deleteMany({ where });
  await recordAudit({ userId: req.user!.sub, action: "CRM_BOARD_PROJECT_DELETE", entityType: "Client", entityId: client.id, beforeData: { projectId: req.params.projectId, name: first.projectName, tasks: count } });
  res.status(204).send();
});

// "Start / retain a consultation month": that month's tasks (the "new clients only" ones skipped for a retained client), created in
// the first column, back-to-back, all tagged with the month. One cycle per client per month.
export const createBoardCycle: RequestHandler = asyncHandler(async (req, res) => {
  const client = await loadClientFor(req, res);
  if (!client) return;
  const parsed = boardCycleCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const service = "Marketing Consultation";
  if (!client.services.includes(service)) return res.status(400).json({ error: `${client.name} doesn't take ${service}` });
  const board = (await loadBoards())[service];
  const list = cycleTasks(board, d.retained);
  if (d.tasks.length !== list.length || d.tasks.some((t, i) => t.title !== list[i].name)) return res.status(400).json({ error: "The tasks don't match this month's list" });
  if (!realDate(d.start) || d.tasks.some((t) => !realDate(t.start) || !realDate(t.due) || t.due < t.start)) return res.status(400).json({ error: "Invalid date" });
  const cycle = d.start.slice(0, 7);
  if (await prisma.clientTask.findFirst({ where: { clientId: client.id, service, cycle } })) return res.status(409).json({ error: `${cycle} has already been started for this client` });
  const who = await resolveAssignee({ assigneeUserId: d.assigneeUserId, name: d.assignedTo });
  if (d.assigneeUserId && !who) return res.status(400).json({ error: "Assignee not found or inactive" });

  const stage = board.stages[0];
  const tasks = await prisma.$transaction(
    d.tasks.map((t, i) => prisma.clientTask.create({
      data: {
        clientId: client.id, title: t.title, service, stage, status: boardStageStatus(board, stage), taskType: list[i].type, platforms: [],
        assignedTo: who?.name ?? null, assigneeUserId: who?.userId ?? null, createdByUserId: req.user!.sub, startAt: toDate(t.start), dueAt: toDate(t.due)!,
        maxDays: list[i].days, cycle, retained: d.retained,
      },
      include: { attachments: true },
    })),
  );
  await notifyUser(who?.userId, { kind: "TASK_ASSIGNED", title: `${tasks.length} tasks assigned to you`, body: `${cycle} consultation — ${client.name}`, link: "workspace/tasks" }, req.user!.sub);
  await recordAudit({ userId: req.user!.sub, action: "CRM_BOARD_CYCLE_CREATE", entityType: "Client", entityId: client.id, afterData: { cycle, retained: d.retained, tasks: tasks.length } });
  res.status(201).json({ cycle, tasks: tasks.map(shape) });
});
