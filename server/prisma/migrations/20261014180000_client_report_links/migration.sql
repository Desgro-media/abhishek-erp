-- CreateTable
CREATE TABLE "client_report_links" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_report_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_report_links_client_id_key" ON "client_report_links"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_report_links_token_key" ON "client_report_links"("token");

-- AddForeignKey
ALTER TABLE "client_report_links" ADD CONSTRAINT "client_report_links_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
