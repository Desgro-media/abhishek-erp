import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { seesAllClients, seesWholeSalesTeam } from "../../middleware/crmAccess";
import { recordAudit } from "../../services/audit.service";
import { adAccessSchema, campaignBriefSchema, brandAssetSchema, clientMeetingSchema } from "../../validation/crm.schemas";

// What DesGro needs from / notes about a client, shown on the client detail page: ad account access,
// brand assets, campaign brief and the meetings log. Everything is scoped to ONE client by the URL and
// guarded exactly like getClient — Admin / Sales Head / Clients role see every client, a plain Sales rep
// only their own book. (This is the same data the future client portal will expose to that client alone.)

async function loadClientFor(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) {
  const client = await prisma.client.findUnique({ where: { id: req.params.id } });
  if (!client) { res.status(404).json({ error: "Client not found" }); return null; }
  if (!seesAllClients(req.user?.roles) && client.salesPerson !== req.user!.name) {
    res.status(403).json({ error: "Forbidden — not your client" });
    return null;
  }
  return client;
}

// Ad account access and the brief only make sense for clients whose ads we run.
const isPerformanceClient = (c: { services: string[] }) => c.services.includes("Performance Marketing");

const dayString = (d: Date) => d.toISOString().slice(0, 10);
const serializeMeeting = (m: { id: string; date: Date; attendees: string; notes: string; loggedBy: string; createdAt: Date }) => ({
  id: m.id, date: dayString(m.date), attendees: m.attendees, notes: m.notes, loggedBy: m.loggedBy, createdAt: m.createdAt,
});

export const getClientCollab: RequestHandler = asyncHandler(async (req, res) => {
  const client = await loadClientFor(req, res);
  if (!client) return;
  const [adAccess, campaignBrief, brandAssets, meetings] = await Promise.all([
    prisma.clientAdAccess.findUnique({ where: { clientId: client.id } }),
    prisma.clientCampaignBrief.findUnique({ where: { clientId: client.id } }),
    prisma.clientBrandAsset.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "asc" } }),
    prisma.clientMeeting.findMany({ where: { clientId: client.id }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] }),
  ]);
  res.json({ adAccess, campaignBrief, brandAssets, meetings: meetings.map(serializeMeeting) });
});

export const upsertAdAccess: RequestHandler = asyncHandler(async (req, res) => {
  const client = await loadClientFor(req, res);
  if (!client) return;
  const parsed = adAccessSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  if (!isPerformanceClient(client)) return res.status(400).json({ error: "Ad account access is only kept for Performance Marketing clients" });

  const data = { ...parsed.data, updatedBy: req.user!.name };
  const before = await prisma.clientAdAccess.findUnique({ where: { clientId: client.id } });
  const adAccess = await prisma.clientAdAccess.upsert({ where: { clientId: client.id }, create: { clientId: client.id, ...data }, update: data });
  await recordAudit({ userId: req.user!.sub, action: "CRM_CLIENT_AD_ACCESS_UPSERT", entityType: "Client", entityId: client.id, beforeData: before ?? undefined, afterData: adAccess });
  res.json({ adAccess });
});

export const upsertCampaignBrief: RequestHandler = asyncHandler(async (req, res) => {
  const client = await loadClientFor(req, res);
  if (!client) return;
  const parsed = campaignBriefSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  if (!isPerformanceClient(client)) return res.status(400).json({ error: "A campaign brief is only kept for Performance Marketing clients" });

  const data = { ...parsed.data, updatedBy: req.user!.name };
  const before = await prisma.clientCampaignBrief.findUnique({ where: { clientId: client.id } });
  const campaignBrief = await prisma.clientCampaignBrief.upsert({ where: { clientId: client.id }, create: { clientId: client.id, ...data }, update: data });
  await recordAudit({ userId: req.user!.sub, action: "CRM_CLIENT_BRIEF_UPSERT", entityType: "Client", entityId: client.id, beforeData: before ?? undefined, afterData: campaignBrief });
  res.json({ campaignBrief });
});

export const addBrandAsset: RequestHandler = asyncHandler(async (req, res) => {
  const client = await loadClientFor(req, res);
  if (!client) return;
  const parsed = brandAssetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });

  const asset = await prisma.clientBrandAsset.create({ data: { clientId: client.id, ...parsed.data, addedBy: req.user!.name } });
  await recordAudit({ userId: req.user!.sub, action: "CRM_CLIENT_BRAND_ASSET_ADD", entityType: "Client", entityId: client.id, afterData: asset });
  res.status(201).json({ asset });
});

export const removeBrandAsset: RequestHandler = asyncHandler(async (req, res) => {
  const client = await loadClientFor(req, res);
  if (!client) return;
  // Matched on BOTH ids so an asset id from another client can never be removed through this client's URL.
  const asset = await prisma.clientBrandAsset.findFirst({ where: { id: req.params.assetId, clientId: client.id } });
  if (!asset) return res.status(404).json({ error: "Asset not found" });
  await prisma.clientBrandAsset.delete({ where: { id: asset.id } });
  await recordAudit({ userId: req.user!.sub, action: "CRM_CLIENT_BRAND_ASSET_REMOVE", entityType: "Client", entityId: client.id, beforeData: asset });
  res.status(204).send();
});

export const logMeeting: RequestHandler = asyncHandler(async (req, res) => {
  const client = await loadClientFor(req, res);
  if (!client) return;
  const parsed = clientMeetingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const date = new Date(`${d.date}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || dayString(date) !== d.date) return res.status(400).json({ error: "Invalid date" });
  // A meeting log records a meeting that happened. One day of slack for timezones (IST is ahead of UTC).
  if (d.date > dayString(new Date(Date.now() + 24 * 3600 * 1000))) return res.status(400).json({ error: "Can't log a meeting for a future date" });

  const meeting = await prisma.clientMeeting.create({ data: { clientId: client.id, date, attendees: d.attendees, notes: d.notes, loggedBy: req.user!.name } });
  await recordAudit({ userId: req.user!.sub, action: "CRM_CLIENT_MEETING_LOG", entityType: "Client", entityId: client.id, afterData: serializeMeeting(meeting) });
  res.status(201).json({ meeting: serializeMeeting(meeting) });
});

// A meeting log is a record of what was agreed, so only Admin / Sales Head can remove one (a typo
// fix, a duplicate) — the person who logged it can't quietly erase it.
export const deleteMeeting: RequestHandler = asyncHandler(async (req, res) => {
  const client = await loadClientFor(req, res);
  if (!client) return;
  if (!seesWholeSalesTeam(req.user?.roles)) return res.status(403).json({ error: "Forbidden — only Admin or the Sales Head can delete a meeting log" });
  const meeting = await prisma.clientMeeting.findFirst({ where: { id: req.params.meetingId, clientId: client.id } });
  if (!meeting) return res.status(404).json({ error: "Meeting not found" });
  await prisma.clientMeeting.delete({ where: { id: meeting.id } });
  await recordAudit({ userId: req.user!.sub, action: "CRM_CLIENT_MEETING_DELETE", entityType: "Client", entityId: client.id, beforeData: serializeMeeting(meeting) });
  res.status(204).send();
});
