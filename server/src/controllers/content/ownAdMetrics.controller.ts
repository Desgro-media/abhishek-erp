import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { ownAdMetricSchema } from "../../validation/crm.schemas";

// DesGro Media's own daily Meta ad numbers (our lead-gen spend) — not a client's, and not the
// campaign-level totals in metaCampaigns.controller. Admin / Content only (router-level guard).

// CPL / CPA / ROAS only mean something with a non-zero divisor; null means "show —", never
// Infinity or NaN. Computed here so every client of the API shows the same figures.
function serialize(m: { id: string; date: Date; spend: unknown; leads: number; purchases: number; revenue: unknown; loggedBy: string | null }) {
  const spend = Number(m.spend);
  const revenue = Number(m.revenue);
  return {
    id: m.id,
    date: m.date.toISOString().slice(0, 10),
    spend,
    leads: m.leads,
    purchases: m.purchases,
    revenue,
    loggedBy: m.loggedBy,
    cpl: m.leads > 0 ? spend / m.leads : null,
    cpa: m.purchases > 0 ? spend / m.purchases : null,
    roas: spend > 0 ? revenue / spend : null,
  };
}

export const listOwnAdMetrics: RequestHandler = asyncHandler(async (_req, res) => {
  const rows = await prisma.ownAdMetric.findMany({ orderBy: { date: "desc" } });
  res.json({ metrics: rows.map(serialize) });
});

// Logging a date that already has numbers replaces them (the prototype's behaviour, and what a
// "fix yesterday's figure" correction needs) — one row per day, enforced by the unique date.
export const upsertOwnAdMetric: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = ownAdMetricSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  // A day that hasn't started yet can't have spend. One day of slack so a server clock behind the
  // caller's timezone (IST is ahead of UTC) doesn't reject a legitimate "today".
  const latest = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  const date = new Date(`${d.date}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || d.date.slice(0, 10) !== date.toISOString().slice(0, 10)) return res.status(400).json({ error: "Invalid date" });
  if (d.date > latest) return res.status(400).json({ error: "Can't log ad numbers for a future date" });

  const data = { spend: d.spend, leads: d.leads, purchases: d.purchases, revenue: d.revenue, loggedBy: req.user!.name };
  const before = await prisma.ownAdMetric.findUnique({ where: { date } });
  const row = await prisma.ownAdMetric.upsert({ where: { date }, create: { date, ...data }, update: data });

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
