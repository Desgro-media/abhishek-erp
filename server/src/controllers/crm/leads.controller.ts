import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { leadCreateSchema, leadUpdateSchema } from "../../validation/crm.schemas";

async function nextLeadCode(): Promise<string> {
  const last = await prisma.lead.findFirst({ orderBy: { leadCode: "desc" } });
  const lastNum = last ? Number(last.leadCode.replace("MLD-", "")) : 0;
  return `MLD-${String(lastNum + 1).padStart(2, "0")}`;
}

export const listLeads: RequestHandler = asyncHandler(async (req, res) => {
  const leads = await prisma.lead.findMany({ where: { status: req.query.status as any }, orderBy: { createdAt: "desc" } });
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

  const lead = await prisma.lead.update({ where: { id: req.params.id }, data: parsed.data }).catch(() => null);
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  await recordAudit({ userId: req.user!.sub, action: "CRM_LEAD_UPDATE", entityType: "Lead", entityId: lead.id, afterData: parsed.data });
  res.json({ lead });
});
