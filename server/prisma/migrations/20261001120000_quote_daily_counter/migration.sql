-- CreateTable
CREATE TABLE "quote_daily_counters" (
    "day" TEXT NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quote_daily_counters_pkey" PRIMARY KEY ("day")
);
