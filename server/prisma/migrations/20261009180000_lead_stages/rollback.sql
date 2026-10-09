-- Manual rollback (Prisma has no down migrations; not run automatically).
-- Run only if this package is being backed out, then:
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261009180000_lead_stages';
-- Drops only the columns and enum this migration added; no existing column is touched, and the old
-- leads.status field (which the Dashboard reads and which the app keeps in step) is unchanged.
-- WARNING: this deletes every stage / lost reason set since the migration. To undo ONLY the old-lead
-- backfill and keep stages users set by hand, use `npx tsx scripts/backfill-lead-stages.ts --undo` instead.
ALTER TABLE "leads"
  DROP COLUMN IF EXISTS "stage",
  DROP COLUMN IF EXISTS "lost_reason",
  DROP COLUMN IF EXISTS "lost_note",
  DROP COLUMN IF EXISTS "stage_changed_at",
  DROP COLUMN IF EXISTS "stage_set_by";
DROP TYPE IF EXISTS "LeadStage";
