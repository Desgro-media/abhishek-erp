import { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { DEPARTMENTS, SERVICE_DEPARTMENTS, isLeadership, headedDepartments } from "../../services/departmentAccess";

const isDept = (d: string) => (DEPARTMENTS as readonly string[]).includes(d);
const monthRe = /^\d{4}-\d{2}$/;
const monthEnd = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)); };
const monthStart = (m: string) => new Date(`${m}-01T00:00:00Z`);
const prevMonth = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7); };
const num = (x: unknown) => Number(x);

// Who heads each department — readable by anyone signed in (it only names the head; the sidebar and "is this
// me?" checks need it). Departments without a head map to null.
export const listHeads: RequestHandler = asyncHandler(async (_req, res) => {
  const rows = await prisma.departmentHead.findMany({ include: { employee: { select: { name: true } } } });
  const heads: Record<string, string | null> = Object.fromEntries(DEPARTMENTS.map((d) => [d, null]));
  // Date (IST) the current head was assigned — action-plan tracking for a department starts then, so a newly named head
  // isn't marked down for days before they had the job.
  const since: Record<string, string | null> = Object.fromEntries(DEPARTMENTS.map((d) => [d, null]));
  rows.forEach((r) => { heads[r.dept] = r.employee?.name ?? null; since[r.dept] = r.employee ? new Date(r.updatedAt.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) : null; });
  res.json({ heads, since });
});

