-- CreateTable
CREATE TABLE "ad_reminder_runs" (
    "id" TEXT NOT NULL,
    "run_date" DATE NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "summary" JSONB,

    CONSTRAINT "ad_reminder_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ad_reminder_runs_run_date_key" ON "ad_reminder_runs"("run_date");
