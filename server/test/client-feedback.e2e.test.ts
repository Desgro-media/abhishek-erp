/**
 * Client feedback: a no-login link a client rates through, staff logging, who may share/log, and the effect on the
 * department score.   TEST_DATABASE_URL=postgresql://.../desgro_erp_test npm run test:e2e
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
const run = `f${Date.now().toString(36)}`;
const D1 = "Graphic Design", D2 = "Performance Marketing";
let tok: { admin: string; am: string; other: string; head: string };
let clientId = "", amName = "";
const created = { users: [] as string[], employees: [] as string[], clients: [] as string[] };
let savedHead: { employeeId: string | null } | null = null;
const istMonth = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7);

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  ({ prisma } = await import("../src/db/prisma"));
  const { app } = await import("../src/app");
  const { signAccessToken } = await import("../src/utils/tokens");
  const h = await prisma.departmentHead.findUnique({ where: { dept: "Production" } });
  savedHead = h ? { employeeId: h.employeeId } : null;
  const mkEmp = async (label: string, dept: string) => { const e = await prisma.employee.create({ data: { employeeCode: `CF-${run}-${created.employees.length}`, name: `${label} ${run}`, dept, role: "Exec", joinedAt: new Date("2030-01-01"), email: `${label}-${run}@test.local`, salary: 0, empType: "PERMANENT", employmentStatus: "ACTIVE" } }); created.employees.push(e.id); return e; };
  const mkTok = async (label: string, roles: any[], emp: { id: string; dept: string } | null) => {
    const u = await prisma.user.create({ data: { name: `${label} ${run}`, email: `${label}-${run}@test.local`, passwordHash: "x", roles } });
    created.users.push(u.id);
    return signAccessToken({ sub: u.id, email: u.email, name: u.name, roles, department: emp?.dept ?? null, employeeId: emp?.id ?? null });
  };
  const am = await mkEmp("acctmgr", D1), headEmp = await mkEmp("prodhead", "Production");
  amName = am.name;
  await prisma.departmentHead.upsert({ where: { dept: "Production" }, create: { dept: "Production", employeeId: headEmp.id, updatedBy: "t" }, update: { employeeId: headEmp.id } });
  tok = { admin: await mkTok("admin", ["ADMIN"], null), am: await mkTok("acctmgr", ["EMPLOYEE"], am), other: await mkTok("other", ["EMPLOYEE"], null), head: await mkTok("prodhead", ["EMPLOYEE"], headEmp) };
  const c = await prisma.client.create({ data: { clientCode: `CFC-${run}`, name: `Rated ${run}`, services: [D1, D2], status: "ACTIVE", onboardedAt: new Date("2020-02-01"), accountManager: am.name } });
  created.clients.push(c.id); clientId = c.id;
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  await prisma.client.deleteMany({ where: { id: { in: created.clients } } }); // feedback + links cascade
  if (savedHead) await prisma.departmentHead.update({ where: { dept: "Production" }, data: { employeeId: savedHead.employeeId } }); else await prisma.departmentHead.deleteMany({ where: { dept: "Production" } });
  await prisma.employee.deleteMany({ where: { id: { in: created.employees } } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  server?.close();
  await prisma.$disconnect();
});

test("sharing a link: account manager / leadership / heads only; one link a month, replaced on regenerate", async () => {
  assert.equal((await call("POST", `/crm/clients/${clientId}/feedback-link`, tok.other, {})).status, 403);
  const made = await call("POST", `/crm/clients/${clientId}/feedback-link`, tok.am, {});
  assert.equal(made.status, 200);
  const first = made.body.link;
  assert.deepEqual(first.depts.sort(), [D1, D2].sort()); assert.equal(first.month, istMonth()); assert.equal(first.open, true);
  assert.equal((await call("POST", `/crm/clients/${clientId}/feedback-link`, tok.head, {})).body.link.token, first.token, "same link until regenerated");
  assert.equal((await call("POST", `/crm/clients/${clientId}/feedback-link`, tok.am, { depts: ["Production"] })).status, 400, "not this client's service");
  const narrowed = await call("POST", `/crm/clients/${clientId}/feedback-link`, tok.am, { depts: [D1] });
  assert.deepEqual(narrowed.body.link.depts, [D1]); assert.equal(narrowed.body.link.token, first.token);
  const fresh = await call("POST", `/crm/clients/${clientId}/feedback-link`, tok.admin, { regenerate: true });
  assert.notEqual(fresh.body.link.token, first.token);
  assert.equal((await call("GET", `/public/client-feedback/${first.token}`, null)).status, 404, "the old link stops working");
});

test("the client rates through the link with no sign-in; only listed services; re-rating replaces", async () => {
  const token = (await call("POST", `/crm/clients/${clientId}/feedback-link`, tok.am, { depts: [D1, D2] })).body.link.token;
  const view = await call("GET", `/public/client-feedback/${token}`, null);
  assert.equal(view.status, 200);
  assert.deepEqual(Object.keys(view.body).sort(), ["clientName", "closesOn", "depts", "month", "open", "projects", "rated"].sort(), "nothing about the account leaks");
  assert.equal((await call("POST", `/public/client-feedback/${token}`, null, { ratings: [{ dept: D1, rating: 9 }] })).status, 400);
  assert.equal((await call("POST", `/public/client-feedback/${token}`, null, { ratings: [{ dept: "Production", rating: 5 }] })).status, 400, "not on the link");
  const ok = await call("POST", `/public/client-feedback/${token}`, null, { ratings: [{ dept: D1, rating: 4, comment: "good" }, { dept: D2, rating: 2 }], name: "Anu" });
  assert.equal(ok.status, 201); assert.equal(ok.body.saved, 2);
  assert.equal((await call("POST", `/public/client-feedback/${token}`, null, { ratings: [{ dept: D2, rating: 5 }] })).status, 201);
  const rows = await prisma.clientFeedback.findMany({ where: { clientId }, orderBy: { dept: "asc" } });
  assert.deepEqual(rows.map((r) => [r.dept, r.rating, r.via, r.by]), [[D1, 4, "Feedback link", "Anu"], [D2, 5, "Feedback link", "Client"]]);
  assert.deepEqual((await call("GET", `/public/client-feedback/${token}`, null)).body.rated, { [D1]: 4, [D2]: 5 });
  // closed: a link for a long-past month can't take ratings
  await prisma.clientFeedbackLink.update({ where: { token }, data: { month: "2020-01" } });
  assert.equal((await call("POST", `/public/client-feedback/${token}`, null, { ratings: [{ dept: D1, rating: 1 }] })).status, 410);
  assert.equal((await call("GET", `/public/client-feedback/${token}`, null)).body.open, false);
});

test("staff logging: account manager / leadership only; read access; replaces this month's rating", async () => {
  assert.equal((await call("POST", `/crm/clients/${clientId}/feedback`, tok.other, { ratings: [{ dept: D1, rating: 3 }] })).status, 403);
  assert.equal((await call("POST", `/crm/clients/${clientId}/feedback`, tok.head, { ratings: [{ dept: D1, rating: 3 }] })).status, 403, "a head may share, not log");
  assert.equal((await call("POST", `/crm/clients/${clientId}/feedback`, tok.am, { ratings: [{ dept: "Production", rating: 3 }] })).status, 400);
  assert.equal((await call("POST", `/crm/clients/${clientId}/feedback`, tok.am, { ratings: [] })).status, 400);
  assert.equal((await call("POST", `/crm/clients/${clientId}/feedback`, tok.am, { ratings: [{ dept: D1, rating: 3, comment: "on a call" }] })).status, 201);
  const got = await call("GET", `/crm/clients/${clientId}/feedback`, tok.am);
  const mine = got.body.feedback.find((f: any) => f.dept === D1 && f.month === istMonth());
  assert.equal(mine.rating, 3); assert.match(mine.via, /Logged by acctmgr/); assert.equal(got.body.canLog, true);
  assert.equal((await call("GET", `/crm/clients/${clientId}/feedback`, tok.other)).status, 403);
  assert.equal((await call("GET", `/crm/clients/${clientId}/feedback`, tok.head)).body.canLog, false);
});

test("feedback feeds the department score and the department page", async () => {
  const sc = (await call("GET", "/scores/departments", tok.admin)).body.scores[D1].now;
  const sat = sc.parts.find((p: any) => p.key === "satisfaction"), cov = sc.parts.find((p: any) => p.key === "feedback");
  assert.notEqual(sat.v, null); assert.match(sat.detail, /★ average from \d+ client/);
  assert.notEqual(cov.v, null);
  await prisma.departmentHead.upsert({ where: { dept: D1 }, create: { dept: D1, employeeId: (await prisma.employee.findFirst({ where: { name: amName } }))!.id, updatedBy: "t" }, update: {} }).catch(() => null);
  const summary = await call("GET", `/departments/${encodeURIComponent(D1)}/summary`, tok.admin);
  assert.equal(summary.status, 200);
  const row = summary.body.clients.find((c: any) => c.name === `Rated ${run}`);
  assert.equal(row.rating, 3);
  assert.ok(summary.body.feedback.some((f: any) => f.clientId === clientId && f.rating === 3));
  assert.ok(summary.body.insights.now.feedbacks >= 1 && summary.body.insights.now.rating != null);
});
