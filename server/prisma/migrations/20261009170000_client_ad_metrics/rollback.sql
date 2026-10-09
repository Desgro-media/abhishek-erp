-- Manual rollback (Prisma has no down migrations; not run automatically).
-- Run only if this package is being backed out, then:
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261009170000_client_ad_metrics';
-- Drops only the table this migration created; no existing table or column is touched.
-- WARNING: this deletes any client ad numbers entered since the migration.
DROP TABLE IF EXISTS "client_ad_metrics";
