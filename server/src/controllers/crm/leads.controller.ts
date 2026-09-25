import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { seesWholeSalesTeam } from "../../middleware/crmAccess";
import { recordAudit } from "../../services/audit.service";
import { leadCreateSchema, leadUpdateSchema } from "../../validation/crm.schemas";

async function nextLeadCode(): Promise<string> {
  const last = await prisma.lead.findFirst({ orderBy: { leadCode: "desc" } });
  const lastNum = last ? Number(last.leadCode.replace("MLD-", "")) : 0;
  return `MLD-${String(lastNum + 1).padStart(2, "0")}`;
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
  const lead = await prisma.lead.update({ where: { id: existing.id }, data: parsed.data });

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
