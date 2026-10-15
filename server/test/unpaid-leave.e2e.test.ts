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
let hr = "", empDbId = "";
const created = { users: [] as string[] };

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  ({ prisma } = await import("../src/db/prisma"));
  const { app } = await import("../src/app");
  const { signAccessToken } = await import("../src/utils/tokens");
  const u = await prisma.user.create({ data: { name: `hr ${run}`, email: `hr-${run}@test.local`, passwordHash: "x", roles: ["HR"] } });
  created.users.push(u.id);
  hr = signAccessToken({ sub: u.id, email: u.email, name: u.name, roles: ["HR"], department: null, employeeId: null });
  const e = await prisma.employee.create({ data: { employeeCode: `E-${run}`, name: `Emp ${run}`, dept: "Production", role: "Editor", joinedAt: new Date("2025-01-01"), email: `emp-${run}@test.local`, salary: 30000, empType: "PERMANENT" } });
  empDbId = e.id;
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  await prisma.leaveRequest.deleteMany({ where: { employeeId: empDbId } });
  await prisma.attendanceRecord.deleteMany({ where: { employeeId: empDbId } });
  await prisma.leaveLedgerEntry.deleteMany({ where: { employeeId: empDbId } });
  await prisma.employee.deleteMany({ where: { id: empDbId } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  server?.close();
  await prisma.$disconnect();
});

test("approved Unpaid leave writes UNPAID_LEAVE attendance and counts every day as Loss of Pay", async () => {
  const made = await call("POST", "/hr/leave-requests", hr, { employeeId: empDbId, type: "UNPAID_LEAVE", fromDate: "2026-03-10", toDate: "2026-03-12", days: 3, reason: `test ${run}` });
  assert.equal(made.status, 201); assert.equal(made.body.leaveRequest.type, "UNPAID_LEAVE");
  assert.equal((await call("PATCH", `/hr/leave-requests/${made.body.leaveRequest.id}`, hr, { status: "APPROVED" })).status, 200);

  const rows = await prisma.attendanceRecord.findMany({ where: { employeeId: empDbId } });
  assert.equal(rows.length, 3); assert.equal(rows.every((r) => r.status === "UNPAID_LEAVE"), true);

  const bal = (await call("GET", `/hr/leave-balance/${empDbId}?month=2026-03`, hr)).body.balance;
  assert.equal(bal.unpaidLeaveDays, 3);
  assert.equal(bal.leaveDays, 0, "paid-leave allowance is untouched");
  assert.equal(bal.lopDays, 3, "all 3 days are Loss of Pay");

  const { computeLopDays } = await import("../src/services/hr/leaveBalance");
  assert.equal(await computeLopDays(empDbId, "2026-03"), 3);
  assert.equal((await call("GET", "/hr/attendance/summary?month=2026-03", hr)).body.byEmployee[empDbId].unpaidLeave, 3);
});
