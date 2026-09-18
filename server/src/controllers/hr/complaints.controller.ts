import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { complaintCreateSchema, complaintUpdateSchema } from "../../validation/hr.schemas";

// Any authenticated user may submit — deliberately no employeeId or other
// identifying field is stored, and the audit entry below passes userId:null
// on purpose. The original design promise ("no name, employee ID or contact
// info is ever captured") only holds if the server keeps it too — logging
// who submitted this, even in the audit trail, would quietly break that
// promise while looking like an oversight rather than a decision.
export const createComplaint: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = complaintCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const complaint = await prisma.complaint.create({
    data: { category: d.category, dept: d.dept, text: d.text, status: "NEW" },
  });

  await recordAudit({
    userId: null,
    action: "HR_COMPLAINT_SUBMITTED",
    entityType: "Complaint",
    entityId: complaint.id,
    afterData: { category: d.category }, // no submitter identity, no free text
  });

  res.status(201).json({ id: complaint.id, submittedAt: complaint.submittedAt });
});

// HR/Admin only (mounted behind requireHRAdmin).
export const listComplaints: RequestHandler = asyncHandler(async (req, res) => {
  const complaints = await prisma.complaint.findMany({
    where: { status: req.query.status as any },
    orderBy: { submittedAt: "desc" },
  });
  res.json({ complaints });
});

export const updateComplaint: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = complaintUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const before = await prisma.complaint.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Complaint not found" });

  const complaint = await prisma.complaint.update({
    where: { id: req.params.id },
    data: { status: d.status, note: d.note },
  });

  await recordAudit({
    userId: req.user!.sub,
    action: "HR_COMPLAINT_UPDATE",
    entityType: "Complaint",
    entityId: complaint.id,
    beforeData: { status: before.status },
    afterData: { status: d.status },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
  });

  res.json({ complaint });
});
