-- AlterTable: a rating can belong to a delivered project (Web Development) instead of a month. Existing ratings keep project_id NULL.
ALTER TABLE "client_feedback" ADD COLUMN "project_id" TEXT;

-- The old rule (one rating per client / service / month) now only applies to monthly ratings; a project rating is unique per project.
DROP INDEX "client_feedback_client_id_dept_month_key";
CREATE UNIQUE INDEX "client_feedback_monthly_key" ON "client_feedback"("client_id", "dept", "month") WHERE "project_id" IS NULL;
CREATE UNIQUE INDEX "client_feedback_project_key" ON "client_feedback"("project_id") WHERE "project_id" IS NOT NULL;

-- CreateIndex
CREATE INDEX "client_feedback_client_id_dept_month_idx" ON "client_feedback"("client_id", "dept", "month");
CREATE INDEX "client_feedback_project_id_idx" ON "client_feedback"("project_id");
