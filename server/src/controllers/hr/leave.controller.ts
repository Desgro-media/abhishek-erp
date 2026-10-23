import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { isHRAdmin, resolveScopedEmployeeId } from "../../middleware/hrAccess";
import { leaveRequestCreateSchema, leaveDecisionSchema } from "../../validation/hr.schemas";
import { computeMonthlyLeaveUsage, getLeaveLedger, ensureCarryForward, thisMonth } from "../../services/hr/leaveBalance";
import { leaveAdjustmentSchema, balanceUpdateSchema } from "../../validation/hr.schemas";
import { sendMail, detailsHtml, HR_MAIL } from "../../services/mail.service";
import { loadWorkingDayCheck, eachDay, requestLoad, DURATION_FRACTION } from "../../services/hr/leaveDays";


// The company's "this month" — IST, so between midnight and 5:30 am on the 1st it is already the new month.
function currentMonth(): string {
  return thisMonth();
}

// Every date from `from` to `to` inclusive, at UTC midnight — matches how
// @db.Date columns come back from Prisma, so these compare/upsert cleanly
// against AttendanceRecord.date.
function eachDateInclusive(from: Date, to: Date): Date[] {
  const dates: Date[] = [];
  let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const last = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cursor <= last) {
    dates.push(cursor);
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return dates;
}

// HR/Admin only (mounted behind requireHRAdmin) — the leave summary table
// needs every employee's usage at once; this does the N computations
// server-side in one request instead of the frontend firing N of them.
// Defaults to the current month — this is a monthly cap, not a running
// balance, so there's nothing meaningful to show "as of no particular month".
export const listAllLeaveBalances: RequestHandler = asyncHandler(async (req, res) => {
  const month = (req.query.month as string) || currentMonth();
  const employeeList = await prisma.employee.findMany({ select: { id: true } });
  const entries = await Promise.all(
    employeeList.map(async (e) => [e.id, await computeMonthlyLeaveUsage(e.id, month)] as const)
  );
  res.json({ month, balances: Object.fromEntries(entries) });
});

export const listLeaveRequests: RequestHandler = asyncHandler(async (req, res) => {
  const requestedEmployeeId = req.query.employeeId as string | undefined;
  const scoped = resolveScopedEmployeeId(req, requestedEmployeeId);

  if (!isHRAdmin(req.user?.roles) && !scoped) {
    return res.json({ leaveRequests: [] }); // no linked employee record — nothing to show
  }

  const requests = await prisma.leaveRequest.findMany({
    where: {
      employeeId: isHRAdmin(req.user?.roles) ? requestedEmployeeId : scoped!,
      status: req.query.status as any,
    },
    include: isHRAdmin(req.user?.roles) ? { employee: { select: { id: true, name: true, employeeCode: true } } } : undefined,
    orderBy: { appliedAt: "desc" },
  });
  res.json({ leaveRequests: requests });
});

