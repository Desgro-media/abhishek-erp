-- CreateEnum
CREATE TYPE "LeaveBucket" AS ENUM ('PAID_LEAVE', 'WFH');

-- AlterTable: existing rows are all paid-leave rows (default), with no old/new audit values
ALTER TABLE "leave_ledger_entries"
  ADD COLUMN "bucket" "LeaveBucket" NOT NULL DEFAULT 'PAID_LEAVE',
  ADD COLUMN "old_value" DECIMAL(5,2),
  ADD COLUMN "new_value" DECIMAL(5,2);
