/**
 * Departments: heads, access to a department's page, the summary figures, and department heads adding calendar events.
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
const run = `d${Date.now().toString(36)}`;
const DEPT = "Web Development";
let tok: { admin: string; head: string; other: string; sales: string; headEmp: string; otherEmp: string };
let savedHead: { employeeId: string | null; updatedBy: string } | null = null;
const created = { users: [] as string[], employees: [] as string[], clients: [] as string[], invoices: [] as string[], banks: [] as string[] };
const MONTH = "2031-04";

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  ({ prisma } = await import("../src/db/prisma"));
  const { app } = await import("../src/app");
  const { signAccessToken } = await import("../src/utils/tokens");
  const row = await prisma.departmentHead.findUnique({ where: { dept: DEPT } });
  savedHead = row ? { employeeId: row.employeeId, updatedBy: row.updatedBy } : null;

  const mkEmp = async (label: string, dept: string, role = "Exec") => {
    const e = await prisma.employee.create({ data: { employeeCode: `DP-${run}-${created.employees.length}`, name: `${label} ${run}`, dept, role, joinedAt: new Date("2030-01-01"), email: `${label}-${run}@test.local`, salary: 0, empType: "PERMANENT", employmentStatus: "ACTIVE" } });
    created.employees.push(e.id);
    return e;
  };
  const mkTok = async (label: string, roles: any[], emp: { id: string; dept: string } | null) => {
    const u = await prisma.user.create({ data: { name: `${label} ${run}`, email: `${label}-${run}@test.local`, passwordHash: "x", roles } });
    created.users.push(u.id);
    return signAccessToken({ sub: u.id, email: u.email, name: u.name, roles, department: emp?.dept ?? null, employeeId: emp?.id ?? null });
  };
  const headEmp = await mkEmp("headweb", DEPT), otherEmp = await mkEmp("otherprod", "Production"), member = await mkEmp("memberweb", DEPT);
  tok = {
    admin: await mkTok("admin", ["ADMIN"], null),
    head: await mkTok("headweb", ["EMPLOYEE"], headEmp),
    other: await mkTok("otherprod", ["EMPLOYEE"], otherEmp),
    sales: await mkTok("sales", ["SALES"], null),
    headEmp: headEmp.id, otherEmp: otherEmp.id,
  };
  // a live client taking the department, one paused (excluded), and an invoice split between two departments
  const mkClient = async (n: string, status: any) => { const c = await prisma.client.create({ data: { clientCode: `DC-${run}-${created.clients.length}`, name: `${n} ${run}`, services: [DEPT], status, onboardedAt: new Date("2030-02-01"), accountManager: member.name } }); created.clients.push(c.id); return c; };
  const live = await mkClient("Live", "ACTIVE"); await mkClient("Paused", "PAUSED");
  const bank = await prisma.bankAccount.create({ data: { name: `Test ${run}`, bank: "T", number: "1", opening: 0, openedAt: new Date("2030-01-01") } });
  created.banks.push(bank.id);
  const inv = await prisma.invoice.create({ data: { invoiceNo: `DG/${run}`, clientId: live.id, issuedAt: new Date(`${MONTH}-10`), dueAt: new Date(`${MONTH}-25`), items: { create: [{ dept: DEPT, amount: 6000 }, { dept: "Graphic Design", amount: 4000 }] }, payments: { create: [{ amount: 5000, paidDate: new Date(`${MONTH}-12`), accountId: bank.id }] } } as any });
  created.invoices.push(inv.id);
  await prisma.clientTask.create({ data: { clientId: live.id, title: `t ${run}`, assignedTo: member.name, dueAt: new Date("2020-01-01"), status: "TODO" } });
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  await prisma.companyEvent.deleteMany({ where: { title: { contains: run } } });
  await prisma.clientTask.deleteMany({ where: { title: { contains: run } } });
  await prisma.invoice.deleteMany({ where: { id: { in: created.invoices } } });
  await prisma.client.deleteMany({ where: { id: { in: created.clients } } });
  await prisma.bankAccount.deleteMany({ where: { id: { in: created.banks } } });
  if (savedHead) await prisma.departmentHead.update({ where: { dept: DEPT }, data: { employeeId: savedHead.employeeId } });
  else await prisma.departmentHead.deleteMany({ where: { dept: DEPT } });
  await prisma.employee.deleteMany({ where: { id: { in: created.employees } } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  server?.close();
  await prisma.$disconnect();
});

test("only leadership can set a head; heads list reflects it", async () => {
  assert.equal((await call("PUT", `/departments/${DEPT}/head`, tok.other, { employeeId: tok.otherEmp })).status, 403);
  assert.equal((await call("PUT", `/departments/Nope/head`, tok.admin, { employeeId: null })).status, 404);
  assert.equal((await call("PUT", `/departments/${DEPT}/head`, tok.admin, { employeeId: "nope" })).status, 400);
  assert.equal((await call("PUT", `/departments/${DEPT}/head`, tok.admin, { employeeId: tok.headEmp })).status, 200);
  const heads = (await call("GET", "/departments/heads", tok.other)).body.heads;
  assert.ok(heads[DEPT].startsWith("headweb"));
});

test("department summary: access rules, live clients only, team, revenue share", async () => {
  assert.equal((await call("GET", `/departments/${DEPT}/summary?month=${MONTH}`, tok.other)).status, 403, "another department's head can't open it");
  assert.equal((await call("GET", `/departments/${DEPT}/summary?month=${MONTH}`, tok.sales)).status, 403, "Sales can't open a department page");
  assert.equal((await call("GET", `/departments/${DEPT}/summary?month=bad`, tok.admin)).status, 400);
  for (const t of [tok.admin, tok.head]) {
    const r = await call("GET", `/departments/${DEPT}/summary?month=${MONTH}`, t);
    assert.equal(r.status, 200);
    const b = r.body;
    assert.ok(b.head.startsWith("headweb"));
    assert.deepEqual(b.clients.filter((c: any) => c.name.endsWith(run)).map((c: any) => c.name.split(" ")[0]), ["Live"], "paused client excluded");
    const member = b.team.find((e: any) => e.name.startsWith("memberweb"));
    assert.equal(member.openTasks, 1); assert.equal(member.overdue, 1); assert.equal(member.clients, 1);
    // this department's 60% of a ₹10,000 invoice; ₹5,000 paid -> ₹3,000 collected, ₹3,000 outstanding
    assert.equal(b.revenue.billed >= 6000, true);
    assert.equal(b.insights.now.paid >= 3000, true);
  }
  const ov = await call("GET", "/departments/overview", tok.head);
  assert.deepEqual(ov.body.tiles.map((t: any) => t.dept), [DEPT], "a head only sees their own tile");
  assert.equal((await call("GET", "/departments/overview", tok.admin)).body.tiles.length, 7);
});

test("a department head can add calendar events and edit only their own", async () => {
  const mine = await call("POST", "/calendar/events", tok.head, { title: `head event ${run}`, date: "2031-04-20" });
  assert.equal(mine.status, 201);
  const adminEv = await call("POST", "/calendar/events", tok.admin, { title: `admin event ${run}`, date: "2031-04-21" });
  assert.equal((await call("PUT", `/calendar/events/${adminEv.body.event.id}`, tok.head, { title: `x ${run}`, date: "2031-04-21" })).status, 403);
  assert.equal((await call("DELETE", `/calendar/events/${adminEv.body.event.id}`, tok.head)).status, 403);
  assert.equal((await call("PUT", `/calendar/events/${mine.body.event.id}`, tok.head, { title: `head event 2 ${run}`, date: "2031-04-22" })).status, 200);
  assert.equal((await call("DELETE", `/calendar/events/${mine.body.event.id}`, tok.head)).status, 204);
  assert.equal((await call("POST", "/calendar/events", tok.other, { title: `no ${run}`, date: "2031-04-20" })).status, 403, "a non-head employee still can't");
});
