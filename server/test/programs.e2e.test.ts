/**
 * HR programs (plan → close out → anonymous feedback) and sales meetings.
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
const run = `g${Date.now().toString(36)}`;
let tok: Record<"admin" | "hr" | "gd1" | "gd2" | "web" | "sales" | "plain", string>;
let emp: Record<"gd1" | "gd2" | "web", string> = { gd1: "", gd2: "", web: "" };
const created = { users: [] as string[], employees: [] as string[], leads: [] as string[] };
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const addDays = (ds: string, n: number) => { const d = new Date(`${ds}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  ({ prisma } = await import("../src/db/prisma"));
  const { app } = await import("../src/app");
  const { signAccessToken } = await import("../src/utils/tokens");
  const mkEmp = async (label: string, dept: string) => { const e = await prisma.employee.create({ data: { employeeCode: `PG-${run}-${created.employees.length}`, name: `${label} ${run}`, dept, role: "Exec", joinedAt: new Date("2020-01-01"), email: `${label}-${run}@test.local`, salary: 0, empType: "PERMANENT", employmentStatus: "ACTIVE" } }); created.employees.push(e.id); return e; };
  const mkTok = async (label: string, roles: any[], e: { id: string; dept: string } | null) => {
    const u = await prisma.user.create({ data: { name: `${label} ${run}`, email: `${label}-${run}@test.local`, passwordHash: "x", roles } });
    created.users.push(u.id);
    return signAccessToken({ sub: u.id, email: u.email, name: u.name, roles, department: e?.dept ?? null, employeeId: e?.id ?? null });
  };
  const gd1 = await mkEmp("gd1", "Graphic Design"), gd2 = await mkEmp("gd2", "Graphic Design"), web = await mkEmp("web", "Web Development");
  emp = { gd1: gd1.id, gd2: gd2.id, web: web.id };
  tok = { admin: await mkTok("admin", ["ADMIN"], null), hr: await mkTok("hr", ["HR"], null), gd1: await mkTok("gd1", ["EMPLOYEE"], gd1), gd2: await mkTok("gd2", ["EMPLOYEE"], gd2), web: await mkTok("web", ["EMPLOYEE"], web), sales: await mkTok("sales", ["SALES"], null), plain: await mkTok("plain", ["EMPLOYEE"], null) };
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  await prisma.hrProgram.deleteMany({ where: { title: { contains: run } } });
  await prisma.salesMeeting.deleteMany({ where: { OR: [{ by: { contains: run } }, { withName: { contains: run } }] } });
  await prisma.lead.deleteMany({ where: { id: { in: created.leads } } });
  await prisma.employee.deleteMany({ where: { id: { in: created.employees } } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  server?.close();
  await prisma.$disconnect();
});

const prog = (o: Record<string, unknown> = {}) => ({ title: `Workshop ${run}`, type: "Upskilling", date: addDays(istToday(), -1), audience: ["Graphic Design"], budget: 5000, ...o });

test("only HR/leadership plan programs; validation; audience; completed can't be set directly", async () => {
  assert.equal((await call("POST", "/hr/programs", tok.gd1, prog())).status, 403);
  assert.equal((await call("POST", "/hr/programs", tok.hr, prog({ type: "Party" }))).status, 400);
  assert.equal((await call("POST", "/hr/programs", tok.hr, prog({ title: "" }))).status, 400);
  assert.equal((await call("POST", "/hr/programs", tok.hr, prog({ status: "Completed" }))).status, 400);
  const made = await call("POST", "/hr/programs", tok.hr, prog({ audience: ["Graphic Design", "All"] }));
  assert.equal(made.status, 201); assert.deepEqual(made.body.program.audience, ["All"]);
  assert.equal((await call("PUT", `/hr/programs/${made.body.program.id}`, tok.gd1, prog())).status, 403);
  assert.equal((await call("PUT", `/hr/programs/${made.body.program.id}`, tok.admin, prog({ title: `Workshop ${run} v2`, audience: ["Graphic Design"] }))).status, 200);
  assert.equal((await call("GET", "/hr/programs", tok.gd1)).status, 403);
  assert.equal((await call("GET", "/hr/programs", tok.hr)).body.programs.some((p: any) => p.id === made.body.program.id), true);
});

test("close-out → attendee-only, once-only, anonymous feedback", async () => {
  const p = (await call("POST", "/hr/programs", tok.hr, prog({ title: `Closeout ${run}` }))).body.program;
  assert.equal((await call("POST", `/hr/programs/${p.id}/feedback`, tok.gd1, { rating: 4, useful: 4 })).status, 409, "not completed yet");
  assert.equal((await call("POST", `/hr/programs/${p.id}/complete`, tok.gd1, { attendeeIds: [] })).status, 403);
  assert.equal((await call("POST", `/hr/programs/${p.id}/complete`, tok.hr, { attendeeIds: [emp.web] })).status, 400, "web dev wasn't invited");
  const done = await call("POST", `/hr/programs/${p.id}/complete`, tok.hr, { attendeeIds: [emp.gd1, emp.gd2], spent: 4200, outcome: "Repeat in Q1" });
  assert.equal(done.status, 200); assert.equal(done.body.program.status, "Completed"); assert.equal(done.body.program.attendees.length, 2);
  assert.equal((await call("PUT", `/hr/programs/${p.id}`, tok.hr, prog({ title: `Closeout ${run}`, status: "Planned" }))).status, 409, "can't reopen");
  // who is asked to rate
  assert.equal((await call("GET", "/hr/programs/mine", tok.gd1)).body.feedbackDue.some((d: any) => d.id === p.id), true);
  assert.equal((await call("GET", "/hr/programs/mine", tok.web)).body.feedbackDue.some((d: any) => d.id === p.id), false);
  assert.equal((await call("POST", `/hr/programs/${p.id}/feedback`, tok.web, { rating: 5, useful: 5 })).status, 403, "not an attendee");
  assert.equal((await call("POST", `/hr/programs/${p.id}/feedback`, tok.gd1, { rating: 9, useful: 4 })).status, 400);
  assert.equal((await call("POST", `/hr/programs/${p.id}/feedback`, tok.gd1, { rating: 5, useful: 4, comment: "great" })).status, 201);
  assert.equal((await call("POST", `/hr/programs/${p.id}/feedback`, tok.gd1, { rating: 1, useful: 1 })).status, 409, "once each");
  assert.equal((await call("POST", `/hr/programs/${p.id}/feedback`, tok.gd2, { rating: 3, useful: 4, comment: "ok" })).status, 201);
  assert.equal((await call("GET", "/hr/programs/mine", tok.gd1)).body.feedbackDue.some((d: any) => d.id === p.id), false, "no longer due once rated");
  const r = await call("GET", `/hr/programs/${p.id}/responses`, tok.hr);
  assert.equal(r.body.responses, 2); assert.equal(r.body.attendees, 2); assert.equal(r.body.rating, 4);
  assert.deepEqual(r.body.comments.map((c: any) => Object.keys(c).sort()), [["rating", "text"], ["rating", "text"]], "comments carry no names");
  assert.equal(JSON.stringify(r.body).includes(emp.gd1), false);
  assert.equal((await call("GET", `/hr/programs/${p.id}/responses`, tok.gd1)).status, 403);
  // the feedback window: a program 20 days ago has closed
  await prisma.hrProgram.update({ where: { id: p.id }, data: { date: new Date(addDays(istToday(), -20)) } });
  await prisma.hrProgramFeedback.deleteMany({ where: { programId: p.id, employeeId: emp.gd2 } });
  assert.equal((await call("POST", `/hr/programs/${p.id}/feedback`, tok.gd2, { rating: 4, useful: 4 })).status, 410);
});

test("a program that hasn't happened can't be closed out; invitations and the calendar follow the audience", async () => {
  const future = (await call("POST", "/hr/programs", tok.hr, prog({ title: `Future ${run}`, date: addDays(istToday(), 5), audience: ["Graphic Design"] }))).body.program;
  assert.equal((await call("POST", `/hr/programs/${future.id}/complete`, tok.hr, { attendeeIds: [] })).status, 409);
  assert.equal((await call("GET", "/hr/programs/mine", tok.gd1)).body.upcoming.some((u: any) => u.id === future.id), true);
  assert.equal((await call("GET", "/hr/programs/mine", tok.web)).body.upcoming.some((u: any) => u.id === future.id), false);
  const cal = async (t: string) => (await call("GET", "/hr/programs/calendar", t)).body.programs.some((x: any) => x.id === future.id);
  assert.deepEqual([await cal(tok.gd1), await cal(tok.web), await cal(tok.hr)], [true, false, true]);
  assert.equal((await call("DELETE", `/hr/programs/${future.id}`, tok.gd1)).status, 403);
  assert.equal((await call("DELETE", `/hr/programs/${future.id}`, tok.hr)).status, 204);
  assert.equal((await call("DELETE", `/hr/programs/${future.id}`, tok.hr)).status, 404);
});

test("sales meetings: Sales only, not in the future, needs a who; counted in the month", async () => {
  const body = { date: istToday(), mode: "Call", withName: `Prospect ${run}` };
  assert.equal((await call("POST", "/crm/sales-meetings", tok.plain, body)).status, 403);
  assert.equal((await call("POST", "/crm/sales-meetings", tok.sales, { ...body, date: addDays(istToday(), 3) })).status, 400);
  assert.equal((await call("POST", "/crm/sales-meetings", tok.sales, { ...body, withName: "" })).status, 400);
  assert.equal((await call("POST", "/crm/sales-meetings", tok.sales, { ...body, mode: "Smoke signal" })).status, 400);
  const lead = await prisma.lead.create({ data: { leadCode: `LD-${run}`, name: `Lead ${run}`, source: "Website", serviceInterested: "Web Development" } });
  created.leads.push(lead.id);
  assert.equal((await call("POST", "/crm/sales-meetings", tok.sales, body)).status, 201);
  assert.equal((await call("POST", "/crm/sales-meetings", tok.sales, { date: istToday(), mode: "In person", leadId: lead.id })).status, 201);
  const list = await call("GET", "/crm/sales-meetings", tok.sales);
  const mine = list.body.meetings.filter((m: any) => m.by.includes(run));
  assert.deepEqual(mine.map((m: any) => m.with).sort(), [`Lead ${run}`, `Prospect ${run}`]);
  assert.equal((await call("GET", "/crm/sales-meetings", tok.plain)).status, 403);
  const score = (await call("GET", "/scores/departments", tok.admin)).body.scores.Sales.now.parts.find((p: any) => p.key === "meetings");
  assert.match(score.detail, /^\d+ of \d+ target/); assert.notEqual(score.v, null);
});
