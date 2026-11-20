-- PB NEW, MASTER PAKAGE NEW and Master Pakage belong to Production. Only moved when they still hold the department the
-- previous migration gave them (or none), so a later choice made in the Meta sheet settings is kept.
UPDATE "lead_sheet_tabs" SET "department" = 'Production'
WHERE (lower(btrim("name")) = 'pb new' AND ("department" IS NULL OR "department" = 'Performance Marketing'))
   OR (lower(btrim("name")) IN ('master pakage', 'master pakage new') AND ("department" IS NULL OR "department" = 'Marketing Consultation'));
