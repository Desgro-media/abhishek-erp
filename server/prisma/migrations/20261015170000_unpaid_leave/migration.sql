-- AlterEnum: Unpaid leave as a leave-request type and as an attendance status. Additive; existing rows are untouched.
ALTER TYPE "LeaveType" ADD VALUE 'UNPAID_LEAVE';
ALTER TYPE "AttendanceStatus" ADD VALUE 'UNPAID_LEAVE';
