-- AlterTable: currency a client's ad numbers are tracked in (INR default, so existing clients are unchanged).
ALTER TABLE "clients" ADD COLUMN "ad_currency" TEXT NOT NULL DEFAULT 'INR';
