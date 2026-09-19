import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { resolveScopedEmployeeId } from "../../middleware/hrAccess";
import { payrollEntrySchema, payrollPaymentSchema } from "../../validation/hr.schemas";
import { computePayrollRow as computeRow, applyAdvanceRecovery } from "../../services/hr/payrollCalc";

// HR/Admin only (mounted behind requireHRAdmin) — only employees HR has
// actually added an entry for show up, same as the old prototype.
export const listPayrollForMonth: RequestHandler = asyncHandler(async (req, res) => {
  const month = req.query.month as string;
  if (!month) return res.status(400).json({ error: "month (YYYY-MM) is required" });

  const entries = await prisma.payrollEntry.findMany({
    where: { month },
    include: { employee: { select: { id: true, name: true, employeeCode: true, dept: true } } },
  });

  const rows = await Promise.all(entries.map((e) => computeRow(e.employeeId, month)));
  res.json({ month, rows });
});

// Any signed-in employee's OWN payroll history (pinned to their token's employeeId —
// no id in the URL to tamper with). Deliberately just the headline figures the
// employee-facing screen shows (salary, pay cuts, final salary, what's paid) rather
// than the internal Basic/HRA/PF/PT breakdown HR works with.
export const listMyPayroll: RequestHandler = asyncHandler(async (req, res) => {
  const employeeId = req.user?.employeeId;
  if (!employeeId) return res.json({ rows: [] });
  const entries = await prisma.payrollEntry.findMany({ where: { employeeId }, select: { month: true }, orderBy: { month: "desc" } });
  const computed = await Promise.all(entries.map((e) => computeRow(employeeId, e.month)));
  const rows = computed.filter((r): r is NonNullable<typeof r> => r !== null).map((r) => ({
    month: r.month, gross: r.gross, lopDays: r.lopDays, lopDeduction: r.lopDeduction,
    net: r.net, paid: r.paid, balance: r.balance, payStatus: r.payStatus,
  }));
  res.json({ rows });
});

export const getPayrollEntry: RequestHandler = asyncHandler(async (req, res) => {
  const { employeeId, month } = req.params;
  const scoped = resolveScopedEmployeeId(req, employeeId);
  if (!scoped || scoped !== employeeId) {
    return res.status(403).json({ error: "Forbidden — you can only view your own payroll" });
  }
  const row = await computeRow(employeeId, month);
  if (!row) return res.status(404).json({ error: "No payroll entry for that employee/month" });
  res.json({ row });
});

// HR/Admin only — upsert this month's gross for an employee. Doesn't touch
// payments; a gross change after payments exist just changes net/balance on
// the next read, same as the original (nothing here is snapshotted).
export const upsertPayrollEntry: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = payrollEntrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const entry = await prisma.payrollEntry.upsert({
    where: { employeeId_month: { employeeId: d.employeeId, month: d.month } },
    create: { employeeId: d.employeeId, month: d.month, gross: d.gross },
    update: { gross: d.gross },
  });

  await recordAudit({
    userId: req.user!.sub,
    action: "HR_PAYROLL_ENTRY_UPSERT",
    entityType: "PayrollEntry",
    entityId: entry.id,
    afterData: d,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
  });

  res.status(201).json({ entry });
});

// HR/Admin only — append-only. A payment that fully clears the balance also
// applies that month's deduction to every Recovering advance for this
// employee, same side effect as the old openRecordPayment().
export const recordPayrollPayment: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = payrollPaymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const { employeeId, month } = req.params;

  const before = await computeRow(employeeId, month);
  if (!before) return res.status(404).json({ error: "No payroll entry for that employee/month" });
  if (before.balance <= 0) return res.status(409).json({ error: "This payroll entry is already fully paid" });

  const amount = Math.max(1, Math.min(d.amount, before.balance));
  const isFull = amount >= before.balance;

  const entry = await prisma.payrollEntry.findUniqueOrThrow({ where: { employeeId_month: { employeeId, month } } });
  const payment = await prisma.payrollPayment.create({
    data: {
      payrollEntryId: entry.id,
      amount,
      paidDate: d.paidDate ? new Date(d.paidDate) : new Date(),
      note: d.note || (isFull ? "Full settlement" : "Partial payment"),
      recordedBy: req.user!.sub,
    },
  });

  if (isFull) await applyAdvanceRecovery(prisma, employeeId);

  await recordAudit({
    userId: req.user!.sub,
    action: "HR_PAYROLL_PAYMENT",
    entityType: "PayrollEntry",
    entityId: entry.id,
    afterData: { amount, isFull },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
  });

  res.status(201).json({ payment, isFull });
});
