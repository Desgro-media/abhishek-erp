import { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { isLeadership } from "../../services/departmentAccess";

export const SOCIAL_PLATFORMS = ["Instagram", "LinkedIn"];
const DEFAULT_OWNER_NAME = "Safa Ansari";
const monthRe = /^\d{4}-\d{2}$/;
const thisMonth = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7);

// The marketing owner: the employee chosen in settings, else the default person by name (if they exist).
async function getOwner() {
  const row = await prisma.marketingSettings.findUnique({ where: { id: 1 } });
  const e = row?.ownerEmployeeId
    ? await prisma.employee.findUnique({ where: { id: row.ownerEmployeeId }, select: { id: true, name: true, employeeCode: true } })
    : await prisma.employee.findFirst({ where: { name: DEFAULT_OWNER_NAME, NOT: { employmentStatus: "LEFT" } }, select: { id: true, name: true, employeeCode: true } });
  return e ? { id: e.id, name: e.name, code: e.employeeCode } : null;
}
const isOwner = (u: { employeeId: string | null }, owner: { id: string } | null) => !!owner && !!u.employeeId && u.employeeId === owner.id;

// Who can see the numbers: Admin / Content (the Marketing module), leadership, and the owner.
export const getSocial: RequestHandler = asyncHandler(async (req, res) => {
  const u = req.user!, roles = u.roles ?? [];
  const owner = await getOwner();
  const leader = await isLeadership(u);
  if (!leader && !roles.includes("ADMIN") && !roles.includes("CONTENT") && !isOwner(u, owner)) return res.status(403).json({ error: "Forbidden" });
  const [stats, notes] = await Promise.all([prisma.socialStat.findMany({ orderBy: [{ month: "asc" }, { platform: "asc" }] }), prisma.socialNote.findMany()]);
  res.json({
    owner, canUpdate: leader || isOwner(u, owner), platforms: SOCIAL_PLATFORMS,
    stats: stats.map((s) => ({ month: s.month, platform: s.platform, followers: s.followers, reach: s.reach, impressions: s.impressions, engagements: s.engagements, profileVisits: s.profileVisits, linkClicks: s.linkClicks, updatedBy: s.updatedBy, updatedOn: s.updatedAt.toISOString().slice(0, 10) })),
    notes: Object.fromEntries(notes.map((n) => [n.month, { text: n.text, by: n.updatedBy, on: n.updatedAt.toISOString().slice(0, 10) }])),
  });
});

// The owner has a lightweight read of their own pending state, so My Workspace can nudge them without Marketing access.
export const socialStatus: RequestHandler = asyncHandler(async (req, res) => {
  const owner = await getOwner();
  const month = thisMonth();
  const done = (await prisma.socialStat.count({ where: { month } })) > 0;
  res.json({ month, isOwner: isOwner(req.user!, owner), pending: !done });
});

const n = z.number().int().min(0).max(1_000_000_000);
const bodySchema = z.object({
  stats: z.array(z.object({
    platform: z.string().refine((p) => SOCIAL_PLATFORMS.includes(p), "Unknown platform"),
    followers: n, reach: n.default(0), engagements: n.default(0),
    impressions: n.nullable().optional(), profileVisits: n.nullable().optional(), linkClicks: n.nullable().optional(),
  })).min(1),
  note: z.string().trim().max(2000).optional(),
});

export const saveSocial: RequestHandler = asyncHandler(async (req, res) => {
  const u = req.user!, month = req.params.month;
  if (!monthRe.test(month)) return res.status(400).json({ error: "month must be YYYY-MM" });
  if (month > thisMonth()) return res.status(400).json({ error: "Insights open once the month starts" });
  const owner = await getOwner();
  if (!(await isLeadership(u)) && !isOwner(u, owner)) return res.status(403).json({ error: "Forbidden — the marketing owner or leadership only" });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid numbers", details: parsed.error.flatten().fieldErrors });
  const { stats, note } = parsed.data;
  await prisma.$transaction(async (tx) => {
    for (const s of stats) {
      const data = { followers: s.followers, reach: s.reach, engagements: s.engagements, impressions: s.impressions ?? null, profileVisits: s.profileVisits ?? null, linkClicks: s.linkClicks ?? null, updatedBy: u.name };
      await tx.socialStat.upsert({ where: { month_platform: { month, platform: s.platform } }, create: { month, platform: s.platform, ...data }, update: data });
    }
    if (note) await tx.socialNote.upsert({ where: { month }, create: { month, text: note, updatedBy: u.name }, update: { text: note, updatedBy: u.name } });
    else await tx.socialNote.deleteMany({ where: { month } });
  });
  await recordAudit({ userId: u.sub, action: "SOCIAL_STATS_SET", entityType: "SocialStat", entityId: month, beforeData: null, afterData: parsed.data, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.json({ ok: true });
});

export const setSocialOwner: RequestHandler = asyncHandler(async (req, res) => {
  const u = req.user!;
  if (!(await isLeadership(u))) return res.status(403).json({ error: "Forbidden — leadership only" });
  const parsed = z.object({ employeeId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "employeeId required" });
  const e = await prisma.employee.findUnique({ where: { id: parsed.data.employeeId }, select: { id: true, name: true, employmentStatus: true } });
  if (!e || e.employmentStatus === "LEFT") return res.status(400).json({ error: "Pick a current employee" });
  const before = await getOwner();
  await prisma.marketingSettings.upsert({ where: { id: 1 }, create: { id: 1, ownerEmployeeId: e.id, updatedBy: u.name }, update: { ownerEmployeeId: e.id, updatedBy: u.name } });
  await recordAudit({ userId: u.sub, action: "MARKETING_OWNER_SET", entityType: "MarketingSettings", entityId: "1", beforeData: before, afterData: { id: e.id, name: e.name }, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.json({ owner: { id: e.id, name: e.name } });
});
