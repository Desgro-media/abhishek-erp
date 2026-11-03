-- A new kind of payable: the upsell a salesperson earned on an invoice, owed to them once the invoice is fully paid.
ALTER TYPE "PayableCategory" ADD VALUE 'UPSELL';

-- Its liability account in the Chart of Accounts, under Accounts Payable (same pattern as Sales Bonus Payable).
INSERT INTO chart_of_accounts (id, name, type, parent_id, created_at, updated_at)
SELECT gen_random_uuid()::text, 'Upsell Payable', 'LIABILITY', ap.id, now(), now()
FROM chart_of_accounts ap
WHERE ap.name = 'Accounts Payable' AND ap.type = 'LIABILITY'
  AND NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE name = 'Upsell Payable');
