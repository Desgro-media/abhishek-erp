import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { seesWholeSalesTeam } from "../../middleware/crmAccess";
import { recordAudit } from "../../services/audit.service";
import { leadCreateSchema, leadUpdateSchema, leadStageSchema, leadLostSchema, leadPaymentSchema, leadConvertSchema, leadSettingsSchema } from "../../validation/crm.schemas";
import { STAGE_TO_STATUS, STATUS_TO_STAGE } from "../../services/leadStage";
import { assertReceivedDate } from "../../services/finance/pendingPayment";
import { convertLeadToClient, autoConvertIfDue, lockLead, getLeadConversionThreshold, LEAD_PAYMENT_MODE_LABEL } from "../../services/leadPayments";
import { nextSequentialCode } from "../../utils/sequentialCode";

async function nextLeadCode(): Promise<string> {
  return nextSequentialCode("MLD-", (await prisma.lead.findMany({ select: { leadCode: true } })).map((l) => l.leadCode));
}

// A plain Sales caller sees their own claimed leads plus the shared Open
// (unclaimed) queue they can claim from — same "narrow self-service slice"
// listClients/listQuotes already give a non-admin caller; ADMIN and the Sales Head see
// everyone's, same as those.
export const listLeads: RequestHandler = asyncHandler(async (req, res) => {
  const admin = seesWholeSalesTeam(req.user?.roles);
  const leads = await prisma.lead.findMany({
    where: { status: req.query.status as any, ...(admin ? {} : { OR: [{ leadOwner: req.user!.name }, { leadOwner: null }] }) },
    orderBy: { createdAt: "desc" },
  });
  // What each lead has paid so far (recorded advances) — drives the "paid" figure and the auto-convert hint.
  const paid = await prisma.leadPayment.groupBy({ by: ["leadId"], where: { leadId: { in: leads.map((l) => l.id) } }, _sum: { amount: true } });
  const paidBy = new Map(paid.map((p) => [p.leadId, Number(p._sum.amount ?? 0)]));
  res.json({ leads: leads.map((l) => ({ ...l, paidTotal: paidBy.get(l.id) ?? 0 })) });
});

export const createLead: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = leadCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const lead = await prisma.lead.create({
    data: { leadCode: await nextLeadCode(), name: d.name, phone: d.phone, email: d.email, source: d.source, serviceInterested: d.serviceInterested, leadOwner: d.leadOwner },
  });

  await recordAudit({ userId: req.user!.sub, action: "CRM_LEAD_CREATE", entityType: "Lead", entityId: lead.id, afterData: d });
  res.status(201).json({ lead });
});

export const updateLead: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = leadUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });

  const existing = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Lead not found" });
  // A plain Sales rep works their own leads plus the shared Open queue (to claim) — never another
  // rep's. Admin / Sales Head edit anyone's.
  if (!seesWholeSalesTeam(req.user?.roles) && existing.leadOwner && existing.leadOwner !== req.user!.name) {
    return res.status(403).json({ error: "Forbidden — not your lead" });
  }
  // The older PATCH can still set the coarse `status` directly; keep the pipeline stage in step with it so
  // the two never disagree. (The Leads page itself doesn't send `status` — it uses the stage endpoints.)
  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.status) {
    Object.assign(data, { stage: STATUS_TO_STAGE[parsed.data.status], stageChangedAt: new Date(), stageSetBy: req.user!.name });
    if (parsed.data.status !== "LOST") Object.assign(data, { lostReason: null, lostNote: null });
  }
  const lead = await prisma.lead.update({ where: { id: existing.id }, data });

  await recordAudit({ userId: req.user!.sub, action: "CRM_LEAD_UPDATE", entityType: "Lead", entityId: lead.id, afterData: parsed.data });
  res.json({ lead });
});

