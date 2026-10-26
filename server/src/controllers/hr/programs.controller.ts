import { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { isHRAdmin } from "../../middleware/hrAccess";
import { isLeadership } from "../../services/departmentAccess";

const TYPES = ["Team Building", "Upskilling", "Training"] as const;
const STATUSES = ["Planned", "Confirmed", "Completed", "Cancelled"] as const;
const MODES = ["In office", "Offsite", "Online"] as const;
export const FEEDBACK_WINDOW_DAYS = 14;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const addDays = (ds: string, n: number) => { const d = new Date(`${ds}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const d10 = (d: Date) => d.toISOString().slice(0, 10);
const num = (x: unknown) => Number(x);

type Caller = { roles?: string[]; name: string; employeeId: string | null };
const canManage = async (u: Caller) => isHRAdmin(u.roles) || (await isLeadership(u));
const normAudience = (a: string[]) => (!a.length || a.includes("All") ? ["All"] : [...new Set(a)]);
const invitedTo = (audience: string[], dept: string | null) => audience.includes("All") || (dept !== null && audience.includes(dept));

const programSchema = z.object({
  title: z.string().trim().min(1, "Give the program a title").max(200),
  type: z.enum(TYPES), status: z.enum(STATUSES).default("Planned"),
  date: dateStr, time: z.string().regex(/^(\d{2}:\d{2})?$/).default(""), duration: z.string().trim().max(60).default(""),
  mode: z.enum(MODES).default("In office"), venue: z.string().trim().max(200).default(""), facilitator: z.string().trim().max(120).default(""),
  audience: z.array(z.string().trim().min(1)).default(["All"]), objective: z.string().trim().max(500).default(""),
  budget: z.number().min(0).default(0),
});
const completeSchema = z.object({ attendeeIds: z.array(z.string().uuid()), spent: z.number().min(0).default(0), outcome: z.string().trim().max(1000).default("") });
const feedbackSchema = z.object({ rating: z.number().int().min(1).max(5), useful: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).default("") });

type Row = Awaited<ReturnType<typeof loadOne>>;
const loadOne = (id: string) => prisma.hrProgram.findUnique({ where: { id }, include: { attendees: { include: { employee: { select: { id: true, name: true } } } }, feedback: { select: { rating: true, useful: true } } } });
const dto = (p: NonNullable<Row>) => ({
  id: p.id, title: p.title, type: p.type, status: p.status, date: d10(p.date), time: p.time, duration: p.duration, mode: p.mode, venue: p.venue,
  facilitator: p.facilitator, audience: p.audience, objective: p.objective, budget: num(p.budget), spent: num(p.spent), outcome: p.outcome,
  attendees: p.attendees.map((a) => ({ id: a.employee.id, name: a.employee.name })),
  responses: p.feedback.length,
  rating: p.feedback.length ? Math.round((p.feedback.reduce((s, f) => s + f.rating, 0) / p.feedback.length) * 100) / 100 : null,
});
const callerDept = async (u: Caller) => (u.employeeId ? (await prisma.employee.findUnique({ where: { id: u.employeeId }, select: { dept: true } }))?.dept ?? null : null);

// HR/leadership: every program in a window (default six months back to six ahead), with who attended and how it was rated.
export const listPrograms: RequestHandler = asyncHandler(async (req, res) => {
  if (!(await canManage(req.user!))) return res.status(403).json({ error: "Forbidden — HR/leadership only" });
  const today = istToday();
  const from = (req.query.from as string) || addDays(today, -183), to = (req.query.to as string) || addDays(today, 183);
  const rows = await prisma.hrProgram.findMany({ where: { date: { gte: new Date(from), lte: new Date(to) } }, include: { attendees: { include: { employee: { select: { id: true, name: true } } } }, feedback: { select: { rating: true, useful: true } } }, orderBy: [{ date: "asc" }, { time: "asc" }] });
  res.json({ programs: rows.map(dto) });
});

// The signed-in person: programs they're invited to from today, and completed ones they attended but haven't rated.
export const myPrograms: RequestHandler = asyncHandler(async (req, res) => {
  const today = istToday(), dept = await callerDept(req.user!);
  const upcoming = (await prisma.hrProgram.findMany({ where: { date: { gte: new Date(today) }, status: { in: ["Planned", "Confirmed"] } }, orderBy: { date: "asc" } }))
    .filter((p) => invitedTo(p.audience, dept))
    .map((p) => ({ id: p.id, title: p.title, type: p.type, date: d10(p.date), time: p.time, mode: p.mode, venue: p.venue, facilitator: p.facilitator }));
  const due = req.user!.employeeId
    ? (await prisma.hrProgram.findMany({ where: { status: "Completed", date: { gte: new Date(addDays(today, -FEEDBACK_WINDOW_DAYS)) }, feedback: { none: { employeeId: req.user!.employeeId } } }, include: { attendees: { where: { employeeId: req.user!.employeeId } } }, orderBy: { date: "desc" } }))
        .filter((p) => p.attendees.length || invitedTo(p.audience, dept))   // anyone the program was for can rate it, not only those ticked as attending
    : [];
  res.json({ upcoming, feedbackDue: due.map((p) => ({ id: p.id, title: p.title, type: p.type, date: d10(p.date), type_: p.type, closesOn: addDays(d10(p.date), FEEDBACK_WINDOW_DAYS) })) });
});

// For the calendar: every non-cancelled program in a window the caller is invited to (HR/leadership see all).
export const calendarPrograms: RequestHandler = asyncHandler(async (req, res) => {
  const today = istToday();
  const from = (req.query.from as string) || addDays(today, -60), to = (req.query.to as string) || addDays(today, 200);
  const manage = await canManage(req.user!), dept = await callerDept(req.user!);
  const rows = await prisma.hrProgram.findMany({ where: { date: { gte: new Date(from), lte: new Date(to) }, status: { not: "Cancelled" } }, orderBy: { date: "asc" } });
  res.json({ programs: rows.filter((p) => manage || invitedTo(p.audience, dept)).map((p) => ({ id: p.id, title: p.title, type: p.type, status: p.status, date: d10(p.date), time: p.time, mode: p.mode, venue: p.venue })) });
});

export const createProgram: RequestHandler = asyncHandler(async (req, res) => {
  if (!(await canManage(req.user!))) return res.status(403).json({ error: "Forbidden — HR/leadership only" });
  const parsed = programSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  if (d.status === "Completed") return res.status(400).json({ error: "Close a program out to mark it completed" });
  const p = await prisma.hrProgram.create({ data: { ...d, date: new Date(d.date), audience: normAudience(d.audience), createdBy: req.user!.name } });
  await recordAudit({ userId: req.user!.sub, action: "HR_PROGRAM_CREATE", entityType: "HrProgram", entityId: p.id, afterData: { title: d.title, type: d.type, date: d.date }, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.status(201).json({ program: dto((await loadOne(p.id))!) });
});

export const updateProgram: RequestHandler = asyncHandler(async (req, res) => {
  if (!(await canManage(req.user!))) return res.status(403).json({ error: "Forbidden — HR/leadership only" });
  const parsed = programSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const before = await prisma.hrProgram.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Program not found" });
  const d = parsed.data;
  if (d.status === "Completed" && before.status !== "Completed") return res.status(400).json({ error: "Close a program out to mark it completed" });
  if (before.status === "Completed" && d.status !== "Completed") return res.status(409).json({ error: "A completed program can't be reopened" });
  await prisma.hrProgram.update({ where: { id: before.id }, data: { ...d, date: new Date(d.date), audience: normAudience(d.audience) } });
  await recordAudit({ userId: req.user!.sub, action: "HR_PROGRAM_UPDATE", entityType: "HrProgram", entityId: before.id, afterData: d, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.json({ program: dto((await loadOne(before.id))!) });
});

export const deleteProgram: RequestHandler = asyncHandler(async (req, res) => {
  if (!(await canManage(req.user!))) return res.status(403).json({ error: "Forbidden — HR/leadership only" });
  const before = await prisma.hrProgram.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Program not found" });
  await prisma.hrProgram.delete({ where: { id: before.id } });
  await recordAudit({ userId: req.user!.sub, action: "HR_PROGRAM_DELETE", entityType: "HrProgram", entityId: before.id, beforeData: { title: before.title, date: d10(before.date) }, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.status(204).send();
});

// Close out a program that has happened: who came, what it cost, what came of it. From then on, those attendees can rate it.
export const completeProgram: RequestHandler = asyncHandler(async (req, res) => {
  if (!(await canManage(req.user!))) return res.status(403).json({ error: "Forbidden — HR/leadership only" });
  const parsed = completeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const p = await prisma.hrProgram.findUnique({ where: { id: req.params.id } });
  if (!p) return res.status(404).json({ error: "Program not found" });
  if (p.status === "Cancelled") return res.status(409).json({ error: "A cancelled program can't be closed out" });
  if (d10(p.date) > istToday()) return res.status(409).json({ error: "This program hasn't happened yet" });
  const d = parsed.data;
  const invited = (await prisma.employee.findMany({ where: { NOT: { employmentStatus: "LEFT" } }, select: { id: true, dept: true } })).filter((e) => invitedTo(p.audience, e.dept)).map((e) => e.id);
  if (d.attendeeIds.some((id) => !invited.includes(id))) return res.status(400).json({ error: "Attendees must be people the program was for" });
  await prisma.$transaction([
    prisma.hrProgramAttendee.deleteMany({ where: { programId: p.id } }),
    prisma.hrProgramAttendee.createMany({ data: [...new Set(d.attendeeIds)].map((employeeId) => ({ programId: p.id, employeeId })) }),
    prisma.hrProgram.update({ where: { id: p.id }, data: { status: "Completed", spent: d.spent, outcome: d.outcome } }),
  ]);
  await recordAudit({ userId: req.user!.sub, action: "HR_PROGRAM_COMPLETE", entityType: "HrProgram", entityId: p.id, afterData: { attendees: d.attendeeIds.length, spent: d.spent }, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.json({ program: dto((await loadOne(p.id))!) });
});

// An attendee rates a completed program — once, within FEEDBACK_WINDOW_DAYS. Anonymous to HR.
export const submitFeedback: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = feedbackSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request" });
  const employeeId = req.user!.employeeId;
  if (!employeeId) return res.status(403).json({ error: "Your login isn't linked to an employee record" });
  const p = await prisma.hrProgram.findUnique({ where: { id: req.params.id }, include: { attendees: { where: { employeeId } } } });
  if (!p) return res.status(404).json({ error: "Program not found" });
  if (p.status !== "Completed") return res.status(409).json({ error: "Feedback opens once HR closes the program out" });
  if (istToday() > addDays(d10(p.date), FEEDBACK_WINDOW_DAYS)) return res.status(410).json({ error: "Feedback for this program has closed" });
  if (!p.attendees.length && !invitedTo(p.audience, await callerDept(req.user!))) return res.status(403).json({ error: "This program wasn't for your team" });
  if (await prisma.hrProgramFeedback.findUnique({ where: { programId_employeeId: { programId: p.id, employeeId } } })) return res.status(409).json({ error: "You've already rated this one" });
  await prisma.hrProgramFeedback.create({ data: { programId: p.id, employeeId, ...parsed.data, date: new Date(istToday()) } });
  res.status(201).json({ ok: true });
});

// HR's view of a program's responses: the spread of ratings and the comments — never who wrote them.
export const programResponses: RequestHandler = asyncHandler(async (req, res) => {
  if (!(await canManage(req.user!))) return res.status(403).json({ error: "Forbidden — HR/leadership only" });
  const p = await prisma.hrProgram.findUnique({ where: { id: req.params.id }, include: { attendees: { include: { employee: { select: { name: true } } } }, feedback: { include: { employee: { select: { name: true } } } } } });
  if (!p) return res.status(404).json({ error: "Program not found" });
  const fb = p.feedback, n = fb.length;
  // Who has / hasn't rated is shown as two plain name lists; comments are ordered by rating, not time, so nobody can be matched to one.
  const rated = new Set(fb.map((f) => f.employeeId)), byName = (a: string, b: string) => a.localeCompare(b);
  res.json({
    attendees: p.attendees.length, responses: n,
    submitted: fb.map((f) => f.employee.name).sort(byName),
    pending: p.attendees.filter((a) => !rated.has(a.employeeId)).map((a) => a.employee.name).sort(byName),
    rating: n ? fb.reduce((s, f) => s + f.rating, 0) / n : null, useful: n ? fb.reduce((s, f) => s + f.useful, 0) / n : null,
    distribution: [5, 4, 3, 2, 1].map((r) => ({ rating: r, count: fb.filter((f) => f.rating === r).length })),
    comments: fb.filter((f) => f.comment).map((f) => ({ text: f.comment, rating: f.rating })).sort((x, y) => y.rating - x.rating || x.text.localeCompare(y.text)),
  });
});
