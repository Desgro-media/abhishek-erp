import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { coaCreateSchema, coaUpdateSchema } from "../../validation/finance.schemas";

export const listAccounts: RequestHandler = asyncHandler(async (_req, res) => {
  const accounts = await prisma.chartOfAccount.findMany({ orderBy: { name: "asc" } });
  res.json({ accounts });
});

export const createAccount: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = coaCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const dup = await prisma.chartOfAccount.findFirst({ where: { name: { equals: d.name, mode: "insensitive" } } });
  if (dup) return res.status(409).json({ error: "An account with that name already exists" });

  let type = d.type;
  if (d.parentId) {
    const parent = await prisma.chartOfAccount.findUnique({ where: { id: d.parentId } });
    if (!parent) return res.status(404).json({ error: "Parent account not found" });
    type = parent.type; // sub-accounts inherit the parent's type at creation time, not re-derived on every read
  }

  const account = await prisma.chartOfAccount.create({ data: { name: d.name, type: type!, parentId: d.parentId } });
  await recordAudit({ userId: req.user!.sub, action: "FIN_COA_CREATE", entityType: "ChartOfAccount", entityId: account.id, afterData: d });
  res.status(201).json({ account });
});

export const updateAccountType: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = coaUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });

  const account = await prisma.chartOfAccount.update({ where: { id: req.params.id }, data: { type: parsed.data.type } }).catch(() => null);
  if (!account) return res.status(404).json({ error: "Account not found" });

  await recordAudit({ userId: req.user!.sub, action: "FIN_COA_TYPE_UPDATE", entityType: "ChartOfAccount", entityId: account.id, afterData: parsed.data });
  res.json({ account });
});

// Cascades to children via onDelete: Cascade on the self-relation... actually
// Prisma requires an explicit delete for self-relations without DB-level
// cascade here, so children are removed explicitly first.
export const removeAccount: RequestHandler = asyncHandler(async (req, res) => {
  const id = req.params.id;
  const account = await prisma.chartOfAccount.findUnique({ where: { id } });
  if (!account) return res.status(404).json({ error: "Account not found" });

  await prisma.$transaction([
    prisma.chartOfAccount.deleteMany({ where: { parentId: id } }),
    prisma.chartOfAccount.delete({ where: { id } }),
  ]);

  await recordAudit({ userId: req.user!.sub, action: "FIN_COA_REMOVE", entityType: "ChartOfAccount", entityId: id, beforeData: account });
  res.status(204).send();
});
