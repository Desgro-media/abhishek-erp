import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { seesAllClients, seesWholeSalesTeam } from "../../middleware/crmAccess";
import { serviceMeetingSchema, webDetailsSchema } from "../../validation/crm.schemas";
import { loadClientFor } from "./clientCollab.controller";

// Client meetings kept per service (Client > Services tabs), and a website client's setup details. Guarded exactly like the client
// page (loadClientFor). A SCHEDULED meeting shows in the Calendar; marking it held needs the minutes; a held one is a record of what
// was agreed, so only Admin / Sales Head can delete it.

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const today = () => new Date().toISOString().slice(0, 10);
const tomorrow = () => new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
const realDate = (s: string) => { const x = new Date(`${s}T00:00:00.000Z`); return !Number.isNaN(x.getTime()) && x.toISOString().slice(0, 10) === s; };

export const serializeServiceMeeting = (m: any) => ({
  id: m.id, clientId: m.clientId, service: m.service, status: m.status, date: day(m.date), time: m.time ?? "", mode: m.mode ?? "", attendees: m.attendees,
  agenda: m.agenda ?? "", notes: m.notes, actionItems: m.actionItems ?? "", scheduledFor: day(m.scheduledFor), cancelledOn: day(m.cancelledOn), cancelledBy: m.cancelledBy, loggedBy: m.loggedBy,
});

// One rule for create and edit: a scheduled meeting can't be in the past, a held one can't be in the future and needs its minutes.
function checkMeeting(d: { status: string; date: string; notes: string }) {
  if (!realDate(d.date)) return "Invalid date";
  if (d.status === "SCHEDULED" && d.date < yesterday()) return "A scheduled meeting can't be in the past — log it as held instead";
  if (d.status === "HELD" && d.date > tomorrow()) return "A held meeting can't be in the future — schedule it instead";
  if (d.status === "HELD" && !d.notes) return "Add the minutes of the meeting";
  return null;
}

export const createServiceMeeting: RequestHandler = asyncHandler(async (req, res) => {
  const client = await loadClientFor(req, res);
  if (!client) return;
  const parsed = serviceMeetingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  if (!client.services.includes(d.service)) return res.status(400).json({ error: `${client.name} doesn't take ${d.service}` });
  const bad = checkMeeting(d);
  if (bad) return res.status(400).json({ error: bad });
  const m = await prisma.clientMeeting.create({
    data: { clientId: client.id, service: d.service, status: d.status, date: new Date(`${d.date}T00:00:00.000Z`), time: d.time || null, mode: d.mode ?? null, attendees: d.attendees, agenda: d.agenda || null, notes: d.status === "HELD" ? d.notes : "", actionItems: d.status === "HELD" ? d.actionItems || null : null, loggedBy: req.user!.name },
  });
  await recordAudit({ userId: req.user!.sub, action: d.status === "SCHEDULED" ? "CRM_SERVICE_MEETING_SCHEDULE" : "CRM_SERVICE_MEETING_LOG", entityType: "Client", entityId: client.id, afterData: serializeServiceMeeting(m) });
  res.status(201).json({ meeting: serializeServiceMeeting(m) });
});

async function loadMeeting(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) {
  const client = await loadClientFor(req, res);
  if (!client) return null;
  // Matched on BOTH ids so a meeting of another client can never be touched through this client's URL.
  const m = await prisma.clientMeeting.findFirst({ where: { id: req.params.meetingId, clientId: client.id, service: { not: null } } });
  if (!m) { res.status(404).json({ error: "Meeting not found" }); return null; }
  return m;
}

