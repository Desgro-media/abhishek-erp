-- CreateTable
CREATE TABLE "social_stats" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "followers" INTEGER NOT NULL,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER,
    "engagements" INTEGER NOT NULL DEFAULT 0,
    "profile_visits" INTEGER,
    "link_clicks" INTEGER,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_notes" (
    "month" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_notes_pkey" PRIMARY KEY ("month")
);

-- CreateTable
CREATE TABLE "marketing_settings" (
    "id" INTEGER NOT NULL,
    "owner_employee_id" TEXT,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "social_stats_month_platform_key" ON "social_stats"("month", "platform");
