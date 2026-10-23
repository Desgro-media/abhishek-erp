-- CreateTable: team leads under a department head (many per department). Additive.
CREATE TABLE "department_team_leads" (
    "id" TEXT NOT NULL,
    "dept" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "updated_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "department_team_leads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "department_team_leads_dept_employee_id_key" ON "department_team_leads"("dept", "employee_id");

ALTER TABLE "department_team_leads" ADD CONSTRAINT "department_team_leads_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