// Admin / Sales Head can delete any lead; a plain Sales rep only their own claimed ones (never the shared
// Open queue, which isn't theirs). Refused once a quote exists against the lead — that quote would be left
// pointing at nobody (and a converted lead always has one); delete or mark-lost those first.
export const deleteLead: RequestHandler = asyncHandler(async (req, res) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id }, include: { _count: { select: { quotes: true } } } });
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  if (!seesWholeSalesTeam(req.user?.roles) && lead.leadOwner !== req.user!.name) {
    return res.status(403).json({ error: "Forbidden — you can only delete your own leads" });
  }
  const n = lead._count.quotes;
  if (n > 0) {
    return res.status(409).json({ error: `Can't delete ${lead.name} — ${n} quote${n === 1 ? "" : "s"} ${n === 1 ? "is" : "are"} raised against them. Delete those quotes first, or mark the lead Lost instead.` });
  }

  // A lead that holds a payment record is a money trail — never silently delete it (the DB refuses too).
  const paidCount = await prisma.leadPayment.count({ where: { leadId: lead.id } });
  if (paidCount > 0) {
    return res.status(409).json({ error: `Can't delete ${lead.name} — ${paidCount} payment${paidCount === 1 ? " is" : "s are"} recorded against them. Mark the lead Lost instead.` });
  }

  await prisma.lead.delete({ where: { id: lead.id } });

  await recordAudit({ userId: req.user!.sub, action: "CRM_LEAD_DELETE", entityType: "Lead", entityId: lead.id, beforeData: { leadCode: lead.leadCode, name: lead.name, leadOwner: lead.leadOwner } });
  res.status(204).send();
});

// ---- Pipeline stage ----
// Same ownership rule as everywhere else on a lead (a plain rep only works their own), plus: an unclaimed lead
// in the shared Open queue can't be moved by a rep — they claim it first. Admin / Sales Head move anyone's.
async function loadWorkableLead(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return null; }
  if (!seesWholeSalesTeam(req.user?.roles)) {
    if (!lead.leadOwner) { res.status(403).json({ error: "Claim this lead first" }); return null; }
    if (lead.leadOwner !== req.user!.name) { res.status(403).json({ error: "Forbidden — not your lead" }); return null; }
  }
  // A converted lead is Won and stays Won — it's a client now; its history lives on the client.
  if (lead.convertedClientId || lead.stage === "WON") { res.status(409).json({ error: "This lead has already been converted to a client" }); return null; }
  return lead;
}

export const setLeadStage: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = leadStageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const lead = await loadWorkableLead(req, res);
  if (!lead) return;
  const { stage } = parsed.data;
  if (lead.stage === stage) return res.json({ lead });

  // Moving back out of Lost reopens it, so the old lost reason goes.
  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: { stage, status: STAGE_TO_STATUS[stage], lostReason: null, lostNote: null, stageChangedAt: new Date(), stageSetBy: req.user!.name },
  });
  await recordAudit({
    userId: req.user!.sub, action: "CRM_LEAD_STAGE", entityType: "Lead", entityId: lead.id,
    beforeData: { stage: lead.stage, lostReason: lead.lostReason }, afterData: { stage: updated.stage },
  });
  res.json({ lead: updated });
});

export const markLeadLost: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = leadLostSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const lead = await loadWorkableLead(req, res);
  if (!lead) return;
  if (lead.stage === "LOST") return res.status(409).json({ error: "Already marked lost — move it back into the pipeline first to change the reason" });

  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: { stage: "LOST", status: STAGE_TO_STATUS.LOST, lostReason: parsed.data.reason, lostNote: parsed.data.note, stageChangedAt: new Date(), stageSetBy: req.user!.name },
  });
  await recordAudit({
    userId: req.user!.sub, action: "CRM_LEAD_LOST", entityType: "Lead", entityId: lead.id,
    beforeData: { stage: lead.stage }, afterData: { stage: "LOST", reason: parsed.data.reason, note: parsed.data.note },
  });
  res.json({ lead: updated });
});

// ---- Advance payments, convert, threshold ----

const modeOf = (m: string) => LEAD_PAYMENT_MODE_LABEL[m as keyof typeof LEAD_PAYMENT_MODE_LABEL] ?? m;
const serializePayment = (p: any) => ({
  id: p.id, amount: Number(p.amount), paymentDate: p.paymentDate.toISOString().slice(0, 10), mode: p.mode, modeLabel: modeOf(p.mode), note: p.note,
  recordedBy: p.recordedBy, salesPerson: p.salesPerson, createdAt: p.createdAt,
  // Where it is on its way to the books: waiting for an invoice, sitting in Finance's queue on one, or approved.
  status: !p.invoicePendingPayment ? "AWAITING_INVOICE" : p.invoicePendingPayment.approved ? "APPROVED" : "ON_INVOICE_PENDING",
  invoiceNo: p.invoicePendingPayment?.invoice?.invoiceNo ?? null,
});
const PAYMENT_INCLUDE = { invoicePendingPayment: { include: { invoice: { select: { invoiceNo: true } } } } } as const;

