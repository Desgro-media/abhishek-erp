import { RequestHandler } from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { prisma } from "../db/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { recordAudit } from "../services/audit.service";
import { candidateCreateSchema } from "../validation/hr.schemas";
import { RESUMES_DIR, MAX_RESUME_BYTES } from "../config/uploads";

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

// Resumes land on local disk (server/uploads/resumes, see config/uploads.ts), named by a fresh
// uuid — never the applicant's own filename, which a hostile upload could otherwise use to path-
// traverse or collide. mimetype is what the browser/client reports, not real content sniffing —
// good enough to keep non-PDFs out in the ordinary case, not a defense against a deliberately
// mislabeled file; nothing here ever executes the upload, only stores and later streams it back
// to HR, which keeps that gap low-stakes.
const resumeUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, RESUMES_DIR),
    filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.pdf`),
  }),
  limits: { fileSize: MAX_RESUME_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") return cb(new Error("Resumes must be a PDF"));
    cb(null, true);
  },
}).single("resume");

// Wraps resumeUpload so a rejection (wrong type, over 5MB) comes back as a normal 400 with a
// message careers.js can show, instead of falling through to errorHandler's generic 500 —
// multer reports these as an error passed to its own callback, not a thrown/rejected promise
// asyncHandler could catch.
export const handleResumeUpload: RequestHandler = (req, res, next) => {
  resumeUpload(req, res, (err) => {
    if (!err) return next();
    const message = err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE" ? "Resume must be 5MB or smaller" : err.message || "Couldn't process the resume file";
    res.status(400).json({ error: message });
  });
};

export const submitApplicationPublic: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = candidateCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  }
  const d = parsed.data;
  if (!d.phone && !d.email) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: "Add a phone number or an email so we can reach you" });
  }

  const position = await prisma.openPosition.findUnique({ where: { id: d.positionId } });
  if (!position || position.status !== "OPEN" || position.archived) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(404).json({ error: "That position isn't open anymore — refresh the page to see current openings" });
  }

  const candidate = await prisma.candidate.create({
    data: {
      positionId: d.positionId,
      name: d.name,
      phone: d.phone,
      email: d.email,
      stage: "APPLIED",
      resumeFilename: req.file ? path.basename(req.file.path) : undefined,
      resumeOriginalName: req.file ? req.file.originalname : undefined,
    },
  });

  // No req.user here (unauthenticated route) — recordAudit's userId is optional for exactly
  // this case; ipAddress/userAgent are what let HR trace a spammy submission back later.
  await recordAudit({
    action: "PUBLIC_CANDIDATE_APPLY",
    entityType: "Candidate",
    entityId: candidate.id,
    afterData: { positionId: d.positionId, name: d.name, hasResume: !!req.file },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
  });

  res.status(201).json({ ok: true });
});
