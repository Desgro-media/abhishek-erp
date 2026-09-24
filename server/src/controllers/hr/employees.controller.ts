import { RequestHandler } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { env } from "../../config/env";
import { isHRAdmin, resolveScopedEmployeeId } from "../../middleware/hrAccess";
import {
  employeeCreateSchema,
  employeeUpdateSchema,
  salaryRevisionSchema,
  noticePeriodSchema,
  confirmDepartureSchema,
  grantAccessSchema,
} from "../../validation/hr.schemas";

async function nextEmployeeCode(): Promise<string> {
  const last = await prisma.employee.findFirst({ orderBy: { employeeCode: "desc" } });
  const lastNum = last ? Number(last.employeeCode.replace("EMP-", "")) : 100;
  return `EMP-${lastNum + 1}`;
}

// Never send the linked User row itself (it carries passwordHash) — just
// whether one exists, so Edit Employee can offer "grant access" vs "reset
// password" without a second round trip.
function withAccessFlag<T extends { user: unknown }>(e: T) {
  const { user, ...rest } = e;
  return { ...rest, hasErpAccess: !!user };
}

// Directory/headcount/attendance-roster views all want the active + notice-
// period crowd by default and never the archive; pass ?employmentStatus=LEFT
// (or NOTICE_PERIOD) explicitly to see a specific bucket instead.
export const listEmployees: RequestHandler = asyncHandler(async (req, res) => {
  if (!isHRAdmin(req.user?.roles)) return res.status(403).json({ error: "Forbidden — HR/Admin access required" });
  const { dept, search, employmentStatus } = req.query as { dept?: string; search?: string; employmentStatus?: string };
  const employees = await prisma.employee.findMany({
    where: {
      dept: dept || undefined,
      employmentStatus: employmentStatus ? (employmentStatus as any) : { not: "LEFT" },
      ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
    },
    include: { user: { select: { id: true } } },
    orderBy: { name: "asc" },
  });
  res.json({ employees: employees.map(withAccessFlag) });
});

// Non-sensitive name+dept roster (no salary/PII) for pickers outside HR —
// e.g. CRM's Account Manager / Sales Person selects on a client — for roles
// that can't call listEmployees above.
export const listEmployeeDirectory: RequestHandler = asyncHandler(async (req, res) => {
  const roles = req.user?.roles ?? [];
  if (!roles.includes("ADMIN") && !roles.includes("HR") && !roles.includes("SALES") && !roles.includes("SALES_HEAD")) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const employees = await prisma.employee.findMany({
    where: { employmentStatus: { not: "LEFT" } },
    select: { id: true, employeeCode: true, name: true, dept: true },
    orderBy: { name: "asc" },
  });
  res.json({ employees });
});

export const getEmployee: RequestHandler = asyncHandler(async (req, res) => {
  const targetId = req.params.id;
  const scoped = resolveScopedEmployeeId(req, targetId);
  if (!scoped || scoped !== targetId) {
    return res.status(403).json({ error: "Forbidden — you can only view your own HR record" });
  }
  const employee = await prisma.employee.findUnique({ where: { id: targetId }, include: { user: { select: { id: true } } } });
  if (!employee) return res.status(404).json({ error: "Employee not found" });
  res.json({ employee: withAccessFlag(employee) });
});

// Self-service shortcut: resolves to the caller's own record without them
// needing to know their own Employee uuid.
export const getMyEmployeeRecord: RequestHandler = asyncHandler(async (req, res) => {
  const employeeId = req.user?.employeeId;
  if (!employeeId) return res.status(404).json({ error: "No HR record is linked to your login" });
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return res.status(404).json({ error: "Linked HR record not found" });
  res.json({ employee });
});

export const createEmployee: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = employeeCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const employeeCode = await nextEmployeeCode();
  const employee = await prisma.employee.create({
    data: {
      employeeCode,
      name: d.name,
      dept: d.dept,
      role: d.role,
      dob: d.dob ? new Date(d.dob) : null,
      joinedAt: new Date(d.joinedAt),
      email: d.email,
      phone: d.phone,
      salary: d.salary,
      empType: d.empType,
    },
  });

  let createdUserId: string | null = null;
  if (d.grantAccess) {
    const passwordHash = await bcrypt.hash(d.grantAccess.password, env.BCRYPT_SALT_ROUNDS);
    const user = await prisma.user.create({
      data: {
        name: d.name,
        email: d.email,
        passwordHash,
        roles: d.grantAccess.roles,
        employeeId: employee.id,
      },
    });
    createdUserId = user.id;
  }

  await recordAudit({
    userId: req.user!.sub,
    action: "HR_EMPLOYEE_CREATE",
    entityType: "Employee",
    entityId: employee.id,
    afterData: { ...employee, salary: employee.salary.toString(), grantedAccess: !!createdUserId },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
  });

  res.status(201).json({ employee });
});

