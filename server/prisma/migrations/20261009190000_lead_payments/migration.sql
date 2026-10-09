-- CreateEnum
CREATE TYPE "LeadPaymentMode" AS ENUM ('BANK_TRANSFER', 'UPI', 'CASH', 'CHEQUE');

-- AlterTable: additive only; the existing sales_policy row gets the default of 5000.
ALTER TABLE "sales_policy" ADD COLUMN "lead_conversion_threshold" DECIMAL(12,2) NOT NULL DEFAULT 5000;

-- CreateTable
CREATE TABLE "lead_payments" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_date" DATE NOT NULL,
    "mode" "LeadPaymentMode" NOT NULL,
    "note" TEXT,
    "recorded_by" TEXT NOT NULL,
    "sales_person" TEXT NOT NULL,
    "invoice_pending_payment_id" TEXT,
    "carried_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_payments_pkey" PRIMARY KEY ("id"),
    -- A recorded amount is always positive; corrections are a delete (before it's carried) and a new entry.
    CONSTRAINT "lead_payments_amount_positive" CHECK ("amount" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_payments_invoice_pending_payment_id_key" ON "lead_payments"("invoice_pending_payment_id");
CREATE INDEX "lead_payments_lead_id_idx" ON "lead_payments"("lead_id");

-- AddForeignKey
-- RESTRICT: a lead that holds a payment record can't be deleted out from under it.
ALTER TABLE "lead_payments" ADD CONSTRAINT "lead_payments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- SET NULL: deleting a not-yet-approved pending entry releases the advance to wait for the next invoice.
ALTER TABLE "lead_payments" ADD CONSTRAINT "lead_payments_invoice_pending_payment_id_fkey" FOREIGN KEY ("invoice_pending_payment_id") REFERENCES "invoice_pending_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
