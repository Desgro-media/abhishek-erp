import { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { isLeadership, headedDepartments, ledDepartments } from "../../services/departmentAccess";
import { handlersFor, revenueByClient, sumMoney, type Money } from "../../services/clientAssignments";

/* Performance Marketing tracking: every client the team runs ads for (who runs it, budget, spend, leads, cost per lead
   against its target, campaign status, last meeting, days the numbers weren't logged) and a monthly score per person.

   Score (out of 100), from the clients a person runs (Client.pmOwnerId) and the tasks assigned to them:
     30% numbers logged on time — working days whose ad numbers were in by the end of the next day
     30% cost per lead on target — clients with a target and spend this month whose cost per lead is at or under it
     20% client rating        — average Performance Marketing rating from their clients this month (5★ = 100%)
     20% tasks on time         — tasks due this month (up to today) finished by their due date
   A part with nothing to measure is left out and the rest are re-weighted. The head (or leadership) can then add or take
   off up to 10 points with a reason; the final score stays within 0–100.

   Who runs a client: Client.pmOwnerId when the head has set it, otherwise the Performance Marketing member with most of the
   client's tasks (shown as "from tasks"); see services/clientAssignments.

   Money (leadership and the head only): each client's share of invoices — billed and received this month, still outstanding —
   totalled per person for the clients they run. Reviews: this month's Performance Marketing ratings, with who runs the client.

   Who sees what: leadership, the department head and team leads see everyone. Anyone else in the department sees only
   their own clients and their own score (My Workspace → My Score). Only leadership and the head change client settings
   or adjustments, and a head can't adjust their own score. */

export const PM = "Performance Marketing";
export const CAMPAIGN_STATUSES = ["Running", "Learning", "Paused", "Stopped"] as const;
export const WEIGHTS = { logging: 30, cpl: 30, rating: 20, tasks: 20 } as const;
export const ADJUST_LIMIT = 10;

const DAY = 86400_000;
const monthRe = /^\d{4}-\d{2}$/;
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const istYmd = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
const lastDayOf = (m: string) => { const [y, mo] = m.split("-").map(Number); return ymd(new Date(Date.UTC(y, mo, 0))); };
const round2 = (n: number) => Math.round(n * 100) / 100;

type Caller = { sub: string; name: string; roles?: string[]; employeeId: string | null };
async function accessOf(u: Caller) {
  const leader = await isLeadership(u);
  const head = (await headedDepartments(u)).includes(PM);
  const lead = (await ledDepartments(u)).includes(PM);
  let member = false;
  if (u.employeeId) {
    const e = await prisma.employee.findUnique({ where: { id: u.employeeId }, select: { dept: true } });
    member = e?.dept === PM || (await prisma.client.count({ where: { pmOwnerId: u.employeeId } })) > 0;
  }
  return { leader, head, lead, member, seeAll: leader || head || lead, manage: leader || head, money: leader || head };
}

/** Everything the page shows for one month. `onlyEmployeeId` limits it to that person's clients and score. */
export async function pmTracking(month: string, onlyEmployeeId: string | null, opts: { money?: boolean } = {}) {
  const today = istToday();
  const first = `${month}-01`, last = lastDayOf(month);
  const until = [addDays(today, -1), last].sort()[0]; // logging is judged up to yesterday; today is still open
  const policy = await prisma.hrPolicy.findUnique({ where: { id: 1 } });
  const weeklyOff = policy?.weeklyOff ?? 0;
  const holidays = new Set((await prisma.holiday.findMany({ select: { date: true } })).map((h) => ymd(h.date)));
  const workDays: string[] = [];
  for (let d = first; d <= until; d = addDays(d, 1)) if (new Date(`${d}T00:00:00Z`).getUTCDay() !== weeklyOff && !holidays.has(d)) workDays.push(d);

  const all = await prisma.client.findMany({
    where: { services: { has: PM }, status: "ACTIVE", archivedAt: null, onboardedAt: { lte: new Date(`${last}T00:00:00Z`) } },
    select: {
      id: true, name: true, accountManager: true, adCurrency: true, onboardedAt: true, pmOwnerId: true,
      pmOwner: { select: { id: true, name: true } },
      adAccess: { select: { status: true, platform: true } },
      campaignBrief: { select: { budget: true, targetCpl: true, campaignStatus: true } },
      adMetrics: { where: { date: { gte: new Date(`${first}T00:00:00Z`), lte: new Date(`${last}T00:00:00Z`) } }, select: { date: true, spend: true, leads: true, createdAt: true } },
      meetings: { where: { status: "HELD", date: { lte: new Date(`${today}T00:00:00Z`) } }, orderBy: { date: "desc" }, take: 1, select: { date: true } },
      feedback: { where: { dept: PM, month }, select: { rating: true, comment: true, via: true, by: true, date: true } },
    },
    orderBy: { name: "asc" },
  });
  const handlers = await handlersFor(PM, all.map((c) => c.id));
  const clients = onlyEmployeeId ? all.filter((c) => handlers.get(c.id)?.id === onlyEmployeeId) : all;
  const revenue = opts.money ? await revenueByClient(PM, month, clients.map((c) => c.id)) : null;

  const team = await prisma.employee.findMany({
    where: onlyEmployeeId ? { id: onlyEmployeeId } : { OR: [{ dept: PM, employmentStatus: { not: "LEFT" } }, { id: { in: [...handlers.values()].filter((h) => h).map((h) => h!.id) } }] },
    select: { id: true, employeeCode: true, name: true, role: true, dept: true },
    orderBy: { name: "asc" },
  });
  const ids = team.map((e) => e.id);
  const leaves = await prisma.leaveRequest.findMany({
    where: { employeeId: { in: ids }, status: "APPROVED", type: "CASUAL_SICK", duration: "FULL_DAY", fromDate: { lte: new Date(`${last}T00:00:00Z`) }, toDate: { gte: new Date(`${first}T00:00:00Z`) } },
    select: { employeeId: true, fromDate: true, toDate: true },
  });
  const onLeave = (empId: string | null, d: string) => !!empId && leaves.some((l) => l.employeeId === empId && ymd(l.fromDate) <= d && d <= ymd(l.toDate));
  const adjustments = await prisma.pmScoreAdjustment.findMany({ where: { employeeId: { in: ids }, month } });
  const tasks = await prisma.clientTask.findMany({
    where: { assignedTo: { in: team.map((e) => e.name) }, dueAt: { gte: new Date(`${first}T00:00:00Z`), lte: new Date(`${last}T00:00:00Z`) } },
    select: { assignedTo: true, dueAt: true, doneAt: true, status: true },
  });

  const rows = clients.map((c) => {
    const spend = c.adMetrics.reduce((s, m) => s + Number(m.spend), 0);
    const leads = c.adMetrics.reduce((s, m) => s + m.leads, 0);
    const target = c.campaignBrief?.targetCpl != null ? Number(c.campaignBrief.targetCpl) : null;
    const cpl = leads ? spend / leads : null;
    // On target: has a target and spent something, and cost per lead is at or under it (spend with no leads misses).
    const cplOk = target != null && spend > 0 ? cpl != null && cpl <= target : null;
    const tracked = c.adAccess?.status === "GRANTED";
    const onboarded = ymd(c.onboardedAt);
    const logged = new Map(c.adMetrics.map((m) => [ymd(m.date), m.createdAt]));
    const h = handlers.get(c.id) ?? null;
    const due = tracked ? workDays.filter((d) => d >= onboarded && !onLeave(h?.id ?? null, d)) : [];
    const missing = due.filter((d) => !logged.has(d));
    // In by the end of the next day (IST): logged on the day itself or the morning after counts as on time.
    const onTime = due.filter((d) => { const at = logged.get(d); return at && istYmd(at) <= addDays(d, 1); });
    const rating = c.feedback.length ? round2(c.feedback.reduce((s, f) => s + f.rating, 0) / c.feedback.length) : null;
    return {
      id: c.id, name: c.name, currency: c.adCurrency, accountManager: c.accountManager ?? "",
      owner: h ? { id: h.id, name: h.name, auto: h.auto, from: h.from ?? null } : null,
      revenue: revenue ? revenue.get(c.id) ?? { billed: 0, collected: 0, outstanding: 0 } : null,
      platform: c.adAccess?.platform ?? null, access: c.adAccess?.status ?? null,
      budget: c.campaignBrief?.budget ?? null, targetCpl: target, campaignStatus: c.campaignBrief?.campaignStatus ?? null,
      spend: round2(spend), leads, cpl: cpl == null ? null : round2(cpl), cplOk,
      lastMeeting: c.meetings[0] ? ymd(c.meetings[0].date) : null,
      daysDue: due.length, daysOnTime: onTime.length, missingDays: missing, rating,
    };
  });

  const scorecard = team.map((e) => {
    const mine = rows.filter((r) => r.owner?.id === e.id);
    const due = mine.reduce((s, r) => s + r.daysDue, 0), onTime = mine.reduce((s, r) => s + r.daysOnTime, 0);
    const withTarget = mine.filter((r) => r.cplOk != null), hit = withTarget.filter((r) => r.cplOk).length;
    const ratings = mine.filter((r) => r.rating != null).map((r) => r.rating as number);
    const myTasks = tasks.filter((t) => t.assignedTo === e.name && (t.doneAt || ymd(t.dueAt) < today));
    const tasksOnTime = myTasks.filter((t) => t.doneAt && istYmd(t.doneAt) <= ymd(t.dueAt)).length;
    const parts = {
      logging: due ? { value: onTime / due, detail: `${onTime} of ${due} days` } : null,
      cpl: withTarget.length ? { value: hit / withTarget.length, detail: `${hit} of ${withTarget.length} clients` } : null,
      rating: ratings.length ? { value: ratings.reduce((s, x) => s + x, 0) / ratings.length / 5, detail: `${round2(ratings.reduce((s, x) => s + x, 0) / ratings.length)} ★ from ${ratings.length}` } : null,
      tasks: myTasks.length ? { value: tasksOnTime / myTasks.length, detail: `${tasksOnTime} of ${myTasks.length} tasks` } : null,
    };
    let wsum = 0, vsum = 0;
    (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).forEach((k) => { const p = parts[k]; if (p) { wsum += WEIGHTS[k]; vsum += WEIGHTS[k] * p.value; } });
    const auto = wsum ? Math.round((100 * vsum) / wsum) : null;
    const adj = adjustments.find((a) => a.employeeId === e.id) ?? null;
    const score = auto == null ? null : Math.max(0, Math.min(100, auto + (adj?.points ?? 0)));
    return {
      employeeId: e.id, id: e.employeeCode, name: e.name, role: e.role, clients: mine.length,
      parts: Object.fromEntries(Object.entries(parts).map(([k, p]) => [k, p ? { pct: Math.round(p.value * 100), detail: p.detail } : null])),
      revenue: revenue ? sumMoney(mine.map((r) => r.revenue as Money)) : null,
      rating: ratings.length ? round2(ratings.reduce((s, x) => s + x, 0) / ratings.length) : null,
      auto, adjustment: adj ? { points: adj.points, reason: adj.reason, by: adj.updatedBy, at: ymd(adj.updatedAt) } : null, score,
    };
  });

  const reviews = clients.flatMap((c) => c.feedback.map((f) => ({ clientId: c.id, client: c.name, handledBy: handlers.get(c.id)?.name ?? null, rating: f.rating, comment: f.comment, via: f.via, by: f.by, date: ymd(f.date) })))
    .sort((a, b) => b.date.localeCompare(a.date));
  const totals = {
    revenue: revenue ? sumMoney(rows.map((r) => r.revenue as Money)) : null,
    spend: round2(rows.reduce((s, r) => s + r.spend, 0)), leads: rows.reduce((s, r) => s + r.leads, 0),
    rating: reviews.length ? round2(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) : null, reviews: reviews.length,
  };
  return { month, workingDays: workDays.length, judgedUntil: until, clients: rows, scorecard, reviews, totals };
}

// GET /api/departments/pm/tracking?month=YYYY-MM[&mine=1]
export const getPmTracking: RequestHandler = asyncHandler(async (req, res) => {
  const month = (req.query.month as string) || istToday().slice(0, 7);
  if (!monthRe.test(month)) return res.status(400).json({ error: "month must be YYYY-MM" });
  const a = await accessOf(req.user!);
  const mineOnly = !a.seeAll || req.query.mine === "1";
  if (!a.seeAll && !a.member) return res.status(403).json({ error: "Forbidden — Performance Marketing only" });
  if (mineOnly && !req.user!.employeeId) return res.status(403).json({ error: "Your login isn't linked to an employee" });
  const data = await pmTracking(month, mineOnly ? req.user!.employeeId : null, { money: a.money && !mineOnly });
  const team = mineOnly ? [] : await prisma.employee.findMany({ where: { dept: PM, employmentStatus: { not: "LEFT" } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  res.json({ ...data, mine: mineOnly, canManage: a.manage && !mineOnly, canSeeMoney: a.money && !mineOnly, me: req.user!.employeeId, team, statuses: CAMPAIGN_STATUSES, weights: WEIGHTS, adjustLimit: ADJUST_LIMIT });
});

const clientBody = z.object({
  ownerId: z.string().uuid().nullable().optional(),
  targetCpl: z.number().positive().max(1e9).nullable().optional(),
  campaignStatus: z.enum(CAMPAIGN_STATUSES).nullable().optional(),
});
// PUT /api/departments/pm/clients/:clientId — who runs the client's ads, target cost per lead, campaign status.
export const setPmClient: RequestHandler = asyncHandler(async (req, res) => {
  const a = await accessOf(req.user!);
  if (!a.manage) return res.status(403).json({ error: "Only the Performance Marketing head or leadership can change this" });
  const parsed = clientBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request" });
  const b = parsed.data;
  const client = await prisma.client.findUnique({ where: { id: req.params.clientId }, select: { id: true, services: true, pmOwnerId: true, campaignBrief: { select: { targetCpl: true, campaignStatus: true } } } });
  if (!client || !client.services.includes(PM)) return res.status(404).json({ error: "Not a Performance Marketing client" });
  if (b.ownerId) {
    const e = await prisma.employee.findUnique({ where: { id: b.ownerId }, select: { employmentStatus: true } });
    if (!e || e.employmentStatus === "LEFT") return res.status(409).json({ error: "That person wasn't found or has left the company" });
  }
  const before = { ownerId: client.pmOwnerId, targetCpl: client.campaignBrief?.targetCpl != null ? Number(client.campaignBrief.targetCpl) : null, campaignStatus: client.campaignBrief?.campaignStatus ?? null };
  const brief: { targetCpl?: number | null; campaignStatus?: string | null } = {};
  if (b.targetCpl !== undefined) brief.targetCpl = b.targetCpl;
  if (b.campaignStatus !== undefined) brief.campaignStatus = b.campaignStatus;
  await prisma.$transaction([
    ...(b.ownerId !== undefined ? [prisma.client.update({ where: { id: client.id }, data: { pmOwnerId: b.ownerId } })] : []),
    ...(Object.keys(brief).length ? [prisma.clientCampaignBrief.upsert({ where: { clientId: client.id }, create: { clientId: client.id, updatedBy: req.user!.name, ...brief }, update: { ...brief, updatedBy: req.user!.name } })] : []),
  ]);
  await recordAudit({ userId: req.user!.sub, action: "PM_CLIENT_SET", entityType: "Client", entityId: client.id, beforeData: before, afterData: b, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.json({ ok: true });
});

const adjBody = z.object({ month: z.string().regex(monthRe), points: z.number().int().min(-ADJUST_LIMIT).max(ADJUST_LIMIT), reason: z.string().trim().max(500) });
// PUT /api/departments/pm/adjustments/:employeeId — set (points 0 with no reason clears) the head's adjustment.
export const setPmAdjustment: RequestHandler = asyncHandler(async (req, res) => {
  const a = await accessOf(req.user!);
  if (!a.manage) return res.status(403).json({ error: "Only the Performance Marketing head or leadership can adjust a score" });
  const parsed = adjBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: `Points must be a whole number from -${ADJUST_LIMIT} to ${ADJUST_LIMIT}` });
  const { month, points, reason } = parsed.data;
  const empId = req.params.employeeId;
  if (empId === req.user!.employeeId && !a.leader) return res.status(403).json({ error: "You can't adjust your own score" });
  const emp = await prisma.employee.findUnique({ where: { id: empId }, select: { id: true } });
  if (!emp) return res.status(404).json({ error: "Employee not found" });
  const before = await prisma.pmScoreAdjustment.findUnique({ where: { employeeId_month: { employeeId: empId, month } } });
  if (points === 0) {
    if (before) await prisma.pmScoreAdjustment.delete({ where: { id: before.id } });
  } else {
    if (!reason) return res.status(400).json({ error: "Write a reason for the adjustment" });
    await prisma.pmScoreAdjustment.upsert({ where: { employeeId_month: { employeeId: empId, month } }, create: { employeeId: empId, month, points, reason, updatedBy: req.user!.name }, update: { points, reason, updatedBy: req.user!.name } });
  }
  await recordAudit({ userId: req.user!.sub, action: "PM_SCORE_ADJUST", entityType: "Employee", entityId: empId, beforeData: before ? { month, points: before.points, reason: before.reason } : { month, points: 0 }, afterData: { month, points, reason }, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.json({ ok: true });
});

// GET /api/departments/pm/overview?month=YYYY-MM — the six months up to `month`, one row each: clients, revenue (leadership and
// the head only), ad spend and leads, client rating, and the team's average score. Same access as the full tracking page.
export const getPmOverview: RequestHandler = asyncHandler(async (req, res) => {
  const month = (req.query.month as string) || istToday().slice(0, 7);
  if (!monthRe.test(month)) return res.status(400).json({ error: "month must be YYYY-MM" });
  const a = await accessOf(req.user!);
  if (!a.seeAll) return res.status(403).json({ error: "Forbidden — Performance Marketing head, team leads or leadership" });
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) { const [y, m] = month.split("-").map(Number); months.push(new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7)); }
  const out = [];
  for (const m of months) {
    const t = await pmTracking(m, null, { money: a.money });
    const scored = t.scorecard.filter((s) => s.score != null);
    out.push({
      month: m, clients: t.clients.length, revenue: t.totals.revenue, spend: t.totals.spend, leads: t.totals.leads,
      rating: t.totals.rating, reviews: t.totals.reviews,
      teamScore: scored.length ? Math.round(scored.reduce((s, x) => s + (x.score as number), 0) / scored.length) : null,
      people: t.scorecard.map((s) => ({ employeeId: s.employeeId, name: s.name, score: s.score, clients: s.clients, collected: s.revenue?.collected ?? null })),
    });
  }
  res.json({ months: out, canSeeMoney: a.money });
});
