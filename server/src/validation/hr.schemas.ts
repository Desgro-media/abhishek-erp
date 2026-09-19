import { z } from "zod";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const employeeCreateSchema = z.object({
  name: z.string().min(1),
  dept: z.string().min(1),
  role: z.string().min(1),
  dob: dateStr.optional(),
  joinedAt: dateStr,
  email: z.string().email(),
  phone: z.string().optional(),
  // Sales draws no salary — commission-only, see SALES_COMMISSION_RATE —
  // so 0 is valid, not just positive amounts.
  salary: z.number().nonnegative(),
  empType: z.enum(["PERMANENT", "PROBATION"]),
  // Optional: HR can grant ERP login access at creation time instead of the
  // old plaintext-password-on-the-employee-row approach.
  grantAccess: z
    .object({
      password: z.string().min(8),
      roles: z.array(z.enum(["ADMIN", "HR", "FINANCE", "SALES", "CONTENT", "EMPLOYEE"])).default(["EMPLOYEE"]),
    })
    .optional(),
});

export const employeeUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  dept: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  dob: dateStr.optional(),
  joinedAt: dateStr.optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  salary: z.number().nonnegative().optional(),
  empType: z.enum(["PERMANENT", "PROBATION"]).optional(),
});

export const noticePeriodSchema = z.object({
  leavingDate: dateStr,
  note: z.string().optional(),
});

export const confirmDepartureSchema = z.object({
  leavingDate: dateStr.optional(),
});

// Grants ERP access to an employee who doesn't have it yet, or resets the
// password of one who already does — same shape either way. Roles are only
// applied when creating the login for the first time; resetting an existing
// login's password never silently changes their roles.
export const grantAccessSchema = z.object({
  password: z.string().min(8),
  roles: z.array(z.enum(["ADMIN", "HR", "FINANCE", "SALES", "CONTENT", "EMPLOYEE"])).default(["EMPLOYEE"]),
});

export const salaryRevisionSchema = z.object({
  amount: z.number().positive(),
  effectiveDate: dateStr,
  note: z.string().optional(),
});

export const attendanceMarkSchema = z.object({
  employeeId: z.string().uuid(),
  date: dateStr,
  status: z.enum(["PRESENT", "LATE", "HALF_DAY", "ABSENT", "ON_LEAVE", "WFH"]),
  checkIn: z.string().optional(),
});

export const leaveRequestCreateSchema = z.object({
  employeeId: z.string().uuid().optional(), // HR only — self-service infers from the caller
  type: z.enum(["CASUAL", "SICK", "EARNED", "UNPAID"]),
  duration: z.enum(["FULL_DAY", "HALF_DAY", "QUARTER_DAY"]).default("FULL_DAY"),
  fromDate: dateStr,
  toDate: dateStr,
  days: z.number().positive(),
  reason: z.string().min(1),
});

export const leaveDecisionSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().optional(),
});

export const leaveBalanceAdjustmentSchema = z.object({
  employeeId: z.string().uuid(),
  type: z.enum(["CASUAL", "SICK", "EARNED"]),
  days: z.number().refine((n) => n !== 0, "days can't be zero"),
  note: z.string().optional(),
});

export const advanceCreateSchema = z.object({
  employeeId: z.string().uuid().optional(), // HR only — self-service infers from the caller
  amount: z.number().positive(),
  reason: z.string().min(1),
  installments: z.number().int().positive(),
});

export const advanceDecisionSchema = z.object({
  status: z.enum(["RECOVERING", "REJECTED"]),
});

export const complaintCreateSchema = z.object({
  category: z.string().min(1),
  dept: z.string().optional(),
  text: z.string().min(1),
});

export const complaintUpdateSchema = z.object({
  status: z.enum(["NEW", "REVIEWED", "RESOLVED"]),
  note: z.string().optional(),
});

export const positionCreateSchema = z.object({
  role: z.string().min(1),
  dept: z.string().min(1),
  openings: z.number().int().positive(),
});

export const positionUpdateSchema = z.object({
  role: z.string().min(1).optional(),
  dept: z.string().min(1).optional(),
  openings: z.number().int().positive().optional(),
  status: z.enum(["OPEN", "ON_HOLD", "CLOSED"]).optional(),
});

export const candidateCreateSchema = z.object({
  positionId: z.string().uuid(),
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
});

export const candidateUpdateSchema = z.object({
  stage: z.enum(["APPLIED", "INTERVIEW", "OFFER", "HIRED", "REJECTED"]).optional(),
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
});

export const noticeCreateSchema = z.object({
  title: z.string().min(1),
  message: z.string().min(1),
});

export const noticeUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  message: z.string().min(1).optional(),
});

export const policyUpdateSchema = z.object({
  casualLeaveDays: z.number().int().nonnegative().optional(),
  sickLeaveDays: z.number().int().nonnegative().optional(),
  earnedLeaveDays: z.number().int().nonnegative().optional(),
  weeklyOff: z.number().int().min(0).max(6).optional(),
  generalNotes: z.string().optional(),
  leavePayNotes: z.string().optional(),
});

export const holidayCreateSchema = z.object({
  date: dateStr,
  name: z.string().min(1),
});

export const payrollEntrySchema = z.object({
  employeeId: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Expected YYYY-MM"),
  gross: z.number().positive(),
});

export const payrollPaymentSchema = z.object({
  amount: z.number().positive(),
  paidDate: dateStr.optional(),
  note: z.string().optional(),
});
