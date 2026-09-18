-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'NOTICE_PERIOD', 'LEFT');

-- AlterTable
ALTER TABLE "employees" DROP COLUMN "active",
ADD COLUMN     "employment_status" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "leaving_date" DATE,
ADD COLUMN     "notice_given_date" DATE,
ADD COLUMN     "notice_note" TEXT;

