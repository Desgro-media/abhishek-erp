/**
 * Performance Marketing tracking: who can see it, client settings, the monthly score and the head's adjustment.
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

const PM = "Performance Marketing";
const MONTH = "2026-09";
let server: Server;
let base: string;
let prisma: typeof import("../src/db/prisma").prisma;
const run = `pm${Date.now().toString(36)}`;
const created = { users: [] as string[], employees: [] as string[], clients: [] as string[] };
let savedHead: { employeeId: string | null } | null = null;
let tok: Record<"admin" | "head" | "member" | "member2" | "outsider", string>;
let emp: Record<"head" | "member" | "member2", string>;
let clientId = "";
let expectedDue = 0;

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const mine = (b: any) => b.clients.filter((c: any) => c.name.endsWith(run));

before(async () => {
  ({ prisma } = await import("../src/db/prisma"));
  const { app } = await import("../src/app");
  const { signAccessToken } = await import("../src/utils/tokens");
  const row = await prisma.departmentHead.findUnique({ where: { dept: PM } });
  savedHead = row ? { employeeId: row.employeeId } : null;

  const mkEmp = async (label: string, dept: string) => {
    const e = await prisma.employee.create({ data: { employeeCode: `PMT-${run}-${created.employees.length}`, name: `${label} ${run}`, dept, role: "Exec", joinedAt: new Date("2025-01-01"), email: `${label}-${run}@test.local`, salary: 0, empType: "PERMANENT", employmentStatus: "ACTIVE" } });
    created.employees.push(e.id);
    return e;
  };
  const mkTok = async (label: string, roles: any[], e: { id: string; dept: string } | null) => {
    const u = await prisma.user.create({ data: { name: `${label} ${run}`, email: `${label}-${run}@test.local`, passwordHash: "x", roles } });
    created.users.push(u.id);
    return signAccessToken({ sub: u.id, email: u.email, name: u.name, roles, department: e?.dept ?? null, employeeId: e?.id ?? null });
  };
  const head = await mkEmp("pmhead", PM), member = await mkEmp("pmmember", PM), member2 = await mkEmp("pmmember2", PM), outsider = await mkEmp("webby", "Web Development");
  await prisma.departmentHead.upsert({ where: { dept: PM }, create: { dept: PM, employeeId: head.id, updatedBy: "t" }, update: { employeeId: head.id } });
  emp = { head: head.id, member: member.id, member2: member2.id };
  tok = {
    admin: await mkTok("admin", ["ADMIN"], null),
    head: await mkTok("pmhead", ["EMPLOYEE"], head),
    member: await mkTok("pmmember", ["EMPLOYEE"], member),
    member2: await mkTok("pmmember2", ["EMPLOYEE"], member2),
    outsider: await mkTok("webby", ["EMPLOYEE"], outsider),
  };

  // A client onboarded on 28 Sep 2026: numbers on time for the 28th, late for the 29th, missing for the 30th.
  const c = await prisma.client.create({ data: { clientCode: `PMC-${run}`, name: `Ads ${run}`, services: [PM], status: "ACTIVE", onboardedAt: new Date("2026-09-28"), accountManager: "Someone" } });
  created.clients.push(c.id); clientId = c.id;
  const other = await prisma.client.create({ data: { clientCode: `PMC2-${run}`, name: `Other ${run}`, services: [PM], status: "ACTIVE", onboardedAt: new Date("2026-09-01"), pmOwnerId: member2.id } });
  created.clients.push(other.id);
  await prisma.clientAdAccess.create({ data: { clientId: c.id, platform: "Meta", status: "GRANTED", updatedBy: "t" } });
  await prisma.clientAdMetric.create({ data: { clientId: c.id, date: new Date("2026-09-28"), spend: 500, leads: 5, purchases: 0, revenue: 0, createdAt: new Date("2026-09-28T12:00:00Z") } });
  await prisma.clientAdMetric.create({ data: { clientId: c.id, date: new Date("2026-09-29"), spend: 500, leads: 3, purchases: 0, revenue: 0, createdAt: new Date("2026-10-05T12:00:00Z") } });
  await prisma.clientFeedback.create({ data: { clientId: c.id, dept: PM, month: MONTH, rating: 4, via: "t", by: "t", date: new Date("2026-09-30") } });
  await prisma.clientTask.create({ data: { clientId: c.id, title: `on time ${run}`, assignedTo: member.name, dueAt: new Date("2026-09-20"), status: "DONE", doneAt: new Date("2026-09-19T10:00:00Z") } });
  await prisma.clientTask.create({ data: { clientId: c.id, title: `late ${run}`, assignedTo: member.name, dueAt: new Date("2026-09-21"), status: "TODO" } });

  // Working days 28–30 Sep under the same rule the server uses (weekly off + holidays).
  const policy = await prisma.hrPolicy.findUnique({ where: { id: 1 } });
  const hol = new Set((await prisma.holiday.findMany()).map((h) => h.date.toISOString().slice(0, 10)));
  expectedDue = ["2026-09-28", "2026-09-29", "2026-09-30"].filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== (policy?.weeklyOff ?? 0) && !hol.has(d)).length;

  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  await prisma.clientTask.deleteMany({ where: { title: { contains: run } } });
  await prisma.client.deleteMany({ where: { id: { in: created.clients } } });
  if (savedHead) await prisma.departmentHead.update({ where: { dept: PM }, data: { employeeId: savedHead.employeeId } });
  else await prisma.departmentHead.deleteMany({ where: { dept: PM } });
  await prisma.employee.deleteMany({ where: { id: { in: created.employees } } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  server?.close();
  await prisma.$disconnect();
});

test("access: outsiders are refused; only the head or leadership change client settings", async () => {
  assert.equal((await call("GET", `/departments/pm/tracking?month=${MONTH}`, tok.outsider)).status, 403);
  assert.equal((await call("GET", `/departments/pm/tracking?month=bad`, tok.admin)).status, 400);
  assert.equal((await call("PUT", `/departments/pm/clients/${clientId}`, tok.member, { targetCpl: 100 })).status, 403);
  assert.equal((await call("PUT", `/departments/pm/clients/${clientId}`, tok.head, { campaignStatus: "Sleeping" })).status, 400);
  const r = await call("PUT", `/departments/pm/clients/${clientId}`, tok.head, { ownerId: emp.member, targetCpl: 100, campaignStatus: "Running" });
  assert.equal(r.status, 200);
  const brief = await prisma.clientCampaignBrief.findUnique({ where: { clientId } });
  assert.equal(Number(brief?.targetCpl), 100); assert.equal(brief?.campaignStatus, "Running");
});

test("client row and score: logged on time, cost per lead vs target, rating, tasks", async () => {
  const r = await call("GET", `/departments/pm/tracking?month=${MONTH}`, tok.head);
  assert.equal(r.status, 200);
  assert.equal(r.body.canManage, true);
  const c = r.body.clients.find((x: any) => x.id === clientId);
  assert.equal(c.owner.id, emp.member);
  assert.equal(c.spend, 1000); assert.equal(c.leads, 8); assert.equal(c.cpl, 125);
  assert.equal(c.cplOk, false, "₹125 a lead is over the ₹100 target");
  assert.equal(c.daysDue, expectedDue);
  assert.equal(c.daysOnTime, expectedDue >= 1 ? 1 : 0, "only the 28th was in by the next day");
  assert.equal(c.rating, 4);

  const s = r.body.scorecard.find((x: any) => x.employeeId === emp.member);
  assert.equal(s.clients, 1);
  assert.equal(s.parts.cpl.pct, 0);
  assert.equal(s.parts.rating.pct, 80);
  assert.equal(s.parts.tasks.pct, 50, "one of two due tasks finished on time");
  const logging = expectedDue ? 1 / expectedDue : null;
  const w = 30 * (logging != null ? 1 : 0) + 30 + 20 + 20;
  const expected = Math.round((100 * (30 * (logging ?? 0) + 0 + 20 * 0.8 + 20 * 0.5)) / w);
  assert.equal(s.auto, expected);
  assert.equal(s.score, expected);
});

test("a member sees only their own clients and score", async () => {
  const r = await call("GET", `/departments/pm/tracking?month=${MONTH}`, tok.member);
  assert.equal(r.status, 200);
  assert.equal(r.body.mine, true); assert.equal(r.body.canManage, false);
  assert.deepEqual(mine(r.body).map((c: any) => c.id), [clientId]);
  assert.deepEqual(r.body.scorecard.map((s: any) => s.employeeId), [emp.member]);
});

test("adjustment: head only, within ±10, needs a reason, not on their own score; 0 clears it", async () => {
  const path = `/departments/pm/adjustments/${emp.member}`;
  assert.equal((await call("PUT", path, tok.member2, { month: MONTH, points: 5, reason: "x" })).status, 403);
  assert.equal((await call("PUT", path, tok.head, { month: MONTH, points: 11, reason: "x" })).status, 400);
  assert.equal((await call("PUT", path, tok.head, { month: MONTH, points: 5, reason: "" })).status, 400);
  assert.equal((await call("PUT", `/departments/pm/adjustments/${emp.head}`, tok.head, { month: MONTH, points: 5, reason: "me" })).status, 403);
  assert.equal((await call("PUT", path, tok.head, { month: MONTH, points: 5, reason: "Handled a crisis" })).status, 200);
  let s = (await call("GET", `/departments/pm/tracking?month=${MONTH}`, tok.admin)).body.scorecard.find((x: any) => x.employeeId === emp.member);
  assert.equal(s.adjustment.points, 5); assert.equal(s.adjustment.reason, "Handled a crisis");
  assert.equal(s.score, Math.min(100, s.auto + 5));
  assert.equal((await call("PUT", path, tok.head, { month: MONTH, points: 0, reason: "" })).status, 200);
  s = (await call("GET", `/departments/pm/tracking?month=${MONTH}`, tok.admin)).body.scorecard.find((x: any) => x.employeeId === emp.member);
  assert.equal(s.adjustment, null); assert.equal(s.score, s.auto);
});
