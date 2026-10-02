import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { Decimal } from "@prisma/client/runtime/library";

function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}


const num = (d: Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
export function nextMonth(m: string): string { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 7); }
export function prevMonth(m: string): string { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7); }
export function thisMonth(): string { return new Date().toISOString().slice(0, 7); }

// ---- Carry-forward ledger -------------------------------------------------------------------
// Unused paid-leave days from a closed month roll into the next month's cap, up to
// HrPolicy.carryForwardMaxDays. Each roll-over is its own LeaveLedgerEntry (see schema) so HR can
// see exactly how a balance was arrived at. "Used" is always counted from Attendance, never stored.
// Fills in any missing months in order and is safe to call repeatedly / concurrently. With
// `reconcile`, existing rows that no longer match the attendance history (a past month was
// corrected) are superseded by a fresh row instead of edited.
export async function ensureCarryForward(
  employeeId: string,
  upToMonth: string,
  db: Prisma.TransactionClient = prisma,
  opts: { reconcile?: boolean } = {}
): Promise<void> {
  const policy = await db.hrPolicy.findUnique({ where: { id: 1 } });
  const maxCarry = policy?.carryForwardMaxDays ?? 0;
  const startMonth = policy?.carryForwardStartMonth;
  if (maxCarry <= 0 || !startMonth) return;
  const baseCap = policy?.paidLeavesPerMonth ?? 1;

  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { joinedAt: true } });
  if (!emp) return;
  const first = [startMonth, nextMonth(emp.joinedAt.toISOString().slice(0, 7))].sort().at(-1)!;
  const last = upToMonth < thisMonth() ? upToMonth : thisMonth();
  if (first > last) return;

  const entries = await db.leaveLedgerEntry.findMany({ where: { employeeId, supersededAt: null, month: { gte: prevMonth(first), lte: last } } });
  const carry: Record<string, (typeof entries)[number]> = {};
  const adj: Record<string, number> = {};
  for (const e of entries) {
    if (e.kind === "CARRY_FORWARD") carry[e.month] = e;
    else adj[e.month] = (adj[e.month] ?? 0) + num(e.days);
  }

  const { start } = monthRange(prevMonth(first));
  const { end } = monthRange(last);
  const leaveRecords = await db.attendanceRecord.findMany({
    where: { employeeId, status: "ON_LEAVE", date: { gte: start, lt: end } },
    select: { date: true },
  });
  const used: Record<string, number> = {};
  for (const r of leaveRecords) { const k = r.date.toISOString().slice(0, 7); used[k] = (used[k] ?? 0) + 1; }

  const toCreate: Prisma.LeaveLedgerEntryCreateManyInput[] = [];
  const toSupersede: string[] = [];
  const carriedDays: Record<string, number> = {};
  for (const [m, row] of Object.entries(carry)) carriedDays[m] = num(row.days);

  for (let m = first; m <= last; m = nextMonth(m)) {
    const src = prevMonth(m);
    const sourceCap = Math.max(0, baseCap + (carriedDays[src] ?? 0) + (adj[src] ?? 0));
    const unused = Math.max(0, sourceCap - (used[src] ?? 0));
    const carried = Math.min(unused, maxCarry);
    const existing = carry[m];
    if (existing) {
      const stale = opts.reconcile && (num(existing.days) !== carried || num(existing.unusedDays) !== unused);
      if (!stale) continue;
      toSupersede.push(existing.id);
    }
    carriedDays[m] = carried;
    toCreate.push({
      employeeId, kind: "CARRY_FORWARD", month: m, days: carried, sourceMonth: src, sourceCap,
      unusedDays: unused, lapsedDays: unused - carried, capApplied: maxCarry,
      note: existing ? "Recalculated after attendance for the source month changed" : null,
    });
  }

  if (toSupersede.length) await db.leaveLedgerEntry.updateMany({ where: { id: { in: toSupersede } }, data: { supersededAt: new Date() } });
  if (toCreate.length) await db.leaveLedgerEntry.createMany({ data: toCreate, skipDuplicates: true });
}

export async function ensureCarryForwardAll(month: string, db: Prisma.TransactionClient = prisma): Promise<void> {
  const policy = await db.hrPolicy.findUnique({ where: { id: 1 } });
  if (!policy || policy.carryForwardMaxDays <= 0) return;
  const emps = await db.employee.findMany({ select: { id: true } });
  for (const e of emps) await ensureCarryForward(e.id, month, db);
}

