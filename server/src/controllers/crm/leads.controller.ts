import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { seesWholeSalesTeam } from "../../middleware/crmAccess";
import { recordAudit } from "../../services/audit.service";
import { leadCreateSchema, leadUpdateSchema, leadStageSchema, leadLostSchema } from "../../validation/crm.schemas";
import { STAGE_TO_STATUS, STATUS_TO_STAGE } from "../../services/leadStage";
import { nextSequentialCode } from "../../utils/sequentialCode";

async function nextLeadCode(): Promise<string> {
  return nextSequentialCode("MLD-", (await prisma.lead.findMany({ select: { leadCode: true } })).map((l) => l.leadCode));
}

// A plain Sales caller sees their own claimed leads plus the shared Open
// (unclaimed) queue they can claim from — same "narrow self-service slice"
// listClients/listQuotes already give a non-admin caller; ADMIN and the Sales Head see
// everyone's, same as those.
export const listLeads: RequestHandler = asyncHandler(async (req, res) => {
  const admin = seesWholeSalesTeam(req.user?.roles);
  const leads = await prisma.lead.findMany({
    where: { status: req.query.status as any, ...(admin ? {} : { OR: [{ leadOwner: req.user!.name }, { leadOwner: null }] }) },
    orderBy: { createdAt: "desc" },
  });
  res.json({ leads });
});

export const createLead: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = leadCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const lead = await prisma.lead.create({
    data: { leadCode: await nextLeadCode(), name: d.name, phone: d.phone, email: d.email, source: d.source, serviceInterested: d.serviceInterested, leadOwner: d.leadOwner },
  });

  await recordAudit({ userId: req.user!.sub, action: "CRM_LEAD_CREATE", entityType: "Lead", entityId: lead.id, afterData: d });
  res.status(201).json({ lead });
});

export const updateLead: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = leadUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });

  const existing = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Lead not found" });
  // A plain Sales rep works their own leads plus the shared Open queue (to claim) — never another
  // rep's. Admin / Sales Head edit anyone's.
  if (!seesWholeSalesTeam(req.user?.roles) && existing.leadOwner && existing.leadOwner !== req.user!.name) {
    return res.status(403).json({ error: "Forbidden — not your lead" });
  }
  // The older PATCH can still set the coarse `status` directly; keep the pipeline stage in step with it so
  // the two never disagree. (The Leads page itself doesn't send `status` — it uses the stage endpoints.)
  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.status) {
    Object.assign(data, { stage: STATUS_TO_STAGE[parsed.data.status], stageChangedAt: new Date(), stageSetBy: req.user!.name });
    if (parsed.data.status !== "LOST") Object.assign(data, { lostReason: null, lostNote: null });
  }
  const lead = await prisma.lead.update({ where: { id: existing.id }, data });

  await recordAudit({ userId: req.user!.sub, action: "CRM_LEAD_UPDATE", entityType: "Lead", entityId: lead.id, afterData: parsed.data });
  res.json({ lead });
});

// Admin / Sales Head can delete any lead; a plain Sales rep only their own claimed ones (never the shared
// Open queue, which isn't theirs). Refused once a quote exists against the lead — that quote would be left
// pointing at nobody (and a converted lead always has one); delete or mark-lost those first.
export const deleteLead: RequestHandler = asyncHandler(async (req, res) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id }, include: { _count: { select: { quotes: true } } } });
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  if (!seesWholeSalesTeam(req.user?.roles) && lead.leadOwner !== req.user!.name) {
    return res.status(403).json({ error: "Forbidden — you can only delete your own leads" });
  }
  const n = lead._count.quotes;
  if (n > 0) {
    return res.status(409).json({ error: `Can't delete ${lead.name} — ${n} quote${n === 1 ? "" : "s"} ${n === 1 ? "is" : "are"} raised against them. Delete those quotes first, or mark the lead Lost instead.` });
  }

  await prisma.lead.delete({ where: { id: lead.id } });

  await recordAudit({ userId: req.user!.sub, action: "CRM_LEAD_DELETE", entityType: "Lead", entityId: lead.id, beforeData: { leadCode: lead.leadCode, name: lead.name, leadOwner: lead.leadOwner } });
  res.status(204).send();
});

// ---- Pipeline stage ----
// Same ownership rule as everywhere else on a lead (a plain rep only works their own), plus: an unclaimed lead
// in the shared Open queue can't be moved by a rep — they claim it first. Admin / Sales Head move anyone's.
async function loadWorkableLead(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return null; }
  if (!seesWholeSalesTeam(req.user?.roles)) {
    if (!lead.leadOwner) { res.status(403).json({ error: "Claim this lead first" }); return null; }
    if (lead.leadOwner !== req.user!.name) { res.status(403).json({ error: "Forbidden — not your lead" }); return null; }
  }
  // A converted lead is Won and stays Won — it's a client now; its history lives on the client.
  if (lead.convertedClientId || lead.stage === "WON") { res.status(409).json({ error: "This lead has already been converted to a client" }); return null; }
  return lead;
}

export const setLeadStage: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = leadStageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const lead = await loadWorkableLead(req, res);
  if (!lead) return;
  const { stage } = parsed.data;
  if (lead.stage === stage) return res.json({ lead });

  // Moving back out of Lost reopens it, so the old lost reason goes.
  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: { stage, status: STAGE_TO_STATUS[stage], lostReason: null, lostNote: null, stageChangedAt: new Date(), stageSetBy: req.user!.name },
  });
  await recordAudit({
    userId: req.user!.sub, action: "CRM_LEAD_STAGE", entityType: "Lead", entityId: lead.id,
    beforeData: { stage: lead.stage, lostReason: lead.lostReason }, afterData: { stage: updated.stage },
  });
  res.json({ lead: updated });
});

export const markLeadLost: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = leadLostSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const lead = await loadWorkableLead(req, res);
  if (!lead) return;
  if (lead.stage === "LOST") return res.status(409).json({ error: "Already marked lost — move it back into the pipeline first to change the reason" });

  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: { stage: "LOST", status: STAGE_TO_STATUS.LOST, lostReason: parsed.data.reason, lostNote: parsed.data.note, stageChangedAt: new Date(), stageSetBy: req.user!.name },
  });
  await recordAudit({
    userId: req.user!.sub, action: "CRM_LEAD_LOST", entityType: "Lead", entityId: lead.id,
    beforeData: { stage: lead.stage }, afterData: { stage: "LOST", reason: parsed.data.reason, note: parsed.data.note },
  });
  res.json({ lead: updated });
});
