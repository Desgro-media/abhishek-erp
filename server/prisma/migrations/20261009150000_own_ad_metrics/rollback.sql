-- Manual rollback (Prisma has no down migrations; not run automatically).
-- Run only if this package is being backed out, then:
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261009150000_own_ad_metrics';
-- Drops only the table this migration created; no existing table is touched.
DROP TABLE IF EXISTS "own_ad_metrics";
