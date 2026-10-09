/**
 * Clients > client detail > Ad Performance (a Performance Marketing client's daily ad numbers).
 *   TEST_DATABASE_URL=postgresql://.../desgro_erp_test npm run test:e2e
 * Same throwaway-DB guard as the other e2e files.
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
let tok: { admin: string; clients: string; repA: string; repB: string; finance: string; content: string };
let names: { repA: string; repB: string };
let pm: { id: string }; // PM client in repA's book
let plain: { id: string }; // non-PM client in repA's book
let other: { id: string }; // PM client in repB's book
const run = `m${Date.now().toString(36)}`;

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  ({ prisma } = await import("../src/db/prisma"));
  const { app } = await import("../src/app");
  const { signAccessToken } = await import("../src/utils/tokens");
  const mk = async (label: string, roles: any[]) => {
    const u = await prisma.user.create({ data: { name: `${label} ${run}`, email: `${label}-${run}@test.local`, passwordHash: "x", roles } });
    return { u, token: signAccessToken({ sub: u.id, email: u.email, name: u.name, roles, department: null, employeeId: null }) };
  };
  const [admin, clients, a, b, finance, content] = [await mk("admin", ["ADMIN"]), await mk("clients", ["CLIENTS"]), await mk("repa", ["SALES"]), await mk("repb", ["SALES"]), await mk("finance", ["FINANCE"]), await mk("content", ["CONTENT"])];
  tok = { admin: admin.token, clients: clients.token, repA: a.token, repB: b.token, finance: finance.token, content: content.token };
  names = { repA: a.u.name, repB: b.u.name };
  const mkClient = (label: string, services: string[], salesPerson: string, n: number) =>
    prisma.client.create({ data: { clientCode: `CAM-${run}-${n}`, name: `${label} ${run}`, services, salesPerson, onboardedAt: new Date() } });
  pm = await mkClient("PM client", ["Performance Marketing"], names.repA, 1);
  plain = await mkClient("Plain client", ["Graphic Design"], names.repA, 2);
  other = await mkClient("Other rep PM", ["Performance Marketing"], names.repB, 3);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(async () => {
  await prisma?.client.deleteMany({ where: { id: { in: [pm?.id, plain?.id, other?.id].filter(Boolean) } } });
  server?.close();
  await prisma?.$disconnect();
});

const U = (c: { id: string }, rest = "") => `/crm/clients/${c.id}/ad-metrics${rest}`;
const good = { date: "2026-09-06", spend: 820.5, leads: 11, purchases: 2, revenue: 28000 };

test("access: no token 401; Finance / Content-only 403; a rep sees only their own clients; Admin and Clients role see all", async () => {
  for (const t of [tok.finance, tok.content]) {
    assert.equal((await call("GET", U(pm), t)).status, 403);
    assert.equal((await call("POST", U(pm), t, good)).status, 403);
  }
  assert.equal((await call("GET", U(pm), null)).status, 401);
  assert.equal((await call("GET", U(other), tok.repA)).status, 403);
  assert.equal((await call("POST", U(other), tok.repA, good)).status, 403, "another rep's client");
  assert.equal(await prisma.clientAdMetric.count({ where: { clientId: other.id } }), 0);
  for (const t of [tok.admin, tok.clients]) assert.equal((await call("GET", U(other), t)).status, 200);
  assert.deepEqual((await call("GET", U(pm), tok.repA)).body, { metrics: [] });
  assert.equal((await call("GET", U({ id: "00000000-0000-0000-0000-000000000000" }), tok.admin)).status, 404);
});

test("Performance Marketing clients only: logging for any other client is refused", async () => {
  assert.equal((await call("POST", U(plain), tok.repA, good)).status, 400);
  assert.equal(await prisma.clientAdMetric.count({ where: { clientId: plain.id } }), 0);
});

test("validation: negatives, fractions, junk / impossible / future dates, missing fields; nothing is stored", async () => {
  for (const b of [
    { ...good, spend: -1 }, { ...good, revenue: -5 }, { ...good, leads: -1 }, { ...good, leads: 1.5 }, { ...good, purchases: 2.2 },
    { ...good, spend: "100" }, { ...good, spend: 1e12 }, { ...good, date: "06/09/2026" }, { ...good, date: "2026-02-31" },
    { ...good, date: "2999-01-01" }, { date: good.date, spend: 1 },
  ]) assert.equal((await call("POST", U(pm), tok.repA, b)).status, 400, JSON.stringify(b));
  assert.equal(await prisma.clientAdMetric.count({ where: { clientId: pm.id } }), 0);
});

test("log -> derived CPL/CPA/ROAS; same date again updates (one row per client per day); audit trail with before/after", async () => {
  const a = await call("POST", U(pm), tok.repA, good);
  assert.equal(a.status, 201);
  assert.equal(a.body.metric.cpl, 820.5 / 11);
  assert.equal(a.body.metric.cpa, 410.25);
  assert.equal(a.body.metric.roas, 28000 / 820.5);
  assert.equal(a.body.metric.loggedBy, names.repA);

  const b = await call("POST", U(pm), tok.admin, { ...good, spend: 1000, leads: 0, purchases: 0, revenue: 2000 });
  assert.equal(b.status, 200);
  assert.equal(b.body.metric.id, a.body.metric.id);
  assert.equal(b.body.metric.cpl, null, "no leads -> null, not Infinity");
  assert.equal(b.body.metric.cpa, null);
  assert.equal(b.body.metric.roas, 2);
  assert.equal(await prisma.clientAdMetric.count({ where: { clientId: pm.id } }), 1);

  const audits = await prisma.auditLog.findMany({ where: { entityId: pm.id, action: { in: ["CRM_CLIENT_AD_METRIC_CREATE", "CRM_CLIENT_AD_METRIC_UPDATE"] } }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(audits.map((x) => x.action), ["CRM_CLIENT_AD_METRIC_CREATE", "CRM_CLIENT_AD_METRIC_UPDATE"]);
  assert.equal((audits[1].beforeData as any).spend, 820.5);
  assert.equal((audits[1].afterData as any).spend, 1000);
});

test("the same date for two different clients is two separate rows (one row per client per day)", async () => {
  const r = await call("POST", U(other), tok.admin, good);
  assert.equal(r.status, 201);
  assert.equal((await call("GET", U(other), tok.admin)).body.metrics.length, 1);
  assert.equal((await call("GET", U(pm), tok.admin)).body.metrics.length, 1, "pm's row untouched");
});

test("list is newest first; delete removes only that client's row; another client's id in the URL is a 404", async () => {
  await call("POST", U(pm), tok.repA, { ...good, date: "2026-09-08" });
  const list = (await call("GET", U(pm), tok.repA)).body.metrics as { id: string; date: string }[];
  assert.deepEqual(list.map((m) => m.date), ["2026-09-08", "2026-09-06"]);

  const theirs = (await call("GET", U(other), tok.admin)).body.metrics[0].id;
  assert.equal((await call("DELETE", U(pm, `/${theirs}`), tok.repA)).status, 404, "wrong client in the URL");
  assert.equal(await prisma.clientAdMetric.count({ where: { id: theirs } }), 1, "untouched");
  assert.equal((await call("DELETE", U(other, `/${theirs}`), tok.repA)).status, 403, "and a rep can't reach another rep's client at all");

  assert.equal((await call("DELETE", U(pm, `/${list[0].id}`), tok.repA)).status, 204);
  assert.equal((await call("DELETE", U(pm, `/${list[0].id}`), tok.repA)).status, 404);
  const del = await prisma.auditLog.findFirst({ where: { action: "CRM_CLIENT_AD_METRIC_DELETE", entityId: pm.id } });
  assert.equal((del!.beforeData as any).date, "2026-09-08");
});

test("deleting a client (allowed when it has no billing) removes its ad numbers with it", async () => {
  const c = await prisma.client.create({ data: { clientCode: `CAM-${run}-9`, name: `Temp ${run}`, services: ["Performance Marketing"], salesPerson: names.repA, onboardedAt: new Date() } });
  await call("POST", U(c), tok.admin, good);
  assert.equal((await call("DELETE", `/crm/clients/${c.id}`, tok.admin)).status, 204);
  assert.equal(await prisma.clientAdMetric.count({ where: { clientId: c.id } }), 0);
});