export const updateEmployee: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = employeeUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const before = await prisma.employee.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Employee not found" });

  // Salary changes go through the salary-revisions endpoint so there's a
  // dated, reasoned history — not a silent overwrite here.
  const employee = await prisma.employee.update({
    where: { id: req.params.id },
    data: {
      name: d.name,
      dept: d.dept,
      role: d.role,
      dob: d.dob ? new Date(d.dob) : undefined,
      joinedAt: d.joinedAt ? new Date(d.joinedAt) : undefined,
      email: d.email,
      phone: d.phone,
      empType: d.empType,
    },
  });

  await recordAudit({
    userId: req.user!.sub,
    action: "HR_EMPLOYEE_UPDATE",
    entityType: "Employee",
    entityId: employee.id,
    beforeData: { ...before, salary: before.salary.toString() },
    afterData: { ...employee, salary: employee.salary.toString() },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
  });

  res.json({ employee });
});

export const listSalaryRevisions: RequestHandler = asyncHandler(async (req, res) => {
  const targetId = req.params.id;
  const scoped = resolveScopedEmployeeId(req, targetId);
  if (!scoped || scoped !== targetId) {
    return res.status(403).json({ error: "Forbidden — you can only view your own salary history" });
  }
  const revisions = await prisma.salaryRevision.findMany({ where: { employeeId: targetId }, orderBy: { effectiveDate: "asc" } });
  res.json({ revisions });
});

// HR/Admin only (mounted behind requireHRAdmin) — append-only, and updates
// the employee's current `salary` once the revision is already in effect.
export const addSalaryRevision: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = salaryRevisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const employeeId = req.params.id;

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return res.status(404).json({ error: "Employee not found" });

  const revision = await prisma.salaryRevision.create({
    data: { employeeId, amount: d.amount, effectiveDate: new Date(d.effectiveDate), note: d.note, createdBy: req.user!.sub },
  });

  const isEffectiveNow = new Date(d.effectiveDate) <= new Date();
  if (isEffectiveNow) {
    await prisma.employee.update({ where: { id: employeeId }, data: { salary: d.amount } });
  }

  await recordAudit({
    userId: req.user!.sub,
    action: "HR_SALARY_REVISION",
    entityType: "Employee",
    entityId: employeeId,
    beforeData: { salary: employee.salary.toString() },
    afterData: { amount: d.amount, effectiveDate: d.effectiveDate, appliedImmediately: isEffectiveNow },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
  });

  res.status(201).json({ revision });
});

// Grants ERP access to an employee who doesn't have it yet (creates their
// User row), or resets the password of one who already does (updates the
// existing row in place — never creates a duplicate). HR/Admin only.
export const grantAccess: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = grantAccessSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const employeeId = req.params.id;

  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, include: { user: true } });
  if (!employee) return res.status(404).json({ error: "Employee not found" });

  const passwordHash = await bcrypt.hash(d.password, env.BCRYPT_SALT_ROUNDS);
  const wasExisting = !!employee.user;

  if (wasExisting) {
    await prisma.user.update({ where: { id: employee.user!.id }, data: { passwordHash } });
  } else {
    await prisma.user.create({
      data: { name: employee.name, email: employee.email, passwordHash, roles: d.roles, employeeId: employee.id },
    });
  }

  await recordAudit({
    userId: req.user!.sub,
    action: wasExisting ? "HR_EMPLOYEE_PASSWORD_RESET" : "HR_EMPLOYEE_GRANT_ACCESS",
    entityType: "Employee",
    entityId: employeeId,
    afterData: wasExisting ? {} : { roles: d.roles },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
  });

  res.json({ hasErpAccess: true });
});

// ---- Offboarding lifecycle: ACTIVE <-> NOTICE_PERIOD -> LEFT -> ACTIVE ----
// All four are HR/Admin only (mounted behind requireHRAdmin) and every
// transition is audit-logged (who/when/on whom) via recordAudit().