// Reschedule a scheduled meeting, or mark it held (with minutes). A held meeting's minutes can be corrected too.
export const updateServiceMeeting: RequestHandler = asyncHandler(async (req, res) => {
  const before = await loadMeeting(req, res);
  if (!before) return;
  const parsed = serviceMeetingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  if (before.status === "CANCELLED") return res.status(400).json({ error: "A cancelled meeting can't be edited" });
  if (before.status === "HELD" && d.status === "SCHEDULED") return res.status(400).json({ error: "A held meeting can't go back to scheduled" });
  if (d.service !== before.service) return res.status(400).json({ error: "A meeting can't change service" });
  const bad = checkMeeting(d);
  if (bad) return res.status(400).json({ error: bad });
  const held = d.status === "HELD";
  const m = await prisma.clientMeeting.update({
    where: { id: before.id },
    data: {
      status: d.status, date: new Date(`${d.date}T00:00:00.000Z`), time: d.time || null, mode: d.mode ?? null, attendees: d.attendees, agenda: d.agenda || null,
      notes: held ? d.notes : "", actionItems: held ? d.actionItems || null : null,
      scheduledFor: before.status === "SCHEDULED" && held ? before.date : undefined, loggedBy: held ? req.user!.name : undefined,
    },
  });
  await recordAudit({ userId: req.user!.sub, action: "CRM_SERVICE_MEETING_UPDATE", entityType: "Client", entityId: before.clientId, beforeData: serializeServiceMeeting(before), afterData: serializeServiceMeeting(m) });
  res.json({ meeting: serializeServiceMeeting(m) });
});

export const cancelServiceMeeting: RequestHandler = asyncHandler(async (req, res) => {
  const before = await loadMeeting(req, res);
  if (!before) return;
  if (before.status !== "SCHEDULED") return res.status(400).json({ error: "Only a scheduled meeting can be cancelled" });
  const m = await prisma.clientMeeting.update({ where: { id: before.id }, data: { status: "CANCELLED", cancelledOn: new Date(`${today()}T00:00:00.000Z`), cancelledBy: req.user!.name } });
  await recordAudit({ userId: req.user!.sub, action: "CRM_SERVICE_MEETING_CANCEL", entityType: "Client", entityId: before.clientId, beforeData: serializeServiceMeeting(before) });
  res.json({ meeting: serializeServiceMeeting(m) });
});

export const deleteServiceMeeting: RequestHandler = asyncHandler(async (req, res) => {
  const before = await loadMeeting(req, res);
  if (!before) return;
  if (before.status === "HELD" && !seesWholeSalesTeam(req.user?.roles)) return res.status(403).json({ error: "Forbidden — only Admin or the Sales Head can delete meeting minutes" });
  await prisma.clientMeeting.delete({ where: { id: before.id } });
  await recordAudit({ userId: req.user!.sub, action: "CRM_SERVICE_MEETING_DELETE", entityType: "Client", entityId: before.clientId, beforeData: serializeServiceMeeting(before) });
  res.status(204).send();
});

// For the Calendar: every scheduled or held service meeting on the clients the caller can see.
export const listCalendarMeetings: RequestHandler = asyncHandler(async (req, res) => {
  const where = seesAllClients(req.user?.roles) ? {} : { client: { salesPerson: req.user!.name } };
  const rows = await prisma.clientMeeting.findMany({ where: { ...where, service: { not: null }, status: { not: "CANCELLED" } }, include: { client: { select: { name: true } } }, orderBy: [{ date: "asc" }, { time: "asc" }] });
  res.json({ meetings: rows.map((m) => ({ ...serializeServiceMeeting(m), clientName: m.client.name })) });
});

export const saveWebDetails: RequestHandler = asyncHandler(async (req, res) => {
  const client = await loadClientFor(req, res);
  if (!client) return;
  const parsed = webDetailsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request", details: parsed.error.flatten().fieldErrors });
  if (!client.services.includes("Web Development")) return res.status(400).json({ error: "Website details are only kept for Web Development clients" });
  const before = await prisma.clientWebDetails.findUnique({ where: { clientId: client.id } });
  const row = await prisma.clientWebDetails.upsert({ where: { clientId: client.id }, create: { clientId: client.id, ...parsed.data, updatedBy: req.user!.name }, update: { ...parsed.data, updatedBy: req.user!.name } });
  await recordAudit({ userId: req.user!.sub, action: "CRM_WEB_DETAILS_UPDATE", entityType: "Client", entityId: client.id, beforeData: before ?? undefined, afterData: parsed.data });
  const { clientId: _c, ...dto } = row;
  res.json({ webDetails: dto });
});
