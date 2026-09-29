-- Payables now sit on a real Chart-of-Accounts Liability account. The old `category` column is
-- deliberately KEPT (it still drives commission/bonus automation and reports); drop in a follow-up.

-- 1. Dedicated liability for sales bonuses (there was none), under Accounts Payable.
INSERT INTO chart_of_accounts (id, name, type, parent_id, created_at, updated_at)
SELECT gen_random_uuid()::text, 'Sales Bonus Payable', 'LIABILITY', ap.id, now(), now()
FROM chart_of_accounts ap
WHERE ap.name = 'Accounts Payable' AND ap.type = 'LIABILITY'
  AND NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE name = 'Sales Bonus Payable');

-- 2. New nullable FK.
ALTER TABLE payables ADD COLUMN account_id TEXT;
ALTER TABLE payables ADD CONSTRAINT payables_account_id_fkey
  FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX payables_account_id_idx ON payables(account_id);

-- 3. Backfill by EXACT name match to a Liability account only — no fuzzy guessing.
UPDATE payables p SET account_id = c.id
FROM chart_of_accounts c
WHERE c.type = 'LIABILITY' AND p.account_id IS NULL AND c.name = CASE p.category
  WHEN 'RENT' THEN 'Rent Payable'
  WHEN 'COMMISSION' THEN 'Commission Payable'
  WHEN 'SALES_BONUS' THEN 'Sales Bonus Payable'
  WHEN 'INTERNAL_LOAN' THEN 'Internal Loan'
  WHEN 'VENDOR' THEN 'Vendor Payable'
END;

-- 4. Report anything that could not be matched, for manual review (left NULL, never dropped).
DO $$
DECLARE r RECORD; n INT := 0;
BEGIN
  FOR r IN SELECT id, category, payee, amount FROM payables WHERE account_id IS NULL LOOP
    RAISE NOTICE 'UNMATCHED payable % (category=%, payee=%, amount=%) - needs manual account assignment', r.id, r.category, r.payee, r.amount;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'payables backfill: % row(s) left unmatched', n;
END $$;