export const markNoticePeriod: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = noticePeriodSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const employeeId = req.params.id;

  const before = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!before) return res.status(404).json({ error: "Employee not found" });
  if (before.employmentStatus === "LEFT") return res.status(409).json({ error: "This employee has already left — reinstate them first" });

  // Notice period is purely informational — access stays active until
  // departure is actually confirmed, so no User row is touched here.
  const employee = await prisma.employee.update({
    where: { id: employeeId },
    data: { employmentStatus: "NOTICE_PERIOD", leavingDate: new Date(d.leavingDate), noticeGivenDate: new Date(), noticeNote: d.note },
  });

  await recordAudit({
    userId: req.user!.sub,
    action: "HR_EMPLOYEE_NOTICE_PERIOD",
    entityType: "Employee",
    entityId: employeeId,
    beforeData: { employmentStatus: before.employmentStatus },
    afterData: { employmentStatus: "NOTICE_PERIOD", leavingDate: d.leavingDate, note: d.note },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
  });

  res.json({ employee });
});

export const cancelNoticePeriod: RequestHandler = asyncHandler(async (req, res) => {
  const employeeId = req.params.id;
  const before = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!before) return res.status(404).json({ error: "Employee not found" });
  if (before.employmentStatus !== "NOTICE_PERIOD") return res.status(409).json({ error: "This employee isn't on notice period" });

  const employee = await prisma.employee.update({
    where: { id: employeeId },
    data: { employmentStatus: "ACTIVE", leavingDate: null, noticeGivenDate: null, noticeNote: null },
  });

  await recordAudit({
    userId: req.user!.sub,
    action: "HR_EMPLOYEE_NOTICE_CANCEL",
    entityType: "Employee",
    entityId: employeeId,
    beforeData: { employmentStatus: before.employmentStatus, leavingDate: before.leavingDate },
    afterData: { employmentStatus: "ACTIVE" },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
  });

  res.json({ employee });
});

// The one transition that actually locks someone out: soft-archives the
// Employee row (never deleted) and, if they had ERP login, deactivates that
// User and revokes every one of their refresh tokens so an already-open
// session can't just refresh its way past the lockout.
export const confirmDeparture: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = confirmDepartureSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const employeeId = req.params.id;

  const before = await prisma.employee.findUnique({ where: { id: employeeId }, include: { user: true } });
  if (!before) return res.status(404).json({ error: "Employee not found" });
  if (before.employmentStatus === "LEFT") return res.status(409).json({ error: "This employee has already left" });

  const leavingDate = new Date(d.leavingDate ?? before.leavingDate ?? new Date());

  const employee = await prisma.$transaction(async (tx) => {
    const updated = await tx.employee.update({
      where: { id: employeeId },
      data: { employmentStatus: "LEFT", leavingDate },
    });
    if (before.user) {
      await tx.user.update({ where: { id: before.user.id }, data: { active: false } });
      await tx.refreshToken.updateMany({ where: { userId: before.user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    return updated;
  });

  await recordAudit({
    userId: req.user!.sub,
    action: "HR_EMPLOYEE_DEPARTURE_CONFIRM",
    entityType: "Employee",
    entityId: employeeId,
    beforeData: { employmentStatus: before.employmentStatus },
    afterData: { employmentStatus: "LEFT", leavingDate: leavingDate.toISOString(), loginRevoked: !!before.user },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
  });

  res.json({ employee });
});

export const reinstateEmployee: RequestHandler = asyncHandler(async (req, res) => {
  const employeeId = req.params.id;
  const before = await prisma.employee.findUnique({ where: { id: employeeId }, include: { user: true } });
  if (!before) return res.status(404).json({ error: "Employee not found" });
  if (before.employmentStatus !== "LEFT") return res.status(409).json({ error: "This employee hasn't left" });

  const employee = await prisma.$transaction(async (tx) => {
    const updated = await tx.employee.update({
      where: { id: employeeId },
      data: { employmentStatus: "ACTIVE", leavingDate: null, noticeGivenDate: null, noticeNote: null },
    });
    if (before.user) {
      await tx.user.update({ where: { id: before.user.id }, data: { active: true } });
    }
    return updated;
  });

  await recordAudit({
    userId: req.user!.sub,
    action: "HR_EMPLOYEE_REINSTATE",
    entityType: "Employee",
    entityId: employeeId,
    beforeData: { employmentStatus: before.employmentStatus },
    afterData: { employmentStatus: "ACTIVE", loginRestored: !!before.user },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
  });

  res.json({ employee });
});
