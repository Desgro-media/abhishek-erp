-- CreateEnum
CREATE TYPE "AdAccessStatus" AS ENUM ('GRANTED', 'PENDING', 'REVOKED');

-- CreateTable
CREATE TABLE "client_ad_access" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "account_id" TEXT,
    "access_email" TEXT,
    "status" "AdAccessStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "updated_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_ad_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_campaign_briefs" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "objective" TEXT,
    "audience" TEXT,
    "budget" TEXT,
    "updated_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_campaign_briefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_brand_assets" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "link" TEXT,
    "notes" TEXT,
    "added_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_brand_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_meetings" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "attendees" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "logged_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_ad_access_client_id_key" ON "client_ad_access"("client_id");
CREATE UNIQUE INDEX "client_campaign_briefs_client_id_key" ON "client_campaign_briefs"("client_id");
CREATE INDEX "client_brand_assets_client_id_idx" ON "client_brand_assets"("client_id");
CREATE INDEX "client_meetings_client_id_date_idx" ON "client_meetings"("client_id", "date");

-- AddForeignKey
ALTER TABLE "client_ad_access" ADD CONSTRAINT "client_ad_access_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_campaign_briefs" ADD CONSTRAINT "client_campaign_briefs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_brand_assets" ADD CONSTRAINT "client_brand_assets_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_meetings" ADD CONSTRAINT "client_meetings_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
