import { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { headedDepartments, isLeadership } from "../../services/departmentAccess";

const TYPES = ["Improve", "Optimise", "Introduce"] as const;
const STATUSES = ["Planned", "In progress", "Done", "Dropped"] as const;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// The company works on India time: "today" is the IST calendar date, whatever the server clock says.
const istNow = () => new Date(Date.now() + 5.5 * 3600_000);
const istToday = () => istNow().toISOString().slice(0, 10);
const istTime = () => istNow().toISOString().slice(11, 16);

const itemSchema = z.object({
  type: z.enum(TYPES), title: z.string().trim().min(1).max(300),
  detail: z.string().trim().max(2000).default(""), status: z.enum(STATUSES).default("Planned"),
  carriedFrom: dateStr.nullish(),
});
const createSchema = z.object({
  focus: z.string().trim().min(1, "Give today a focus").max(300),
  research: z.string().trim().max(5000).default(""),
  items: z.array(itemSchema).min(1, "Add at least one item"),
});
const patchSchema = z.object({
  focus: z.string().trim().min(1).max(300).optional(),
  research: z.string().trim().max(5000).optional(),
  // "" or null withdraws the question; any text (re)opens it.
  needsQuestion: z.string().trim().max(2000).nullable().optional(),
});
const commentSchema = z.object({ text: z.string().trim().min(1).max(2000), resolve: z.boolean().optional() });

const include = { items: { orderBy: { seq: "asc" as const } }, comments: { orderBy: { createdAt: "asc" as const } } };
type PlanRow = NonNullable<Awaited<ReturnType<typeof loadPlan>>>;
const loadPlan = (id: string) => prisma.actionPlan.findUnique({ where: { id }, include });
const d10 = (d: Date) => d.toISOString().slice(0, 10);

const toDto = (p: PlanRow) => ({
  id: p.id, dept: p.dept, head: p.headName, date: d10(p.date), submittedAt: p.submittedAt, focus: p.focus, research: p.research,
  needsInput: p.needsQuestion ? { question: p.needsQuestion, resolved: p.needsResolved } : null,
  items: p.items.map((i) => ({ id: i.id, type: i.type, title: i.title, detail: i.detail, status: i.status, carriedFrom: i.carriedFrom ? d10(i.carriedFrom) : null, addedBy: i.addedBy })),
  comments: p.comments.map((c) => ({ by: c.by, text: c.text, date: d10(c.date) })),
});

// What the caller may touch on a plan: the head of that department (own plan, today only) and leadership.
async function access(req: Parameters<RequestHandler>[0], plan: { dept: string }) {
  const leader = await isLeadership(req.user!);
  const head = (await headedDepartments(req.user!)).includes(plan.dept);
  return { leader, head };
}

// Leadership reads every department's plans; a head reads only their own department's. Default window: last 70 days.
export const listPlans: RequestHandler = asyncHandler(async (req, res) => {
  const leader = await isLeadership(req.user!);
  const headed = await headedDepartments(req.user!);
  if (!leader && !headed.length) return res.json({ plans: [] });
  const from = (req.query.from as string) || new Date(Date.now() - 70 * 86400_000).toISOString().slice(0, 10);
  const plans = await prisma.actionPlan.findMany({
    where: { date: { gte: new Date(from) }, ...(leader ? {} : { dept: { in: headed } }) },
    include, orderBy: [{ date: "desc" }, { dept: "asc" }],
  });
  res.json({ plans: plans.map(toDto) });
});

// The head files today's plan for their department — once a day.
export const createPlan: RequestHandler = asyncHandler(async (req, res) => {
  const headed = await headedDepartments(req.user!);
  if (!headed.length) return res.status(403).json({ error: "Forbidden — only a department head files an action plan" });
  const dept = headed[0];
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const date = new Date(istToday());
  if (await prisma.actionPlan.findUnique({ where: { dept_date: { dept, date } } })) return res.status(409).json({ error: "Today's plan is already filed" });
  const plan = await prisma.actionPlan.create({
    data: {
      dept, headName: req.user!.name, date, submittedAt: istTime(), focus: d.focus, research: d.research,
      items: { create: d.items.map((i, n) => ({ seq: n, type: i.type, title: i.title, detail: i.detail, status: i.status, carriedFrom: i.carriedFrom ? new Date(i.carriedFrom) : null })) },
    },
    include,
  });
  await recordAudit({ userId: req.user!.sub, action: "PLAN_FILE", entityType: "ActionPlan", entityId: plan.id, afterData: { dept, items: d.items.length }, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.status(201).json({ plan: toDto(plan) });
});

// Focus / research / "needs your input" — the head's own plan, filed today, only.
export const updatePlan: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const plan = await prisma.actionPlan.findUnique({ where: { id: req.params.id } });
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  const { head } = await access(req, plan);
  if (!head) return res.status(403).json({ error: "Forbidden — only that department's head can edit it" });
  if (d10(plan.date) !== istToday()) return res.status(409).json({ error: "Only today's plan can be edited" });
  const d = parsed.data;
  const q = d.needsQuestion === undefined ? undefined : (d.needsQuestion || null);
  await prisma.actionPlan.update({ where: { id: plan.id }, data: { focus: d.focus, research: d.research, ...(q === undefined ? {} : { needsQuestion: q, needsResolved: false }) } });
  res.json({ plan: toDto((await loadPlan(plan.id))!) });
});

const nextSeq = async (planId: string) => ((await prisma.actionPlanItem.aggregate({ where: { planId }, _max: { seq: true } }))._max.seq ?? -1) + 1;

// Add an item: the head to today's plan; leadership to any plan (marked as added by them).
export const addItem: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = itemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const plan = await prisma.actionPlan.findUnique({ where: { id: req.params.id } });
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  const { leader, head } = await access(req, plan);
  const today = d10(plan.date) === istToday();
  if (!(head && today) && !leader) return res.status(403).json({ error: "Forbidden" });
  const d = parsed.data;
  await prisma.actionPlanItem.create({
    data: { planId: plan.id, seq: await nextSeq(plan.id), type: d.type, title: d.title, detail: d.detail, status: d.status, carriedFrom: d.carriedFrom ? new Date(d.carriedFrom) : null, addedBy: head && today ? null : req.user!.name },
  });
  res.status(201).json({ plan: toDto((await loadPlan(plan.id))!) });
});

