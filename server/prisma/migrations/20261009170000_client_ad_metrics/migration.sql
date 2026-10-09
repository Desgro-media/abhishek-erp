-- CreateTable
CREATE TABLE "client_ad_metrics" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "spend" DECIMAL(12,2) NOT NULL,
    "leads" INTEGER NOT NULL,
    "purchases" INTEGER NOT NULL,
    "revenue" DECIMAL(12,2) NOT NULL,
    "logged_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_ad_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_ad_metrics_client_id_date_key" ON "client_ad_metrics"("client_id", "date");

-- AddForeignKey
ALTER TABLE "client_ad_metrics" ADD CONSTRAINT "client_ad_metrics_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