export const createLeaveRequest: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = leaveRequestCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const employeeId = resolveScopedEmployeeId(req, d.employeeId);
  if (!employeeId) {
    return res.status(isHRAdmin(req.user?.roles) ? 400 : 403).json({
      error: isHRAdmin(req.user?.roles) ? "employeeId is required" : "No HR record is linked to your login",
    });
  }

  if (d.toDate < d.fromDate) return res.status(400).json({ error: "The To date can't be before the From date" });
  if (eachDay(d.fromDate, d.toDate).length > 92) return res.status(400).json({ error: "A request can cover at most 92 days" });

  // The days a request costs are worked out here, never taken from the browser: working days only (not the weekly off or a holiday),
  // or the fraction for a single-day half / quarter day.
  const isWorking = await loadWorkingDayCheck();
  const duration = d.fromDate === d.toDate ? d.duration : "FULL_DAY";
  const workingDates = eachDay(d.fromDate, d.toDate).filter(isWorking);
  if (!workingDates.length) return res.status(400).json({ error: d.fromDate === d.toDate ? `${d.fromDate} is a weekly off or holiday — nothing to apply for` : "Every day in that range is a weekly off or holiday — nothing to apply for" });
  const days = duration === "FULL_DAY" ? workingDates.length : DURATION_FRACTION[duration];

  // No double booking: across the employee's pending and approved requests, no date may take more than one whole day
  // (so two half days on one date are fine, a half day over a full-day request is not).
  const mine = await prisma.leaveRequest.findMany({
    where: { employeeId, status: { in: ["PENDING", "APPROVED"] }, fromDate: { lte: new Date(d.toDate) }, toDate: { gte: new Date(d.fromDate) } },
    select: { duration: true, fromDate: true, toDate: true },
  });
  const load: Record<string, number> = {};
  for (const r of mine) for (const [day, w] of Object.entries(requestLoad(r, isWorking))) load[day] = (load[day] ?? 0) + w;
  const clash = Object.entries(requestLoad({ duration, fromDate: new Date(d.fromDate), toDate: new Date(d.toDate) }, isWorking)).find(([day, w]) => (load[day] ?? 0) + w > 1);
  if (clash) return res.status(409).json({ error: `You already have a leave or WFH request covering ${clash[0]}` });

  // Paid allowance: Casual/Sick and WFH can't be requested beyond what is left for the month (approved + still-pending requests
  // count). Past the allowance the employee has to apply for Unpaid leave, which is Loss of Pay by design.
  if (d.type === "CASUAL_SICK" || d.type === "WFH") {
    const mine = d.type === "CASUAL_SICK";
    const asked: Record<string, number> = {};
    for (const [day, w] of Object.entries(requestLoad({ duration, fromDate: new Date(d.fromDate), toDate: new Date(d.toDate) }, isWorking))) asked[day.slice(0, 7)] = (asked[day.slice(0, 7)] ?? 0) + w;
    for (const [month, want] of Object.entries(asked)) {
      const usage = await computeMonthlyLeaveUsage(employeeId, month);
      const cap = mine ? usage.leaveCap : usage.wfhCap;
      const used = mine ? usage.leaveDays : usage.wfhDays;
      const [y, m] = month.split("-").map(Number);
      const pending = await prisma.leaveRequest.findMany({
        where: { employeeId, status: "PENDING", type: d.type, fromDate: { lt: new Date(Date.UTC(y, m, 1)) }, toDate: { gte: new Date(Date.UTC(y, m - 1, 1)) } },
        select: { duration: true, fromDate: true, toDate: true },
      });
      const held = pending.reduce((sum, r) => sum + Object.entries(requestLoad(r, isWorking)).filter(([day]) => day.slice(0, 7) === month).reduce((a, [, w]) => a + w, 0), 0);
      const left = Math.max(0, cap - used - held);
      if (want > left) {
        const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
        const what = mine ? "paid leave" : "WFH";
        return res.status(409).json({
          error: left > 0
            ? `You only have ${left} ${what} day${left === 1 ? "" : "s"} left for ${label} and this request needs ${want}. Shorten it${mine ? ", or apply for Unpaid leave for the rest" : ""}.`
            : `Your ${what} allowance for ${label} is finished — you can't apply for more${mine ? ". If you still need time off, apply for Unpaid leave" : ""}.`,
          code: "BALANCE_EXHAUSTED",
        });
      }
    }
  }

  const leaveRequest = await prisma.leaveRequest.create({
    data: {
      employeeId,
      type: d.type,
      duration,
      fromDate: new Date(d.fromDate),
      toDate: new Date(d.toDate),
      days,
      reason: d.reason,
      status: "PENDING",
    },
  });

  await recordAudit({
    userId: req.user!.sub,
    action: "HR_LEAVE_REQUEST_CREATE",
    entityType: "LeaveRequest",
    entityId: leaveRequest.id,
    afterData: { employeeId, type: d.type, days },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
  });

  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { name: true, email: true } });
  if (emp) {
    const span = d.fromDate === d.toDate ? d.fromDate : `${d.fromDate} to ${d.toDate}`;
    const rows = { Employee: emp.name, Type: d.type, Dates: span, Days: days, Reason: d.reason };
    sendMail("hr", { to: HR_MAIL(), subject: `Leave request: ${emp.name} (${span})`, html: detailsHtml("A new leave request is waiting for approval.", rows) });
    sendMail("hr", { to: emp.email, subject: "Your leave request was submitted", html: detailsHtml("HR has received your leave request and will review it.", rows) });
  }

  res.status(201).json({ leaveRequest });
});

