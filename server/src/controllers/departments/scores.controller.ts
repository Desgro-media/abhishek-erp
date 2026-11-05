import { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { headedDepartments, isLeadership } from "../../services/departmentAccess";
import { DEFAULT_TARGETS, SERVICE_DEPARTMENTS, deptClientScore, getTargets, metaAdsScore, prevMonthOf, salesMonthStats, salesPeopleMonth, salesScore } from "../../services/scores";

const monthRe = /^\d{4}-\d{2}$/;
const thisMonth = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7);
const pos = z.number().positive().finite();

export const getScoreTargets: RequestHandler = asyncHandler(async (_req, res) => { res.json({ targets: await getTargets() }); });

const targetsSchema = z.object({
  deptRevenue: z.record(z.string(), z.number().min(0).finite()).refine((o) => Object.keys(o).every((k) => SERVICE_DEPARTMENTS.includes(k)), "Unknown department"),
  deptClientGrowth: z.number().min(0).max(100),
  sales: z.object({ revenue: pos, conversion: z.number().min(1).max(100), meetings: pos }),
  meta: z.object({ roas: pos, cpl: pos, conv: pos }),
  marketing: z.object({
    followerGrowth: z.number().min(0.1).max(100),
    engagement: z.number().min(0.1).max(100),
    months: z.record(z.string().regex(monthRe), z.object({ content: z.number().int().min(1).max(10000).optional(), followerGrowth: z.number().min(0.1).max(100).optional(), engagement: z.number().min(0.1).max(100).optional() })),
  }),
});
// Leadership only. A partial body keeps the other targets as they are.
export const setScoreTargets: RequestHandler = asyncHandler(async (req, res) => {
  // Leadership can change every target; the Marketing (Content) team can change the Marketing Score targets only.
  if (!(await isLeadership(req.user!))) {
    const marketingOnly = Object.keys(req.body ?? {}).every((k) => k === "marketing");
    if (!(req.user!.roles ?? []).includes("CONTENT") || !marketingOnly) return res.status(403).json({ error: "Forbidden — leadership only" });
  }
  const cur = await getTargets();
  // Marketing month overrides merge per month; a month sent as null (or with every field blank) goes back to the defaults.
  const mkt = { ...cur.marketing, ...(req.body?.marketing ?? {}), months: { ...cur.marketing.months } };
  for (const [m, v] of Object.entries((req.body?.marketing?.months ?? {}) as Record<string, Record<string, unknown> | null>)) {
    const clean = Object.fromEntries(Object.entries(v ?? {}).filter(([, x]) => x != null && x !== ""));
    if (Object.keys(clean).length) mkt.months[m] = clean; else delete mkt.months[m];
  }
  const merged = { ...cur, ...(req.body ?? {}), deptRevenue: { ...cur.deptRevenue, ...(req.body?.deptRevenue ?? {}) }, sales: { ...cur.sales, ...(req.body?.sales ?? {}) }, meta: { ...cur.meta, ...(req.body?.meta ?? {}) }, marketing: mkt };
  const parsed = targetsSchema.safeParse(merged);
  if (!parsed.success) return res.status(400).json({ error: "Invalid targets", details: parsed.error.flatten().fieldErrors });
  await prisma.scoreSettings.upsert({ where: { id: 1 }, create: { id: 1, targets: parsed.data, updatedBy: req.user!.name }, update: { targets: parsed.data, updatedBy: req.user!.name } });
  await recordAudit({ userId: req.user!.sub, action: "SCORE_TARGETS_SET", entityType: "ScoreSettings", entityId: "1", beforeData: cur, afterData: parsed.data, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.json({ targets: parsed.data });
});

// Scores for the departments the caller may see — leadership every service department plus Sales, a head their own —
// for the month and the one before it (for the "vs last month" deltas).
export const departmentScores: RequestHandler = asyncHandler(async (req, res) => {
  const month = (req.query.month as string) || thisMonth();
  if (!monthRe.test(month)) return res.status(400).json({ error: "month must be YYYY-MM" });
  const leader = await isLeadership(req.user!);
  const headed = await headedDepartments(req.user!);
  const wanted = [...SERVICE_DEPARTMENTS, "Sales"].filter((d) => leader || headed.includes(d));
  const t = await getTargets(), prev = prevMonthOf(month);
  const scores: Record<string, { now: unknown; prev: unknown }> = {};
  await Promise.all(wanted.map(async (d) => {
    scores[d] = d === "Sales" ? { now: await salesScore(month, t), prev: await salesScore(prev, t) } : { now: await deptClientScore(d, month, t), prev: await deptClientScore(d, prev, t) };
  }));
  res.json({ month, scores, targets: leader || headed.length ? t : DEFAULT_TARGETS });
});

// Our own Meta Ads score — leadership/Admin and the Content team (who run those ads).
export const metaScore: RequestHandler = asyncHandler(async (req, res) => {
  const roles = req.user!.roles ?? [];
  if (!roles.includes("ADMIN") && !roles.includes("CONTENT") && !(await isLeadership(req.user!))) return res.status(403).json({ error: "Forbidden" });
  const month = (req.query.month as string) || thisMonth();
  if (!monthRe.test(month)) return res.status(400).json({ error: "month must be YYYY-MM" });
  const t = await getTargets(), prev = prevMonthOf(month);
  const totals = async (m: string) => {
    const [y, mo] = m.split("-").map(Number);
    const rows = await prisma.ownAdMetric.findMany({ where: { date: { gte: new Date(`${m}-01T00:00:00Z`), lte: new Date(Date.UTC(y, mo, 0)) } } });
    const n = (k: "spend" | "leads" | "purchases" | "revenue") => rows.reduce((s, r) => s + Number(r[k]), 0);
    return { days: new Set(rows.map((r) => r.date.toISOString())).size, spend: n("spend"), leads: n("leads"), purchases: n("purchases"), revenue: n("revenue") };
  };
  res.json({ month, now: await metaAdsScore(month, t), prev: await metaAdsScore(prev, t), totals: { now: await totals(month), prev: await totals(prev) }, targets: t.meta });
});

// The Sales overview: the sales score and its month-on-month figures, plus each salesperson's month. For leadership and
// everyone with Sales access (a rep sees the same team table as the head, as the prototype shows).
export const salesOverview: RequestHandler = asyncHandler(async (req, res) => {
  const roles = req.user!.roles ?? [];
  if (!roles.some((r) => ["ADMIN", "SALES", "SALES_HEAD"].includes(r)) && !(await isLeadership(req.user!))) return res.status(403).json({ error: "Forbidden" });
  const month = (req.query.month as string) || thisMonth();
  if (!monthRe.test(month)) return res.status(400).json({ error: "month must be YYYY-MM" });
  const t = await getTargets(), prev = prevMonthOf(month);
  const [now, was, statsNow, statsPrev, peopleNow, peoplePrev] = await Promise.all([
    salesScore(month, t), salesScore(prev, t), salesMonthStats(month), salesMonthStats(prev), salesPeopleMonth(month), salesPeopleMonth(prev),
  ]);
  const people = peopleNow.map((p) => ({ name: p.name, now: p, prev: peoplePrev.find((q) => q.name === p.name) ?? p }));
  res.json({ month, now: { ...now, stats: statsNow }, prev: { ...was, stats: statsPrev }, targets: t.sales, people });
});
