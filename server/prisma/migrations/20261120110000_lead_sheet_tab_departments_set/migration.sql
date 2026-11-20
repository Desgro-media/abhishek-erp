-- The department of each Meta sheet tab the performance team uses today, as agreed with them. Only tabs with no
-- department yet are filled, so a choice made in Marketing → Leads → Meta sheet is never overwritten.
UPDATE "lead_sheet_tabs" SET "department" = CASE lower(btrim("name"))
    WHEN 'pm sheet'          THEN 'Performance Marketing'
    WHEN 'pb new'            THEN 'Performance Marketing'
    WHEN 'pb'                THEN 'Performance Marketing'
    WHEN 'pb master pakage'  THEN 'Performance Marketing'
    WHEN 'web kerala'        THEN 'Web Development'
    WHEN 'web new'           THEN 'Web Development'
    WHEN 'web'               THEN 'Web Development'
    WHEN 'erp'               THEN 'Web Development'
    WHEN 'graphic gcc new'   THEN 'Graphic Design'
    WHEN 'graphic gcc'       THEN 'Graphic Design'
    WHEN 'graphic kerala'    THEN 'Graphic Design'
    WHEN 'master pakage'     THEN 'Marketing Consultation'
    WHEN 'master pakage new' THEN 'Marketing Consultation'
    WHEN 'consultation'      THEN 'Marketing Consultation'
  END
WHERE "department" IS NULL AND lower(btrim("name")) IN ('pm sheet','pb new','pb','pb master pakage','web kerala','web new','web','erp',
  'graphic gcc new','graphic gcc','graphic kerala','master pakage','master pakage new','consultation');
