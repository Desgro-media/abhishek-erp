-- AlterTable: tag a Sales-logged payment as an upsell (extra sale to an existing client). Reporting tag only; no effect on commission. Additive.
ALTER TABLE "invoice_pending_payments" ADD COLUMN "is_upsell" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "invoice_payments" ADD COLUMN "is_upsell" BOOLEAN NOT NULL DEFAULT false;
