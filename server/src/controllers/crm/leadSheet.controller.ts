import { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { seesWholeSalesTeam } from "../../middleware/crmAccess";
import { recordAudit } from "../../services/audit.service";
import { extractSheetId, getLeadSheet, refreshTabs, syncLeadSheet, SheetAccessError, SERVICE_DEPARTMENTS, todayIst, SheetSource } from "../../services/leadSheet";

// Admin and the Sales Head set this up; it decides which leads reach the whole sales team.
const denied = (req: any) => !seesWholeSalesTeam(req.user?.roles);

// Tests swap the Google reader for a fake one.
let testSource: SheetSource | undefined;
export const __setLeadSheetSource = (s?: SheetSource) => { testSource = s; };

const saveSchema = z.object({
  sheetUrl: z.string().trim().min(1).optional(),
  autoSync: z.boolean().optional(),
  importFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  tabs: z.array(z.object({ gid: z.string(), service: z.enum(SERVICE_DEPARTMENTS as [string, ...string[]]).nullable() })).optional(),
});

export const getLeadSheetSettings: RequestHandler = asyncHandler(async (req, res) => {
  if (denied(req)) return res.status(403).json({ error: "Forbidden" });
  res.json({ ...(await getLeadSheet()), services: SERVICE_DEPARTMENTS });
});

export const saveLeadSheetSettings: RequestHandler = asyncHandler(async (req, res) => {
  if (denied(req)) return res.status(403).json({ error: "Forbidden" });
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const before = await prisma.leadSheetConfig.findUnique({ where: { id: 1 } });

  let sheetId = before?.sheetId ?? null;
  const newSheet = d.sheetUrl !== undefined;
  if (newSheet) {
    sheetId = extractSheetId(d.sheetUrl!);
    if (!sheetId) return res.status(400).json({ error: "That doesn't look like a Google Sheets link" });
  }
  if (newSheet && sheetId !== before?.sheetId) {
    try { await refreshTabs(sheetId!, testSource); }
    catch (err) { if (err instanceof SheetAccessError) return res.status(400).json({ error: err.message }); throw err; }
  }
  const importFrom = d.importFrom === undefined ? (before ? before.importFrom : new Date(`${todayIst()}T00:00:00Z`)) : d.importFrom ? new Date(`${d.importFrom}T00:00:00Z`) : null;
  await prisma.leadSheetConfig.upsert({
    where: { id: 1 },
    create: { id: 1, sheetId, autoSync: d.autoSync ?? false, importFrom },
    update: { sheetId, ...(d.autoSync !== undefined ? { autoSync: d.autoSync } : {}), importFrom },
  });
  for (const t of d.tabs ?? []) await prisma.leadSheetTab.updateMany({ where: { gid: t.gid }, data: { service: t.service } });
  await recordAudit({ userId: req.user!.sub, action: "LEAD_SHEET_SETTINGS", entityType: "LeadSheetConfig", entityId: "1", beforeData: before ? { sheetId: before.sheetId, autoSync: before.autoSync, importFrom: before.importFrom } : undefined, afterData: { sheetId, autoSync: d.autoSync, importFrom: d.importFrom, tabs: d.tabs }, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.json({ ...(await getLeadSheet()), services: SERVICE_DEPARTMENTS });
});

export const refreshLeadSheetTabs: RequestHandler = asyncHandler(async (req, res) => {
  if (denied(req)) return res.status(403).json({ error: "Forbidden" });
  const c = await prisma.leadSheetConfig.findUnique({ where: { id: 1 } });
  if (!c?.sheetId) return res.status(400).json({ error: "Add the sheet link first" });
  try { await refreshTabs(c.sheetId, testSource); }
  catch (err) { if (err instanceof SheetAccessError) return res.status(400).json({ error: err.message }); throw err; }
  res.json({ ...(await getLeadSheet()), services: SERVICE_DEPARTMENTS });
});

export const syncLeadSheetNow: RequestHandler = asyncHandler(async (req, res) => {
  if (denied(req)) return res.status(403).json({ error: "Forbidden" });
  const c = await prisma.leadSheetConfig.findUnique({ where: { id: 1 } });
  if (!c?.sheetId) return res.status(400).json({ error: "Add the sheet link first" });
  const summary = await syncLeadSheet({ source: testSource, actorUserId: req.user!.sub });
  if (!summary) return res.status(409).json({ error: "A sync is already running — try again in a moment" });
  res.json({ summary, ...(await getLeadSheet()), services: SERVICE_DEPARTMENTS });
});
