/**
 * Editing / deleting APPROVED payments (Accounts > Payment Receipts > Approved).
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
let names: { sales: string };
let bankA: string, bankB: string;
const run = `x${Date.now().toString(36)}`;
const today = new Date().toISOString().slice(0, 10);
const thisMonth = today.slice(0, 7);
const prevMonthDate = (() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })();
const prevMonth = prevMonthDate.slice(0, 7);

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
  names = { sales: sales.u.name };
  const mkBank = (n: string) => prisma.bankAccount.create({ data: { name: `${n} ${run}`, bank: "B", number: n + run, opening: 0, openedAt: new Date() } });
  bankA = (await mkBank("A")).id; bankB = (await mkBank("B")).id;
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(async () => { server?.close(); await prisma?.$disconnect(); });

const balance = async (id: string) => Number((await call("GET", "/finance/bank-accounts", tok.finance)).body.accounts.find((a: any) => a.id === id).balance);
const gross = async (m: string) => (await call("GET", `/finance/reports/dept-profitability?month=${m}`, tok.finance)).body.rows.reduce((s: number, r: any) => s + r.grossRevenue, 0) as number;
const ledger = (paymentId: string) => prisma.bankTransaction.findMany({ where: { refId: paymentId } });
const commissionsOf = async (paymentId: string) => (await prisma.payable.findMany({ where: { sourcePaymentId: paymentId, category: "COMMISSION" } })).map((p) => Number(p.amount));
const row = async (paymentId: string) => (await call("GET", "/finance/payment-receipts/approved?limit=1000", tok.finance)).body.receipts.find((r: any) => r.paymentId === paymentId);
const patch = (id: string, body: unknown, t = tok.finance) => call("PATCH", `/finance/payment-receipts/approved/${id}`, t, body);
const del = (id: string, t = tok.finance) => call("DELETE", `/finance/payment-receipts/approved/${id}`, t);

async function invoice(label: string, amount: number) {
  const lead = (await call("POST", "/crm/leads", tok.sales, { name: `Lead ${label} ${run}`, source: "test", serviceInterested: "Web Development", leadOwner: names.sales })).body.lead;
  const q = (await call("POST", "/crm/quotes", tok.sales, { leadId: lead.id, title: `${label} ${run}`, items: [{ dept: "Web Development", amount }] })).body.quote;
  const c = (await call("POST", `/crm/quotes/${q.id}/convert-to-invoice`, tok.sales, { issuedAt: today, dueAt: today })).body;
  return { invoiceId: c.invoiceId as string, invoiceNo: c.invoiceNo as string, quote: q };
}
// Sales pushes, Finance approves into bank A -> returns everything needed to inspect the result.
async function pushedAndApproved(label: string, invoiceTotal: number, amount: number) {
  const inv = await invoice(label, invoiceTotal);
  const p = await call("POST", `/finance/invoices/${inv.invoiceId}/pending-payments`, tok.sales, { amount, paymentDate: today });
  const ok = await call("POST", `/finance/invoices/${inv.invoiceId}/pending-payments/${p.body.pending.id}/approve`, tok.finance, { accountId: bankA });
  assert.equal(ok.status, 201);
  return { ...inv, pendingId: p.body.pending.id as string, paymentId: ok.body.payment.id as string, commissionId: ok.body.commission.id as string };
}

test("edit note / date / bank account: the ledger entry and revenue month move with it", async () => {
  const x = await pushedAndApproved("meta", 100_000, 40_000);
  const [a0, b0, cur0, prev0] = [await balance(bankA), await balance(bankB), await gross(thisMonth), await gross(prevMonth)];

  const r = await patch(x.paymentId, { note: "Corrected: cheque", accountId: bankB, paidDate: prevMonthDate });
  assert.equal(r.status, 200);

  assert.equal(await balance(bankA), a0 - 40_000, "left the old account");
  assert.equal(await balance(bankB), b0 + 40_000, "landed in the new one");
  const txns = await ledger(x.paymentId);
  assert.equal(txns.length, 1, "still exactly one ledger row");
  assert.equal(txns[0].accountId, bankB);
  assert.equal(txns[0].date.toISOString().slice(0, 10), prevMonthDate);
  assert.equal(await gross(thisMonth), cur0 - 40_000, "revenue leaves this month…");
  assert.equal(await gross(prevMonth), prev0 + 40_000, "…and lands in the month it was actually paid");

  const shown = await row(x.paymentId);
  assert.equal(shown.note, "Corrected: cheque");
  assert.equal(shown.bankAccount.id, bankB);
  assert.equal(shown.approvedBy !== null, true, "approver is preserved, not overwritten by the edit");
  assert.deepEqual(await commissionsOf(x.paymentId), [4_000], "commission untouched by a non-amount edit");
  assert.ok(await prisma.auditLog.findFirst({ where: { action: "FIN_RECEIPT_EDIT", entityId: x.paymentId } }), "audited");
});

test("edit amount: bank, invoice balance, revenue, pending row and the untouched commission all follow", async () => {
  const x = await pushedAndApproved("amt", 100_000, 40_000);
  const [a0, cur0] = [await balance(bankA), await gross(thisMonth)];

  assert.equal((await patch(x.paymentId, { amount: 30_000 })).status, 200);

  assert.equal(await balance(bankA), a0 - 10_000);
  assert.equal(await gross(thisMonth), cur0 - 10_000);
  assert.deepEqual(await commissionsOf(x.paymentId), [3_000], "10% of the new amount");
  assert.equal(Number((await prisma.invoicePendingPayment.findUniqueOrThrow({ where: { id: x.pendingId } })).amount), 30_000, "sales-target base stays consistent");
  assert.equal((await ledger(x.paymentId))[0].amount.toString(), "30000");
  const inv = (await call("GET", `/finance/invoices/${x.invoiceId}`, tok.finance)).body.invoice;
  assert.equal(inv.balance, 70_000);
});

test("edit amount is refused (nothing changes) when the commission was edited, split or paid out — or the invoice would be over-paid", async () => {
  const snapshot = async (x: { paymentId: string }) => ({ bank: await balance(bankA), gross: await gross(thisMonth), amount: Number((await prisma.invoicePayment.findUniqueOrThrow({ where: { id: x.paymentId } })).amount) });

  // edited
  const e = await pushedAndApproved("ed", 100_000, 40_000);
  await call("PATCH", `/finance/payables/${e.commissionId}`, tok.finance, { amount: 5_000 });
  let s = await snapshot(e);
  let r = await patch(e.paymentId, { amount: 30_000 });
  assert.equal(r.status, 409); assert.match(r.body.error, /was edited/);
  assert.deepEqual(await snapshot(e), s);
  assert.equal((await patch(e.paymentId, { note: "note is still fine" })).status, 200, "non-amount edits still allowed");

  // split
  const sp = await pushedAndApproved("sp", 100_000, 40_000);
  await prisma.payable.create({ data: { category: "COMMISSION", payee: "split", salesPerson: names.sales, amount: 500, dueAt: new Date(), sourcePaymentId: sp.paymentId } });
  r = await patch(sp.paymentId, { amount: 30_000 });
  assert.equal(r.status, 409); assert.match(r.body.error, /was split/);

  // paid out
  const pd = await pushedAndApproved("pd", 100_000, 40_000);
  assert.equal((await call("POST", `/finance/payables/${pd.commissionId}/payments`, tok.finance, { amount: 1_000, paidDate: today, accountId: bankA })).status, 201);
  r = await patch(pd.paymentId, { amount: 30_000 });
  assert.equal(r.status, 409); assert.match(r.body.error, /already been paid out/);

  // over-paid
  const ov = await pushedAndApproved("ov", 50_000, 20_000);
  r = await patch(ov.paymentId, { amount: 60_000 });
  assert.equal(r.status, 400);
});

test("Direct payment: amount is editable (no commission to worry about) and delete just removes it", async () => {
  const inv = await invoice("dir", 20_000);
  const pay = await call("POST", `/finance/invoices/${inv.invoiceId}/payments`, tok.finance, { amount: 20_000, paidDate: today, accountId: bankA });
  const id = pay.body.payment.id as string;
  const a0 = await balance(bankA);

  assert.equal((await patch(id, { amount: 15_000 })).status, 200);
  assert.equal(await balance(bankA), a0 - 5_000);
  assert.deepEqual(await commissionsOf(id), []);

  assert.equal((await del(id)).status, 204);
  assert.equal(await balance(bankA), a0 - 20_000);
  assert.equal(await prisma.invoicePayment.count({ where: { id } }), 0);
  assert.equal(await row(id), undefined);
  assert.equal(await prisma.invoicePendingPayment.count({ where: { invoiceId: inv.invoiceId } }), 0, "nothing to return to Pending");
});

test("delete a Sales-pushed payment: reversed everywhere and back in Pending; re-approving works", async () => {
  const x = await pushedAndApproved("rev", 100_000, 40_000);
  const [a0, cur0] = [await balance(bankA), await gross(thisMonth)];

  assert.equal((await del(x.paymentId)).status, 204);

  assert.equal(await balance(bankA), a0 - 40_000, "bank credit reversed");
  assert.equal(await gross(thisMonth), cur0 - 40_000, "revenue reversed");
  assert.equal((await ledger(x.paymentId)).length, 0);
  assert.equal(await prisma.payable.count({ where: { id: x.commissionId } }), 0, "commission removed");
  assert.equal(await row(x.paymentId), undefined, "gone from Approved");

  const pending = await prisma.invoicePendingPayment.findUniqueOrThrow({ where: { id: x.pendingId } });
  assert.equal(pending.approved, false);
  assert.equal(pending.invoicePayment, null);
  const inv = (await call("GET", "/finance/invoices", tok.finance)).body.invoices.find((i: any) => i.id === x.invoiceId);
  assert.ok(inv.pendingPayments.some((p: any) => p.id === x.pendingId && p.approved === false), "shows in the Pending queue again");

  // …and it can be approved again cleanly, creating a fresh payment + commission.
  const again = await call("POST", `/finance/invoices/${x.invoiceId}/pending-payments/${x.pendingId}/approve`, tok.finance, { accountId: bankA });
  assert.equal(again.status, 201);
  assert.equal(await balance(bankA), a0);
  assert.deepEqual(await commissionsOf(again.body.payment.id), [4_000]);
  assert.ok(await prisma.auditLog.findFirst({ where: { action: "FIN_RECEIPT_REVERSED", entityId: x.paymentId } }), "reversal audited");
});

test("delete a quote-origin payment: the quote goes back to 'Submitted to Finance' with its payment pending again", async () => {
  const lead = (await call("POST", "/crm/leads", tok.sales, { name: `Lead qo ${run}`, source: "test", serviceInterested: "Web Development", leadOwner: names.sales })).body.lead;
  const q = (await call("POST", "/crm/quotes", tok.sales, { leadId: lead.id, title: `qo ${run}`, items: [{ dept: "Web Development", amount: 30_000 }] })).body.quote;
  await call("POST", `/crm/quotes/${q.id}/send`, tok.sales);
  const pend = await call("POST", `/crm/quotes/${q.id}/pending-payments`, tok.sales, { amount: 30_000, paymentDate: today });
  const ok = await call("POST", `/crm/quotes/${q.id}/pending-payments/${pend.body.pending.id}/approve`, tok.finance, { accountId: bankA });
  assert.equal((await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).status, "INVOICED");

  assert.equal((await del(ok.body.payment.id)).status, 204);
  assert.equal((await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).status, "SUBMITTED_TO_FINANCE");
  const pending = await prisma.quotePendingPayment.findUniqueOrThrow({ where: { id: pend.body.pending.id } });
  assert.equal(pending.approved, false);
  assert.equal(pending.invoicePayment, null);
});

test("delete is refused when its commission has already been paid out (nothing changes)", async () => {
  const x = await pushedAndApproved("paid", 100_000, 40_000);
  await call("POST", `/finance/payables/${x.commissionId}/payments`, tok.finance, { amount: 1_000, paidDate: today, accountId: bankA });
  const a0 = await balance(bankA);
  const r = await del(x.paymentId);
  assert.equal(r.status, 409);
  assert.match(r.body.error, /already been paid out/);
  assert.equal(await balance(bankA), a0);
  assert.ok(await row(x.paymentId), "still listed");
});

test("a sales bonus for that month blocks amount edits and deletes (but not note edits)", async () => {
  const x = await pushedAndApproved("bonus", 100_000, 40_000);
  const month = new Date().toISOString().slice(0, 7);
  await prisma.payable.create({ data: { category: "SALES_BONUS", payee: `${names.sales} — monthly target bonus (${month})`, salesPerson: names.sales, amount: 1_000, dueAt: new Date() } });
  const r1 = await patch(x.paymentId, { amount: 30_000 });
  assert.equal(r1.status, 409); assert.match(r1.body.error, /sales bonus/);
  assert.equal((await del(x.paymentId)).status, 409);
  assert.equal((await patch(x.paymentId, { note: "ok" })).status, 200);
});

test("only Finance/Admin; unknown ids 404; empty edit 400", async () => {
  const x = await pushedAndApproved("perm", 100_000, 10_000);
  assert.equal((await patch(x.paymentId, { note: "x" }, tok.sales)).status, 403);
  assert.equal((await del(x.paymentId, tok.sales)).status, 403);
  assert.equal((await patch(x.paymentId, {}, tok.finance)).status, 400);
  assert.equal((await patch("00000000-0000-0000-0000-000000000000", { note: "x" }, tok.admin)).status, 404);
  assert.equal((await del("00000000-0000-0000-0000-000000000000", tok.admin)).status, 404);
  assert.ok(await row(x.paymentId), "Sales attempts changed nothing");
});