// HR/Admin only (mounted behind requireHRAdmin). Approving a Full Day
// request writes Attendance for every date in range (ON_LEAVE for
// CASUAL_SICK, WFH for WFH, WFH_PARTIAL for PARTIAL_WFH) in the same transaction as the decision —
// Loss of Pay/WFH pay-cut are computed from Attendance, not from this
// request, so the two must never be left to drift apart as separate facts.
// Half/Quarter Day requests don't touch Attendance at all — there's no
// fractional "leave" status to mark (see the LeaveType enum comment).
export const decideLeaveRequest: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = leaveDecisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const before = await prisma.leaveRequest.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Leave request not found" });
  if (before.status !== "PENDING") return res.status(409).json({ error: "This request has already been decided" });

  const isWorking = await loadWorkingDayCheck();
  class Stop extends Error { constructor(public code: number, public body: object) { super("stop"); } }
  let leaveRequest;
  try {
    leaveRequest = await prisma.$transaction(async (tx) => {
      // Claim the decision atomically — if another HR login got there first, this matches nothing and nothing is written.
      const claimed = await tx.leaveRequest.updateMany({
        where: { id: req.params.id, status: "PENDING" },
        data: { status: d.status, note: d.note, decidedBy: req.user!.sub, decidedAt: new Date() },
      });
      if (!claimed.count) throw new Stop(409, { error: "This request has already been decided" });

      if (d.status === "APPROVED" && before.duration === "FULL_DAY") {
        const attendanceStatus = before.type === "WFH" ? "WFH" : before.type === "PARTIAL_WFH" ? "WFH_PARTIAL" : before.type === "UNPAID_LEAVE" ? "UNPAID_LEAVE" : "ON_LEAVE";
        // Working days only: a weekly off or holiday inside the range is never marked as leave (it would be charged as a day taken).
        const dates = eachDay(before.fromDate.toISOString().slice(0, 10), before.toDate.toISOString().slice(0, 10)).filter(isWorking).map((x) => new Date(`${x}T00:00:00.000Z`));
        // Someone marked Present / Late / Half day on one of these dates actually worked it — don't silently replace that.
        const worked = await tx.attendanceRecord.findMany({
          where: { employeeId: before.employeeId, date: { in: dates }, status: { in: ["PRESENT", "LATE", "HALF_DAY"] } },
          select: { date: true, status: true },
        });
        if (worked.length && !d.overwriteAttendance) {
          throw new Stop(409, { error: `Already marked as worked on ${worked.map((w) => w.date.toISOString().slice(0, 10)).join(", ")} — approving would replace that attendance`, code: "ATTENDANCE_CONFLICT", conflicts: worked.map((w) => ({ date: w.date.toISOString().slice(0, 10), status: w.status })) });
        }
        for (const date of dates) {
          await tx.attendanceRecord.upsert({
            where: { employeeId_date: { employeeId: before.employeeId, date } },
            create: { employeeId: before.employeeId, date, status: attendanceStatus, markedBy: req.user!.sub },
            update: { status: attendanceStatus, markedBy: req.user!.sub },
          });
        }
      }
      return tx.leaveRequest.findUniqueOrThrow({ where: { id: req.params.id } });
    });
  } catch (e) {
    if (e instanceof Stop) return res.status(e.code).json(e.body);
    throw e;
  }

  await recordAudit({
    userId: req.user!.sub,
    action: "HR_LEAVE_REQUEST_DECIDE",
    entityType: "LeaveRequest",
    entityId: leaveRequest.id,
    beforeData: { status: before.status },
    afterData: { status: d.status, note: d.note, overwroteAttendance: d.overwriteAttendance || undefined },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
  });

  const emp = await prisma.employee.findUnique({ where: { id: before.employeeId }, select: { name: true, email: true } });
  if (emp) {
    const verdict = d.status === "APPROVED" ? "approved" : "rejected";
    sendMail("hr", {
      to: emp.email,
      subject: `Your leave request was ${verdict}`,
      html: detailsHtml(`Your leave request has been ${verdict}.`, {
        Type: before.type, From: before.fromDate.toISOString().slice(0, 10), To: before.toDate.toISOString().slice(0, 10), Days: Number(before.days), Note: d.note,
      }),
    });
  }

  res.json({ leaveRequest });
});

