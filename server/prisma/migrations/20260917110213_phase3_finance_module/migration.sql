-- CreateEnum
CREATE TYPE "PayableCategory" AS ENUM ('SALARY', 'RENT', 'COMMISSION', 'INTERNAL_LOAN', 'VENDOR');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('SOFTWARE', 'EQUIPMENT', 'TRAVEL', 'UTILITIES', 'MISC');

-- CreateEnum
CREATE TYPE "BankTxnType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "BankTxnRefType" AS ENUM ('INVOICE_PAYMENT', 'PAYABLE_PAYMENT', 'EXPENSE', 'TRANSFER', 'JOURNAL', 'MANUAL');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "CommissionWithdrawalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "JournalSide" AS ENUM ('DEBIT', 'CREDIT');

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "invoice_no" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "issued_at" DATE NOT NULL,
    "due_at" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "dept" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_payments" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_date" DATE NOT NULL,
    "account_id" TEXT NOT NULL,
    "note" TEXT,
    "recorded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_pending_payments" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_date" DATE NOT NULL,
    "sales_person" TEXT,
    "note" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "approved_at" TIMESTAMP(3),
    "invoice_payment_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_pending_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payables" (
    "id" TEXT NOT NULL,
    "category" "PayableCategory" NOT NULL,
    "payee" TEXT NOT NULL,
    "sales_person" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "due_at" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payable_payments" (
    "id" TEXT NOT NULL,
    "payable_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_date" DATE NOT NULL,
    "account_id" TEXT NOT NULL,
    "note" TEXT,
    "recorded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payable_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "date" DATE NOT NULL,
    "account_id" TEXT NOT NULL,
    "dept" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bank" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "opening" DECIMAL(12,2) NOT NULL,
    "opened_at" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" "BankTxnType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "ref_type" "BankTxnRefType" NOT NULL,
    "ref_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" TEXT NOT NULL,
    "from_account_id" TEXT NOT NULL,
    "to_account_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chart_of_accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "parent_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chart_of_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "memo" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "journal_entry_id" TEXT NOT NULL,
    "coa_account_id" TEXT,
    "bank_account_id" TEXT,
    "side" "JournalSide" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_withdrawals" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "CommissionWithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "decided_at" TIMESTAMP(3),
    "account_id" TEXT,
    "paid_amount" DECIMAL(12,2),

    CONSTRAINT "commission_withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_no_key" ON "invoices"("invoice_no");

-- CreateIndex
CREATE INDEX "invoices_client_id_idx" ON "invoices"("client_id");

-- CreateIndex
CREATE INDEX "invoice_items_invoice_id_idx" ON "invoice_items"("invoice_id");

-- CreateIndex
CREATE INDEX "invoice_payments_invoice_id_idx" ON "invoice_payments"("invoice_id");

-- CreateIndex
CREATE INDEX "invoice_pending_payments_invoice_id_idx" ON "invoice_pending_payments"("invoice_id");

-- CreateIndex
CREATE INDEX "payables_category_idx" ON "payables"("category");

-- CreateIndex
CREATE INDEX "payable_payments_payable_id_idx" ON "payable_payments"("payable_id");

-- CreateIndex
CREATE INDEX "bank_transactions_account_id_date_idx" ON "bank_transactions"("account_id", "date");

-- CreateIndex
CREATE INDEX "bank_transactions_ref_type_ref_id_idx" ON "bank_transactions"("ref_type", "ref_id");

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_accounts_name_key" ON "chart_of_accounts"("name");

-- CreateIndex
CREATE INDEX "journal_lines_journal_entry_id_idx" ON "journal_lines"("journal_entry_id");

-- CreateIndex
CREATE INDEX "commission_withdrawals_employee_id_idx" ON "commission_withdrawals"("employee_id");

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_pending_payments" ADD CONSTRAINT "invoice_pending_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_payments" ADD CONSTRAINT "payable_payments_payable_id_fkey" FOREIGN KEY ("payable_id") REFERENCES "payables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_payments" ADD CONSTRAINT "payable_payments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_account_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_coa_account_id_fkey" FOREIGN KEY ("coa_account_id") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_withdrawals" ADD CONSTRAINT "commission_withdrawals_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
