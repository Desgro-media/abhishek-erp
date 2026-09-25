/**
 * Edit / delete rules for leads, quotes and invoices.
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
let tok: { admin: string; finance: string; a: string; b: string };
let names: { a: string; b: string };
let bankId: string;
const run = `e${Date.now().toString(36)}`;
const today = new Date().toISOString().slice(0, 10);

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
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
  const [admin, finance, a, b] = [await mk("admin", ["ADMIN"]), await mk("finance", ["FINANCE"]), await mk("repa", ["SALES"]), await mk("repb", ["SALES"])];
  tok = { admin: admin.token, finance: finance.token, a: a.token, b: b.token };
  names = { a: a.u.name, b: b.u.name };
  bankId = (await prisma.bankAccount.create({ data: { name: `Bank ${run}`, bank: "B", number: run, opening: 0, openedAt: new Date() } })).id;
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(async () => { server?.close(); await prisma?.$disconnect(); });

const newLead = async (token: string, label: string, leadOwner?: string) => {
  const r = await call("POST", "/crm/leads", token, { name: `Lead ${label} ${run}`, source: "test", serviceInterested: "Web Development", leadOwner });
  assert.equal(r.status, 201);
  return r.body.lead as { id: string };
};
const newQuote = async (token: string, leadId: string, title: string, send = true) => {
  const r = await call("POST", "/crm/quotes", token, { leadId, title: `${title} ${run}`, items: [{ dept: "Web Development", amount: 10_000 }] });
  assert.equal(r.status, 201);
  if (send) assert.equal((await call("POST", `/crm/quotes/${r.body.quote.id}/send`, token)).status, 200);
  return r.body.quote as { id: string };
};

test("leads: a rep edits/deletes only their own; Open leads can be claimed but not deleted by a rep", async () => {
  const mine = await newLead(tok.a, "own", names.a);
  assert.equal((await call("PATCH", `/crm/leads/${mine.id}`, tok.b, { name: "Hacked" })).status, 403);
  assert.equal((await call("DELETE", `/crm/leads/${mine.id}`, tok.b)).status, 403);
  assert.equal((await call("PATCH", `/crm/leads/${mine.id}`, tok.a, { phone: "999" })).status, 200);

  const open = await newLead(tok.admin, "open");
  assert.equal((await call("DELETE", `/crm/leads/${open.id}`, tok.a)).status, 403, "shared Open queue isn't a rep's to delete");
  assert.equal((await call("PATCH", `/crm/leads/${open.id}`, tok.a, { leadOwner: names.a })).status, 200, "but they can claim it");
  assert.equal((await call("PATCH", `/crm/leads/${open.id}`, tok.b, { leadOwner: names.b })).status, 403, "and once claimed it's theirs");

  assert.equal((await call("DELETE", `/crm/leads/${mine.id}`, tok.a)).status, 204);
  assert.equal((await call("DELETE", `/crm/leads/${open.id}`, tok.admin)).status, 204, "Admin deletes anyone's");
  assert.equal((await call("DELETE", `/crm/leads/${open.id}`, tok.admin)).status, 404);
});

test("leads: can't delete a lead that has quotes until they're gone", async () => {
  const lead = await newLead(tok.a, "quoted", names.a);
  const q = await newQuote(tok.a, lead.id, "LQ");
  const blocked = await call("DELETE", `/crm/leads/${lead.id}`, tok.a);
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /1 quote/);
  assert.equal((await call("DELETE", `/crm/quotes/${q.id}`, tok.a)).status, 204);
  assert.equal((await call("DELETE", `/crm/leads/${lead.id}`, tok.a)).status, 204);
});

test("quotes: a rep edits/deletes only their own; editing stops once a payment is recorded", async () => {
  const lead = await newLead(tok.a, "qown", names.a);
  const q = await newQuote(tok.a, lead.id, "QE");
  assert.equal((await call("PATCH", `/crm/quotes/${q.id}`, tok.b, { title: "Hacked" })).status, 403);
  assert.equal((await call("DELETE", `/crm/quotes/${q.id}`, tok.b)).status, 403);

  const edited = await call("PATCH", `/crm/quotes/${q.id}`, tok.a, { title: "Renamed", items: [{ dept: "Production", amount: 12_000 }] });
  assert.equal(edited.status, 200, "a Sent quote is editable");
  assert.equal(Number(edited.body.quote.items[0].amount), 12_000);

  const pay = await call("POST", `/crm/quotes/${q.id}/pending-payments`, tok.a, { amount: 5_000, paymentDate: today });
  assert.equal(pay.status, 201);
  assert.equal((await call("PATCH", `/crm/quotes/${q.id}`, tok.a, { title: "Too late" })).status, 409);

  // Deleting a quote with only an unapproved payment discards it — nothing was ever posted.
  assert.equal((await call("DELETE", `/crm/quotes/${q.id}`, tok.a)).status, 204);
  assert.equal(await prisma.quotePendingPayment.count({ where: { quoteId: q.id } }), 0);
});

test("quotes: an invoiced quote can be neither edited nor deleted", async () => {
  const lead = await newLead(tok.a, "qinv", names.a);
  const q = await newQuote(tok.a, lead.id, "QI");
  assert.equal((await call("POST", `/crm/quotes/${q.id}/convert-to-invoice`, tok.a, { issuedAt: today, dueAt: today })).status, 201);
  assert.equal((await call("PATCH", `/crm/quotes/${q.id}`, tok.a, { title: "x" })).status, 409);
  assert.equal((await call("DELETE", `/crm/quotes/${q.id}`, tok.a)).status, 409);
});

test("invoices: Finance/Admin edit and delete; Sales can't; a paid invoice is protected; deleting an unpaid one reopens its quote", async () => {
  const lead = await newLead(tok.a, "inv", names.a);
  const q = await newQuote(tok.a, lead.id, "IV");
  const conv = await call("POST", `/crm/quotes/${q.id}/convert-to-invoice`, tok.a, { issuedAt: today, dueAt: today });
  const invoiceId = conv.body.invoiceId as string;

  assert.equal((await call("PATCH", `/finance/invoices/${invoiceId}`, tok.a, { dueAt: today })).status, 403);
  assert.equal((await call("DELETE", `/finance/invoices/${invoiceId}`, tok.a)).status, 403);
  assert.equal((await call("PATCH", `/finance/invoices/${invoiceId}`, tok.finance, { items: [{ dept: "Web Development", amount: 11_000 }] })).status, 200);

  // A payment Finance has approved makes it undeletable.
  const p = await call("POST", `/finance/invoices/${invoiceId}/pending-payments`, tok.a, { amount: 1_000, paymentDate: today });
  assert.equal((await call("POST", `/finance/invoices/${invoiceId}/pending-payments/${p.body.pending.id}/approve`, tok.finance, { accountId: bankId })).status, 201);
  assert.equal((await call("DELETE", `/finance/invoices/${invoiceId}`, tok.finance)).status, 409);

  // A different, unpaid invoice: deleting it sends its quote back to Sent so it can be converted again.
  const lead2 = await newLead(tok.a, "inv2", names.a);
  const q2 = await newQuote(tok.a, lead2.id, "IV2");
  const inv2 = (await call("POST", `/crm/quotes/${q2.id}/convert-to-invoice`, tok.a, { issuedAt: today, dueAt: today })).body.invoiceId as string;
  assert.equal((await call("DELETE", `/finance/invoices/${inv2}`, tok.finance)).status, 204);
  const reopened = await prisma.quote.findUniqueOrThrow({ where: { id: q2.id } });
  assert.equal(reopened.status, "SENT");
  assert.equal(reopened.invoiceId, null);
  assert.equal((await call("POST", `/crm/quotes/${q2.id}/convert-to-invoice`, tok.a, { issuedAt: today, dueAt: today })).status, 201, "and it can be converted again");
});

test("auto invoice numbers never collide with an existing one, even after deletions leave gaps", async () => {
  const client = (await call("POST", "/crm/clients", tok.admin, { name: `Numbering ${run}`, services: [] })).body.client;
  // Take exactly the number the old "1000 + count + 1" rule would hand out next.
  const count = await prisma.invoice.count();
  const year = new Date().getFullYear();
  const taken = await call("POST", "/finance/invoices", tok.finance, { clientId: client.id, invoiceNo: `DG-${year}-${1000 + count + 2}`, issuedAt: today, dueAt: today, items: [{ dept: "Web Development", amount: 1_000 }] });
  assert.equal(taken.status, 201);

  const lead = await newLead(tok.a, "numbering", names.a);
  const q = await newQuote(tok.a, lead.id, "NUM");
  const conv = await call("POST", `/crm/quotes/${q.id}/convert-to-invoice`, tok.a, { issuedAt: today, dueAt: today });
  assert.equal(conv.status, 201, JSON.stringify(conv.body));
  assert.notEqual(conv.body.invoiceNo, `DG-${year}-${1000 + count + 2}`);
});