export const listLeadPayments: RequestHandler = asyncHandler(async (req, res) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  if (!seesWholeSalesTeam(req.user?.roles) && lead.leadOwner !== req.user!.name) return res.status(403).json({ error: "Forbidden — not your lead" });
  const rows = await prisma.leadPayment.findMany({ where: { leadId: lead.id }, orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }], include: PAYMENT_INCLUDE });
  res.json({ payments: rows.map(serializePayment), threshold: await getLeadConversionThreshold() });
});

// Records money a lead paid BEFORE becoming a client. It moves no money — no bank entry, revenue or
// commission; it waits for an invoice and then goes through Finance's normal approval (services/leadPayments.ts).
// If it brings the lead's total to the threshold, the lead becomes a client in the same transaction.
export const recordLeadPayment: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = leadPaymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const lead = await loadWorkableLead(req, res);
  if (!lead) return;
  if (!lead.leadOwner) return res.status(400).json({ error: "Assign this lead to a sales person first — the owner earns commission on the payment" });
  if (lead.stage === "LOST") return res.status(409).json({ error: "Move this lead back into the pipeline before recording a payment" });
  const date = new Date(d.paymentDate);
  assertReceivedDate(date);

  const result = await prisma.$transaction(async (tx) => {
    await lockLead(tx, lead.id);
    const fresh = await tx.lead.findUniqueOrThrow({ where: { id: lead.id } });
    if (fresh.convertedClientId) throw Object.assign(new Error("This lead has already been converted to a client — record the payment against their invoice instead"), { status: 409 });
    if (!fresh.leadOwner) throw Object.assign(new Error("Assign this lead to a sales person first"), { status: 400 });
    const payment = await tx.leadPayment.create({
      data: { leadId: lead.id, amount: d.amount, paymentDate: date, mode: d.mode, note: d.note, recordedBy: req.user!.name, salesPerson: fresh.leadOwner },
      include: PAYMENT_INCLUDE,
    });
    await recordAudit({ userId: req.user!.sub, action: "CRM_LEAD_PAYMENT_RECORDED", entityType: "Lead", entityId: lead.id, afterData: { amount: d.amount, paymentDate: d.paymentDate, mode: d.mode, note: d.note, salesPerson: fresh.leadOwner } }, tx);
    const converted = await autoConvertIfDue(tx, lead.id, req.user!.sub);
    const paidTotal = Number((await tx.leadPayment.aggregate({ where: { leadId: lead.id }, _sum: { amount: true } }))._sum.amount ?? 0);
    return { payment, converted, paidTotal };
  });
  res.status(201).json({ payment: serializePayment(result.payment), converted: result.converted, paidTotal: result.paidTotal });
});

// Only a payment that hasn't been carried onto an invoice can be removed (a duplicate or a mistake). Once it's
// a pending entry in Finance's queue it's theirs: removing THAT entry (Payment Receipts) releases it back here.
export const deleteLeadPayment: RequestHandler = asyncHandler(async (req, res) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  if (!seesWholeSalesTeam(req.user?.roles) && lead.leadOwner !== req.user!.name) return res.status(403).json({ error: "Forbidden — not your lead" });
  const payment = await prisma.leadPayment.findFirst({ where: { id: req.params.paymentId, leadId: lead.id }, include: PAYMENT_INCLUDE });
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  if (payment.invoicePendingPayment) {
    return res.status(409).json({ error: `This advance is already on invoice ${payment.invoicePendingPayment.invoice.invoiceNo} — remove the pending entry in Payment Receipts first, which releases it.` });
  }
  const removed = await prisma.leadPayment.deleteMany({ where: { id: payment.id, invoicePendingPaymentId: null } });
  if (removed.count !== 1) return res.status(409).json({ error: "This advance was just attached to an invoice" });
  await recordAudit({ userId: req.user!.sub, action: "CRM_LEAD_PAYMENT_DELETED", entityType: "Lead", entityId: lead.id, beforeData: serializePayment(payment) });
  res.status(204).send();
});

