-- Manual rollback (Prisma has no down migrations; not run automatically).
-- Run only if this package is being backed out, then:
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261009190000_lead_payments';
-- Drops the new table and enum and the one new sales_policy column; no existing column is touched.
-- Pending invoice payments that were created from advances stay (they are ordinary pending payments),
-- they just lose their link back to the lead payment.
-- WARNING: this deletes every lead payment record. Do NOT run it if any advance is still "awaiting invoice":
-- that record is the only trace of money a lead paid. Check first:
--   SELECT count(*) FROM lead_payments WHERE invoice_pending_payment_id IS NULL;
DROP TABLE IF EXISTS "lead_payments";
ALTER TABLE "sales_policy" DROP COLUMN IF EXISTS "lead_conversion_threshold";
DROP TYPE IF EXISTS "LeadPaymentMode";
