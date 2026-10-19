-- CreateTable: a department's saved edits to its client board. Additive; no row = the built-in defaults.
CREATE TABLE "service_board_configs" (
    "service" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_board_configs_pkey" PRIMARY KEY ("service")
);
