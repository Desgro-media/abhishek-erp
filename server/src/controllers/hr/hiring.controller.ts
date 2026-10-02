import { RequestHandler } from "express";
import path from "node:path";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { nextSequentialCode } from "../../utils/sequentialCode";
import { RESUMES_DIR } from "../../config/uploads";
import { buildOfferLetterPdf } from "../../services/hr/offerLetter";
import {
  positionCreateSchema,
  positionUpdateSchema,
  candidateCreateSchema,
  candidateUpdateSchema,
  offerLetterSchema,
} from "../../validation/hr.schemas";
import { sendMail, sendMailNow, detailsHtml, HR_MAIL } from "../../services/mail.service";
import { hiringEmail } from "../../services/hr/hiringEmails";

// Everything in this file is HR/Admin only (mounted behind requireHRAdmin).

async function nextPositionCode(): Promise<string> {
  return nextSequentialCode("POS-", (await prisma.openPosition.findMany({ select: { positionCode: true } })).map((p) => p.positionCode));
}

// Returns both active and archived positions/candidates in one shot — the
// client (loadHiring()) fetches this once and splits active vs. archived
// itself, the same way it already does for status/stage.
export const listPositions: RequestHandler = asyncHandler(async (req, res) => {
  const positions = await prisma.openPosition.findMany({
    where: { status: req.query.status as any },
    include: { candidates: true },
    orderBy: { postedDate: "desc" },
  });
  res.json({ positions });
});

export const createPosition: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = positionCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const position = await prisma.openPosition.create({
    data: { positionCode: await nextPositionCode(), role: d.role, dept: d.dept, openings: d.openings, status: "OPEN" },
  });

  await recordAudit({ userId: req.user!.sub, action: "HR_POSITION_CREATE", entityType: "OpenPosition", entityId: position.id, afterData: d });
  res.status(201).json({ position });
});

export const updatePosition: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = positionUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });

  const position = await prisma.openPosition.update({ where: { id: req.params.id }, data: parsed.data }).catch(() => null);
  if (!position) return res.status(404).json({ error: "Position not found" });

  await recordAudit({ userId: req.user!.sub, action: "HR_POSITION_UPDATE", entityType: "OpenPosition", entityId: position.id, afterData: parsed.data });
  res.json({ position });
});

export const createCandidate: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = candidateCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const position = await prisma.openPosition.findUnique({ where: { id: d.positionId } });
  if (!position) return res.status(404).json({ error: "Position not found" });

  const candidate = await prisma.candidate.create({
    data: { positionId: d.positionId, name: d.name, phone: d.phone, email: d.email, stage: "APPLIED" },
  });

  await recordAudit({ userId: req.user!.sub, action: "HR_CANDIDATE_CREATE", entityType: "Candidate", entityId: candidate.id, afterData: d });
  if (d.email) sendMail("hr", { to: d.email, cc: HR_MAIL(), ...hiringEmail("APPLIED", { name: d.name, role: position.role, candidateId: candidate.id }) });
  sendMail("hr", { to: HR_MAIL(), subject: `New candidate: ${d.name}`, html: detailsHtml("A candidate was added.", { Name: d.name, Position: position.role, Email: d.email, Phone: d.phone }) });
  res.status(201).json({ candidate });
});

export const updateCandidate: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = candidateUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });

  const before = await prisma.candidate.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Candidate not found" });

  const candidate = await prisma.candidate.update({ where: { id: req.params.id }, data: parsed.data });

  await recordAudit({
    userId: req.user!.sub,
    action: "HR_CANDIDATE_UPDATE",
    entityType: "Candidate",
    entityId: candidate.id,
    beforeData: { stage: before.stage },
    afterData: parsed.data,
  });

  // APPLIED/SHORTLISTED/INTERVIEW/HIRED/REJECTED each send a templated email (see hiringEmails.ts). OFFER sends
  // nothing here — the offer-letter email (sendOfferLetter) is the one the candidate gets at that stage.
  if (candidate.email && before.stage !== candidate.stage && candidate.stage !== "OFFER") {
    const position = await prisma.openPosition.findUnique({ where: { id: candidate.positionId }, select: { role: true } });
    sendMail("hr", { to: candidate.email, cc: HR_MAIL(), ...hiringEmail(candidate.stage, { name: candidate.name, role: position?.role, candidateId: candidate.id }) });
  }
  res.json({ candidate });
});

// HR/Admin only (same requireHRAdmin gate as everything else in this file) — the file itself
// lives outside /public specifically so it's never reachable except through this authenticated
// route. path.basename() on the stored filename (already just a uuid + ".pdf", never the
// applicant's own name — see public.controller.ts) is belt-and-braces against ever resolving
// outside RESUMES_DIR, even though nothing user-supplied reaches this path today.
export const downloadCandidateResume: RequestHandler = asyncHandler(async (req, res) => {
  const candidate = await prisma.candidate.findUnique({ where: { id: req.params.id } });
  if (!candidate || !candidate.resumeFilename) return res.status(404).json({ error: "No resume on file for this candidate" });

  res.download(path.join(RESUMES_DIR, path.basename(candidate.resumeFilename)), candidate.resumeOriginalName || "resume.pdf", (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "Resume file is missing" });
  });
});

// Renders the offer letter as a PDF for download (works for manual entry too — no candidate needed).
export const offerLetterPdf: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = offerLetterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const pdf = await buildOfferLetterPdf(parsed.data);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="offer-letter.pdf"');
  res.send(pdf);
});

// Emails the PDF to the candidate's address from the HR mailbox, HR copied.
export const sendOfferLetter: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = offerLetterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const candidate = await prisma.candidate.findUnique({ where: { id: req.params.id } });
  if (!candidate) return res.status(404).json({ error: "Candidate not found" });
  if (!candidate.email) return res.status(400).json({ error: "This candidate has no email address on file" });

  const d = parsed.data;
  const pdf = await buildOfferLetterPdf(d);
  try {
    await sendMailNow("hr", {
      to: candidate.email,
      cc: HR_MAIL(),
      ...hiringEmail("OFFER", { name: d.name, role: d.role, candidateId: candidate.id }),
      attachments: [{ filename: `Offer letter - ${d.name}.pdf`, content: pdf, contentType: "application/pdf" }],
    });
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : "Couldn't send the email" });
  }

  await recordAudit({ userId: req.user!.sub, action: "HR_OFFER_LETTER_SEND", entityType: "Candidate", entityId: candidate.id, afterData: { to: candidate.email, role: d.role } });
  res.json({ sent: true, to: candidate.email });
});
