import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { resolveScopedEmployeeId } from "../../middleware/hrAccess";
import { payrollEntrySchema, payrollPaymentSchema } from "../../validation/hr.schemas";
import { computeLopDays } from "../../services/hr/leaveBalance";
import { workingDaysInMonth } from "../../services/hr/workingDays";

// Same formula as the old computePayrollRow() in app.js: 60/20/20 basic/HRA/
// special split, 12% PF on basic, flat ₹200 PT, LOP priced at gross/working
// days, advance deduction capped at each Recovering advance's balance.
async function computeRow(employeeId: string, month: string) {
  const entry = await prisma.payrollEntry.findUnique({
    where: { employeeId_month: { employeeId, month } },
    include: { payments: { orderBy: { paidDate: "asc" } } },
  });
  if (!entry) return null;

  const gross = Number(entry.gross);
  const basic = Math.round(gross * 0.6);
  const hra = Math.round(gross * 0.2);
  const special = gross - basic - hra;
  const pf = Math.round(basic * 0.12);
  const pt = 200;

  const recoveringAdvances = await prisma.advance.findMany({ where: { employeeId, status: "RECOVERING" } });
  const advDeduction = recoveringAdvances.reduce((sum, a) => sum + Math.min(Number(a.monthlyDeduction), Number(a.balance)), 0);

  const monthWorkingDays = await workingDaysInMonth(month);
  const lopDays = await computeLopDays(employeeId);
  const perDayRate = monthWorkingDays ? gross / monthWorkingDays : 0;
  const lopDeduction = Math.round(perDayRate * lopDays);

  const totalDeductions = pf + pt + advDeduction + lopDeduction;
  const net = gross - totalDeductions;
  const paid = entry.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const balance = Math.max(0, net - paid);
  const payStatus = paid <= 0 ? "Unpaid" : balance > 0 ? "Partially Paid" : "Paid";

  return {
    employeeId,
    month,
    gross,
    basic,
    hra,
    special,
    pf,
    pt,
    advDeduction,
    lopDays,
    lopDeduction,
    monthWorkingDays,
    totalDeductions,
    net,
    paid,
    balance,
    payStatus,
    payments: entry.payments,
  };
}

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

  if (isFull) {
    const recovering = await prisma.advance.findMany({ where: { employeeId, status: "RECOVERING" } });
    for (const a of recovering) {
      const newBalance = Math.max(0, Number(a.balance) - Number(a.monthlyDeduction));
      await prisma.advance.update({
        where: { id: a.id },
        data: { balance: newBalance, status: newBalance === 0 ? "RECOVERED" : "RECOVERING" },
      });
    }
  }

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
