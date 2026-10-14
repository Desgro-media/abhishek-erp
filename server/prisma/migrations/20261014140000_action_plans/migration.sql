-- CreateTable
CREATE TABLE "action_plans" (
    "id" TEXT NOT NULL,
    "dept" TEXT NOT NULL,
    "head_name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "submitted_at" TEXT NOT NULL,
    "focus" TEXT NOT NULL,
    "research" TEXT NOT NULL DEFAULT '',
    "needs_question" TEXT,
    "needs_resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_plan_items" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL,
    "carried_from" DATE,
    "added_by" TEXT,

    CONSTRAINT "action_plan_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_plan_comments" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "by" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_plan_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "action_plans_date_idx" ON "action_plans"("date");

-- CreateIndex
CREATE UNIQUE INDEX "action_plans_dept_date_key" ON "action_plans"("dept", "date");

-- CreateIndex
CREATE INDEX "action_plan_items_plan_id_idx" ON "action_plan_items"("plan_id");

-- CreateIndex
CREATE INDEX "action_plan_comments_plan_id_idx" ON "action_plan_comments"("plan_id");

-- AddForeignKey
ALTER TABLE "action_plan_items" ADD CONSTRAINT "action_plan_items_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "action_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_plan_comments" ADD CONSTRAINT "action_plan_comments_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "action_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