// Leadership/Admin only: set (or clear, with employeeId null) a department's head.
export const setHead: RequestHandler = asyncHandler(async (req, res) => {
  if (!(await isLeadership(req.user!))) return res.status(403).json({ error: "Forbidden — leadership only" });
  const dept = req.params.dept;
  if (!isDept(dept)) return res.status(404).json({ error: "Unknown department" });
  const parsed = z.object({ employeeId: z.string().uuid().nullable() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request" });
  const { employeeId } = parsed.data;
  if (employeeId) {
    const e = await prisma.employee.findUnique({ where: { id: employeeId }, select: { employmentStatus: true } });
    if (!e) return res.status(404).json({ error: "Employee not found" });
    if (e.employmentStatus === "LEFT") return res.status(409).json({ error: "That person has left the company" });
  }
  const before = await prisma.departmentHead.findUnique({ where: { dept } });
  await prisma.departmentHead.upsert({
    where: { dept },
    create: { dept, employeeId, updatedBy: req.user!.name },
    update: { employeeId, updatedBy: req.user!.name },
  });
  await recordAudit({ userId: req.user!.sub, action: "DEPT_HEAD_SET", entityType: "Department", entityId: dept, beforeData: { employeeId: before?.employeeId ?? null }, afterData: { employeeId }, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.json({ ok: true });
});

// A client counts toward a department in a month when it takes that service, was onboarded by month end, and is
// live (Active, not archived). History for paused/churned clients isn't kept, so a past month shows who is live now.
async function clientsFor(dept: string, month: string) {
  return prisma.client.findMany({
    where: { services: { has: dept }, onboardedAt: { lte: monthEnd(month) }, status: "ACTIVE", archivedAt: null },
    select: { id: true, name: true, accountManager: true },
    orderBy: { name: "asc" },
  });
}
async function teamFor(dept: string, month: string) {
  return prisma.employee.findMany({
    where: { dept, joinedAt: { lte: monthEnd(month) }, NOT: { employmentStatus: "LEFT", leavingDate: { lt: monthStart(month) } } },
    select: { id: true, employeeCode: true, name: true, role: true, employmentStatus: true },
    orderBy: { name: "asc" },
  });
}
// Billed (issued that month), collected (payments received that month) and still outstanding for the
// department's share of every invoice — each invoice is split across its department-tagged line items.
async function revenueFor(dept: string, month: string) {
  const invoices = await prisma.invoice.findMany({ where: { items: { some: { dept } } }, include: { items: true, payments: true } });
  let billed = 0, collected = 0, outstanding = 0;
  for (const inv of invoices) {
    const total = inv.items.reduce((s, it) => s + num(it.amount), 0);
    if (total <= 0) continue;
    const share = inv.items.filter((it) => it.dept === dept).reduce((s, it) => s + num(it.amount), 0);
    if (!share) continue;
    const frac = share / total;
    if (inv.issuedAt.toISOString().slice(0, 7) === month) billed += share;
    inv.payments.filter((p) => p.paidDate.toISOString().slice(0, 7) === month).forEach((p) => { collected += num(p.amount) * frac; });
    const paid = inv.payments.reduce((s, p) => s + num(p.amount), 0);
    outstanding += Math.max(0, total - paid) * frac;
  }
  return { billed: Math.round(billed), collected: Math.round(collected), outstanding: Math.round(outstanding) };
}

// One department's page data. Visible to leadership and that department's head; the money figures also to
// Sales and Finance (as in the prototype), never to a plain head of another department.
export const departmentSummary: RequestHandler = asyncHandler(async (req, res) => {
  const dept = req.params.dept;
  if (!isDept(dept)) return res.status(404).json({ error: "Unknown department" });
  const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
  if (!monthRe.test(month)) return res.status(400).json({ error: "month must be YYYY-MM" });

  const leader = await isLeadership(req.user!);
  const headed = await headedDepartments(req.user!);
  if (!leader && !headed.includes(dept)) return res.status(403).json({ error: "Forbidden — not your department" });
  const roles = req.user!.roles ?? [];
  const money = leader || headed.includes(dept) || roles.includes("SALES") || roles.includes("SALES_HEAD") || roles.includes("FINANCE");

  const svc = SERVICE_DEPARTMENTS.includes(dept);
  const prev = prevMonth(month);
  const [headRow, team, prevTeam, clients, prevClients, tasks, rev, prevRev] = await Promise.all([
    prisma.departmentHead.findUnique({ where: { dept }, include: { employee: { select: { name: true } } } }),
    teamFor(dept, month), teamFor(dept, prev),
    svc ? clientsFor(dept, month) : Promise.resolve([]),
    svc ? clientsFor(dept, prev) : Promise.resolve([]),
    prisma.clientTask.findMany({ where: { status: { not: "DONE" }, assignedTo: { in: (await teamFor(dept, month)).map((e) => e.name) } }, select: { clientId: true, assignedTo: true, dueAt: true } }),
    svc && money ? revenueFor(dept, month) : Promise.resolve(null),
    svc && money ? revenueFor(dept, prev) : Promise.resolve(null),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const byPerson = (name: string) => tasks.filter((t) => t.assignedTo === name);
  const openFor = (clientId: string) => tasks.filter((t) => t.clientId === clientId).length;
  res.json({
    dept, month, head: headRow?.employee?.name ?? null, service: svc, canSeeMoney: money,
    team: team.map((e) => {
      const t = byPerson(e.name);
      return { id: e.employeeCode, name: e.name, role: e.role, openTasks: t.length, overdue: t.filter((x) => x.dueAt.toISOString().slice(0, 10) < today).length, clients: new Set(t.map((x) => x.clientId)).size };
    }),
    clients: clients.map((c) => ({ id: c.id, name: c.name, accountManager: c.accountManager ?? "", openTasks: openFor(c.id) })),
    insights: {
      now: { clients: clients.length, team: team.length, ...(rev ? { paid: rev.collected } : {}) },
      prev: { clients: prevClients.length, team: prevTeam.length, ...(prevRev ? { paid: prevRev.collected } : {}) },
    },
    revenue: rev,
  });
});

// Overview tiles: head, headcount and live-client count for every department the caller may open.
export const departmentsOverview: RequestHandler = asyncHandler(async (req, res) => {
  const leader = await isLeadership(req.user!);
  const headed = await headedDepartments(req.user!);
  const visible = DEPARTMENTS.filter((d) => leader || headed.includes(d));
  const month = new Date().toISOString().slice(0, 7);
  const heads = await prisma.departmentHead.findMany({ include: { employee: { select: { name: true } } } });
  const tiles = await Promise.all(visible.map(async (d) => ({
    dept: d, head: heads.find((h) => h.dept === d)?.employee?.name ?? null,
    people: (await teamFor(d, month)).filter((e) => e.employmentStatus !== "LEFT").length,
    clients: SERVICE_DEPARTMENTS.includes(d) ? (await clientsFor(d, month)).length : null,
  })));
  res.json({ tiles });
});
