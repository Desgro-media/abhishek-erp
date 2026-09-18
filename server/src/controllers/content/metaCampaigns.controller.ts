import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { metaCampaignCreateSchema, metaCampaignUpdateSchema } from "../../validation/crm.schemas";

// Read-only in the old prototype (pure seed data, no add/edit/delete UI
// anywhere) — full CRUD added here since a real multi-user system needs a
// way to actually enter this data; there's no live Meta integration to
// sync from, so these are entered by hand until one exists.
export const listMetaCampaigns: RequestHandler = asyncHandler(async (_req, res) => {
  const campaigns = await prisma.metaAdsCampaign.findMany({ orderBy: { startAt: "desc" } });
  res.json({ campaigns });
});

export const createMetaCampaign: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = metaCampaignCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const campaign = await prisma.metaAdsCampaign.create({ data: { ...d, startAt: new Date(d.startAt) } });
  await recordAudit({ userId: req.user!.sub, action: "CONTENT_META_CAMPAIGN_CREATE", entityType: "MetaAdsCampaign", entityId: campaign.id, afterData: d });
  res.status(201).json({ campaign });
});

export const updateMetaCampaign: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = metaCampaignUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const campaign = await prisma.metaAdsCampaign.update({ where: { id: req.params.id }, data: { ...d, startAt: d.startAt ? new Date(d.startAt) : undefined } }).catch(() => null);
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });

  await recordAudit({ userId: req.user!.sub, action: "CONTENT_META_CAMPAIGN_UPDATE", entityType: "MetaAdsCampaign", entityId: campaign.id, afterData: d });
  res.json({ campaign });
});
