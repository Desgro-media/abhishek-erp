import { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { isLeadership } from "../../services/departmentAccess";

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), mode: z.enum(["In person", "Video", "Call"]),
  leadId: z.string().uuid().nullish(), withName: z.string().trim().max(200).default(""), notes: z.string().trim().max(1000).default(""),
});
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

// A salesperson logs a meeting with a lead (or a prospect who isn't a lead yet). Dated today or earlier.
export const logSalesMeeting: RequestHandler = asyncHandler(async (req, res) => {
  const roles = req.user!.roles ?? [];
  if (!roles.some((r) => r === "ADMIN" || r === "SALES" || r === "SALES_HEAD")) return res.status(403).json({ error: "Forbidden — Sales only" });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  if (d.date > istToday()) return res.status(400).json({ error: "A meeting can't be dated in the future" });
  if (!d.leadId && !d.withName) return res.status(400).json({ error: "Pick a lead or type who the meeting was with" });
  if (d.leadId && !(await prisma.lead.findUnique({ where: { id: d.leadId }, select: { id: true } }))) return res.status(404).json({ error: "Lead not found" });
  const m = await prisma.salesMeeting.create({ data: { date: new Date(d.date), mode: d.mode, leadId: d.leadId ?? null, withName: d.leadId ? "" : d.withName, notes: d.notes, by: req.user!.name } });
  await recordAudit({ userId: req.user!.sub, action: "SALES_MEETING_LOG", entityType: "SalesMeeting", entityId: m.id, afterData: { date: d.date, leadId: d.leadId ?? null }, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.status(201).json({ meeting: { id: m.id } });
});

// Meetings in a month — leadership and Sales see everyone's (it's the team's leaderboard); `mine=1` narrows to the caller.
export const listSalesMeetings: RequestHandler = asyncHandler(async (req, res) => {
  const roles = req.user!.roles ?? [];
  const month = (req.query.month as string) || istToday().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "month must be YYYY-MM" });
  if (!roles.some((r) => r === "ADMIN" || r === "SALES" || r === "SALES_HEAD") && !(await isLeadership(req.user!))) return res.status(403).json({ error: "Forbidden" });
  const [y, mo] = month.split("-").map(Number);
  const rows = await prisma.salesMeeting.findMany({ where: { date: { gte: new Date(`${month}-01`), lte: new Date(Date.UTC(y, mo, 0)) }, ...(req.query.mine === "1" ? { by: req.user!.name } : {}) }, include: { lead: { select: { name: true } } }, orderBy: { date: "desc" } });
  res.json({ meetings: rows.map((m) => ({ id: m.id, date: m.date.toISOString().slice(0, 10), by: m.by, mode: m.mode, with: m.lead?.name ?? m.withName, leadId: m.leadId, notes: m.notes })) });
});
