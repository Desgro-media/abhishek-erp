-- DropForeignKey
ALTER TABLE "payables" DROP CONSTRAINT "payables_account_id_fkey";

-- AlterTable
ALTER TABLE "hr_policy" ADD COLUMN     "payroll_default_split" JSONB NOT NULL DEFAULT '[{"percent":100,"day":0}]';

-- CreateTable
CREATE TABLE "payroll_instalments" (
    "id" TEXT NOT NULL,
    "payroll_entry_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "due_date" DATE NOT NULL,

    CONSTRAINT "payroll_instalments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_instalments_payroll_entry_id_seq_key" ON "payroll_instalments"("payroll_entry_id", "seq");

-- AddForeignKey
ALTER TABLE "payroll_instalments" ADD CONSTRAINT "payroll_instalments_payroll_entry_id_fkey" FOREIGN KEY ("payroll_entry_id") REFERENCES "payroll_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payables" ADD CONSTRAINT "payables_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
