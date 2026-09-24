import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { seesWholeSalesTeam } from "../../middleware/crmAccess";
import { recordAudit } from "../../services/audit.service";
import { clientCreateSchema, clientUpdateSchema } from "../../validation/crm.schemas";

async function nextClientCode(): Promise<string> {
  const last = await prisma.client.findFirst({ orderBy: { clientCode: "desc" } });
  const lastNum = last ? Number(last.clientCode.replace("CLI-", "")) : 0;
  return `CLI-${String(lastNum + 1).padStart(2, "0")}`;
}

// Mounted behind requireCrmUser (ADMIN, SALES_HEAD or SALES). A plain Sales caller only
// ever sees their own book — same "narrow self-service slice" listInvoices
// already does by salesPerson — ADMIN and the Sales Head see everyone's.
export const listClients: RequestHandler = asyncHandler(async (req, res) => {
  const admin = seesWholeSalesTeam(req.user?.roles);
  const clients = await prisma.client.findMany({
    where: { status: req.query.status as any, salesPerson: admin ? undefined : req.user!.name },
    orderBy: { name: "asc" },
  });
  res.json({ clients });
});

export const getClient: RequestHandler = asyncHandler(async (req, res) => {
  const admin = seesWholeSalesTeam(req.user?.roles);
  const client = await prisma.client.findUnique({ where: { id: req.params.id } });
  if (!client) return res.status(404).json({ error: "Client not found" });
  if (!admin && client.salesPerson !== req.user!.name) return res.status(403).json({ error: "Forbidden — not your client" });
  res.json({ client });
});

export const createClient: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = clientCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const client = await prisma.client.create({
    data: { clientCode: await nextClientCode(), name: d.name, industry: d.industry, city: d.city, services: d.services, accountManager: d.accountManager, salesPerson: d.salesPerson, billingType: d.billingType, onboardedAt: new Date() },
  });

  await recordAudit({ userId: req.user!.sub, action: "CRM_CLIENT_CREATE", entityType: "Client", entityId: client.id, afterData: d });
  res.status(201).json({ client });
});

export const updateClient: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = clientUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });

  const client = await prisma.client.update({ where: { id: req.params.id }, data: parsed.data }).catch(() => null);
  if (!client) return res.status(404).json({ error: "Client not found" });

  await recordAudit({ userId: req.user!.sub, action: "CRM_CLIENT_UPDATE", entityType: "Client", entityId: client.id, afterData: parsed.data });
  res.json({ client });
});
