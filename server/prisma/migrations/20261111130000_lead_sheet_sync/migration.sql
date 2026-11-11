-- AlterTable: Meta's lead id on imported leads, so a sheet row is never imported twice
ALTER TABLE "leads" ADD COLUMN "meta_lead_id" TEXT;
CREATE UNIQUE INDEX "leads_meta_lead_id_key" ON "leads"("meta_lead_id");

-- CreateTable
CREATE TABLE "lead_sheet_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "sheet_id" TEXT,
    "auto_sync" BOOLEAN NOT NULL DEFAULT false,
    "import_from" DATE,
    "last_sync_at" TIMESTAMP(3),
    "last_summary" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_sheet_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_sheet_tabs" (
    "id" TEXT NOT NULL,
    "gid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "service" TEXT,
    "last_rows" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lead_sheet_tabs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lead_sheet_tabs_gid_key" ON "lead_sheet_tabs"("gid");
