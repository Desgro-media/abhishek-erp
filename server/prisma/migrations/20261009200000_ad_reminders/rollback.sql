-- Manual rollback (Prisma has no down migrations; not run automatically).
-- Run only if this feature is being backed out, then:
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261009200000_ad_reminders';
-- Drops only the one table this migration created. (Turning the reminders off needs no database change:
-- set AD_REMINDERS_ENABLED=false.)
DROP TABLE IF EXISTS "ad_reminder_runs";
