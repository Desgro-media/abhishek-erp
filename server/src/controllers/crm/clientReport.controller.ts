import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { loadClientFor, isPerformanceClient } from "./clientCollab.controller";
import { newToken } from "../../services/clientFeedback";

const dto = (l: { token: string; createdBy: string; createdAt: Date } | null) => (l ? { token: l.token, createdBy: l.createdBy, createdAt: l.createdAt.toISOString().slice(0, 10) } : null);

// The report link for one client — guarded exactly like the client's own page (Admin / Sales Head / Clients role see every
// client, a Sales rep only their own).
export const getReportLink: RequestHandler = asyncHandler(async (req, res) => {
  const client = await loadClientFor(req, res); if (!client) return;
  res.json({ link: dto(await prisma.clientReportLink.findUnique({ where: { clientId: client.id } })) });
});

// Create the link, or with { regenerate: true } swap its token so the old one stops working.
export const makeReportLink: RequestHandler = asyncHandler(async (req, res) => {
  const client = await loadClientFor(req, res); if (!client) return;
  if (!isPerformanceClient(client)) return res.status(400).json({ error: "A report link is only for Performance Marketing clients" });
  const existing = await prisma.clientReportLink.findUnique({ where: { clientId: client.id } });
  const link = existing && !req.body?.regenerate
    ? existing
    : await prisma.clientReportLink.upsert({ where: { clientId: client.id }, create: { clientId: client.id, token: newToken(), createdBy: req.user!.name }, update: { token: newToken(), createdBy: req.user!.name } });
  if (!existing || req.body?.regenerate) await recordAudit({ userId: req.user!.sub, action: existing ? "CLIENT_REPORT_LINK_REGENERATE" : "CLIENT_REPORT_LINK_CREATE", entityType: "Client", entityId: client.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.json({ link: dto(link) });
});

export const removeReportLink: RequestHandler = asyncHandler(async (req, res) => {
  const client = await loadClientFor(req, res); if (!client) return;
  await prisma.clientReportLink.deleteMany({ where: { clientId: client.id } });
  await recordAudit({ userId: req.user!.sub, action: "CLIENT_REPORT_LINK_REMOVE", entityType: "Client", entityId: client.id, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.status(204).send();
});

/* ---- Public, no sign-in ---- */
const num = (x: unknown) => Number(x);
const monthOk = (m: unknown): m is string => typeof m === "string" && /^\d{4}-\d{2}$/.test(m);
const istMonth = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7);
const prevMonth = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7); };
const range = (m: string) => { const [y, mo] = m.split("-").map(Number); return { gte: new Date(`${m}-01T00:00:00Z`), lte: new Date(Date.UTC(y, mo, 0)) }; };
const totalsOf = (rows: { spend: unknown; leads: number; purchases: number; revenue: unknown }[]) => {
  const spend = rows.reduce((s, r) => s + num(r.spend), 0), revenue = rows.reduce((s, r) => s + num(r.revenue), 0);
  const leads = rows.reduce((s, r) => s + r.leads, 0), purchases = rows.reduce((s, r) => s + r.purchases, 0);
  return { days: rows.length, spend, leads, purchases, revenue, roas: spend > 0 ? revenue / spend : null, cpl: leads > 0 ? spend / leads : null };
};

// What the client sees: the month's ad numbers (daily rows + totals vs the month before), the campaign brief and the meetings
// log. Never ad-account access details, invoices, payments, quotes, tasks or the names of staff who logged anything.
export const getClientReportPublic: RequestHandler = async (req, res, next) => {
  try {
    const link = await prisma.clientReportLink.findUnique({ where: { token: String(req.params.token) }, include: { client: { select: { id: true, name: true } } } });
    if (!link) return res.status(404).json({ error: "This link isn't valid — it may have been replaced or switched off." });
    const cid = link.client.id;
    const all = await prisma.clientAdMetric.findMany({ where: { clientId: cid }, select: { date: true }, orderBy: { date: "desc" } });
    const months = [...new Set(all.map((r) => r.date.toISOString().slice(0, 7)))];
    const month = monthOk(req.query.month) ? req.query.month : (months[0] ?? istMonth());
    const [rows, prevRows, brief, meetings] = await Promise.all([
      prisma.clientAdMetric.findMany({ where: { clientId: cid, date: range(month) }, orderBy: { date: "desc" } }),
      prisma.clientAdMetric.findMany({ where: { clientId: cid, date: range(prevMonth(month)) } }),
      prisma.clientCampaignBrief.findUnique({ where: { clientId: cid } }),
      prisma.clientMeeting.findMany({ where: { clientId: cid }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 20 }),
    ]);
    res.json({
      clientName: link.client.name, month, months: months.length ? months : [month],
      totals: totalsOf(rows), prevTotals: totalsOf(prevRows),
      daily: rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), spend: num(r.spend), leads: r.leads, purchases: r.purchases, revenue: num(r.revenue) })),
      brief: brief && (brief.objective || brief.audience || brief.budget) ? { objective: brief.objective, audience: brief.audience, budget: brief.budget } : null,
      meetings: meetings.map((m) => ({ date: m.date.toISOString().slice(0, 10), attendees: m.attendees, notes: m.notes })),
    });
  } catch (e) { next(e); }
};