// The paid-leave cap that actually applies to one employee in one month: the org-wide monthly cap
// plus days carried in plus HR adjustments. This is the single source payroll, the request form and
// HR's view all read.
export async function leaveCapFor(employeeId: string, month: string, db: Prisma.TransactionClient = prisma) {
  const policy = await db.hrPolicy.findUnique({ where: { id: 1 } });
  const base = policy?.paidLeavesPerMonth ?? 1;
  await ensureCarryForward(employeeId, month, db);
  const rows = await db.leaveLedgerEntry.findMany({ where: { employeeId, month, supersededAt: null } });
  const carriedIn = rows.filter((r) => r.kind === "CARRY_FORWARD").reduce((s, r) => s + num(r.days), 0);
  const adjustment = rows.filter((r) => r.kind === "ADJUSTMENT").reduce((s, r) => s + num(r.days), 0);
  return { base, carriedIn, adjustment, cap: Math.max(0, base + carriedIn + adjustment) };
}

// Loss-of-pay days for a given employee + payroll month = days marked
// ON_LEAVE in Attendance that month, beyond hrPolicy.paidLeavesPerMonth.
// Computed from Attendance, not LeaveRequest — approving a request writes
// Attendance (see decideLeaveRequest), so a later correction made directly
// to attendance stays correct even without touching the original request.
// `db` lets a caller already inside a transaction run this on that same connection.
export async function computeLopDays(employeeId: string, month: string, db: Prisma.TransactionClient = prisma): Promise<number> {
  const { cap } = await leaveCapFor(employeeId, month, db);
  const { start, end } = monthRange(month);

  const leaveCount = await db.attendanceRecord.count({
    where: { employeeId, status: "ON_LEAVE", date: { gte: start, lt: end } },
  });

  return Math.max(0, leaveCount - cap);
}

// WFH days beyond hrPolicy.paidWfhPerMonth in a given payroll month (plus every Partially Paid WFH day), paid at
// 75% (a 25% cut per excess day) instead of a full Loss of Pay — see
// computePayrollRow(). Counted from actual attendance records, same
// "derive from real history" approach computeLopDays takes for leave.
export async function computeWfhExcessDays(employeeId: string, month: string, db: Prisma.TransactionClient = prisma): Promise<number> {
  const policy = await db.hrPolicy.findUnique({ where: { id: 1 } });
  const cap = policy?.paidWfhPerMonth ?? 1;
  const { start, end } = monthRange(month);

  const [wfhCount, partialCount] = await Promise.all([
    db.attendanceRecord.count({ where: { employeeId, status: "WFH", date: { gte: start, lt: end } } }),
    db.attendanceRecord.count({ where: { employeeId, status: "WFH_PARTIAL", date: { gte: start, lt: end } } }),
  ]);

  // Partially Paid WFH days are always cut 25% and don't use up the free allowance, so they're
  // added on top of the plain-WFH excess — one figure, one 25% formula, in payroll and every preview.
  return Math.max(0, wfhCount - cap) + partialCount;
}

// Both leave and WFH usage for a month in one shot, against the org-wide
// caps — powers HR's "Leave & WFH this month" panel and an employee's own
// pre-submit pay-impact preview on Apply for Leave, so both read the exact
// same figures payroll actually deducts against (computeLopDays/computeWfhExcessDays).
export async function computeMonthlyLeaveUsage(employeeId: string, month: string, db: Prisma.TransactionClient = prisma) {
  const policy = await db.hrPolicy.findUnique({ where: { id: 1 } });
  const leave = await leaveCapFor(employeeId, month, db);
  const leaveCap = leave.cap;
  const wfhCap = policy?.paidWfhPerMonth ?? 1;
  const { start, end } = monthRange(month);

  const grouped = await db.attendanceRecord.groupBy({
    by: ["status"],
    where: { employeeId, status: { in: ["ON_LEAVE", "WFH", "WFH_PARTIAL"] }, date: { gte: start, lt: end } },
    _count: { _all: true },
  });
  const leaveDays = grouped.find((g) => g.status === "ON_LEAVE")?._count._all ?? 0;
  const wfhDays = grouped.find((g) => g.status === "WFH")?._count._all ?? 0;
  const partialWfhDays = grouped.find((g) => g.status === "WFH_PARTIAL")?._count._all ?? 0;

  return {
    month,
    leaveDays,
    leaveBaseCap: leave.base,
    leaveCarriedIn: leave.carriedIn,
    leaveAdjustment: leave.adjustment,
    // What would roll into next month if the month ended now (0 when carry-forward is off).
    leaveCarryOutProjected: Math.min(Math.max(0, leaveCap - leaveDays), policy?.carryForwardMaxDays ?? 0),
    leaveCap,
    leaveRemaining: Math.max(0, leaveCap - leaveDays),
    lopDays: Math.max(0, leaveDays - leaveCap),
    wfhDays,
    wfhCap,
    wfhRemaining: Math.max(0, wfhCap - wfhDays),
    partialWfhDays,
    // Plain WFH beyond the allowance + every Partially Paid WFH day — each a 25% cut.
    wfhExcessDays: Math.max(0, wfhDays - wfhCap) + partialWfhDays,
  };
}

