/**
 * Client edit / delete rules.
 *   TEST_DATABASE_URL=postgresql://.../desgro_erp_test npm run test:e2e
 * Same throwaway-DB guard as quote-to-cash.e2e.test.ts.
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
let tok: { admin: string; head: string; sales: string; otherSales: string };
let salesName: string;
const run = `c${Date.now().toString(36)}`;

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
// Codes must stay in the app's numeric "CLI-<n>" shape: nextClientCode() takes the max code and
// parses the number, so anything else here would poison code generation for every later client.
let codeSeq = 800_000 + Math.floor(Math.random() * 100_000);
const mkClient = (label: string, salesPerson: string) =>
  prisma.client.create({ data: { clientCode: `CLI-${codeSeq++}`, name: `Client ${label} ${run}`, services: [], onboardedAt: new Date(), salesPerson } });

before(async () => {
  ({ prisma } = await import("../src/db/prisma"));
  const { app } = await import("../src/app");
  const { signAccessToken } = await import("../src/utils/tokens");
  const mk = async (label: string, roles: any[]) => {
    const u = await prisma.user.create({ data: { name: `${label} ${run}`, email: `${label}-${run}@test.local`, passwordHash: "x", roles } });
    return { u, token: signAccessToken({ sub: u.id, email: u.email, name: u.name, roles, department: null, employeeId: null }) };
  };
  const [admin, head, sales, other] = [await mk("admin", ["ADMIN"]), await mk("head", ["SALES_HEAD"]), await mk("sales", ["SALES"]), await mk("othersales", ["SALES"])];
  tok = { admin: admin.token, head: head.token, sales: sales.token, otherSales: other.token };
  salesName = sales.u.name;
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(async () => { server?.close(); await prisma?.$disconnect(); });

test("a Sales rep edits their own client, but not someone else's", async () => {
  const mine = await mkClient("mine", salesName);
  const ok = await call("PATCH", `/crm/clients/${mine.id}`, tok.sales, { city: "Kochi" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.client.city, "Kochi");

  const notMine = await call("PATCH", `/crm/clients/${mine.id}`, tok.otherSales, { city: "Hacked" });
  assert.equal(notMine.status, 403);
  assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: mine.id } })).city, "Kochi");

  assert.equal((await call("PATCH", `/crm/clients/${mine.id}`, tok.head, { status: "PAUSED" })).status, 200, "Sales Head edits anyone's");
  assert.equal((await call("PATCH", `/crm/clients/${mine.id}`, tok.admin, { status: "ACTIVE" })).status, 200);
  assert.equal((await call("PATCH", `/crm/clients/00000000-0000-0000-0000-000000000000`, tok.admin, { city: "x" })).status, 404);
});

test("only Admin / Sales Head can delete a client", async () => {
  const c = await mkClient("nodelete", salesName);
  assert.equal((await call("DELETE", `/crm/clients/${c.id}`, tok.sales)).status, 403, "even the client's own Sales rep");
  assert.ok(await prisma.client.findUnique({ where: { id: c.id } }), "still there");

  assert.equal((await call("DELETE", `/crm/clients/${c.id}`, tok.head)).status, 204);
  assert.equal(await prisma.client.findUnique({ where: { id: c.id } }), null);
  assert.equal((await call("DELETE", `/crm/clients/${c.id}`, tok.admin)).status, 404, "already gone");
});

test("a client with no billing history is deleted along with their workflow tasks", async () => {
  const c = await mkClient("tasks", salesName);
  await prisma.clientTask.create({ data: { clientId: c.id, title: "Logo", assignedTo: "x", dueAt: new Date() } });
  assert.equal((await call("DELETE", `/crm/clients/${c.id}`, tok.admin)).status, 204);
  assert.equal(await prisma.clientTask.count({ where: { clientId: c.id } }), 0);
  assert.ok(await prisma.auditLog.findFirst({ where: { action: "CRM_CLIENT_DELETE", entityId: c.id } }), "audited");
});

test("a client with an invoice or a quote can't be deleted (ledger is append-only)", async () => {
  const withInvoice = await mkClient("inv", salesName);
  await prisma.invoice.create({ data: { clientId: withInvoice.id, invoiceNo: `INV-${run}`, issuedAt: new Date(), dueAt: new Date(), items: { create: [{ dept: "Web Development", amount: 1000 }] } } });
  const r1 = await call("DELETE", `/crm/clients/${withInvoice.id}`, tok.admin);
  assert.equal(r1.status, 409);
  assert.match(r1.body.error, /1 invoice/);
  assert.ok(await prisma.client.findUnique({ where: { id: withInvoice.id } }));

  const withQuote = await mkClient("quo", salesName);
  const q = await call("POST", "/crm/quotes", tok.sales, { clientId: withQuote.id, title: `Q-${run}`, items: [{ dept: "Web Development", amount: 500 }] });
  assert.equal(q.status, 201);
  const r2 = await call("DELETE", `/crm/clients/${withQuote.id}`, tok.admin);
  assert.equal(r2.status, 409);
  assert.match(r2.body.error, /1 quote/);
  assert.ok(await prisma.client.findUnique({ where: { id: withQuote.id } }));
});
