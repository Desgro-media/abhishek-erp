/**
 * Accounts > Payment Receipts > Approved history.
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
let tok: { admin: string; finance: string; sales: string };
let names: { finance: string; sales: string };
let bank: { id: string; name: string };
const run = `r${Date.now().toString(36)}`;
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
  const [admin, finance, sales] = [await mk("admin", ["ADMIN"]), await mk("finance", ["FINANCE"]), await mk("sales", ["SALES"])];
  tok = { admin: admin.token, finance: finance.token, sales: sales.token };
  names = { finance: finance.u.name, sales: sales.u.name };
  const b = await prisma.bankAccount.create({ data: { name: `Bank ${run}`, bank: "B", number: run, opening: 0, openedAt: new Date() } });
  bank = { id: b.id, name: b.name };
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(async () => { server?.close(); await prisma?.$disconnect(); });

const approved = async () => (await call("GET", "/finance/payment-receipts/approved?limit=1000", tok.finance)).body as { total: number; receipts: any[] };
const byPayment = async (paymentId: string) => (await approved()).receipts.find((r) => r.paymentId === paymentId);

async function convertedInvoice(label: string, amount: number) {
  const lead = (await call("POST", "/crm/leads", tok.sales, { name: `Lead ${label} ${run}`, source: "test", serviceInterested: "Web Development", leadOwner: names.sales })).body.lead;
  const q = (await call("POST", "/crm/quotes", tok.sales, { leadId: lead.id, title: `${label} ${run}`, items: [{ dept: "Web Development", amount }] })).body.quote;
  const conv = await call("POST", `/crm/quotes/${q.id}/convert-to-invoice`, tok.sales, { issuedAt: today, dueAt: today });
  assert.equal(conv.status, 201);
  return { quote: q, invoiceId: conv.body.invoiceId as string, invoiceNo: conv.body.invoiceNo as string, clientId: conv.body.clientId as string };
}

test("Sales-pushed invoice payment: pending is NOT in Approved; once approved it shows every detail incl. commission", async () => {
  const inv = await convertedInvoice("push", 100_000);
  const p = await call("POST", `/finance/invoices/${inv.invoiceId}/pending-payments`, tok.sales, { amount: 40_000, paymentDate: today, note: "UPI" });
  const before = await approved();
  assert.equal(before.receipts.some((r) => r.invoiceNo === inv.invoiceNo), false, "pending payments stay out of history");

  const ok = await call("POST", `/finance/invoices/${inv.invoiceId}/pending-payments/${p.body.pending.id}/approve`, tok.finance, { accountId: bank.id });
  assert.equal(ok.status, 201);

  const row = await byPayment(ok.body.payment.id);
  assert.ok(row, "approved payment is listed");
  assert.equal(row.source, "Invoice");
  assert.equal(row.invoiceNo, inv.invoiceNo);
  assert.equal(row.clientName, `Lead push ${run}`);
  assert.equal(row.amount, 40_000);
  assert.equal(row.pushedBy, names.sales);
  assert.equal(row.approvedBy, names.finance, "the Finance user who approved it");
  assert.equal(row.bankAccount.name, bank.name);
  assert.ok(row.approvedAt);
  assert.deepEqual(row.commissions.map((c: any) => [c.amount, c.salesPerson]), [[4_000, names.sales]], "10% to the Sales rep");
  assert.equal((await approved()).total, before.total + 1);
});

test("quote-origin payment shows as Quote with its code and the quote's creator as pusher", async () => {
  const lead = (await call("POST", "/crm/leads", tok.sales, { name: `Lead q ${run}`, source: "test", serviceInterested: "Web Development", leadOwner: names.sales })).body.lead;
  const q = (await call("POST", "/crm/quotes", tok.sales, { leadId: lead.id, title: `qo ${run}`, items: [{ dept: "Web Development", amount: 30_000 }] })).body.quote;
  await call("POST", `/crm/quotes/${q.id}/send`, tok.sales);
  const pend = await call("POST", `/crm/quotes/${q.id}/pending-payments`, tok.sales, { amount: 30_000, paymentDate: today });
  const ok = await call("POST", `/crm/quotes/${q.id}/pending-payments/${pend.body.pending.id}/approve`, tok.finance, { accountId: bank.id });
  assert.equal(ok.status, 201);

  const row = await byPayment(ok.body.payment.id);
  assert.equal(row.source, "Quote");
  assert.equal(row.quoteCode, q.quoteCode);
  assert.equal(row.pushedBy, names.sales);
  assert.deepEqual(row.commissions.map((c: any) => c.amount), [3_000]);
});

test("Direct payment (Finance records it straight on the invoice) is listed too — no pusher, no commission", async () => {
  const inv = await convertedInvoice("direct", 20_000);
  const r = await call("POST", `/finance/invoices/${inv.invoiceId}/payments`, tok.finance, { amount: 20_000, paidDate: today, accountId: bank.id });
  assert.equal(r.status, 201);

  const row = await byPayment(r.body.payment.id);
  assert.ok(row, "nothing confirmed is invisible");
  assert.equal(row.source, "Direct");
  assert.equal(row.pushedBy, null);
  assert.deepEqual(row.commissions, []);
  assert.equal(row.approvedBy, names.finance);
  assert.equal(row.bankAccount.name, bank.name);
});

test("most recent first", async () => {
  const { receipts } = await approved();
  const times = receipts.map((r) => new Date(r.approvedAt).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
});

test("the commission link is a real FK: editing, splitting or deleting the payable never leaves the history stale or wrong", async () => {
  const inv = await convertedInvoice("link", 100_000);
  const p = await call("POST", `/finance/invoices/${inv.invoiceId}/pending-payments`, tok.sales, { amount: 50_000, paymentDate: today });
  const ok = await call("POST", `/finance/invoices/${inv.invoiceId}/pending-payments/${p.body.pending.id}/approve`, tok.finance, { accountId: bank.id });
  const paymentId = ok.body.payment.id as string;
  const commissionId = ok.body.commission.id as string;

  // The generated payable points at the payment in the database itself.
  assert.equal((await prisma.payable.findUniqueOrThrow({ where: { id: commissionId } })).sourcePaymentId, paymentId);

  // Edited (amount AND payee text) — a text/10% match would lose it; the FK doesn't.
  assert.equal((await call("PATCH", `/finance/payables/${commissionId}`, tok.finance, { amount: 4_000, payee: "Renegotiated commission" })).status, 200);
  assert.deepEqual((await byPayment(paymentId)).commissions.map((c: any) => c.amount), [4_000]);

  // Split: a second payable tied to the same payment appears next to the first.
  await prisma.payable.create({ data: { category: "COMMISSION", payee: "Split — referral share", salesPerson: names.sales, amount: 1_000, dueAt: new Date(), sourcePaymentId: paymentId } });
  assert.deepEqual((await byPayment(paymentId)).commissions.map((c: any) => c.amount).sort((a: number, b: number) => a - b), [1_000, 4_000]);

  // Deleted (disputed and removed): the payment stays in history, just without that commission.
  assert.equal((await call("DELETE", `/finance/payables/${commissionId}`, tok.finance)).status, 204);
  const after = await byPayment(paymentId);
  assert.ok(after, "the payment itself is never lost");
  assert.deepEqual(after.commissions.map((c: any) => c.amount), [1_000]);
});

test("Sales can't read it; Finance and Admin can", async () => {
  assert.equal((await call("GET", "/finance/payment-receipts/approved", tok.sales)).status, 403);
  assert.equal((await call("GET", "/finance/payment-receipts/approved", tok.finance)).status, 200);
  assert.equal((await call("GET", "/finance/payment-receipts/approved", tok.admin)).status, 200);
});

test("pagination", async () => {
  const all = await approved();
  const page = (await call("GET", "/finance/payment-receipts/approved?limit=2&offset=1", tok.finance)).body;
  assert.equal(page.receipts.length, 2);
  assert.equal(page.total, all.total);
  assert.deepEqual(page.receipts.map((r: any) => r.paymentId), all.receipts.slice(1, 3).map((r: any) => r.paymentId));
});
