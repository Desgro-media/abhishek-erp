/**
 * Unpaid leave: approving it marks Attendance UNPAID_LEAVE, and every such day is Loss of Pay in full
 * (never drawn from the paid-leave allowance).
 *   TEST_DATABASE_URL=postgresql://.../desgro_erp_test npm run test:e2e
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const testDbUrl = process.env.TEST_DATABASE_URL;
if (!testDbUrl || !/\/[^/?]*test[^/?]*(\?|$)/i.test(testDbUrl)) {
  console.error("Refusing to run: set TEST_DATABASE_URL to a database whose name contains 'test'.");
  process.exit(1);
}
process.env.DATABASE_URL = testDbUrl;
process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET ||= "x".repeat(40);

let server: Server;
let base: string;
let prisma: typeof import("../src/db/prisma").prisma;
const run = `u${Date.now().toString(36)}`;
let hr = "", empDbId = "", empTok = "", otherTok = "", other2Db = "";
const created = { users: [] as string[] };

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

let savedPolicy: { weeklyOff: number; paidLeavesPerMonth: number; paidWfhPerMonth: number } | null = null;

before(async () => {
  ({ prisma } = await import("../src/db/prisma"));
  const { app } = await import("../src/app");
  const { signAccessToken } = await import("../src/utils/tokens");
  const mkUser = async (label: string, roles: any[], employeeId: string | null) => {
    const u = await prisma.user.create({ data: { name: `${label} ${run}`, email: `${label}-${run}@test.local`, passwordHash: "x", roles } });
    created.users.push(u.id);
    return signAccessToken({ sub: u.id, email: u.email, name: u.name, roles, department: null, employeeId });
  };
  const mkEmp = (n: string) => prisma.employee.create({ data: { employeeCode: `E-${run}-${n}`, name: `Emp${n} ${run}`, dept: "Production", role: "Editor", joinedAt: new Date("2025-01-01"), email: `emp${n}-${run}@test.local`, salary: 30000, empType: "PERMANENT" } });
  const e = await mkEmp("1"), e2 = await mkEmp("2");
  empDbId = e.id; other2Db = e2.id;
  hr = await mkUser("hr", ["HR"], null);
  empTok = await mkUser("emp", ["EMPLOYEE"], e.id);
  otherTok = await mkUser("emp2", ["EMPLOYEE"], e2.id);
  // Sunday is the weekly off for these tests.
  const p = await prisma.hrPolicy.findUnique({ where: { id: 1 } });
  savedPolicy = p ? { weeklyOff: p.weeklyOff, paidLeavesPerMonth: p.paidLeavesPerMonth, paidWfhPerMonth: p.paidWfhPerMonth } : null;
  await prisma.hrPolicy.upsert({ where: { id: 1 }, create: { id: 1, weeklyOff: 0, paidLeavesPerMonth: 30, paidWfhPerMonth: 30 }, update: { weeklyOff: 0, paidLeavesPerMonth: 30, paidWfhPerMonth: 30 } }); // roomy allowance: these tests are about counting, not the balance block
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  const ids = [empDbId, other2Db];
  await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: ids } } });
  await prisma.attendanceRecord.deleteMany({ where: { employeeId: { in: ids } } });
  await prisma.leaveLedgerEntry.deleteMany({ where: { employeeId: { in: ids } } });
  await prisma.holiday.deleteMany({ where: { name: `t-${run}` } });
  await prisma.employee.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  if (savedPolicy) await prisma.hrPolicy.update({ where: { id: 1 }, data: savedPolicy });
  server?.close();
  await prisma.$disconnect();
});

const apply = (b: Record<string, unknown>, tok = empTok) => call("POST", "/hr/leave-requests", tok, { type: "CASUAL_SICK", reason: "t", ...b });
const decide = (id: string, status: string, extra: object = {}) => call("PATCH", `/hr/leave-requests/${id}`, hr, { status, ...extra });
const att = (date: string) => prisma.attendanceRecord.findMany({ where: { employeeId: empDbId, date: new Date(`${date}T00:00:00.000Z`) } });
const balance = async (month: string) => (await call("GET", `/hr/leave-balance/${empDbId}?month=${month}`, empTok)).body.balance;

test("days come from the dates, working days only: Friday-to-Monday over a Sunday is 3 days, and only those days are marked on approval", async () => {
  // 2026-03-13 Fri, 14 Sat, 15 Sun (weekly off), 16 Mon. The browser claims 99 days.
  const r = await apply({ fromDate: "2026-03-13", toDate: "2026-03-16", days: 99 });
  assert.equal(r.status, 201);
  assert.equal(Number(r.body.leaveRequest.days), 3);
  assert.equal((await decide(r.body.leaveRequest.id, "APPROVED")).status, 200);
  const rows = await prisma.attendanceRecord.findMany({ where: { employeeId: empDbId, status: "ON_LEAVE" }, orderBy: { date: "asc" } });
  assert.deepEqual(rows.map((x) => x.date.toISOString().slice(0, 10)), ["2026-03-13", "2026-03-14", "2026-03-16"], "the Sunday is not marked");
  assert.equal((await balance("2026-03")).leaveDays, 3);
});

test("a weekly off or holiday alone, a reversed range and a huge range are refused", async () => {
  assert.equal((await apply({ fromDate: "2026-03-22", toDate: "2026-03-22" })).status, 400, "Sunday");
  await prisma.holiday.create({ data: { date: new Date("2026-03-25"), name: `t-${run}` } });
  assert.equal((await apply({ fromDate: "2026-03-25", toDate: "2026-03-25" })).status, 400, "holiday");
  assert.equal((await apply({ fromDate: "2026-03-24", toDate: "2026-03-26" })).body.leaveRequest.days, "2", "the holiday inside a range isn't counted");
  assert.equal((await apply({ fromDate: "2026-03-30", toDate: "2026-03-28" })).status, 400);
  assert.equal((await apply({ fromDate: "2026-01-01", toDate: "2026-12-31", type: "WFH" })).status, 400);
});

test("no double booking: overlapping full days refused; two half days on one date fine, a third part is not", async () => {
  assert.equal((await apply({ fromDate: "2026-03-16", toDate: "2026-03-17" })).status, 409, "overlaps the approved request");
  assert.equal((await apply({ fromDate: "2026-03-16", toDate: "2026-03-16", type: "WFH", duration: "HALF_DAY" })).status, 409, "a half day over a full day");
  const a = await apply({ fromDate: "2026-04-07", toDate: "2026-04-07", duration: "HALF_DAY" });
  assert.equal(a.status, 201);
  assert.equal((await apply({ fromDate: "2026-04-07", toDate: "2026-04-07", type: "WFH", duration: "HALF_DAY" })).status, 201, "two halves make a day");
  assert.equal((await apply({ fromDate: "2026-04-07", toDate: "2026-04-07", duration: "QUARTER_DAY" })).status, 409, "that would be more than a day");
  assert.equal((await apply({ fromDate: "2026-04-07", toDate: "2026-04-09" })).status, 409, "a full-day range over a part-day");
  await call("POST", `/hr/leave-requests/${a.body.leaveRequest.id}/cancel`, empTok);
});

test("half and quarter days count as fractions against the allowance, with no attendance record", async () => {
  const mk = async (b: Record<string, unknown>) => { const r = await apply(b); assert.equal(r.status, 201, JSON.stringify(r.body)); await decide(r.body.leaveRequest.id, "APPROVED"); return r.body.leaveRequest; };
  await mk({ fromDate: "2026-05-04", toDate: "2026-05-04", duration: "HALF_DAY" });   // 0.5 paid leave
  await mk({ fromDate: "2026-05-05", toDate: "2026-05-05", duration: "HALF_DAY" });   // 1.0 — exactly the allowance
  let b = await balance("2026-05");
  assert.equal(b.leaveDays, 1); assert.equal(b.lopDays, 0); assert.equal(b.leaveRemaining, 0);
  await mk({ fromDate: "2026-05-06", toDate: "2026-05-06", duration: "QUARTER_DAY" }); // 1.25 — a quarter day over
  b = await balance("2026-05");
  assert.equal(b.leaveDays, 1.25); assert.equal(b.lopDays, 0.25);
  assert.equal(await prisma.attendanceRecord.count({ where: { employeeId: empDbId, date: { gte: new Date("2026-05-01"), lt: new Date("2026-06-01") } } }), 0, "no fractional attendance");
  await mk({ fromDate: "2026-05-07", toDate: "2026-05-07", type: "WFH", duration: "HALF_DAY" });
  await mk({ fromDate: "2026-05-08", toDate: "2026-05-08", type: "PARTIAL_WFH", duration: "HALF_DAY" });
  await mk({ fromDate: "2026-05-11", toDate: "2026-05-11", type: "UNPAID_LEAVE", duration: "HALF_DAY" });
  b = await balance("2026-05");
  assert.equal(b.wfhDays, 0.5); assert.equal(b.partialWfhDays, 0.5); assert.equal(b.wfhExcessDays, 0.5, "the partially paid half day is a half-day 25% cut");
  assert.equal(b.unpaidLeaveDays, 0.5); assert.equal(b.lopDays, 0.75, "0.25 over the allowance + 0.5 unpaid");
});

test("two HR logins approving at once: exactly one wins and the attendance is written once", async () => {
  const r = await apply({ fromDate: "2026-06-02", toDate: "2026-06-03" });
  const id = r.body.leaveRequest.id;
  const res = await Promise.all([decide(id, "APPROVED"), decide(id, "APPROVED"), decide(id, "REJECTED")]);
  assert.equal(res.filter((x) => x.status === 200).length, 1);
  assert.equal(res.filter((x) => x.status === 409).length, 2);
});

test("approving over a day marked Present is refused unless HR confirms the overwrite", async () => {
  await prisma.attendanceRecord.create({ data: { employeeId: empDbId, date: new Date("2026-07-06"), status: "PRESENT", markedBy: "t" } });
  await prisma.attendanceRecord.create({ data: { employeeId: empDbId, date: new Date("2026-07-07"), status: "ABSENT", markedBy: "t" } });
  const r = await apply({ fromDate: "2026-07-06", toDate: "2026-07-07" });
  const id = r.body.leaveRequest.id;
  const first = await decide(id, "APPROVED");
  assert.equal(first.status, 409);
  assert.equal(first.body.code, "ATTENDANCE_CONFLICT");
  assert.deepEqual(first.body.conflicts, [{ date: "2026-07-06", status: "PRESENT" }], "an Absent day is replaced without fuss");
  assert.equal((await att("2026-07-06"))[0].status, "PRESENT", "nothing written");
  assert.equal((await call("GET", `/hr/leave-requests?employeeId=${empDbId}`, hr)).body.leaveRequests.find((x: any) => x.id === id).status, "PENDING", "still pending, so HR can decide");
  assert.equal((await decide(id, "APPROVED", { overwriteAttendance: true })).status, 200);
  assert.equal((await att("2026-07-06"))[0].status, "ON_LEAVE");
});

test("cancel: own pending request only (HR any pending one); decided requests can't be cancelled; a cancelled one frees the dates", async () => {
  const mine = (await apply({ fromDate: "2026-08-04", toDate: "2026-08-04" })).body.leaveRequest.id;
  assert.equal((await call("POST", `/hr/leave-requests/${mine}/cancel`, otherTok)).status, 403, "someone else's");
  const c = await call("POST", `/hr/leave-requests/${mine}/cancel`, empTok);
  assert.equal(c.status, 200);
  assert.equal(c.body.leaveRequest.status, "CANCELLED");
  assert.equal((await call("POST", `/hr/leave-requests/${mine}/cancel`, empTok)).status, 409, "already cancelled");
  assert.equal((await decide(mine, "APPROVED")).status, 409, "can't approve a cancelled request");
  assert.equal((await apply({ fromDate: "2026-08-04", toDate: "2026-08-04" })).status, 201, "dates are free again");
  const done = (await apply({ fromDate: "2026-08-11", toDate: "2026-08-11" })).body.leaveRequest.id;
  await decide(done, "APPROVED");
  assert.equal((await call("POST", `/hr/leave-requests/${done}/cancel`, empTok)).status, 409, "approved");
  const hrs = (await apply({ fromDate: "2026-08-18", toDate: "2026-08-18" })).body.leaveRequest.id;
  assert.equal((await call("POST", `/hr/leave-requests/${hrs}/cancel`, hr)).status, 200);
  assert.equal((await call("POST", `/hr/leave-requests/${hrs}/cancel`, null)).status, 401);
  assert.equal(await prisma.auditLog.count({ where: { entityId: mine, action: "HR_LEAVE_REQUEST_CANCEL" } }), 1);
});

test("pending days in the balance count working days only", async () => {
  const r = await apply({ fromDate: "2026-09-04", toDate: "2026-09-07" }); // Fri, Sat, Sun, Mon -> 3
  assert.equal(r.status, 201);
  assert.equal((await balance("2026-09")).pendingLeaveDays, 3);
});
