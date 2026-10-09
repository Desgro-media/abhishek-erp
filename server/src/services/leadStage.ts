import type { LeadStage, LeadStatus } from "@prisma/client";

// Pipeline stages a person can move a lead between by hand. WON is deliberately not here: a lead is only
// Won by actually converting it to a client (today, via quote -> invoice). LOST goes through its own
// endpoint because it needs a reason.
export const MOVABLE_STAGES = ["NEW", "CONTACTED", "MEETING", "PROPOSAL_SENT", "NEGOTIATION"] as const;

// Why a lead was lost. "Not recorded (migrated)" is reserved for the one-off backfill of leads that were
// already marked Lost before reasons existed; it can't be chosen from the app.
export const LOST_REASONS = ["Budget", "Went with a competitor", "No response", "Not a fit", "Other"] as const;
export const MIGRATED_LOST_REASON = "Not recorded (migrated)";

// The older coarse `leads.status` is still read by the Dashboard ("leads: new · contacted · qualified"),
// so every stage change keeps it coherent: reaching a meeting or later counts as Qualified.
export const STAGE_TO_STATUS: Record<LeadStage, LeadStatus> = {
  NEW: "NEW",
  CONTACTED: "CONTACTED",
  MEETING: "QUALIFIED",
  PROPOSAL_SENT: "QUALIFIED",
  NEGOTIATION: "QUALIFIED",
  WON: "CONVERTED",
  LOST: "LOST",
};

// ...and the reverse, for the older PATCH /leads/:id that still accepts `status` directly.
export const STATUS_TO_STAGE: Record<LeadStatus, LeadStage> = {
  NEW: "NEW",
  CONTACTED: "CONTACTED",
  QUALIFIED: "MEETING",
  CONVERTED: "WON",
  LOST: "LOST",
};

// What a lead's stage should be, derived from data that already exists. Used ONLY by the backfill of
// leads that predate stages (scripts/backfill-lead-stages.ts). First match wins:
//   1. converted to a client                         -> WON
//   2. status LOST                                   -> LOST, reason "Not recorded (migrated)"
//   3. nobody has claimed it (no owner)              -> NEW
//   4. owned, and a quote has been sent (and is not yet invoiced/converted: SENT or SUBMITTED_TO_FINANCE)
//                                                    -> PROPOSAL_SENT
//   5. owned, no sent quote                          -> CONTACTED
// This SQL is the single source of truth: the dry run counts with it and --apply updates with it.
export const CLASSIFY_SQL = `
  SELECT l.id,
    CASE
      WHEN l.converted_client_id IS NOT NULL OR l.status = 'CONVERTED' THEN 'WON'
      WHEN l.status = 'LOST' THEN 'LOST'
      WHEN l.lead_owner IS NULL THEN 'NEW'
      WHEN EXISTS (SELECT 1 FROM quotes q WHERE q.lead_id = l.id AND q.status IN ('SENT', 'SUBMITTED_TO_FINANCE')) THEN 'PROPOSAL_SENT'
      ELSE 'CONTACTED'
    END AS stage
  FROM leads l`;
