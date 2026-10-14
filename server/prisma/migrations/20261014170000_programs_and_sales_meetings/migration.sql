-- CreateTable
CREATE TABLE "hr_programs" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Planned',
    "date" DATE NOT NULL,
    "time" TEXT NOT NULL DEFAULT '',
    "duration" TEXT NOT NULL DEFAULT '',
    "mode" TEXT NOT NULL DEFAULT 'In office',
    "venue" TEXT NOT NULL DEFAULT '',
    "facilitator" TEXT NOT NULL DEFAULT '',
    "audience" TEXT[],
    "objective" TEXT NOT NULL DEFAULT '',
    "budget" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "spent" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "outcome" TEXT NOT NULL DEFAULT '',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_program_attendees" (
    "program_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,

    CONSTRAINT "hr_program_attendees_pkey" PRIMARY KEY ("program_id","employee_id")
);

-- CreateTable
CREATE TABLE "hr_program_feedback" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "useful" INTEGER NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_program_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_meetings" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "lead_id" TEXT,
    "by" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "with_name" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hr_programs_date_idx" ON "hr_programs"("date");

-- CreateIndex
CREATE UNIQUE INDEX "hr_program_feedback_program_id_employee_id_key" ON "hr_program_feedback"("program_id", "employee_id");

-- CreateIndex
CREATE INDEX "sales_meetings_date_idx" ON "sales_meetings"("date");

-- CreateIndex
CREATE INDEX "sales_meetings_by_idx" ON "sales_meetings"("by");

-- AddForeignKey
ALTER TABLE "hr_program_attendees" ADD CONSTRAINT "hr_program_attendees_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "hr_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_program_attendees" ADD CONSTRAINT "hr_program_attendees_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_program_feedback" ADD CONSTRAINT "hr_program_feedback_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "hr_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_program_feedback" ADD CONSTRAINT "hr_program_feedback_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_meetings" ADD CONSTRAINT "sales_meetings_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
