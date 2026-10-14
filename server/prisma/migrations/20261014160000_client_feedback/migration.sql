-- CreateTable
CREATE TABLE "client_feedback" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "dept" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "via" TEXT NOT NULL,
    "by" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_feedback_links" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "depts" TEXT[],
    "month" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_feedback_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_feedback_month_idx" ON "client_feedback"("month");

-- CreateIndex
CREATE UNIQUE INDEX "client_feedback_client_id_dept_month_key" ON "client_feedback"("client_id", "dept", "month");

-- CreateIndex
CREATE UNIQUE INDEX "client_feedback_links_token_key" ON "client_feedback_links"("token");

-- CreateIndex
CREATE UNIQUE INDEX "client_feedback_links_client_id_month_key" ON "client_feedback_links"("client_id", "month");

-- AddForeignKey
ALTER TABLE "client_feedback" ADD CONSTRAINT "client_feedback_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_feedback_links" ADD CONSTRAINT "client_feedback_links_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
