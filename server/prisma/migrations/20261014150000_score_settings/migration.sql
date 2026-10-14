-- CreateTable
CREATE TABLE "score_settings" (
    "id" INTEGER NOT NULL,
    "targets" JSONB NOT NULL,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "score_settings_pkey" PRIMARY KEY ("id")
);
