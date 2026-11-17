-- A sheet tab's service is now the tab's own name. Tabs that are being skipped (service NULL) stay skipped.
UPDATE "lead_sheet_tabs" SET "service" = left(btrim("name"), 60) WHERE "service" IS NOT NULL AND btrim("name") <> '';

-- The next sync files leads already imported from the sheet under their tab's name (once), then sets this.
ALTER TABLE "lead_sheet_config" ADD COLUMN "tab_names_applied" BOOLEAN NOT NULL DEFAULT false;
