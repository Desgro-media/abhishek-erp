import { RequestHandler } from "express";
import { prisma } from "../db/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { recordAudit } from "../services/audit.service";
import { candidateCreateSchema } from "../validation/hr.schemas";

// The receiving end of public/careers.html and the "Get application link" share link on
// Hiring — genuinely unauthenticated (mounted with no `authenticate` in public.routes.ts),
// unlike every other controller in this codebase. That's deliberate: anyone on the internet
// needs to reach these. Keep that boundary narrow — every read here is a non-sensitive slice
// (role/dept/openings only, never salary or anything internal) and every write goes through
// the same candidateCreateSchema HR's own form uses, plus a rate limiter on the route itself.

export const listOpenPositionsPublic: RequestHandler = asyncHandler(async (_req, res) => {
  const positions = await prisma.openPosition.findMany({
    where: { status: "OPEN", archived: false },
    select: { id: true, role: true, dept: true, openings: true },
    orderBy: { postedDate: "desc" },
  });
  res.json({ positions });
});

export const submitApplicationPublic: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = candidateCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  if (!d.phone && !d.email) return res.status(400).json({ error: "Add a phone number or an email so we can reach you" });

  const position = await prisma.openPosition.findUnique({ where: { id: d.positionId } });
  if (!position || position.status !== "OPEN" || position.archived) {
    return res.status(404).json({ error: "That position isn't open anymore — refresh the page to see current openings" });
  }

  const candidate = await prisma.candidate.create({
    data: { positionId: d.positionId, name: d.name, phone: d.phone, email: d.email, stage: "APPLIED" },
  });

  // No req.user here (unauthenticated route) — recordAudit's userId is optional for exactly
  // this case; ipAddress/userAgent are what let HR trace a spammy submission back later.
  await recordAudit({
    action: "PUBLIC_CANDIDATE_APPLY",
    entityType: "Candidate",
    entityId: candidate.id,
    afterData: { positionId: d.positionId, name: d.name },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
  });

  res.status(201).json({ ok: true });
});
