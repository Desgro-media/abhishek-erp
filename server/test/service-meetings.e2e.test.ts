/**
 * Clients > client detail > Services: per-service meetings and website details.
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
  pm = await mkClient("PM client", ["Web Development", "Graphic Design"], names.repA, 1);
  plain = await mkClient("Plain client", ["Production"], names.repA, 2);
  other = await mkClient("Other rep PM", ["Web Development"], names.repB, 3);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(async () => {
  await prisma?.client.deleteMany({ where: { id: { in: [pm?.id, plain?.id, other?.id].filter(Boolean) } } });
  server?.close();
  await prisma?.$disconnect();
});

const C = (c: { id: string }, rest = "") => `/crm/clients/${c.id}${rest}`;
const iso = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const sched = { service: "Web Development", status: "SCHEDULED", date: iso(3), time: "11:00", mode: "Google Meet", attendees: "Muhsin, founder", agenda: "Kickoff" };
let mid: string;

test("access: 401 / Finance 403; a rep only on their own client; Admin and Clients on any", async () => {
  assert.equal((await call("POST", C(pm, "/service-meetings"), null, sched)).status, 401);
  assert.equal((await call("POST", C(pm, "/service-meetings"), tok.finance, sched)).status, 403);
  assert.equal((await call("POST", C(other, "/service-meetings"), tok.repA, sched)).status, 403);
  assert.equal((await call("PUT", C(pm, "/web-details"), tok.repB, {})).status, 403);
  assert.equal((await call("GET", "/crm/client-meetings", tok.finance)).status, 403);
});

test("schedule: needs a service the client takes; past dates, bad time / mode refused; held needs minutes and no future date", async () => {
  assert.equal((await call("POST", C(plain, "/service-meetings"), tok.repA, sched)).status, 400, "client doesn't take it");
  for (const b of [{ ...sched, date: iso(-3) }, { ...sched, time: "25:00" }, { ...sched, mode: "Carrier pigeon" }, { ...sched, date: "2026-02-31" },
    { ...sched, status: "HELD", date: iso(-1), notes: "" }, { ...sched, status: "HELD", date: iso(3), notes: "x" }, { ...sched, status: "CANCELLED" }])
    assert.equal((await call("POST", C(pm, "/service-meetings"), tok.repA, b)).status, 400, JSON.stringify(b));
  const r = await call("POST", C(pm, "/service-meetings"), tok.repA, sched);
  assert.equal(r.status, 201);
  mid = r.body.meeting.id;
  assert.equal(r.body.meeting.status, "SCHEDULED");
  assert.equal(r.body.meeting.notes, "");
  const logged = await call("POST", C(pm, "/service-meetings"), tok.repA, { ...sched, status: "HELD", date: iso(-1), notes: "Agreed scope", actionItems: "Send assets" });
  assert.equal(logged.status, 201);
  assert.equal(logged.body.meeting.status, "HELD");
});

test("reschedule, mark held (remembers the original date), cancel; a held meeting can't go back; cancelled can't be edited", async () => {
  const re = await call("PUT", C(pm, `/service-meetings/${mid}`), tok.repA, { ...sched, date: iso(5) });
  assert.equal(re.body.meeting.date, iso(5));
  assert.equal(re.body.meeting.scheduledFor, null);
  const held = await call("PUT", C(pm, `/service-meetings/${mid}`), tok.repA, { ...sched, status: "HELD", date: iso(0), notes: "Reviewed the sitemap" });
  assert.equal(held.status, 200);
  assert.equal(held.body.meeting.status, "HELD");
  assert.equal(held.body.meeting.scheduledFor, iso(5), "was scheduled for another day");
  assert.equal((await call("PUT", C(pm, `/service-meetings/${mid}`), tok.repA, sched)).status, 400, "held can't go back to scheduled");
  assert.equal((await call("PUT", C(pm, `/service-meetings/${mid}`), tok.repA, { ...sched, status: "HELD", date: iso(0), notes: "x", service: "Graphic Design" })).status, 400, "can't change service");
  assert.equal((await call("POST", C(pm, `/service-meetings/${mid}/cancel`), tok.repA)).status, 400, "only scheduled ones cancel");
  const s2 = (await call("POST", C(pm, "/service-meetings"), tok.repA, sched)).body.meeting.id;
  assert.equal((await call("POST", C(pm, `/service-meetings/${s2}/cancel`), tok.repB)).status, 403);
  assert.equal((await call("POST", C(other, `/service-meetings/${s2}/cancel`), tok.admin)).status, 404, "never through another client's URL");
  const c = await call("POST", C(pm, `/service-meetings/${s2}/cancel`), tok.repA);
  assert.equal(c.body.meeting.status, "CANCELLED");
  assert.equal((await call("PUT", C(pm, `/service-meetings/${s2}`), tok.repA, sched)).status, 400);
  // deleting: a cancelled/scheduled one by the rep, held minutes only by Admin
  assert.equal((await call("DELETE", C(pm, `/service-meetings/${s2}`), tok.repA)).status, 204);
  assert.equal((await call("DELETE", C(pm, `/service-meetings/${mid}`), tok.repA)).status, 403, "held minutes are a record");
  assert.equal((await call("DELETE", C(pm, `/service-meetings/${mid}`), tok.admin)).status, 204);
});

test("calendar feed: scheduled and held only, scoped to the caller's clients; collab keeps the legacy log separate", async () => {
  const s = await call("POST", C(pm, "/service-meetings"), tok.repA, sched);
  const o = await call("POST", C(other, "/service-meetings"), tok.admin, sched);
  const mine = (await call("GET", "/crm/client-meetings", tok.repA)).body.meetings;
  assert.ok(mine.some((m: any) => m.id === s.body.meeting.id && m.clientName === `PM client ${run}`));
  assert.ok(!mine.some((m: any) => m.id === o.body.meeting.id), "another rep's client");
  assert.ok((await call("GET", "/crm/client-meetings", tok.admin)).body.meetings.some((m: any) => m.id === o.body.meeting.id));
  const collab = (await call("GET", C(pm, "/collab"), tok.repA)).body;
  assert.ok(collab.serviceMeetings.some((m: any) => m.id === s.body.meeting.id));
  assert.ok(!collab.meetings.some((m: any) => m.id === s.body.meeting.id), "legacy weekly log is service-less meetings only");
});

test("website details: http(s) links only; Web Development clients only; saved and returned with the client's collab data", async () => {
  const good = { stagingUrl: "https://stg.example.com", liveUrl: "", domain: "example.com", hosting: "Hostinger", platform: "WordPress", notes: "n" };
  assert.equal((await call("PUT", C(plain, "/web-details"), tok.repA, good)).status, 400);
  for (const b of [{ ...good, liveUrl: "javascript:alert(1)" }, { ...good, stagingUrl: "ftp://x" }, { ...good, domain: undefined }])
    assert.equal((await call("PUT", C(pm, "/web-details"), tok.repA, b)).status, 400, JSON.stringify(b));
  const r = await call("PUT", C(pm, "/web-details"), tok.repA, good);
  assert.equal(r.status, 200);
  assert.equal((await call("GET", C(pm, "/collab"), tok.repA)).body.webDetails.hosting, "Hostinger");
  assert.equal((await call("PUT", C(pm, "/web-details"), tok.repA, { ...good, hosting: "Netlify" })).body.webDetails.hosting, "Netlify");
  assert.equal(await prisma.auditLog.count({ where: { entityId: pm.id, action: "CRM_WEB_DETAILS_UPDATE" } }), 2);
});
