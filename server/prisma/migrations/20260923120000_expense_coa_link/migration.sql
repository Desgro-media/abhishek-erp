-- Expenses used to be tagged with a fixed ExpenseCategory enum, completely
-- disconnected from the Chart of Accounts — so a new Expense-type COA
-- account had no way to ever receive a logged expense, and P&L had to
-- re-derive a label from the enum instead of reading it straight off COA.
-- This links Expense directly to ChartOfAccount instead, same pattern as
-- JournalLine.coaAccountId.

-- AlterTable: add the new column nullable first so existing rows can be backfilled
ALTER TABLE "expenses" ADD COLUMN "coa_account_id" TEXT;

-- Backfill: the old enum values were always uppercase versions of a main
-- COA account name seeded in seed-finance.ts (Software/Equipment/Travel/
-- Utilities/Misc), so map each row onto that same-named account; anything
-- that doesn't resolve (a category value without a matching COA account)
-- falls back to "Misc" rather than leaving the row unmappable.
UPDATE "expenses" e
SET "coa_account_id" = COALESCE(
  (SELECT c.id FROM "chart_of_accounts" c WHERE c.name = INITCAP(REPLACE(e.category::text, '_', ' ')) LIMIT 1),
  (SELECT c.id FROM "chart_of_accounts" c WHERE c.name = 'Misc' LIMIT 1)
);

-- Now safe to enforce NOT NULL and drop the old enum column + type
ALTER TABLE "expenses" ALTER COLUMN "coa_account_id" SET NOT NULL;
ALTER TABLE "expenses" DROP COLUMN "category";
DROP TYPE "ExpenseCategory";

-- CreateIndex
CREATE INDEX "expenses_coa_account_id_idx" ON "expenses"("coa_account_id");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_coa_account_id_fkey" FOREIGN KEY ("coa_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
