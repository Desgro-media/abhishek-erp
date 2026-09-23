import { z } from "zod";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const clientCreateSchema = z.object({
  name: z.string().min(1),
  industry: z.string().optional(),
  city: z.string().optional(),
  services: z.array(z.string()).default([]),
  accountManager: z.string().optional(),
  salesPerson: z.string().optional(),
  billingType: z.enum(["PREPAID", "POSTPAID"]).default("PREPAID"),
});
export const clientUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  industry: z.string().optional(),
  city: z.string().optional(),
  services: z.array(z.string()).optional(),
  status: z.enum(["ACTIVE", "PAUSED", "CHURNED"]).optional(),
  accountManager: z.string().optional(),
  salesPerson: z.string().optional(),
  billingType: z.enum(["PREPAID", "POSTPAID"]).optional(),
});

export const leadCreateSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  source: z.string().min(1),
  serviceInterested: z.string().min(1),
  leadOwner: z.string().optional(),
});
export const leadUpdateSchema = leadCreateSchema.partial().extend({
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST"]).optional(),
  // Explicit null (not just omission) puts a lead back in the Open queue.
  leadOwner: z.string().nullable().optional(),
});

export const quoteItemSchema = z.object({ dept: z.string().min(1), amount: z.number().positive() });
export const quoteCreateSchema = z.object({
  clientId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  items: z.array(quoteItemSchema).min(1),
  title: z.string().min(1),
}).refine((d) => !!d.clientId !== !!d.leadId, { message: "Exactly one of clientId or leadId is required" });
export const quoteUpdateSchema = z.object({
  // Explicit null (not just omission) clears the other party field when
  // reassigning a quote between a client and a lead — see the controller.
  clientId: z.string().uuid().nullable().optional(),
  leadId: z.string().uuid().nullable().optional(),
  items: z.array(quoteItemSchema).min(1).optional(),
  title: z.string().min(1).optional(),
}).refine((d) => d.clientId === undefined || d.leadId === undefined || !(d.clientId && d.leadId), { message: "A quote can't have both a client and a lead" });

export const quotePendingPaymentSchema = z.object({
  amount: z.number().positive(),
  paymentDate: dateStr,
  note: z.string().optional(),
});
export const quoteApprovalSchema = z.object({
  accountId: z.string().uuid(),
  date: dateStr.optional(),
  invoiceNo: z.string().optional(), // required only when this approval creates the first invoice
});
export const quoteConvertSchema = z.object({
  issuedAt: dateStr,
  dueAt: dateStr,
});

export const taskCreateSchema = z.object({
  title: z.string().min(1),
  assignedTo: z.string().optional(),
  dueAt: dateStr,
});
export const taskUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  assignedTo: z.string().optional(),
  dueAt: dateStr.optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "REVIEW", "DONE"]).optional(),
  revisions: z.number().int().min(0).optional(),
});

export const contentItemCreateSchema = z.object({
  title: z.string().min(1),
  type: z.string().min(1),
  platforms: z.array(z.string()).default([]),
  assignee: z.string().optional(),
  stage: z.enum(["IDEA", "SCRIPTING", "PRODUCTION", "REVIEW", "SCHEDULED", "PUBLISHED"]).default("IDEA"),
  dueAt: dateStr,
  notes: z.string().optional(),
});
export const contentItemUpdateSchema = contentItemCreateSchema.partial();

export const metaCampaignCreateSchema = z.object({
  name: z.string().min(1),
  objective: z.string().min(1),
  platform: z.string().min(1),
  status: z.enum(["ACTIVE", "PAUSED"]).default("ACTIVE"),
  spend: z.number().nonnegative(),
  impressions: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  leads: z.number().int().nonnegative(),
  startAt: dateStr,
});
export const metaCampaignUpdateSchema = metaCampaignCreateSchema.partial();
