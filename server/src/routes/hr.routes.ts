import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { requireHRAdmin } from "../middleware/hrAccess";
import * as employees from "../controllers/hr/employees.controller";
import * as attendance from "../controllers/hr/attendance.controller";
import * as leave from "../controllers/hr/leave.controller";
import * as advances from "../controllers/hr/advances.controller";
import * as complaints from "../controllers/hr/complaints.controller";
import * as hiring from "../controllers/hr/hiring.controller";
import * as notices from "../controllers/hr/notices.controller";
import * as policy from "../controllers/hr/policy.controller";
import * as payroll from "../controllers/hr/payroll.controller";

const router = Router();

// Every HR route requires a logged-in session; most also require
// requireHRAdmin — routes without it do their own "own record only" scoping
// via resolveScopedEmployeeId (see each controller for the exact rule).
router.use(authenticate);

// Employees
router.get("/employees", employees.listEmployees); // HR/Admin only (checked inside)
router.get("/employees/me", employees.getMyEmployeeRecord);
router.get("/employees/:id", employees.getEmployee); // self-or-HR (checked inside)
router.post("/employees", requireHRAdmin, employees.createEmployee);
router.patch("/employees/:id", requireHRAdmin, employees.updateEmployee);
router.get("/employees/:id/salary-revisions", employees.listSalaryRevisions); // self-or-HR
router.post("/employees/:id/salary-revisions", requireHRAdmin, employees.addSalaryRevision);

// Offboarding lifecycle — HR/Admin only.
router.post("/employees/:id/notice-period", requireHRAdmin, employees.markNoticePeriod);
router.post("/employees/:id/cancel-notice-period", requireHRAdmin, employees.cancelNoticePeriod);
router.post("/employees/:id/confirm-departure", requireHRAdmin, employees.confirmDeparture);
router.post("/employees/:id/reinstate", requireHRAdmin, employees.reinstateEmployee);

// Attendance
router.get("/attendance", requireHRAdmin, attendance.listAttendanceForDate);
router.post("/attendance", requireHRAdmin, attendance.markAttendance);
router.get("/attendance/:employeeId/history", attendance.getAttendanceHistory); // self-or-HR

// Leave
router.get("/leave-requests", leave.listLeaveRequests); // self-or-HR (checked inside)
router.post("/leave-requests", leave.createLeaveRequest); // self-service or HR-for-any
router.patch("/leave-requests/:id", requireHRAdmin, leave.decideLeaveRequest);
router.get("/leave-balance", requireHRAdmin, leave.listAllLeaveBalances);
router.get("/leave-balance/:employeeId", leave.getLeaveBalance); // self-or-HR
router.post("/leave-balance-adjustments", requireHRAdmin, leave.addLeaveBalanceAdjustment);

// Advances
router.get("/advances", advances.listAdvances); // self-or-HR (checked inside)
router.post("/advances", advances.createAdvance); // self-service or HR-for-any
router.patch("/advances/:id", requireHRAdmin, advances.decideAdvance);

// Complaints — anonymous by design, see complaints.controller.ts
router.post("/complaints", complaints.createComplaint); // any authenticated user
router.get("/complaints", requireHRAdmin, complaints.listComplaints);
router.patch("/complaints/:id", requireHRAdmin, complaints.updateComplaint);

// Hiring
router.get("/positions", requireHRAdmin, hiring.listPositions);
router.post("/positions", requireHRAdmin, hiring.createPosition);
router.patch("/positions/:id", requireHRAdmin, hiring.updatePosition);
router.post("/candidates", requireHRAdmin, hiring.createCandidate);
router.patch("/candidates/:id", requireHRAdmin, hiring.updateCandidate);

// Notices — visible company-wide, writes are HR/Admin only
router.get("/notices", notices.listNotices);
router.post("/notices", requireHRAdmin, notices.createNotice);
router.patch("/notices/:id", requireHRAdmin, notices.updateNotice);
router.delete("/notices/:id", requireHRAdmin, notices.deleteNotice);

// Policy — readable company-wide, writes are HR/Admin only
router.get("/policy", policy.getPolicy);
router.patch("/policy", requireHRAdmin, policy.updatePolicy);
router.post("/policy/holidays", requireHRAdmin, policy.addHoliday);
router.delete("/policy/holidays/:date", requireHRAdmin, policy.removeHoliday);

// Payroll
router.get("/payroll", requireHRAdmin, payroll.listPayrollForMonth);
router.get("/payroll/:employeeId/:month", payroll.getPayrollEntry); // self-or-HR
router.post("/payroll/entries", requireHRAdmin, payroll.upsertPayrollEntry);
router.post("/payroll/:employeeId/:month/payments", requireHRAdmin, payroll.recordPayrollPayment);

export default router;
