-- Simplify leave policy: annual per-type entitlement banks -> org-wide
-- monthly caps (paid leave days/month, paid WFH days/month), computed from
-- Attendance rather than LeaveRequest. Breaking change, hand-written (not
-- prisma-generated) because it remaps existing data through an enum swap,
-- which `prisma migrate dev` refuses to attempt automatically.
--
-- Historical LeaveRequest rows previously typed CASUAL/SICK/EARNED/UNPAID
-- are all relabeled CASUAL_SICK (confirmed choice — see conversation). This
-- keeps every row, its dates/days/status/reason intact; only the type label
-- changes. leave_balance_adjustments (the "Add to balance" ledger) is
-- dropped entirely, including any rows it has — that feature no longer
-- exists in the new model.

-- ---- 1. LeaveType enum: swap CASUAL/SICK/EARNED/UNPAID for CASUAL_SICK/WFH ----
CREATE TYPE "LeaveType_new" AS ENUM ('CASUAL_SICK', 'WFH');

ALTER TABLE "leave_requests" ADD COLUMN "type_new" "LeaveType_new";

UPDATE "leave_requests" SET "type_new" = CASE "type"
  WHEN 'CASUAL' THEN 'CASUAL_SICK'::"LeaveType_new"
  WHEN 'SICK'   THEN 'CASUAL_SICK'::"LeaveType_new"
  WHEN 'EARNED' THEN 'CASUAL_SICK'::"LeaveType_new"
  WHEN 'UNPAID' THEN 'CASUAL_SICK'::"LeaveType_new"
END;

ALTER TABLE "leave_requests" ALTER COLUMN "type_new" SET NOT NULL;
ALTER TABLE "leave_requests" DROP COLUMN "type";
ALTER TABLE "leave_requests" RENAME COLUMN "type_new" TO "type";

-- ---- 2. Drop the annual-balance-adjustment ledger entirely ----
-- Must happen before DROP TYPE "LeaveType" below — its own `type` column
-- still references the old enum.
DROP TABLE "leave_balance_adjustments";

DROP TYPE "LeaveType";
ALTER TYPE "LeaveType_new" RENAME TO "LeaveType";

-- ---- 3. HrPolicy: annual per-type banks -> org-wide monthly caps ----
ALTER TABLE "hr_policy" DROP COLUMN "casual_leave_days";
ALTER TABLE "hr_policy" DROP COLUMN "sick_leave_days";
ALTER TABLE "hr_policy" DROP COLUMN "earned_leave_days";
ALTER TABLE "hr_policy" ADD COLUMN "paid_leaves_per_month" INTEGER NOT NULL DEFAULT 1;
