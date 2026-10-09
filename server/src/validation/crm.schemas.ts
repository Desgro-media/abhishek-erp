import { z } from "zod";
import { MOVABLE_STAGES, LOST_REASONS } from "../services/leadStage";

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
// Public get-started form. source/owner/status are NOT accepted from the client — the controller
// forces source "Meta" and an unassigned owner. `website` is the honeypot (humans never see it).
export const SERVICE_INTERESTED_OPTIONS = ["Marketing Consultation", "Web Development", "Production", "Graphic Design", "Performance Marketing"] as const;
export const publicLeadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(5, "Enter your phone number").max(30).regex(/^[0-9+()\-\s]+$/, "Enter a valid phone number"),
  serviceInterested: z.enum(SERVICE_INTERESTED_OPTIONS),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  website: z.string().optional(),
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
  // No title: it's generated server-side (QT/DDMMYY/serial) and any client-sent value is dropped.
}).refine((d) => !!d.clientId !== !!d.leadId, { message: "Exactly one of clientId or leadId is required" });
export const quoteUpdateSchema = z.object({
  // Explicit null (not just omission) clears the other party field when
  // reassigning a quote between a client and a lead — see the controller.
  clientId: z.string().uuid().nullable().optional(),
  leadId: z.string().uuid().nullable().optional(),
  items: z.array(quoteItemSchema).min(1).optional(),
}).refine((d) => d.clientId === undefined || d.leadId === undefined || !(d.clientId && d.leadId), { message: "A quote can't have both a client and a lead" });

export const quotePendingPaymentSchema = z.object({
  amount: z.number().positive(),
  paymentDate: dateStr,
  note: z.string().optional(),
});
export const quoteApprovalSchema = z.object({
  accountId: z.string().uuid(),
  date: dateStr, // date received — set/confirmed by Finance, see invoicePendingApprovalSchema
  commissionRate: z.number().min(0).max(100).optional(),
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

// ---- Client collaboration data ----
// Optional text: trimmed, and a blank string means "not set" (stored as null).
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
// Asset links are rendered as <a href>, so only http(s) is accepted — never javascript: or data: URLs.
const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => /^https?:\/\/[^\s]+$/i.test(v), "Must be a http(s) link");

export const adAccessSchema = z.object({
  platform: z.string().trim().min(1).max(100),
  accountId: optText(100),
  accessEmail: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === "" || z.string().email().safeParse(v).success, "Invalid email")
    .optional()
    .transform((v) => (v ? v : null)),
  status: z.enum(["GRANTED", "PENDING", "REVOKED"]),
  notes: optText(1000),
});
export const campaignBriefSchema = z.object({
  objective: optText(500),
  audience: optText(500),
  budget: optText(200),
});
export const brandAssetSchema = z.object({
  name: z.string().trim().min(1).max(200),
  link: z
    .union([httpUrl, z.literal("")])
    .optional()
    .transform((v) => (v ? v : null)),
  notes: optText(500),
});
export const clientMeetingSchema = z.object({
  date: dateStr,
  attendees: z.string().trim().min(1).max(500),
  notes: z.string().trim().min(1).max(5000),
});

// One day of DesGro's own Meta ad numbers. Money is capped well above any real daily spend so a
// stray extra zero is caught rather than stored. The "no future dates" rule needs today's date, so
// it lives in the controller.
export const ownAdMetricSchema = z.object({
  date: dateStr,
  spend: z.number().nonnegative().max(100_000_000),
  revenue: z.number().nonnegative().max(1_000_000_000),
  leads: z.number().int().nonnegative().max(1_000_000),
  purchases: z.number().int().nonnegative().max(1_000_000),
});

// A Performance Marketing client's daily ad numbers have exactly the shape of DesGro's own.
export const clientAdMetricSchema = ownAdMetricSchema;

// Moving a lead along the pipeline. WON isn't accepted (only a real conversion makes a lead Won) and LOST
// has its own endpoint because it needs a reason.
export const leadStageSchema = z.object({ stage: z.enum(MOVABLE_STAGES) });
export const leadLostSchema = z.object({
  reason: z.enum(LOST_REASONS),
  note: z.string().trim().max(500).optional().transform((v) => (v ? v : null)),
});

// ---- Lead payments, convert, threshold ----
export const leadPaymentSchema = z.object({
  amount: z.number().positive().max(100_000_000).refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "At most 2 decimal places"),
  paymentDate: dateStr,
  mode: z.enum(["BANK_TRANSFER", "UPI", "CASH", "CHEQUE"]),
  note: z.string().trim().max(500).optional().transform((v) => (v ? v : null)),
});
export const leadConvertSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  industry: z.string().trim().max(100).optional(),
  city: z.string().trim().max(100).optional(),
  services: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  billingType: z.enum(["PREPAID", "POSTPAID"]).optional(),
  onboardedAt: dateStr.optional(),
});
export const leadSettingsSchema = z.object({ conversionThreshold: z.number().positive().max(100_000_000) });