async function ownTodayItem(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) {
  const item = await prisma.actionPlanItem.findUnique({ where: { id: req.params.itemId }, include: { plan: true } });
  if (!item || item.planId !== req.params.id) { res.status(404).json({ error: "Item not found" }); return null; }
  const { head } = await access(req, item.plan);
  if (!head) { res.status(403).json({ error: "Forbidden — only that department's head can change its items" }); return null; }
  if (d10(item.plan.date) !== istToday()) { res.status(409).json({ error: "Only today's plan can be edited" }); return null; }
  return item;
}

export const updateItem: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = itemSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const item = await ownTodayItem(req, res); if (!item) return;
  const d = parsed.data;
  await prisma.actionPlanItem.update({ where: { id: item.id }, data: { type: d.type, title: d.title, detail: d.detail, status: d.status } });
  res.json({ plan: toDto((await loadPlan(item.planId))!) });
});

export const deleteItem: RequestHandler = asyncHandler(async (req, res) => {
  const item = await ownTodayItem(req, res); if (!item) return;
  await prisma.actionPlanItem.delete({ where: { id: item.id } });
  res.json({ plan: toDto((await loadPlan(item.planId))!) });
});

// Comment thread. Leadership may comment on any plan and, with `resolve`, mark the head's open question answered;
// the head may reply on their own department's plans.
export const addComment: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const plan = await prisma.actionPlan.findUnique({ where: { id: req.params.id } });
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  const { leader, head } = await access(req, plan);
  if (!leader && !head) return res.status(403).json({ error: "Forbidden" });
  await prisma.actionPlanComment.create({ data: { planId: plan.id, by: req.user!.name, text: parsed.data.text, date: new Date(istToday()) } });
  if (leader && parsed.data.resolve && plan.needsQuestion && !plan.needsResolved) await prisma.actionPlan.update({ where: { id: plan.id }, data: { needsResolved: true } });
  res.status(201).json({ plan: toDto((await loadPlan(plan.id))!) });
});
