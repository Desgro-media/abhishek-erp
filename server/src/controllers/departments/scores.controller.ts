import { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { headedDepartments, isLeadership } from "../../services/departmentAccess";
import { DEFAULT_TARGETS, SERVICE_DEPARTMENTS, deptClientScore, getTargets, metaAdsScore, prevMonthOf, salesScore } from "../../services/scores";

const monthRe = /^\d{4}-\d{2}$/;
const thisMonth = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7);
const pos = z.number().positive().finite();

export const getScoreTargets: RequestHandler = asyncHandler(async (_req, res) => { res.json({ targets: await getTargets() }); });

const targetsSchema = z.object({
  deptRevenue: z.record(z.string(), z.number().min(0).finite()).refine((o) => Object.keys(o).every((k) => SERVICE_DEPARTMENTS.includes(k)), "Unknown department"),
  deptClientGrowth: z.number().min(0).max(100),
  sales: z.object({ revenue: pos, conversion: z.number().min(1).max(100), meetings: pos }),
  meta: z.object({ roas: pos, cpl: pos, conv: pos }),
});
// Leadership only. A partial body keeps the other targets as they are.
export const setScoreTargets: RequestHandler = asyncHandler(async (req, res) => {
  if (!(await isLeadership(req.user!))) return res.status(403).json({ error: "Forbidden — leadership only" });
  const cur = await getTargets();
  const merged = { ...cur, ...(req.body ?? {}), deptRevenue: { ...cur.deptRevenue, ...(req.body?.deptRevenue ?? {}) }, sales: { ...cur.sales, ...(req.body?.sales ?? {}) }, meta: { ...cur.meta, ...(req.body?.meta ?? {}) } };
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
    return { days: rows.length, spend: n("spend"), leads: n("leads"), purchases: n("purchases"), revenue: n("revenue") };
  };
  res.json({ month, now: await metaAdsScore(month, t), prev: await metaAdsScore(prev, t), totals: { now: await totals(month), prev: await totals(prev) }, targets: t.meta });
});
