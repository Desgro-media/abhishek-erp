-- AlterEnum
ALTER TYPE "PayableCategory" ADD VALUE 'SALES_BONUS';

-- CreateTable
CREATE TABLE "sales_policy" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "monthly_target" DECIMAL(12,2) NOT NULL DEFAULT 500000,
    "bonus_rate" DECIMAL(5,4) NOT NULL DEFAULT 0.10,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_policy_pkey" PRIMARY KEY ("id")
);

