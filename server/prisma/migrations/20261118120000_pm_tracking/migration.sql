-- Performance Marketing tracking. Additive only: nullable columns and one new table.
ALTER TABLE "clients" ADD COLUMN "pm_owner_id" TEXT;
ALTER TABLE "clients" ADD CONSTRAINT "clients_pm_owner_id_fkey" FOREIGN KEY ("pm_owner_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "client_campaign_briefs" ADD COLUMN "target_cpl" DECIMAL(12,2);
ALTER TABLE "client_campaign_briefs" ADD COLUMN "campaign_status" TEXT;

CREATE TABLE "pm_score_adjustments" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "updated_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pm_score_adjustments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pm_score_adjustments_employee_id_month_key" ON "pm_score_adjustments"("employee_id", "month");
ALTER TABLE "pm_score_adjustments" ADD CONSTRAINT "pm_score_adjustments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
