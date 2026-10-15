-- Additive: link tasks / content cards to the assignee's login by ID (the name column stays as display text).
ALTER TABLE "client_tasks" ADD COLUMN "assignee_user_id" TEXT;
ALTER TABLE "client_tasks" ADD COLUMN "created_by_user_id" TEXT;
ALTER TABLE "content_items" ADD COLUMN "assignee_user_id" TEXT;
CREATE INDEX "client_tasks_assignee_user_id_idx" ON "client_tasks"("assignee_user_id");
CREATE INDEX "content_items_assignee_user_id_idx" ON "content_items"("assignee_user_id");

-- Backfill by EXACT name match only, and only where exactly one login has that name. Nothing else is guessed;
-- rows left NULL are reported for a manual decision.
UPDATE "client_tasks" t SET "assignee_user_id" = u.id
FROM "users" u
WHERE t."assignee_user_id" IS NULL AND t."assigned_to" = u."name"
  AND (SELECT count(*) FROM "users" x WHERE x."name" = t."assigned_to") = 1;
UPDATE "content_items" c SET "assignee_user_id" = u.id
FROM "users" u
WHERE c."assignee_user_id" IS NULL AND c."assignee" = u."name"
  AND (SELECT count(*) FROM "users" x WHERE x."name" = c."assignee") = 1;

CREATE TABLE "notifications" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "link" TEXT,
  "read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");
