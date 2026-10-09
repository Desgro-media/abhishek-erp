/**
 * Clients > client detail: ad account access, campaign brief, brand assets, meetings log.
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
let tok: { admin: string; head: string; clients: string; repA: string; repB: string; finance: string };
let names: { repA: string; repB: string };
let pm: { id: string }; // Performance Marketing client, repA's book
let plain: { id: string }; // non-PM client, repA's book
let other: { id: string }; // PM client in repB's book
const run = `c${Date.now().toString(36)}`;
const today = new Date().toISOString().slice(0, 10);

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
  const [admin, head, clients, a, b, finance] = [await mk("admin", ["ADMIN"]), await mk("head", ["SALES_HEAD"]), await mk("clients", ["CLIENTS"]), await mk("repa", ["SALES"]), await mk("repb", ["SALES"]), await mk("finance", ["FINANCE"])];
  tok = { admin: admin.token, head: head.token, clients: clients.token, repA: a.token, repB: b.token, finance: finance.token };
  names = { repA: a.u.name, repB: b.u.name };
  const mkClient = (label: string, services: string[], salesPerson: string, n: number) =>
    prisma.client.create({ data: { clientCode: `CLT-${run}-${n}`, name: `${label} ${run}`, services, salesPerson, onboardedAt: new Date() } });
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

const U = (c: { id: string }, rest = "") => `/crm/clients/${c.id}${rest}`;
const access = { platform: "Meta Business Manager", accountId: "act_123", accessEmail: "ads@desgromedia.com", status: "GRANTED", notes: "Admin on BM" };

test("empty client: GET /collab returns the empty shape", async () => {
  const r = await call("GET", U(pm, "/collab"), tok.repA);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { adAccess: null, campaignBrief: null, brandAssets: [], meetings: [] });
  assert.equal((await call("GET", U({ id: "00000000-0000-0000-0000-000000000000" }, "/collab"), tok.admin)).status, 404);
});

test("access: no token 401; Finance-only 403; a Sales rep gets their own clients only; Admin / Sales Head / Clients role get all", async () => {
  assert.equal((await call("GET", U(pm, "/collab"), null)).status, 401);
  assert.equal((await call("GET", U(pm, "/collab"), tok.finance)).status, 403);
  assert.equal((await call("GET", U(other, "/collab"), tok.repA)).status, 403, "another rep's client");
  for (const t of [tok.admin, tok.head, tok.clients]) assert.equal((await call("GET", U(other, "/collab"), t)).status, 200);
  // every write is refused cross-book too, and nothing is stored
  assert.equal((await call("PUT", U(other, "/ad-access"), tok.repA, access)).status, 403);
  assert.equal((await call("PUT", U(other, "/campaign-brief"), tok.repA, { objective: "x" })).status, 403);
  assert.equal((await call("POST", U(other, "/brand-assets"), tok.repA, { name: "Logo" })).status, 403);
  assert.equal((await call("POST", U(other, "/meetings"), tok.repA, { date: today, attendees: "a", notes: "n" })).status, 403);
  assert.equal(await prisma.clientAdAccess.count({ where: { clientId: other.id } }), 0);
  assert.equal(await prisma.clientBrandAsset.count({ where: { clientId: other.id } }), 0);
  assert.equal(await prisma.clientMeeting.count({ where: { clientId: other.id } }), 0);
});

test("ad account access + brief: Performance Marketing clients only; upsert keeps one row; blanks become null; audited", async () => {
  assert.equal((await call("PUT", U(plain, "/ad-access"), tok.repA, access)).status, 400, "not a PM client");
  assert.equal((await call("PUT", U(plain, "/campaign-brief"), tok.repA, { objective: "x" })).status, 400);

  const a = await call("PUT", U(pm, "/ad-access"), tok.repA, access);
  assert.equal(a.status, 200);
  assert.equal(a.body.adAccess.status, "GRANTED");
  assert.equal(a.body.adAccess.updatedBy, names.repA);
  const b = await call("PUT", U(pm, "/ad-access"), tok.admin, { platform: "Google Ads", accountId: "", accessEmail: "", status: "REVOKED" });
  assert.equal(b.status, 200);
  assert.equal(b.body.adAccess.accountId, null);
  assert.equal(b.body.adAccess.accessEmail, null);
  assert.equal(b.body.adAccess.notes, null);
  assert.equal(await prisma.clientAdAccess.count({ where: { clientId: pm.id } }), 1);
  const audits = await prisma.auditLog.findMany({ where: { action: "CRM_CLIENT_AD_ACCESS_UPSERT", entityId: pm.id }, orderBy: { createdAt: "asc" } });
  assert.equal(audits.length, 2);
  assert.equal((audits[1].beforeData as any).platform, "Meta Business Manager", "update records the old values");

  const br = await call("PUT", U(pm, "/campaign-brief"), tok.repA, { objective: "Leads", audience: "  UAE homeowners  ", budget: "AED 15,000 / month" });
  assert.equal(br.status, 200);
  assert.equal(br.body.campaignBrief.audience, "UAE homeowners", "trimmed");
  const clear = await call("PUT", U(pm, "/campaign-brief"), tok.repA, {});
  assert.equal(clear.body.campaignBrief.objective, null);
  assert.equal(await prisma.clientCampaignBrief.count({ where: { clientId: pm.id } }), 1);
});

test("ad access validation: blank platform, bad status, bad email, oversize text are refused", async () => {
  for (const b of [
    { ...access, platform: "  " },
    { ...access, status: "MAYBE" },
    { ...access, status: undefined },
    { ...access, accessEmail: "not-an-email" },
    { ...access, notes: "x".repeat(1001) },
  ]) assert.equal((await call("PUT", U(pm, "/ad-access"), tok.admin, b)).status, 400, JSON.stringify(b).slice(0, 80));
});

test("brand assets: only http(s) links; add, list, remove; another client's asset can't be removed via this URL", async () => {
  for (const link of ["javascript:alert(1)", "data:text/html,<b>x</b>", "ftp://x.com/a", "drive.google.com/x", "https://a b.com"]) {
    assert.equal((await call("POST", U(pm, "/brand-assets"), tok.repA, { name: "Logo", link })).status, 400, link);
  }
  assert.equal((await call("POST", U(pm, "/brand-assets"), tok.repA, { name: "   " })).status, 400);

  const a = await call("POST", U(pm, "/brand-assets"), tok.repA, { name: " Logo pack ", link: "https://drive.google.com/logo", notes: "" });
  assert.equal(a.status, 201);
  assert.equal(a.body.asset.name, "Logo pack");
  assert.equal(a.body.asset.notes, null);
  assert.equal((await call("POST", U(plain, "/brand-assets"), tok.repA, { name: "Guidelines", link: "" })).status, 201, "any client can hold brand assets; link is optional");

  const otherAsset = await call("POST", U(other, "/brand-assets"), tok.admin, { name: "Theirs" });
  assert.equal((await call("DELETE", U(pm, `/brand-assets/${otherAsset.body.asset.id}`), tok.repA)).status, 404, "wrong client in the URL");
  assert.equal(await prisma.clientBrandAsset.count({ where: { id: otherAsset.body.asset.id } }), 1, "untouched");

  assert.equal((await call("GET", U(pm, "/collab"), tok.repA)).body.brandAssets.length, 1);
  assert.equal((await call("DELETE", U(pm, `/brand-assets/${a.body.asset.id}`), tok.repA)).status, 204);
  assert.equal((await call("DELETE", U(pm, `/brand-assets/${a.body.asset.id}`), tok.repA)).status, 404);
  assert.ok(await prisma.auditLog.findFirst({ where: { action: "CRM_CLIENT_BRAND_ASSET_REMOVE", entityId: pm.id } }));
});

test("meetings: validation, newest first, future/impossible dates refused, only Admin / Sales Head can delete", async () => {
  for (const b of [
    { date: today, attendees: "", notes: "n" },
    { date: today, attendees: "a", notes: "   " },
    { date: "2999-01-01", attendees: "a", notes: "n" },
    { date: "2026-02-31", attendees: "a", notes: "n" },
    { date: "01/02/2026", attendees: "a", notes: "n" },
    { date: today, attendees: "a", notes: "x".repeat(5001) },
  ]) assert.equal((await call("POST", U(pm, "/meetings"), tok.repA, b)).status, 400, JSON.stringify(b).slice(0, 60));

  const older = await call("POST", U(pm, "/meetings"), tok.repA, { date: "2026-09-01", attendees: "Hafsa, Client Ops", notes: "Approved Q4 concept" });
  const newer = await call("POST", U(pm, "/meetings"), tok.repA, { date: "2026-09-08", attendees: "Hafsa", notes: "Ad review" });
  assert.equal(older.status, 201);
  assert.equal(older.body.meeting.loggedBy, names.repA);
  const list = (await call("GET", U(pm, "/collab"), tok.repA)).body.meetings;
  assert.deepEqual(list.map((m: any) => m.date), ["2026-09-08", "2026-09-01"]);

  assert.equal((await call("DELETE", U(pm, `/meetings/${newer.body.meeting.id}`), tok.repA)).status, 403, "the rep who logged it can't erase it");
  assert.equal((await call("DELETE", U(pm, `/meetings/${newer.body.meeting.id}`), tok.clients)).status, 403);
  assert.equal((await call("DELETE", U(plain, `/meetings/${newer.body.meeting.id}`), tok.admin)).status, 404, "wrong client in the URL");
  assert.equal((await call("DELETE", U(pm, `/meetings/${newer.body.meeting.id}`), tok.head)).status, 204);
  assert.equal((await call("DELETE", U(pm, `/meetings/${older.body.meeting.id}`), tok.admin)).status, 204);
  assert.ok(await prisma.auditLog.findFirst({ where: { action: "CRM_CLIENT_MEETING_DELETE", entityId: pm.id } }));
});

test("deleting a client (allowed when it has no billing) removes its collaboration data with it", async () => {
  const c = await prisma.client.create({ data: { clientCode: `CLT-${run}-9`, name: `Temp ${run}`, services: ["Performance Marketing"], salesPerson: names.repA, onboardedAt: new Date() } });
  await call("PUT", U(c, "/ad-access"), tok.admin, access);
  await call("PUT", U(c, "/campaign-brief"), tok.admin, { objective: "x" });
  await call("POST", U(c, "/brand-assets"), tok.admin, { name: "Logo" });
  await call("POST", U(c, "/meetings"), tok.admin, { date: today, attendees: "a", notes: "n" });
  assert.equal((await call("DELETE", U(c), tok.admin)).status, 204);
  for (const t of ["clientAdAccess", "clientCampaignBrief", "clientBrandAsset", "clientMeeting"] as const) {
    assert.equal(await (prisma[t] as any).count({ where: { clientId: c.id } }), 0, t);
  }
});
