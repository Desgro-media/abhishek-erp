-- AlterEnum: a pending leave request can be withdrawn. Additive.
ALTER TYPE "LeaveStatus" ADD VALUE 'CANCELLED';
