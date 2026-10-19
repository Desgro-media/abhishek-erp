-- AlterTable: Marketing Consultation monthly tasks. Optional columns, so existing tasks are untouched.
ALTER TABLE "client_tasks" ADD COLUMN "cycle" TEXT, ADD COLUMN "retained" BOOLEAN;
