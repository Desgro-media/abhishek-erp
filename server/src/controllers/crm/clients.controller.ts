import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { clientCreateSchema, clientUpdateSchema } from "../../validation/crm.schemas";

async function nextClientCode(): Promise<string> {
  const last = await prisma.client.findFirst({ orderBy: { clientCode: "desc" } });
  const lastNum = last ? Number(last.clientCode.replace("CLI-", "")) : 0;
  return `CLI-${String(lastNum + 1).padStart(2, "0")}`;
}

export const listClients: RequestHandler = asyncHandler(async (req, res) => {
  const clients = await prisma.client.findMany({
    where: { status: req.query.status as any },
    orderBy: { name: "asc" },
  });
  res.json({ clients });
});

export const getClient: RequestHandler = asyncHandler(async (req, res) => {
  const client = await prisma.client.findUnique({ where: { id: req.params.id } });
  if (!client) return res.status(404).json({ error: "Client not found" });
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
