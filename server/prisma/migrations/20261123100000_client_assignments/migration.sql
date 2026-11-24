-- Who handles each client in each service department (Performance Marketing keeps clients.pm_owner_id). Additive.
CREATE TABLE "client_assignments" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "dept" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "updated_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "client_assignments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "client_assignments_client_id_dept_key" ON "client_assignments"("client_id", "dept");
CREATE INDEX "client_assignments_employee_id_idx" ON "client_assignments"("employee_id");
ALTER TABLE "client_assignments" ADD CONSTRAINT "client_assignments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_assignments" ADD CONSTRAINT "client_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
