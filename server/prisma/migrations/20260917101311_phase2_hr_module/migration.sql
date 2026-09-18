-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('PERMANENT', 'PROBATION');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'ON_LEAVE', 'WFH');

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('CASUAL', 'SICK', 'EARNED', 'UNPAID');

-- CreateEnum
CREATE TYPE "LeaveDuration" AS ENUM ('FULL_DAY', 'HALF_DAY', 'QUARTER_DAY');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AdvanceStatus" AS ENUM ('PENDING', 'RECOVERING', 'RECOVERED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('NEW', 'REVIEWED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('OPEN', 'ON_HOLD', 'CLOSED');

-- CreateEnum
CREATE TYPE "CandidateStage" AS ENUM ('APPLIED', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED');

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "employee_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dept" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "dob" DATE,
    "joined_at" DATE NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "salary" DECIMAL(12,2) NOT NULL,
    "emp_type" "EmploymentType" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_revisions" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "effective_date" DATE NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "salary_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "check_in" TEXT,
    "marked_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "type" "LeaveType" NOT NULL,
    "duration" "LeaveDuration" NOT NULL DEFAULT 'FULL_DAY',
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "days" DECIMAL(4,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_balance_adjustments" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "type" "LeaveType" NOT NULL,
    "days" DECIMAL(4,2) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "leave_balance_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advances" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "installments" INTEGER NOT NULL,
    "monthly_deduction" DECIMAL(12,2) NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL,
    "status" "AdvanceStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaints" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "dept" TEXT,
    "text" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ComplaintStatus" NOT NULL DEFAULT 'NEW',
    "note" TEXT,

    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "open_positions" (
    "id" TEXT NOT NULL,
    "position_code" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "dept" TEXT NOT NULL,
    "openings" INTEGER NOT NULL,
    "status" "PositionStatus" NOT NULL DEFAULT 'OPEN',
    "posted_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "open_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidates" (
    "id" TEXT NOT NULL,
    "position_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "stage" "CandidateStage" NOT NULL DEFAULT 'APPLIED',
    "applied_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notices" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "posted_by" TEXT NOT NULL,
    "posted_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_policy" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "casual_leave_days" INTEGER NOT NULL DEFAULT 12,
    "sick_leave_days" INTEGER NOT NULL DEFAULT 8,
    "earned_leave_days" INTEGER NOT NULL DEFAULT 15,
    "weekly_off" INTEGER NOT NULL DEFAULT 0,
    "general_notes" TEXT,
    "leave_pay_notes" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_entries" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "gross" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_payments" (
    "id" TEXT NOT NULL,
    "payroll_entry_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "recorded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_employee_code_key" ON "employees"("employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "employees_email_key" ON "employees"("email");

-- CreateIndex
CREATE INDEX "employees_dept_idx" ON "employees"("dept");

-- CreateIndex
CREATE INDEX "salary_revisions_employee_id_idx" ON "salary_revisions"("employee_id");

-- CreateIndex
CREATE INDEX "attendance_records_date_idx" ON "attendance_records"("date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_employee_id_date_key" ON "attendance_records"("employee_id", "date");

-- CreateIndex
CREATE INDEX "leave_requests_employee_id_idx" ON "leave_requests"("employee_id");

-- CreateIndex
CREATE INDEX "leave_requests_status_idx" ON "leave_requests"("status");

-- CreateIndex
CREATE INDEX "leave_balance_adjustments_employee_id_idx" ON "leave_balance_adjustments"("employee_id");

-- CreateIndex
CREATE INDEX "advances_employee_id_idx" ON "advances"("employee_id");

-- CreateIndex
CREATE INDEX "advances_status_idx" ON "advances"("status");

-- CreateIndex
CREATE UNIQUE INDEX "open_positions_position_code_key" ON "open_positions"("position_code");

-- CreateIndex
CREATE INDEX "candidates_position_id_idx" ON "candidates"("position_id");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_date_key" ON "holidays"("date");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_entries_employee_id_month_key" ON "payroll_entries"("employee_id", "month");

-- CreateIndex
CREATE INDEX "payroll_payments_payroll_entry_id_idx" ON "payroll_payments"("payroll_entry_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_revisions" ADD CONSTRAINT "salary_revisions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balance_adjustments" ADD CONSTRAINT "leave_balance_adjustments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advances" ADD CONSTRAINT "advances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "open_positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notices" ADD CONSTRAINT "notices_posted_by_fkey" FOREIGN KEY ("posted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_payroll_entry_id_fkey" FOREIGN KEY ("payroll_entry_id") REFERENCES "payroll_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
