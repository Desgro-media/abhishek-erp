-- AlterEnum
ALTER TYPE "BankTxnRefType" ADD VALUE 'ADVANCE';

-- AlterTable
ALTER TABLE "advances" ADD COLUMN     "account_id" TEXT,
ADD COLUMN     "paid_by" TEXT,
ADD COLUMN     "paid_date" DATE;

-- AddForeignKey
ALTER TABLE "advances" ADD CONSTRAINT "advances_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
