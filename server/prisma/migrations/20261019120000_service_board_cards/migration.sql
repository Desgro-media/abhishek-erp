-- AlterTable: columns for service-board cards on a client's Services tabs. All optional / defaulted, so existing tasks are untouched.
ALTER TABLE "client_tasks"
  ADD COLUMN "service" TEXT,
  ADD COLUMN "stage" TEXT,
  ADD COLUMN "task_type" TEXT,
  ADD COLUMN "platforms" TEXT[],
  ADD COLUMN "start_at" DATE,
  ADD COLUMN "max_days" INTEGER,
  ADD COLUMN "project_id" TEXT,
  ADD COLUMN "project_name" TEXT,
  ADD COLUMN "project_kind" TEXT,
  ADD COLUMN "client_assigned" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "notes" TEXT;

-- CreateIndex
CREATE INDEX "client_tasks_client_id_service_idx" ON "client_tasks"("client_id", "service");
