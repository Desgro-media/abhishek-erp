import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { clientAdMetricSchema } from "../../validation/crm.schemas";
import { serializeAdMetric as serialize, parseMetricDate } from "../../services/adMetrics";
import { loadClientFor, isPerformanceClient } from "./clientCollab.controller";

// A Performance Marketing client's daily ad numbers (spend / leads / purchases / revenue), typed in
// from whatever their ad platform reported — we run the account on their behalf. Per-client and
// guarded exactly like the rest of the client page (loadClientFor: Admin / Sales Head / Clients role
// see every client, a plain Sales rep only their own). Not DesGro's own ad spend — that's the
// content module's own-ad-metrics — and not an accounting entry: nothing here touches finance.

export const listClientAdMetrics: RequestHandler = asyncHandler(async (req, res) => {
  const client = await loadClientFor(req, res);
  if (!client) return;
  const rows = await prisma.clientAdMetric.findMany({ where: { clientId: client.id }, orderBy: { date: "desc" } });
  res.json({ metrics: rows.map(serialize) });
});

// Re-logging a date replaces that day's numbers (one row per client per day) — the way to fix a typo.
export const upsertClientAdMetric: RequestHandler = asyncHandler(async (req, res) => {
  const client = await loadClientFor(req, res);
  if (!client) return;
  const parsed = clientAdMetricSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  if (!isPerformanceClient(client)) return res.status(400).json({ error: "Ad numbers are only tracked for Performance Marketing clients" });
  const d = parsed.data;

  const parsedDate = parseMetricDate(d.date);
  if ("error" in parsedDate) return res.status(400).json({ error: parsedDate.error });
  const date = parsedDate.date;

  const data = { spend: d.spend, leads: d.leads, purchases: d.purchases, revenue: d.revenue, loggedBy: req.user!.name };
  const key = { clientId_date: { clientId: client.id, date } };
  const before = await prisma.clientAdMetric.findUnique({ where: key });
  const row = await prisma.clientAdMetric.upsert({ where: key, create: { clientId: client.id, date, ...data }, update: data });

  await recordAudit({
    userId: req.user!.sub,
    action: before ? "CRM_CLIENT_AD_METRIC_UPDATE" : "CRM_CLIENT_AD_METRIC_CREATE",
    entityType: "Client",
    entityId: client.id,
    beforeData: before ? serialize(before) : undefined,
    afterData: serialize(row),
  });
  res.status(before ? 200 : 201).json({ metric: serialize(row) });
});

export const deleteClientAdMetric: RequestHandler = asyncHandler(async (req, res) => {
  const client = await loadClientFor(req, res);
  if (!client) return;
  // Matched on BOTH ids so a metric from another client can never be removed through this client's URL.
  const existing = await prisma.clientAdMetric.findFirst({ where: { id: req.params.metricId, clientId: client.id } });
  if (!existing) return res.status(404).json({ error: "Entry not found" });
  await prisma.clientAdMetric.delete({ where: { id: existing.id } });
  await recordAudit({ userId: req.user!.sub, action: "CRM_CLIENT_AD_METRIC_DELETE", entityType: "Client", entityId: client.id, beforeData: serialize(existing) });
  res.status(204).send();
});
