-- Own Meta ad numbers become service-wise: one row per date per service ("" = not tied to a service, i.e. every existing row).
ALTER TABLE "own_ad_metrics" ADD COLUMN "service" TEXT NOT NULL DEFAULT '';
DROP INDEX "own_ad_metrics_date_key";
CREATE UNIQUE INDEX "own_ad_metrics_date_service_key" ON "own_ad_metrics"("date", "service");
