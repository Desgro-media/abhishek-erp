import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { ownAdMetricServiceSchema } from "../../validation/crm.schemas";
import { SERVICE_DEPARTMENTS } from "../../services/departmentAccess";
import { serializeAdMetric, parseMetricDate } from "../../services/adMetrics";

// DesGro Media's own daily Meta ad numbers (our lead-gen spend) — not a client's, and not the
// campaign-level totals in metaCampaigns.controller. Admin / Content only (router-level guard).

const serialize = (r: Parameters<typeof serializeAdMetric>[0] & { service: string }) => ({ ...serializeAdMetric(r), service: r.service });

export const listOwnAdMetrics: RequestHandler = asyncHandler(async (_req, res) => {
  const rows = await prisma.ownAdMetric.findMany({ orderBy: [{ date: "desc" }, { service: "asc" }] });
  res.json({ metrics: rows.map(serialize), services: SERVICE_DEPARTMENTS });
});

// Logging a date + service that already has numbers replaces them ("fix yesterday's figure"). One row per date per
// service, enforced by the unique (date, service) — so a date can carry several services, each its own entry.
export const upsertOwnAdMetric: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = ownAdMetricServiceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const parsedDate = parseMetricDate(d.date);
  if ("error" in parsedDate) return res.status(400).json({ error: parsedDate.error });
  const date = parsedDate.date;

  const service = d.service ?? "";
  if (service && !SERVICE_DEPARTMENTS.includes(service)) return res.status(400).json({ error: "Pick one of the ERP services" });

  const data = { spend: d.spend, leads: d.leads, purchases: d.purchases, revenue: d.revenue, note: d.note || null, loggedBy: req.user!.name };
  // Editing a specific entry (id given): update that row in place, including moving it to another service.
  if (d.id) {
    const existing = await prisma.ownAdMetric.findUnique({ where: { id: d.id } });
    if (!existing) return res.status(404).json({ error: "Entry not found" });
    if (existing.date.getTime() !== date.getTime()) return res.status(400).json({ error: "The date of an entry can't be changed — delete it and log the new date" });
    if (existing.service !== service) {
      const clash = await prisma.ownAdMetric.findUnique({ where: { date_service: { date, service } } });
      if (clash) return res.status(409).json({ error: `${service || "A general (no service)"} entry already exists for this date — edit that one instead` });
    }
    const updated = await prisma.ownAdMetric.update({ where: { id: existing.id }, data: { ...data, service } });
    await recordAudit({ userId: req.user!.sub, action: "CONTENT_OWN_AD_METRIC_UPDATE", entityType: "OwnAdMetric", entityId: updated.id, beforeData: serialize(existing), afterData: serialize(updated) });
    return res.json({ metric: serialize(updated) });
  }

  const before = await prisma.ownAdMetric.findUnique({ where: { date_service: { date, service } } });
  const row = await prisma.ownAdMetric.upsert({ where: { date_service: { date, service } }, create: { date, service, ...data }, update: data });

  await recordAudit({
    userId: req.user!.sub,
    action: before ? "CONTENT_OWN_AD_METRIC_UPDATE" : "CONTENT_OWN_AD_METRIC_CREATE",
    entityType: "OwnAdMetric",
    entityId: row.id,
    beforeData: before ? serialize(before) : undefined,
    afterData: serialize(row),
  });
  res.status(before ? 200 : 201).json({ metric: serialize(row) });
});

export const deleteOwnAdMetric: RequestHandler = asyncHandler(async (req, res) => {
  const existing = await prisma.ownAdMetric.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Entry not found" });
  await prisma.ownAdMetric.delete({ where: { id: existing.id } });
  await recordAudit({ userId: req.user!.sub, action: "CONTENT_OWN_AD_METRIC_DELETE", entityType: "OwnAdMetric", entityId: existing.id, beforeData: serialize(existing) });
  res.status(204).send();
});
