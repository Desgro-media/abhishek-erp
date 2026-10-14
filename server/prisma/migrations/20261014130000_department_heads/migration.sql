-- CreateTable
CREATE TABLE "department_heads" (
    "id" TEXT NOT NULL,
    "dept" TEXT NOT NULL,
    "employee_id" TEXT,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "department_heads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "department_heads_dept_key" ON "department_heads"("dept");

-- AddForeignKey
ALTER TABLE "department_heads" ADD CONSTRAINT "department_heads_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
