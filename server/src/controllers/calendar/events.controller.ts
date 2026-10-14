import { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { isHRAdmin } from "../../middleware/hrAccess";
import { headedDepartments, isLeadership } from "../../services/departmentAccess";

const KINDS = ["Meeting", "Company event", "Deadline", "Other"] as const;

const eventSchema = z.object({
  title: z.string().trim().min(1, "Give the event a title").max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
  time: z.string().regex(/^(\d{2}:\d{2})?$/, "Expected HH:MM").default(""),
  kind: z.enum(KINDS).default("Meeting"),
  venue: z.string().trim().max(200).default(""),
  audience: z.array(z.string().trim().min(1)).default(["All"]),
  notes: z.string().trim().max(2000).default(""),
});

// Admin/HR/leadership manage every event; a department head may add events and edit or delete their own.
type Caller = { roles?: string[]; name: string; employeeId: string | null };
const canManageAll = async (u: Caller) => isHRAdmin(u.roles) || (await isLeadership(u));
const canCreate = async (u: Caller) => (await canManageAll(u)) || (await headedDepartments(u)).length > 0;
const normAudience = (a: string[]) => (!a.length || a.includes("All") ? ["All"] : [...new Set(a)]);

const toDto = (e: { id: string; title: string; date: Date; time: string; kind: string; venue: string; audience: string[]; notes: string; createdBy: string }) => ({
  id: e.id, title: e.title, date: e.date.toISOString().slice(0, 10), time: e.time, kind: e.kind,
  venue: e.venue, audience: e.audience, notes: e.notes, createdBy: e.createdBy,
});

// Everyone signed in sees the events meant for them: "All", their own department, or ones they created.
// Admin/HR see everything. Optional ?from=&to= (YYYY-MM-DD) narrows the window.
export const listEvents: RequestHandler = asyncHandler(async (req, res) => {
  const { from, to } = req.query as { from?: string; to?: string };
  const range = from || to ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {};
  const all = await prisma.companyEvent.findMany({ where: range, orderBy: [{ date: "asc" }, { time: "asc" }] });
  const seeAll = await canManageAll(req.user!);
  const dept = req.user?.department ?? null;
  const events = all.filter((e) => seeAll || e.createdBy === req.user!.name || e.audience.includes("All") || (dept !== null && e.audience.includes(dept)));
  res.json({ events: events.map(toDto) });
});

export const createEvent: RequestHandler = asyncHandler(async (req, res) => {
  if (!(await canCreate(req.user!))) return res.status(403).json({ error: "Forbidden — only HR, leadership and department heads can add calendar events" });
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const event = await prisma.companyEvent.create({
    data: { title: d.title, date: new Date(d.date), time: d.time, kind: d.kind, venue: d.venue, audience: normAudience(d.audience), notes: d.notes, createdBy: req.user!.name },
  });
  await recordAudit({ userId: req.user!.sub, action: "CAL_EVENT_CREATE", entityType: "CompanyEvent", entityId: event.id, afterData: d, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.status(201).json({ event: toDto(event) });
});

export const updateEvent: RequestHandler = asyncHandler(async (req, res) => {
  if (!(await canCreate(req.user!))) return res.status(403).json({ error: "Forbidden — only HR, leadership and department heads can edit calendar events" });
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const before = await prisma.companyEvent.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Event not found" });
  if (before.createdBy !== req.user!.name && !(await canManageAll(req.user!))) return res.status(403).json({ error: "Forbidden — you can only edit events you added" });
  const event = await prisma.companyEvent.update({
    where: { id: before.id },
    data: { title: d.title, date: new Date(d.date), time: d.time, kind: d.kind, venue: d.venue, audience: normAudience(d.audience), notes: d.notes },
  });
  await recordAudit({ userId: req.user!.sub, action: "CAL_EVENT_UPDATE", entityType: "CompanyEvent", entityId: event.id, beforeData: toDto(before), afterData: d, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.json({ event: toDto(event) });
});

export const deleteEvent: RequestHandler = asyncHandler(async (req, res) => {
  if (!(await canCreate(req.user!))) return res.status(403).json({ error: "Forbidden — only HR, leadership and department heads can delete calendar events" });
  const before = await prisma.companyEvent.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Event not found" });
  if (before.createdBy !== req.user!.name && !(await canManageAll(req.user!))) return res.status(403).json({ error: "Forbidden — you can only delete events you added" });
  await prisma.companyEvent.delete({ where: { id: before.id } });
  await recordAudit({ userId: req.user!.sub, action: "CAL_EVENT_DELETE", entityType: "CompanyEvent", entityId: before.id, beforeData: toDto(before), ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.status(204).send();
});
