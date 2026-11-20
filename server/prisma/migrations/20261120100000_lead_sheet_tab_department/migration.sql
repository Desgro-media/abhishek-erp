-- Each Meta sheet tab can be filed under an ERP department, so Meta Ads shows leads and spend per department. Additive.
ALTER TABLE "lead_sheet_tabs" ADD COLUMN "department" TEXT;
