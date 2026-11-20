-- PB and PB Master pakage belong to Production too (like PB NEW). Only moved when they still hold the department an
-- earlier migration gave them (or none), so a later choice made in the Meta sheet settings is kept.
UPDATE "lead_sheet_tabs" SET "department" = 'Production'
WHERE lower(btrim("name")) IN ('pb', 'pb master pakage') AND ("department" IS NULL OR "department" = 'Performance Marketing');
