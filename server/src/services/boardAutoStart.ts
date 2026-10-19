import { randomUUID } from "crypto";
import { prisma } from "../db/prisma";
import { loadBoards, boardStageStatus, cycleTasks } from "./serviceBoards";
import { resolveAssignee } from "./taskAccess.service";

// When a client starts taking a service, its board shouldn't be empty: Marketing Consultation gets its first month of tasks and
// Web Development / Graphic Design get a first project of the department's first type. Idempotent (does nothing for a service that
// already has cards), and never allowed to break the client save that triggered it.

const addDays = (ds: string, n: number) => { const d = new Date(`${ds}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function workingDayCheck() {
  const policy = await prisma.hrPolicy.findUnique({ where: { id: 1 } });
  const weeklyOff = policy?.weeklyOff ?? 0;
  const holidays = new Set((await prisma.holiday.findMany({ select: { date: true } })).map((h) => h.date.toISOString().slice(0, 10)));
  return (d: string) => new Date(`${d}T00:00:00.000Z`).getUTCDay() !== weeklyOff && !holidays.has(d);
}

// Same rule as the page: the n-th working day counting the start day itself; tasks run back-to-back.
export async function scheduleTasks(days: number[], startDate: string) {
  const isWork = await workingDayCheck();
  const nextWork = (d: string) => { let i = 0; while (!isWork(d) && i++ < 30) d = addDays(d, 1); return d; };
  const addWork = (date: string, n: number) => {
    let d = nextWork(date);
    for (let left = Math.max(0, Math.ceil(n) - 1); left > 0; ) { d = addDays(d, 1); if (isWork(d)) left--; }
    return d;
  };
  let d = nextWork(startDate);
  return days.map((n) => { const start = d, due = addWork(start, n); d = nextWork(addDays(due, 1)); return { start, due }; });
}

async function ownerFor(service: string, accountManager: string | null): Promise<{ userId: string | null; name: string | null }> {
  if (service === "Marketing Consultation" && accountManager) return (await resolveAssignee({ name: accountManager })) ?? { userId: null, name: null };
  const u = await prisma.user.findFirst({ where: { active: true, employee: { dept: service } }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  return u ? { userId: u.id, name: u.name } : { userId: null, name: null };
}

export async function autoStartServices(clientId: string, only?: string[], actorUserId?: string | null) {
  try {
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) return;
    const today = new Date().toISOString().slice(0, 10);
    const boards = await loadBoards();
    for (const service of client.services.filter((s) => !only || only.includes(s))) {
      const board = boards[service];
      if (!board || !(board.monthlyTasks || board.projectTasks)) continue;
      if (await prisma.clientTask.findFirst({ where: { clientId, service }, select: { id: true } })) continue;
      const stage = board.stages[0], status = boardStageStatus(board, stage);
      const who = await ownerFor(service, client.accountManager);
      const base = { clientId, service, stage, status, platforms: [] as string[], assignedTo: who.name, assigneeUserId: who.userId, createdByUserId: actorUserId ?? null };
      const toDate = (d: string) => new Date(`${d}T00:00:00.000Z`);
      if (board.monthlyTasks) {
        const list = cycleTasks(board, false), dates = await scheduleTasks(list.map((r) => r.days), today);
        await prisma.clientTask.createMany({ data: list.map((r, i) => ({ ...base, title: r.name, taskType: r.type, startAt: toDate(dates[i].start), dueAt: toDate(dates[i].due), maxDays: r.days, cycle: today.slice(0, 7), retained: false })) });
      } else {
        const type = Object.keys(board.projectTasks!)[0], list = board.projectTasks![type], dates = await scheduleTasks(list.map((r) => r.days), today);
        const projectId = randomUUID();
        await prisma.clientTask.createMany({ data: list.map((r, i) => ({ ...base, title: r.name, taskType: type, startAt: toDate(dates[i].start), dueAt: toDate(dates[i].due), maxDays: r.days, projectId, projectName: type, projectKind: type })) });
      }
    }
  } catch (err) {
    console.error("Auto-start of client services failed", err);
  }
}
