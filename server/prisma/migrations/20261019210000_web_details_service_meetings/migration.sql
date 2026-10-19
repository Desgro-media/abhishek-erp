-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'HELD', 'CANCELLED');

-- AlterTable: per-service meetings. Every existing meeting log stays as it is (status HELD, no service).
ALTER TABLE "client_meetings"
  ADD COLUMN "service" TEXT,
  ADD COLUMN "status" "MeetingStatus" NOT NULL DEFAULT 'HELD',
  ADD COLUMN "time" TEXT,
  ADD COLUMN "mode" TEXT,
  ADD COLUMN "agenda" TEXT,
  ADD COLUMN "action_items" TEXT,
  ADD COLUMN "scheduled_for" DATE,
  ADD COLUMN "cancelled_on" DATE,
  ADD COLUMN "cancelled_by" TEXT;

-- CreateIndex
CREATE INDEX "client_meetings_service_date_idx" ON "client_meetings"("service", "date");

-- CreateTable
CREATE TABLE "client_web_details" (
    "client_id" TEXT NOT NULL,
    "staging_url" TEXT NOT NULL DEFAULT '',
    "live_url" TEXT NOT NULL DEFAULT '',
    "domain" TEXT NOT NULL DEFAULT '',
    "hosting" TEXT NOT NULL DEFAULT '',
    "platform" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_web_details_pkey" PRIMARY KEY ("client_id")
);

-- AddForeignKey
ALTER TABLE "client_web_details" ADD CONSTRAINT "client_web_details_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
