/**
 * Marketing > Meta Ads > Daily Tracking (DesGro's own ad numbers).
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
let tok: { admin: string; content: string; sales: string; finance: string };
const run = `o${Date.now().toString(36)}`;
// Far in the past so these rows never collide with real data on the one-row-per-date key.
const D1 = "2001-03-04";
const D2 = "2001-03-05";

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
    return signAccessToken({ sub: u.id, email: u.email, name: u.name, roles, department: null, employeeId: null });
  };
  tok = { admin: await mk("admin", ["ADMIN"]), content: await mk("content", ["CONTENT"]), sales: await mk("sales", ["SALES"]), finance: await mk("finance", ["FINANCE"]) };
  await prisma.ownAdMetric.deleteMany({ where: { date: { in: [new Date(`${D1}T00:00:00Z`), new Date(`${D2}T00:00:00Z`)] } } });
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(async () => {
  await prisma?.ownAdMetric.deleteMany({ where: { date: { in: [new Date(`${D1}T00:00:00Z`), new Date(`${D2}T00:00:00Z`)] } } });
  server?.close();
  await prisma?.$disconnect();
});

const good = { date: D1, spend: 2150.5, leads: 7, purchases: 1, revenue: 15000 };

test("only Admin / Content can read or write; everyone else (and no token) is refused", async () => {
  for (const t of [tok.sales, tok.finance, null]) {
    assert.equal((await call("GET", "/content/own-ad-metrics", t)).status, t ? 403 : 401);
    assert.equal((await call("POST", "/content/own-ad-metrics", t, good)).status, t ? 403 : 401);
  }
  assert.equal((await call("GET", "/content/own-ad-metrics", tok.content)).status, 200);
  assert.equal((await call("GET", "/content/own-ad-metrics", tok.admin)).status, 200);
});

test("validation: negatives, fractions, junk dates, impossible dates and future dates are refused; nothing is stored", async () => {
  const bad: unknown[] = [
    { ...good, spend: -1 },
    { ...good, revenue: -5 },
    { ...good, leads: -1 },
    { ...good, leads: 1.5 },
    { ...good, purchases: 2.2 },
    { ...good, spend: "100" },
    { ...good, spend: 1e12 },
    { ...good, date: "04/03/2001" },
    { ...good, date: "2001-02-31" },
    { ...good, date: "2999-01-01" },
    { date: D1, spend: 1 },
  ];
  for (const b of bad) assert.equal((await call("POST", "/content/own-ad-metrics", tok.content, b)).status, 400, JSON.stringify(b));
  assert.equal(await prisma.ownAdMetric.count({ where: { date: new Date(`${D1}T00:00:00Z`) } }), 0);
});

test("log -> derived CPL/CPA/ROAS; same date again updates (one row per day); audit trail", async () => {
  const a = await call("POST", "/content/own-ad-metrics", tok.content, good);
  assert.equal(a.status, 201);
  assert.equal(a.body.metric.date, D1);
  assert.equal(a.body.metric.spend, 2150.5);
  assert.equal(a.body.metric.cpl, 2150.5 / 7);
  assert.equal(a.body.metric.cpa, 2150.5);
  assert.equal(a.body.metric.roas, 15000 / 2150.5);
  assert.match(a.body.metric.loggedBy, /^content /);

  const b = await call("POST", "/content/own-ad-metrics", tok.admin, { ...good, spend: 3000, leads: 10, purchases: 2, revenue: 6000 });
  assert.equal(b.status, 200, "second log of the same date is an update");
  assert.equal(b.body.metric.id, a.body.metric.id);
  assert.equal(await prisma.ownAdMetric.count({ where: { date: new Date(`${D1}T00:00:00Z`) } }), 1);
  assert.equal(b.body.metric.roas, 2);

  const audits = await prisma.auditLog.findMany({ where: { entityType: "OwnAdMetric", entityId: a.body.metric.id }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(audits.map((x) => x.action), ["CONTENT_OWN_AD_METRIC_CREATE", "CONTENT_OWN_AD_METRIC_UPDATE"]);
  assert.equal((audits[1].beforeData as any).spend, 2150.5, "update records the old figures");
  assert.equal((audits[1].afterData as any).spend, 3000);
});

test("a zero day gives null (not Infinity/NaN) for CPL, CPA and ROAS", async () => {
  const r = await call("POST", "/content/own-ad-metrics", tok.content, { date: D2, spend: 0, leads: 0, purchases: 0, revenue: 500 });
  assert.equal(r.status, 201);
  assert.equal(r.body.metric.cpl, null);
  assert.equal(r.body.metric.cpa, null);
  assert.equal(r.body.metric.roas, null);
});

test("list is newest-first; delete removes it, 404s afterwards, and is audited", async () => {
  const list = (await call("GET", "/content/own-ad-metrics", tok.content)).body.metrics as { id: string; date: string }[];
  const mine = list.filter((m) => m.date === D1 || m.date === D2);
  assert.deepEqual(mine.map((m) => m.date), [D2, D1]);

  const id = mine[0].id;
  assert.equal((await call("DELETE", `/content/own-ad-metrics/${id}`, tok.sales)).status, 403);
  assert.equal((await call("DELETE", `/content/own-ad-metrics/${id}`, tok.content)).status, 204);
  assert.equal((await call("DELETE", `/content/own-ad-metrics/${id}`, tok.content)).status, 404);
  const del = await prisma.auditLog.findFirst({ where: { action: "CONTENT_OWN_AD_METRIC_DELETE", entityId: id } });
  assert.ok(del && (del.beforeData as any).revenue === 500);
});
