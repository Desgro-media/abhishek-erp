-- CreateTable
CREATE TABLE "company_events" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "time" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'Meeting',
    "venue" TEXT NOT NULL DEFAULT '',
    "audience" TEXT[],
    "notes" TEXT NOT NULL DEFAULT '',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_events_date_idx" ON "company_events"("date");
