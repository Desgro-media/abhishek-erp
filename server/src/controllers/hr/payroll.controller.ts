import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { resolveScopedEmployeeId } from "../../middleware/hrAccess";
import { payrollEntrySchema, payrollPaymentSchema, payrollScheduleSchema } from "../../validation/hr.schemas";
import { computePayrollRow as computeRow, applyAdvanceRecovery } from "../../services/hr/payrollCalc";
import { buildSchedule, parseSplit, replaceSchedule } from "../../services/hr/payrollSchedule";

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
    wfhExcessDays: r.wfhExcessDays, wfhDeduction: r.wfhDeduction,
    net: r.net, paid: r.paid, balance: r.balance, payStatus: r.payStatus,
    // Read-only for the employee: when each part is due / was paid.
    schedule: r.schedule,
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

  // A brand-new month gets the company's default payout split, built from that month's real net pay.
  const entry = await prisma.$transaction(async (tx) => {
    const existed = await tx.payrollEntry.findUnique({ where: { employeeId_month: { employeeId: d.employeeId, month: d.month } } });
    const e = await tx.payrollEntry.upsert({
      where: { employeeId_month: { employeeId: d.employeeId, month: d.month } },
      create: { employeeId: d.employeeId, month: d.month, gross: d.gross },
      update: { gross: d.gross },
    });
    if (!existed) {
      const policy = await tx.hrPolicy.findUnique({ where: { id: 1 } });
      const row = await computeRow(d.employeeId, d.month, tx);
      if (row && row.net > 0) await replaceSchedule(tx, e.id, buildSchedule(row.net, d.month, parseSplit(policy?.payrollDefaultSplit)));
    }
    return e;
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

  if (isFull) await applyAdvanceRecovery(prisma, employeeId, month);

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

// HR/Finance/Admin — set this employee-month's payout plan: an explicit list of instalments, or reset to
// the company default. The amounts must add up to the month's net pay (so a split of an odd amount can't
// lose a rupee), and an instalment that is already fully paid can't be changed or moved — only what is
// still unpaid can be re-planned. Every change is audited with who / old / new.
export const setPayrollSchedule: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = payrollScheduleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const { employeeId, month } = req.params;

  const result = await prisma.$transaction(async (tx) => {
    const before = await computeRow(employeeId, month, tx);
    if (!before) return { status: 404, error: "No payroll entry for that employee/month" } as const;
    const entry = await tx.payrollEntry.findUniqueOrThrow({ where: { employeeId_month: { employeeId, month } } });

    let next: { amount: number; dueDate: string }[];
    if ("useDefault" in parsed.data) {
      const policy = await tx.hrPolicy.findUnique({ where: { id: 1 } });
      next = buildSchedule(before.net, month, parseSplit(policy?.payrollDefaultSplit));
    } else {
      next = parsed.data.instalments;
    }
    if (before.schedule.overpayment > 0) return { status: 409, error: `Net pay is ₹${before.schedule.overpayment} lower than what was already paid — resolve that overpayment first, a schedule can't fix it.` } as const;
    const total = Math.round(next.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    if (Math.abs(total - before.net) > 0.005) return { status: 400, error: `Instalments add up to ₹${total}, but this month's net pay is ₹${before.net}. They must match exactly.` } as const;

    // Paid instalments are frozen: the plan must keep them as they are, in the same positions.
    const paidRows = before.schedule.instalments.filter((i) => i.status === "Paid");
    for (const [idx, p] of paidRows.entries()) {
      const n = next[idx];
      if (!n || Math.abs(n.amount - p.amount) > 0.005 || n.dueDate !== p.dueDate) {
        return { status: 409, error: `Instalment ${idx + 1} (₹${p.amount}, due ${p.dueDate}) is already paid and can't be changed — only unpaid instalments can be re-planned.` } as const;
      }
    }

    await replaceSchedule(tx, entry.id, next);
    await recordAudit({
      userId: req.user!.sub, action: "HR_PAYROLL_SCHEDULE_SET", entityType: "PayrollEntry", entityId: entry.id,
      beforeData: { employeeId, month, instalments: before.schedule.instalments.map((i) => ({ amount: i.amount, dueDate: i.dueDate })) },
      afterData: { employeeId, month, instalments: next, source: "useDefault" in parsed.data ? "company default" : "manual" },
      ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null,
    }, tx);
    return { status: 200 } as const;
  });

  if (result.status !== 200) return res.status(result.status).json({ error: (result as any).error });
  res.json({ row: await computeRow(employeeId, month) });
});
