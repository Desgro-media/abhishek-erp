-- Percentage applied when a commission / sales-bonus payable was created. Nullable: only backfilled where
-- it is certain, never guessed.
ALTER TABLE "payables" ADD COLUMN "commission_rate" DECIMAL(7,4);

-- Flat commissions that are exactly 10% of their (single) source payment.
UPDATE "payables" p SET "commission_rate" = 10
FROM "invoice_payments" ip
WHERE p."category" = 'COMMISSION' AND ip."id" = p."source_payment_id" AND ip."amount" > 0
  AND round(p."amount" / ip."amount" * 100, 2) = 10.00
  AND (SELECT count(*) FROM "payables" x WHERE x."source_payment_id" = p."source_payment_id" AND x."category" = 'COMMISSION') = 1;

-- Target bonuses: the bonus rate on sales past target that was in force (the current policy rate; 10% default).
UPDATE "payables" SET "commission_rate" = COALESCE((SELECT "bonus_rate" * 100 FROM "sales_policy" WHERE "id" = 1), 10)
WHERE "category" = 'SALES_BONUS' AND "source_payment_id" IS NOT NULL;
