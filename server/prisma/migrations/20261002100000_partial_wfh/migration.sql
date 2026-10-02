-- Partially Paid WFH (75% payout): a new leave type and the attendance status its approval writes.
ALTER TYPE "LeaveType" ADD VALUE 'PARTIAL_WFH';
ALTER TYPE "AttendanceStatus" ADD VALUE 'WFH_PARTIAL';
