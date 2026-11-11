DROP TABLE "lead_sheet_tabs";
DROP TABLE "lead_sheet_config";
DROP INDEX "leads_meta_lead_id_key";
ALTER TABLE "leads" DROP COLUMN "meta_lead_id";
