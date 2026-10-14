/**
 * Department action plans: heads file one plan a day, leadership comments / answers / adds items, scoping and
 * "today only" edit rules.   TEST_DATABASE_URL=postgresql://.../desgro_erp_test npm run test:e2e
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
const run = `p${Date.now().toString(36)}`;
const DEPT = "Graphic Design", OTHER = "Production";
let tok: { admin: string; head: string; otherHead: string; plain: string };
const saved: Record<string, string | null | undefined> = {};
const created = { users: [] as string[], employees: [] as string[] };
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  ({ prisma } = await import("../src/db/prisma"));
  const { app } = await import("../src/app");
  const { signAccessToken } = await import("../src/utils/tokens");
  for (const d of [DEPT, OTHER]) { const r = await prisma.departmentHead.findUnique({ where: { dept: d } }); saved[d] = r ? r.employeeId : undefined; }
  await prisma.actionPlan.deleteMany({ where: { dept: { in: [DEPT, OTHER] }, date: { gte: new Date(istToday()) } } });
  const mkEmp = async (label: string, dept: string) => { const e = await prisma.employee.create({ data: { employeeCode: `AP-${run}-${created.employees.length}`, name: `${label} ${run}`, dept, role: "Exec", joinedAt: new Date("2030-01-01"), email: `${label}-${run}@test.local`, salary: 0, empType: "PERMANENT", employmentStatus: "ACTIVE" } }); created.employees.push(e.id); return e; };
  const mkTok = async (label: string, roles: any[], emp: { id: string; dept: string } | null) => {
    const u = await prisma.user.create({ data: { name: `${label} ${run}`, email: `${label}-${run}@test.local`, passwordHash: "x", roles } });
    created.users.push(u.id);
    return signAccessToken({ sub: u.id, email: u.email, name: u.name, roles, department: emp?.dept ?? null, employeeId: emp?.id ?? null });
  };
  const h = await mkEmp("gdhead", DEPT), oh = await mkEmp("prodhead", OTHER), plain = await mkEmp("plain", DEPT);
  for (const [dept, e] of [[DEPT, h], [OTHER, oh]] as const) await prisma.departmentHead.upsert({ where: { dept }, create: { dept, employeeId: e.id, updatedBy: "t" }, update: { employeeId: e.id } });
  tok = { admin: await mkTok("admin", ["ADMIN"], null), head: await mkTok("gdhead", ["EMPLOYEE"], h), otherHead: await mkTok("prodhead", ["EMPLOYEE"], oh), plain: await mkTok("plain", ["EMPLOYEE"], plain) };
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  await prisma.actionPlan.deleteMany({ where: { OR: [{ headName: { contains: run } }, { dept: { in: [DEPT, OTHER] }, date: { gte: new Date(istToday()) } }] } });
  for (const d of [DEPT, OTHER]) {
    if (saved[d] === undefined) await prisma.departmentHead.deleteMany({ where: { dept: d } });
    else await prisma.departmentHead.update({ where: { dept: d }, data: { employeeId: saved[d] } });
  }
  await prisma.employee.deleteMany({ where: { id: { in: created.employees } } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  server?.close();
  await prisma.$disconnect();
});

test("filing: only a head, once a day, needs a focus and an item", async () => {
  const body = { focus: "Speed up reviews", research: "notes", items: [{ type: "Improve", title: "Review template", status: "Planned" }] };
  assert.equal((await call("POST", "/action-plans", tok.plain, body)).status, 403);
  assert.equal((await call("POST", "/action-plans", tok.admin, body)).status, 403, "admin isn't a head");
  assert.equal((await call("POST", "/action-plans", tok.head, { focus: "", items: [] })).status, 400);
  assert.equal((await call("POST", "/action-plans", tok.head, { focus: "x", items: [{ type: "Bogus", title: "t" }] })).status, 400);
  const ok = await call("POST", "/action-plans", tok.head, body);
  assert.equal(ok.status, 201);
  assert.equal(ok.body.plan.dept, DEPT); assert.equal(ok.body.plan.date, istToday()); assert.equal(ok.body.plan.items.length, 1);
  assert.equal((await call("POST", "/action-plans", tok.head, body)).status, 409, "second plan the same day");
});

test("edit rules: head edits own today's plan; others can't; leadership adds items and answers", async () => {
  const plan = (await call("GET", "/action-plans", tok.head)).body.plans.find((p: any) => p.date === istToday() && p.dept === DEPT);
  const itemId = plan.items[0].id;
  assert.equal((await call("PATCH", `/action-plans/${plan.id}`, tok.otherHead, { focus: "hijack" })).status, 403);
  assert.equal((await call("POST", `/action-plans/${plan.id}/items`, tok.otherHead, { type: "Improve", title: "no" })).status, 403);
  const status = await call("PATCH", `/action-plans/${plan.id}/items/${itemId}`, tok.head, { status: "Done" });
  assert.equal(status.status, 200); assert.equal(status.body.plan.items[0].status, "Done");
  assert.equal((await call("POST", `/action-plans/${plan.id}/items`, tok.head, { type: "Introduce", title: "New service" })).status, 201);
  // head asks leadership; leadership adds an item and answers
  const ask = await call("PATCH", `/action-plans/${plan.id}`, tok.head, { needsQuestion: "Price at 18k?" });
  assert.deepEqual(ask.body.plan.needsInput, { question: "Price at 18k?", resolved: false });
  const add = await call("POST", `/action-plans/${plan.id}/items`, tok.admin, { type: "Optimise", title: "Cut approval rounds" });
  assert.equal(add.body.plan.items.find((i: any) => i.title === "Cut approval rounds").addedBy.startsWith("admin"), true);
  assert.equal((await call("POST", `/action-plans/${plan.id}/comments`, tok.plain, { text: "hi" })).status, 403);
  const ans = await call("POST", `/action-plans/${plan.id}/comments`, tok.admin, { text: "Yes, 18k", resolve: true });
  assert.equal(ans.status, 201); assert.equal(ans.body.plan.needsInput.resolved, true); assert.equal(ans.body.plan.comments.length, 1);
  const reply = await call("POST", `/action-plans/${plan.id}/comments`, tok.head, { text: "Thanks", resolve: true });
  assert.equal(reply.body.plan.comments.length, 2);
  const del = await call("DELETE", `/action-plans/${plan.id}/items/${itemId}`, tok.head);
  assert.equal(del.status, 200); assert.equal(del.body.plan.items.some((i: any) => i.id === itemId), false);
});

test("past plans are read-only; listing is scoped to the department (leadership sees all)", async () => {
  const past = await prisma.actionPlan.create({ data: { dept: DEPT, headName: `gdhead ${run}`, date: new Date("2031-01-07"), submittedAt: "10:00", focus: "old", items: { create: [{ seq: 0, type: "Improve", title: "old item", status: "Planned" }] } }, include: { items: true } });
  assert.equal((await call("PATCH", `/action-plans/${past.id}`, tok.head, { focus: "rewrite history" })).status, 409);
  assert.equal((await call("PATCH", `/action-plans/${past.id}/items/${past.items[0].id}`, tok.head, { status: "Done" })).status, 409);
  const mineDepts = new Set((await call("GET", "/action-plans?from=2031-01-01", tok.head)).body.plans.map((p: any) => p.dept));
  assert.deepEqual([...mineDepts], [DEPT]);
  assert.deepEqual((await call("GET", "/action-plans", tok.plain)).body.plans, [], "non-head, non-leadership sees none");
  assert.equal((await call("GET", "/action-plans?from=2031-01-01", tok.admin)).body.plans.some((p: any) => p.id === past.id), true);
});
