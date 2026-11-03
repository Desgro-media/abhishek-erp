-- The upsell tag becomes an amount: how much of the payment is upsell (e.g. 3,000 of a 50,000 payment).
-- Replaces the is_upsell flag added in 20261103140000 (nothing was recorded with it yet; any flagged row keeps its full amount as upsell).
ALTER TABLE "invoice_pending_payments" ADD COLUMN "upsell_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoice_payments" ADD COLUMN "upsell_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
UPDATE "invoice_pending_payments" SET "upsell_amount" = "amount" WHERE "is_upsell";
UPDATE "invoice_payments" SET "upsell_amount" = "amount" WHERE "is_upsell";
ALTER TABLE "invoice_pending_payments" DROP COLUMN "is_upsell";
ALTER TABLE "invoice_payments" DROP COLUMN "is_upsell";
