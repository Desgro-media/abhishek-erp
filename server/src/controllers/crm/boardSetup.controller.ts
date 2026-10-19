import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { isLeadership, headedDepartments } from "../../services/departmentAccess";
import { loadBoards, boardStageStatus, type ServiceBoard } from "../../services/serviceBoards";
import { boardSetupSchema } from "../../validation/crm.schemas";

// Departments → Board setup: the columns, work types, platforms and task lists a service's client boards use. Leadership (Admin / a
// founder-or-chief title) or the department's own head may change it. Existing cards are kept: a renamed column carries its cards, and
// cards in a removed column fall back to the column before it. Running work is never deleted by an edit.

export const saveBoardSetup: RequestHandler = asyncHandler(async (req, res) => {
  const service = req.params.service;
  const before = (await loadBoards())[service];
  if (!before) return res.status(404).json({ error: "That service has no board" });
  const u = { roles: req.user!.roles, name: req.user!.name, employeeId: req.user!.employeeId ?? null };
  if (!(await isLeadership(u)) && !(await headedDepartments(u)).includes(service)) return res.status(403).json({ error: "Forbidden — only leadership or the department head can change this board" });

  const parsed = boardSetupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const names = d.stages.map((s) => s.name);
  if (new Set(names).size !== names.length) return res.status(400).json({ error: "Two stages have the same name" });
  if (d.stages.some((s) => s.was && !before.stages.includes(s.was))) return res.status(400).json({ error: "Unknown column" });
  const wasList = d.stages.map((s) => s.was).filter(Boolean);
  if (new Set(wasList).size !== wasList.length) return res.status(400).json({ error: "A column can only be renamed once" });
  if (before.monthlyTasks && !d.monthlyTasks) return res.status(400).json({ error: "Keep at least one monthly task" });
  if (before.projectTasks && !d.projectTasks) return res.status(400).json({ error: "Keep at least one project type" });
  if (before.projectTasks && !Object.keys(d.projectTasks!).length) return res.status(400).json({ error: "Keep at least one project type" });

  const next: ServiceBoard = {
    ...before,
    stages: names,
    platforms: d.platforms ?? [],
    types: before.projectTasks ? Object.keys(d.projectTasks!) : d.types ?? before.types,
    ...(before.monthlyTasks ? { monthlyTasks: d.monthlyTasks!.map((r) => ({ ...r, newOnly: r.newOnly || undefined })) } : {}),
    ...(before.projectTasks ? { projectTasks: d.projectTasks! } : {}),
  };

  // Where each old column's cards go.
  const rename: Record<string, string> = {};
  for (const s of d.stages) if (s.was) rename[s.was] = s.name;
  const fallback = (old: string) => {
    for (let i = before.stages.indexOf(old) - 1; i >= 0; i--) if (rename[before.stages[i]]) return rename[before.stages[i]];
    return names[0];
  };

  await prisma.$transaction(async (tx) => {
    const cards = await tx.clientTask.findMany({ where: { service }, select: { id: true, stage: true } });
    const groups = new Map<string, string[]>(); // new column -> ids
    for (const c of cards) {
      const to = c.stage && before.stages.includes(c.stage) ? rename[c.stage] ?? fallback(c.stage) : names[0];
      groups.set(to, [...(groups.get(to) ?? []), c.id]);
    }
    for (const [stage, ids] of groups) {
      const status = boardStageStatus(next, stage);
      await tx.clientTask.updateMany({ where: { id: { in: ids } }, data: { stage, status } });
      if (status === "DONE") await tx.clientTask.updateMany({ where: { id: { in: ids }, doneAt: null }, data: { doneAt: new Date() } });
      else await tx.clientTask.updateMany({ where: { id: { in: ids }, doneAt: { not: null } }, data: { doneAt: null } });
    }
    // Store only what differs from nothing: the whole board config for this service.
    const { noun: _n, flagLate: _f, ...config } = next;
    await tx.serviceBoardConfig.upsert({ where: { service }, create: { service, config: config as any, updatedBy: req.user!.name }, update: { config: config as any, updatedBy: req.user!.name } });
    await recordAudit({ userId: req.user!.sub, action: "CRM_BOARD_SETUP_UPDATE", entityType: "ServiceBoard", entityId: service, beforeData: { stages: before.stages, types: before.types, platforms: before.platforms }, afterData: { stages: names, types: next.types, platforms: next.platforms, cardsMoved: cards.length } }, tx);
  });
  res.json({ board: (await loadBoards())[service] });
});