// Withdraw a request that hasn't been decided yet: the employee's own, or any (HR). Nothing was ever written to attendance for a pending one.
export const cancelLeaveRequest: RequestHandler = asyncHandler(async (req, res) => {
  const before = await prisma.leaveRequest.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Leave request not found" });
  const scoped = resolveScopedEmployeeId(req, before.employeeId);
  if (!isHRAdmin(req.user?.roles) && scoped !== before.employeeId) return res.status(403).json({ error: "Forbidden — you can only cancel your own request" });
  const claimed = await prisma.leaveRequest.updateMany({ where: { id: before.id, status: "PENDING" }, data: { status: "CANCELLED", decidedBy: req.user!.sub, decidedAt: new Date() } });
  if (!claimed.count) return res.status(409).json({ error: "Only a pending request can be cancelled" });
  await recordAudit({ userId: req.user!.sub, action: "HR_LEAVE_REQUEST_CANCEL", entityType: "LeaveRequest", entityId: before.id, beforeData: { status: "PENDING" }, afterData: { status: "CANCELLED" }, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.json({ leaveRequest: await prisma.leaveRequest.findUniqueOrThrow({ where: { id: before.id } }) });
});

// Defaults to the current month — see listAllLeaveBalances.
export const getLeaveBalance: RequestHandler = asyncHandler(async (req, res) => {
  const targetId = req.params.employeeId;
  const scoped = resolveScopedEmployeeId(req, targetId);
  if (!scoped || scoped !== targetId) {
    return res.status(403).json({ error: "Forbidden — you can only view your own leave balance" });
  }
  const month = (req.query.month as string) || currentMonth();
  const balance = await computeMonthlyLeaveUsage(targetId, month);
  // ?history=1 adds the month-by-month ledger (granted / carried in / used / carried out).
  const ledger = req.query.history ? await getLeaveLedger(targetId) : undefined;
  res.json({ balance, ledger });
});

// HR/Admin only — grant or remove paid-leave days for one month, with a reason. Recorded as its own
// append-only ledger entry (never edits history); later months' carry-forward is then reconciled.
export const addLeaveAdjustment: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = leaveAdjustmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const employeeId = req.params.employeeId;
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
  if (!emp) return res.status(404).json({ error: "Employee not found" });

  const entry = await prisma.leaveLedgerEntry.create({
    data: { employeeId, kind: "ADJUSTMENT", month: d.month, days: d.days, note: d.note, createdBy: req.user!.sub },
  });
  await ensureCarryForward(employeeId, thisMonth(), prisma, { reconcile: true });
  await recordAudit({ userId: req.user!.sub, action: "HR_LEAVE_ADJUSTMENT", entityType: "Employee", entityId: employeeId, afterData: d, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.status(201).json({ entry });
});

// HR/Admin only — "Update Balances". HR enters the remaining Paid Leave and/or WFH balance they want for a month;
// we store (target − current remaining) as an ADJUSTMENT on top of the computed value, with old/new/reason/who,
// so a later Attendance correction still flows through and the audit chain stays intact. The month's usage is
// still counted from Attendance — nothing here stores "used".
export const updateLeaveBalances: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = balanceUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const employeeId = req.params.employeeId;
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
  if (!emp) return res.status(404).json({ error: "Employee not found" });

  const changes = await prisma.$transaction(async (tx) => {
    const usage = await computeMonthlyLeaveUsage(employeeId, d.month, tx);
    const out: { bucket: "PAID_LEAVE" | "WFH"; oldValue: number; newValue: number; delta: number }[] = [];
    const apply = async (bucket: "PAID_LEAVE" | "WFH", target: number | undefined, cap: number, used: number) => {
      if (target === undefined) return;
      const oldValue = cap - used; // can go negative: that's LOP / pay-cut territory, which is exactly what HR may be fixing
      const delta = target - oldValue;
      if (delta === 0) return;
      await tx.leaveLedgerEntry.create({
        data: { employeeId, kind: "ADJUSTMENT", bucket, month: d.month, days: delta, oldValue, newValue: target, note: d.reason, createdBy: req.user!.sub },
      });
      out.push({ bucket, oldValue, newValue: target, delta });
    };
    await apply("PAID_LEAVE", d.paidLeaveBalance, usage.leaveCap, usage.leaveDays);
    await apply("WFH", d.wfhBalance, usage.wfhCap, usage.wfhDays);
    return out;
  });
  if (!changes.length) return res.status(400).json({ error: "Those balances are already what the system calculates — nothing to change" });

  await ensureCarryForward(employeeId, thisMonth(), prisma, { reconcile: true });
  await recordAudit({ userId: req.user!.sub, action: "HR_LEAVE_BALANCE_UPDATE", entityType: "Employee", entityId: employeeId, beforeData: changes.map((c) => ({ bucket: c.bucket, value: c.oldValue })), afterData: { month: d.month, reason: d.reason, changes }, ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? null });
  res.status(201).json({ changes, balance: await computeMonthlyLeaveUsage(employeeId, d.month) });
});
