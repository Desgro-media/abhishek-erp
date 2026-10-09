-- Manual rollback (Prisma has no down migrations; not run automatically).
-- Run only if this package is being backed out, then:
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261009160000_client_collab';
-- Drops only the four tables and the enum this migration created; no existing table or column is touched.
-- WARNING: this deletes any ad-access / brief / brand-asset / meeting data entered since the migration.
DROP TABLE IF EXISTS "client_ad_access";
DROP TABLE IF EXISTS "client_campaign_briefs";
DROP TABLE IF EXISTS "client_brand_assets";
DROP TABLE IF EXISTS "client_meetings";
DROP TYPE IF EXISTS "AdAccessStatus";
