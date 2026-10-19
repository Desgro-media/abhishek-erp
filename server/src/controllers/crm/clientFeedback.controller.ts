import { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { headedDepartments, isLeadership } from "../../services/departmentAccess";
import { istMonth, linkClosesOn, linkIsOpen, newToken, saveRatings, pinProjects } from "../../services/clientFeedback";

const ratingsSchema = z.object({
  ratings: z.array(z.object({ dept: z.string().min(1), rating: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).default(""), projectId: z.string().min(1).max(64).optional() })).min(1, "Pick a rating for at least one service"),
});
const linkSchema = z.object({ regenerate: z.boolean().optional(), depts: z.array(z.string().min(1)).min(1).optional() });

type Caller = { roles?: string[]; name: string; employeeId: string | null };
// Who may share a client's feedback link or read its feedback: leadership, the client's account manager, any department head.
async function canShare(u: Caller, client: { accountManager: string | null }) {
  if ((u.roles ?? []).includes("ADMIN") || (await isLeadership(u))) return true;
  if ((client.accountManager ?? "").trim().toLowerCase() === u.name.trim().toLowerCase()) return true;
  return (await headedDepartments(u)).length > 0;
}
// Logging what a client said on a call is the account manager's or leadership's job (not every department head's).
async function canLog(u: Caller, client: { accountManager: string | null }) {
  if ((u.roles ?? []).includes("ADMIN") || (await isLeadership(u))) return true;
  return (client.accountManager ?? "").trim().toLowerCase() === u.name.trim().toLowerCase();
}
const linkDto = (l: { token: string; depts: string[]; month: string }) => ({ token: l.token, depts: l.depts, month: l.month, closesOn: linkClosesOn(l.month), open: linkIsOpen(l.month) });
const fbDto = (f: { id: string; dept: string; month: string; rating: number; comment: string; via: string; by: string; date: Date; projectId: string | null }) => ({ id: f.id, projectId: f.projectId, dept: f.dept, month: f.month, rating: f.rating, comment: f.comment, via: f.via, by: f.by, date: f.date.toISOString().slice(0, 10) });

export const getClientFeedback: RequestHandler = asyncHandler(async (req, res) => {
  const client = await prisma.client.findUnique({ where: { id: req.params.clientId }, select: { id: true, accountManager: true } });
  if (!client) return res.status(404).json({ error: "Client not found" });
  if (!(await canShare(req.user!, client))) return res.status(403).json({ error: "Forbidden" });
  const [feedback, link] = await Promise.all([
    prisma.clientFeedback.findMany({ where: { clientId: client.id }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] }),
    prisma.clientFeedbackLink.findUnique({ where: { clientId_month: { clientId: client.id, month: istMonth() } } }),
  ]);
  res.json({ feedback: feedback.map(fbDto), link: link ? linkDto(link) : null, canLog: await canLog(req.user!, client) });
});

export const logClientFeedback: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = ratingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
  const client = await prisma.client.findUnique({ where: { id: req.params.clientId }, select: { id: true, services: true, accountManager: true } });
  if (!client) return res.status(404).json({ error: "Client not found" });
  if (!(await canLog(req.user!, client))) return res.status(403).json({ error: "Forbidden — only the account manager or leadership can log feedback" });
  const bad = parsed.data.ratings.find((r) => !client.services.includes(r.dept));
  if (bad) return res.status(400).json({ error: `${bad.dept} isn't one of this client's services` });
  const pinned = await pinProjects(client.id, parsed.data.ratings);
  if ("error" in pinned) return res.status(400).json({ error: pinned.error });
  await saveRatings(client.id, istMonth(), pinned.ratings, `Logged by ${req.user!.name}`, req.user!.name);
  await recordAudit({ userId: req.user!.sub, action: "CLIENT_FEEDBACK_LOG", entityType: "Client", entityId: client.id, afterData: pinned.ratings, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.status(201).json({ ok: true });
});

// This month's link for the client — created on first use. `regenerate` makes a fresh token (the old link stops working);
// `depts` sets which services are on it.
export const upsertFeedbackLink: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = linkSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid request" });
  const client = await prisma.client.findUnique({ where: { id: req.params.clientId }, select: { id: true, services: true, accountManager: true } });
  if (!client) return res.status(404).json({ error: "Client not found" });
  if (!(await canShare(req.user!, client))) return res.status(403).json({ error: "Forbidden" });
  const month = istMonth();
  const where = { clientId_month: { clientId: client.id, month } };
  const existing = await prisma.clientFeedbackLink.findUnique({ where });
  const wanted = parsed.data.depts ?? (existing ? existing.depts.filter((d) => client.services.includes(d)) : []);
  const depts = (wanted.length ? wanted : client.services).filter((d) => client.services.includes(d));
  if (!depts.length) return res.status(400).json({ error: "This client has no services to rate" });
  if (parsed.data.depts && parsed.data.depts.some((d) => !client.services.includes(d))) return res.status(400).json({ error: "Unknown service for this client" });
  const link = existing && !parsed.data.regenerate
    ? await prisma.clientFeedbackLink.update({ where, data: { depts } })
    : await prisma.clientFeedbackLink.upsert({ where, create: { token: newToken(), clientId: client.id, depts, month, createdBy: req.user!.name }, update: { token: newToken(), depts, createdBy: req.user!.name } });
  res.json({ link: linkDto(link) });
});
