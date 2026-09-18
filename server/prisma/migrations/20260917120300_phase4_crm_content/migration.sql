-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CHURNED');

-- CreateEnum
CREATE TYPE "BillingType" AS ENUM ('PREPAID', 'POSTPAID');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'SUBMITTED_TO_FINANCE', 'INVOICED', 'LOST');

-- CreateEnum
CREATE TYPE "ClientTaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'REVIEW', 'DONE');

-- CreateEnum
CREATE TYPE "ContentStage" AS ENUM ('IDEA', 'SCRIPTING', 'PRODUCTION', 'REVIEW', 'SCHEDULED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "MetaAdsCampaignStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "client_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "city" TEXT,
    "services" TEXT[],
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "billing_type" "BillingType" NOT NULL DEFAULT 'PREPAID',
    "onboarded_at" DATE NOT NULL,
    "account_manager" TEXT,
    "sales_person" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "lead_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "source" TEXT NOT NULL,
    "service_interested" TEXT NOT NULL,
    "lead_owner" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "converted_client_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "quote_code" TEXT NOT NULL,
    "client_id" TEXT,
    "lead_id" TEXT,
    "title" TEXT NOT NULL,
    "created_by" TEXT,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "sent_at" DATE,
    "invoice_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_items" (
    "id" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "dept" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "quote_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_pending_payments" (
    "id" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_date" DATE NOT NULL,
    "note" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "approved_at" TIMESTAMP(3),
    "invoice_payment_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_pending_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_tasks" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "assigned_to" TEXT,
    "due_at" DATE NOT NULL,
    "status" "ClientTaskStatus" NOT NULL DEFAULT 'TODO',
    "revisions" INTEGER NOT NULL DEFAULT 0,
    "done_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_attachments" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_items" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "platforms" TEXT[],
    "assignee" TEXT,
    "stage" "ContentStage" NOT NULL DEFAULT 'IDEA',
    "due_at" DATE NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_ads_campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" "MetaAdsCampaignStatus" NOT NULL DEFAULT 'ACTIVE',
    "spend" DECIMAL(12,2) NOT NULL,
    "impressions" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "leads" INTEGER NOT NULL,
    "start_at" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_ads_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clients_client_code_key" ON "clients"("client_code");

-- CreateIndex
CREATE UNIQUE INDEX "leads_lead_code_key" ON "leads"("lead_code");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_quote_code_key" ON "quotes"("quote_code");

-- CreateIndex
CREATE INDEX "quote_items_quote_id_idx" ON "quote_items"("quote_id");

-- CreateIndex
CREATE INDEX "quote_pending_payments_quote_id_idx" ON "quote_pending_payments"("quote_id");

-- CreateIndex
CREATE INDEX "task_attachments_task_id_idx" ON "task_attachments"("task_id");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_client_id_fkey" FOREIGN KEY ("converted_client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_pending_payments" ADD CONSTRAINT "quote_pending_payments_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_tasks" ADD CONSTRAINT "client_tasks_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "client_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
