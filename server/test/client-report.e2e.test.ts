/**
 * Client report link: a no-login, read-only page of a Performance Marketing client's ad numbers, brief and meetings.
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
const run = `r${Date.now().toString(36)}`;
let tok: { admin: string; owner: string; other: string };
let pm = "", web = "";
const created = { users: [] as string[], clients: [] as string[] };

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  ({ prisma } = await import("../src/db/prisma"));
  const { app } = await import("../src/app");
  const { signAccessToken } = await import("../src/utils/tokens");
  const mkTok = async (label: string, roles: any[]) => {
    const u = await prisma.user.create({ data: { name: `${label} ${run}`, email: `${label}-${run}@test.local`, passwordHash: "x", roles } });
    created.users.push(u.id);
    return { token: signAccessToken({ sub: u.id, email: u.email, name: u.name, roles, department: null, employeeId: null }), name: u.name };
  };
  const admin = await mkTok("admin", ["ADMIN"]), owner = await mkTok("owner", ["SALES"]), other = await mkTok("other", ["SALES"]);
  tok = { admin: admin.token, owner: owner.token, other: other.token };
  const mk = async (n: string, services: string[], salesPerson: string | null) => { const c = await prisma.client.create({ data: { clientCode: `RP-${run}-${created.clients.length}`, name: `${n} ${run}`, services, status: "ACTIVE", onboardedAt: new Date("2020-01-01"), salesPerson } }); created.clients.push(c.id); return c; };
  pm = (await mk("PM client", ["Performance Marketing"], owner.name)).id;
  web = (await mk("Web client", ["Web Development"], owner.name)).id;
  for (const [d, sp, l, p, r] of [["2031-02-03", 500, 10, 2, 4000], ["2031-02-04", 500, 14, 1, 2000], ["2031-01-10", 1000, 20, 4, 10000]] as const)
    await prisma.clientAdMetric.create({ data: { clientId: pm, date: new Date(d), spend: sp, leads: l, purchases: p, revenue: r, loggedBy: "Secret Staffer" } });
  await prisma.clientCampaignBrief.create({ data: { clientId: pm, objective: "More leads", audience: "Women 25-40", budget: "₹30k / month", updatedBy: "Secret Staffer" } });
  await prisma.clientAdAccess.create({ data: { clientId: pm, platform: "Meta", accountId: "ACT-SECRET-123", accessEmail: "ads@private.example", status: "GRANTED", updatedBy: "t" } });
  await prisma.clientMeeting.create({ data: { clientId: pm, date: new Date("2031-02-05"), attendees: "Asik, Sruthi", notes: "Agreed to raise budget", loggedBy: "Secret Staffer" } });
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  await prisma.client.deleteMany({ where: { id: { in: created.clients } } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  server?.close();
  await prisma.$disconnect();
});

test("making the link: client's own salesperson or leadership, Performance Marketing clients only, one permanent link", async () => {
  assert.equal((await call("POST", `/crm/clients/${pm}/report-link`, tok.other, {})).status, 403, "another rep's client");
  assert.equal((await call("POST", `/crm/clients/${web}/report-link`, tok.owner, {})).status, 400, "not a Performance Marketing client");
  assert.equal((await call("GET", `/crm/clients/${pm}/report-link`, tok.owner)).body.link, null);
  const a = await call("POST", `/crm/clients/${pm}/report-link`, tok.owner, {});
  assert.equal(a.status, 200);
  assert.equal((await call("POST", `/crm/clients/${pm}/report-link`, tok.admin, {})).body.link.token, a.body.link.token, "same link until regenerated");
  assert.equal((await call("GET", `/crm/clients/${pm}/report-link`, tok.other)).status, 403);
});

test("the public report shows ad numbers, brief and meetings — and nothing internal", async () => {
  const token = (await call("GET", `/crm/clients/${pm}/report-link`, tok.owner)).body.link.token;
  const r = await call("GET", `/public/client-report/${token}`, null);
  assert.equal(r.status, 200);
  assert.equal(r.body.month, "2031-02", "defaults to the latest month with numbers");
  assert.deepEqual(r.body.months, ["2031-02", "2031-01"]);
  assert.deepEqual({ spend: r.body.totals.spend, leads: r.body.totals.leads, purchases: r.body.totals.purchases, revenue: r.body.totals.revenue, days: r.body.totals.days }, { spend: 1000, leads: 24, purchases: 3, revenue: 6000, days: 2 });
  assert.equal(r.body.totals.roas, 6); assert.equal(Math.round(r.body.totals.cpl), 42);
  assert.equal(r.body.prevTotals.spend, 1000, "January is the month before");
  assert.deepEqual(r.body.daily.map((d: any) => d.date), ["2031-02-04", "2031-02-03"]);
  assert.equal(r.body.brief.objective, "More leads");
  assert.equal(r.body.meetings[0].notes, "Agreed to raise budget");
  const text = JSON.stringify(r.body);
  for (const secret of ["Secret Staffer", "ACT-SECRET-123", "ads@private.example", pm]) assert.equal(text.includes(secret), false, `leaked: ${secret}`);
  assert.equal((await call("GET", `/public/client-report/${token}?month=2031-01`, null)).body.totals.spend, 1000);
  assert.equal((await call("GET", `/public/client-report/${token}?month=2030-06`, null)).body.totals.days, 0, "a month with no numbers is empty, not an error");
});

test("regenerate kills the old link; turning it off removes the report", async () => {
  const old = (await call("GET", `/crm/clients/${pm}/report-link`, tok.owner)).body.link.token;
  const fresh = (await call("POST", `/crm/clients/${pm}/report-link`, tok.owner, { regenerate: true })).body.link.token;
  assert.notEqual(fresh, old);
  assert.equal((await call("GET", `/public/client-report/${old}`, null)).status, 404);
  assert.equal((await call("GET", `/public/client-report/${fresh}`, null)).status, 200);
  assert.equal((await call("DELETE", `/crm/clients/${pm}/report-link`, tok.other)).status, 403);
  assert.equal((await call("DELETE", `/crm/clients/${pm}/report-link`, tok.owner)).status, 204);
  assert.equal((await call("GET", `/public/client-report/${fresh}`, null)).status, 404);
  assert.equal((await call("GET", `/crm/clients/${pm}/report-link`, tok.owner)).body.link, null);
});
