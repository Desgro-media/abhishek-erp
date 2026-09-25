import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { seesWholeSalesTeam } from "../../middleware/crmAccess";
import { recordAudit } from "../../services/audit.service";
import { clientCreateSchema, clientUpdateSchema } from "../../validation/crm.schemas";
import { nextSequentialCode } from "../../utils/sequentialCode";

async function nextClientCode(): Promise<string> {
  return nextSequentialCode("CLI-", (await prisma.client.findMany({ select: { clientCode: true } })).map((c) => c.clientCode));
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

  const existing = await prisma.client.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Client not found" });
  // Same scoping as listClients/getClient: a plain Sales rep only ever edits their own book.
  if (!seesWholeSalesTeam(req.user?.roles) && existing.salesPerson !== req.user!.name) {
    return res.status(403).json({ error: "Forbidden — not your client" });
  }
  const client = await prisma.client.update({ where: { id: existing.id }, data: parsed.data });

  await recordAudit({ userId: req.user!.sub, action: "CRM_CLIENT_UPDATE", entityType: "Client", entityId: client.id, afterData: parsed.data });
  res.json({ client });
});

// Admin / Sales Head only — a plain Sales rep can edit their clients but not remove them. Refused
// once the client has invoices or quotes: those carry the payment ledger, which is append-only
// (same rule as deleteInvoice/deleteQuote), so a client with any billing history is archived by
// setting its status to Churned instead. Their workflow tasks are deleted along with them (schema cascade).
export const deleteClient: RequestHandler = asyncHandler(async (req, res) => {
  if (!seesWholeSalesTeam(req.user?.roles)) return res.status(403).json({ error: "Forbidden — only Admin or the Sales Head can delete a client" });

  const client = await prisma.client.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { invoices: true, quotes: true, tasks: true } } },
  });
  if (!client) return res.status(404).json({ error: "Client not found" });

  const { invoices, quotes } = client._count;
  if (invoices > 0 || quotes > 0) {
    const parts = [invoices && `${invoices} invoice${invoices === 1 ? "" : "s"}`, quotes && `${quotes} quote${quotes === 1 ? "" : "s"}`].filter(Boolean).join(" and ");
    return res.status(409).json({ error: `Can't delete ${client.name} — they have ${parts}, and the payment ledger is append-only. Set their status to Churned instead.` });
  }

  await prisma.client.delete({ where: { id: client.id } });

  await recordAudit({ userId: req.user!.sub, action: "CRM_CLIENT_DELETE", entityType: "Client", entityId: client.id, beforeData: { clientCode: client.clientCode, name: client.name, tasksDeleted: client._count.tasks } });
  res.status(204).send();
});