export const convertLead: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = leadConvertSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const lead = await loadWorkableLead(req, res);
  if (!lead) return;
  const onboardedAt = d.onboardedAt ? new Date(`${d.onboardedAt}T00:00:00.000Z`) : new Date();
  if (Number.isNaN(onboardedAt.getTime())) return res.status(400).json({ error: "Invalid date" });
  if (onboardedAt.getTime() > Date.now() + 24 * 3600 * 1000) return res.status(400).json({ error: "Onboarding date can't be in the future" });

  const result = await prisma.$transaction(async (tx) => {
    await lockLead(tx, lead.id);
    const fresh = await tx.lead.findUniqueOrThrow({ where: { id: lead.id } });
    if (fresh.convertedClientId) throw Object.assign(new Error("This lead has already been converted to a client"), { status: 409 });
    const res2 = await convertLeadToClient(tx, fresh, { ...d, onboardedAt, via: `Converted by ${req.user!.name}` });
    await recordAudit({ userId: req.user!.sub, action: "CRM_LEAD_CONVERTED", entityType: "Lead", entityId: lead.id, afterData: { clientId: res2.clientId, createdClient: res2.created, ...d } }, tx);
    return res2;
  });
  res.status(201).json(result);
});

export const getLeadSettings: RequestHandler = asyncHandler(async (_req, res) => {
  res.json({ conversionThreshold: await getLeadConversionThreshold() });
});

// Admin only. Lowering it converts any lead whose recorded payments already reach the new figure, so a
// paying lead never sits in the pipeline as "just a lead" — the response lists exactly which ones.
export const updateLeadSettings: RequestHandler = asyncHandler(async (req, res) => {
  if (!(req.user?.roles ?? []).includes("ADMIN")) return res.status(403).json({ error: "Forbidden — only Admin can change the conversion threshold" });
  const parsed = leadSettingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const { conversionThreshold } = parsed.data;

  const out = await prisma.$transaction(async (tx) => {
    const before = await getLeadConversionThreshold(tx);
    await tx.salesPolicy.upsert({ where: { id: 1 }, create: { id: 1, leadConversionThreshold: conversionThreshold }, update: { leadConversionThreshold: conversionThreshold } });
    await recordAudit({ userId: req.user!.sub, action: "CRM_LEAD_THRESHOLD_UPDATE", entityType: "SalesPolicy", entityId: "1", beforeData: { conversionThreshold: before }, afterData: { conversionThreshold }, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null }, tx);
    const sums = await tx.leadPayment.groupBy({ by: ["leadId"], where: { lead: { convertedClientId: null } }, _sum: { amount: true } });
    const converted: { leadId: string; clientId: string }[] = [];
    for (const s of sums) {
      if (Math.round(Number(s._sum.amount ?? 0) * 100) < Math.round(conversionThreshold * 100)) continue;
      await lockLead(tx, s.leadId);
      const r = await autoConvertIfDue(tx, s.leadId, req.user!.sub);
      if (r) converted.push({ leadId: s.leadId, clientId: r.clientId });
    }
    return { conversionThreshold, converted };
  });
  res.json(out);
});

// What a client's lead(s) paid before they became a client, and where each advance is now. Same visibility as
// the client page itself (Admin / Sales Head / Clients role see all; a plain rep only their own clients).
export const getClientLeadAdvances: RequestHandler = asyncHandler(async (req, res) => {
  const client = await prisma.client.findUnique({ where: { id: req.params.id } });
  if (!client) return res.status(404).json({ error: "Client not found" });
  const roles = req.user?.roles ?? [];
  const seesAll = seesWholeSalesTeam(roles) || roles.includes("CLIENTS");
  if (!seesAll && client.salesPerson !== req.user!.name) return res.status(403).json({ error: "Forbidden — not your client" });
  const rows = await prisma.leadPayment.findMany({ where: { lead: { convertedClientId: client.id } }, orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }], include: PAYMENT_INCLUDE });
  const payments = rows.map(serializePayment);
  const sum = (st: string) => payments.filter((p) => p.status === st).reduce((a, p) => a + p.amount, 0);
  res.json({ payments, totals: { awaitingInvoice: sum("AWAITING_INVOICE"), onInvoicePending: sum("ON_INVOICE_PENDING"), approved: sum("APPROVED") } });
});
