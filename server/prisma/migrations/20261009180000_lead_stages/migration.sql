-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('NEW', 'CONTACTED', 'MEETING', 'PROPOSAL_SENT', 'NEGOTIATION', 'WON', 'LOST');

-- AlterTable: additive only. Every existing lead keeps its data and starts at NEW with nothing set;
-- the separate, explicit backfill (scripts/backfill-lead-stages.ts) assigns real stages afterwards.
ALTER TABLE "leads"
  ADD COLUMN "stage" "LeadStage" NOT NULL DEFAULT 'NEW',
  ADD COLUMN "lost_reason" TEXT,
  ADD COLUMN "lost_note" TEXT,
  ADD COLUMN "stage_changed_at" TIMESTAMP(3),
  ADD COLUMN "stage_set_by" TEXT;