export function decimalToNumber(d: Decimal | number | null | undefined): number {
  if (d == null) return 0;
  return typeof d === "number" ? d : Number(d);
}

// Month-by-month history for the balance card / HR's dispute view: what was granted, carried in,
// adjusted, used, and what rolled out or lapsed — plus the raw ledger entries (superseded ones
// included) so the arithmetic is auditable.
export async function getLeaveLedger(employeeId: string, months = 6, db: Prisma.TransactionClient = prisma) {
  const current = thisMonth();
  await ensureCarryForward(employeeId, current, db);
  let m = current;
  for (let i = 1; i < months; i++) m = prevMonth(m);
  const from = m;

  const policy = await db.hrPolicy.findUnique({ where: { id: 1 } });
  const maxCarry = policy?.carryForwardMaxDays ?? 0;
  const entries = await db.leaveLedgerEntry.findMany({ where: { employeeId, month: { gte: from } }, orderBy: [{ month: "desc" }, { createdAt: "desc" }] });
  const { start } = monthRange(from);
  const { end } = monthRange(current);
  const leaveRecords = await db.attendanceRecord.findMany({ where: { employeeId, status: "ON_LEAVE", date: { gte: start, lt: end } }, select: { date: true } });
  const used: Record<string, number> = {};
  for (const r of leaveRecords) { const k = r.date.toISOString().slice(0, 7); used[k] = (used[k] ?? 0) + 1; }

  const live = entries.filter((e) => !e.supersededAt);
  const rows = [];
  for (let mm = current; mm >= from; mm = prevMonth(mm)) {
    const carriedIn = live.filter((e) => e.month === mm && e.kind === "CARRY_FORWARD").reduce((s, e) => s + num(e.days), 0);
    const adjustment = live.filter((e) => e.month === mm && e.kind === "ADJUSTMENT").reduce((s, e) => s + num(e.days), 0);
    const base = policy?.paidLeavesPerMonth ?? 1;
    const cap = Math.max(0, base + carriedIn + adjustment);
    const usedDays = used[mm] ?? 0;
    const nextRow = live.find((e) => e.month === nextMonth(mm) && e.kind === "CARRY_FORWARD");
    const isCurrent = mm === current;
    rows.push({
      month: mm, granted: base, carriedIn, adjustment, cap, used: usedDays,
      lop: Math.max(0, usedDays - cap),
      carriedOut: nextRow ? num(nextRow.days) : isCurrent ? Math.min(Math.max(0, cap - usedDays), maxCarry) : 0,
      lapsed: nextRow ? num(nextRow.lapsedDays) : 0,
      closed: !isCurrent,
    });
    if (mm === from) break;
  }
  return {
    carryForwardMaxDays: maxCarry,
    months: rows,
    entries: entries.map((e) => ({
      id: e.id, kind: e.kind, month: e.month, days: num(e.days), sourceMonth: e.sourceMonth, sourceCap: e.sourceCap == null ? null : num(e.sourceCap),
      unusedDays: e.unusedDays == null ? null : num(e.unusedDays), lapsedDays: e.lapsedDays == null ? null : num(e.lapsedDays),
      capApplied: e.capApplied, note: e.note, createdBy: e.createdBy, createdAt: e.createdAt, superseded: !!e.supersededAt,
    })),
  };
}
