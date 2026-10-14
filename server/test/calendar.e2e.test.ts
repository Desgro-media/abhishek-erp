/**
 * Company calendar events: only HR/Admin can write; everyone else sees "All", their own department's, or their own.
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
let tok: { admin: string; hr: string; prod: string; mkt: string };
const run = `c${Date.now().toString(36)}`;
const userIds: string[] = [];

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  ({ prisma } = await import("../src/db/prisma"));
  const { app } = await import("../src/app");
  const { signAccessToken } = await import("../src/utils/tokens");
  const mk = async (label: string, roles: any[], department: string | null) => {
    const u = await prisma.user.create({ data: { name: `${label} ${run}`, email: `${label}-${run}@test.local`, passwordHash: "x", roles } });
    userIds.push(u.id);
    return signAccessToken({ sub: u.id, email: u.email, name: u.name, roles, department, employeeId: null });
  };
  tok = { admin: await mk("admin", ["ADMIN"], null), hr: await mk("hr", ["HR"], "Administrative"), prod: await mk("prod", ["EMPLOYEE"], "Production"), mkt: await mk("mkt", ["EMPLOYEE"], "Marketing") };
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  await prisma.companyEvent.deleteMany({ where: { title: { contains: run } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  server?.close();
  await prisma.$disconnect();
});

test("only HR/Admin can create, edit or delete events; validation rejects bad input", async () => {
  const body = { title: `Staff try ${run}`, date: "2031-05-05" };
  assert.equal((await call("POST", "/calendar/events", tok.prod, body)).status, 403);
  assert.equal((await call("POST", "/calendar/events", null, body)).status, 401);
  assert.equal((await call("POST", "/calendar/events", tok.admin, { title: "", date: "2031-05-05" })).status, 400);
  assert.equal((await call("POST", "/calendar/events", tok.admin, { title: `x ${run}`, date: "05/05/2031" })).status, 400);
  const made = await call("POST", "/calendar/events", tok.hr, { title: `HR event ${run}`, date: "2031-05-05", time: "10:30", kind: "Deadline", audience: ["Production", "All"] });
  assert.equal(made.status, 201);
  assert.deepEqual(made.body.event.audience, ["All"], "'All' wins over a department list");
  const id = made.body.event.id;
  assert.equal((await call("PUT", `/calendar/events/${id}`, tok.prod, { title: `edit ${run}`, date: "2031-05-06" })).status, 403);
  const upd = await call("PUT", `/calendar/events/${id}`, tok.admin, { title: `HR event ${run} v2`, date: "2031-05-06", audience: ["Production"] });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.event.date, "2031-05-06");
  assert.equal((await call("DELETE", `/calendar/events/${id}`, tok.prod)).status, 403);
  assert.equal((await call("DELETE", `/calendar/events/${id}`, tok.admin)).status, 204);
  assert.equal((await call("DELETE", `/calendar/events/${id}`, tok.admin)).status, 404);
});

test("visibility: All / own department / Admin+HR see everything", async () => {
  const mkEv = (title: string, audience: string[]) => call("POST", "/calendar/events", tok.admin, { title: `${title} ${run}`, date: "2031-06-10", audience });
  await mkEv("everyone", ["All"]);
  await mkEv("prod-only", ["Production"]);
  await mkEv("mkt-only", ["Marketing"]);
  const titles = async (t: string) => (await call("GET", "/calendar/events?from=2031-06-01&to=2031-06-30", t)).body.events.map((e: any) => e.title.replace(` ${run}`, "")).sort();
  assert.deepEqual(await titles(tok.prod), ["everyone", "prod-only"]);
  assert.deepEqual(await titles(tok.mkt), ["everyone", "mkt-only"]);
  assert.deepEqual(await titles(tok.admin), ["everyone", "mkt-only", "prod-only"]);
  assert.deepEqual(await titles(tok.hr), ["everyone", "mkt-only", "prod-only"]);
});
