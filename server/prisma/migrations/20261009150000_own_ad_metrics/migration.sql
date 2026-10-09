-- CreateTable
CREATE TABLE "own_ad_metrics" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "spend" DECIMAL(12,2) NOT NULL,
    "leads" INTEGER NOT NULL,
    "purchases" INTEGER NOT NULL,
    "revenue" DECIMAL(12,2) NOT NULL,
    "logged_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "own_ad_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "own_ad_metrics_date_key" ON "own_ad_metrics"("date");
