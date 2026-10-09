/**
 * Leads: advance payments, convert, auto-convert threshold, and how an advance reaches the books.
 *   TEST_DATABASE_URL=postgresql://.../desgro_erp_test npm run test:e2e
 * Same throwaway-DB guard as the other e2e files.
 *
 * The rule under test: a lead payment moves NO money by itself. It reaches the books only as an ordinary
 * pending payment on an invoice, which Finance approves through the unchanged approval — so bank entry,
 * commission and revenue follow the RECEIVED date Finance sets, exactly like any Sales-pushed payment.
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
let bank: { id: string };
const run = `a${Date.now().toString(36)}`;
const day = (ago: number) => new Date(Date.now() - ago * 86400_000).toISOString().slice(0, 10);
const today = day(0);
let seq = 0;

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
  bank = await prisma.bankAccount.create({ data: { name: `Bank ${run}`, bank: "B", number: run, opening: 0, openedAt: new Date() } });
  await prisma.salesPolicy.upsert({ where: { id: 1 }, create: { id: 1, leadConversionThreshold: 5000 }, update: { leadConversionThreshold: 5000 } });
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(async () => {
  await prisma?.salesPolicy.update({ where: { id: 1 }, data: { leadConversionThreshold: 5000 } }).catch(() => {});
  server?.close();
  await prisma?.$disconnect();
});

const newLead = async (owner: string | null = names.repA) => {
  const r = await call("POST", "/crm/leads", tok.admin, { name: `Adv Lead ${run} ${++seq}`, source: "test", serviceInterested: "Web Development", leadOwner: owner ?? undefined });
  assert.equal(r.status, 201);
  return r.body.lead as { id: string; name: string };
};
const pay = (leadId: string, token: string, amount: number, ago = 1, extra: Record<string, unknown> = {}) =>
  call("POST", `/crm/leads/${leadId}/payments`, token, { amount, paymentDate: day(ago), mode: "UPI", ...extra });
const money = async () => ({
  bank: await prisma.bankTransaction.count(), invPayments: await prisma.invoicePayment.count(),
  payables: await prisma.payable.count(), invoices: await prisma.invoice.count(),
});
const convert = async (leadId: string) => { const r = await call("POST", `/crm/leads/${leadId}/convert`, tok.repA, {}); assert.equal(r.status, 201); return r.body.clientId as string; };
const invoiceFor = async (clientId: string, total: number) => {
  const r = await call("POST", "/finance/invoices", tok.finance, { clientId, issuedAt: today, dueAt: today, items: [{ dept: "Web Development", amount: total }] });
  assert.equal(r.status, 201);
  return r.body.invoice as { id: string; invoiceNo: string; pendingPayments: any[] };
};
const pendings = (invoiceId: string) => prisma.invoicePendingPayment.findMany({ where: { invoiceId }, orderBy: { paymentDate: "asc" } });
const approve = (invoiceId: string, pendingId: string, date: string, extra: Record<string, unknown> = {}) =>
  call("POST", `/finance/invoices/${invoiceId}/pending-payments/${pendingId}/approve`, tok.finance, { accountId: bank.id, date, ...extra });

test("recording: owner/Admin/Sales Head only; validated; and it moves NO money (no bank, invoice payment, commission or invoice)", async () => {
  const lead = await newLead();
  const open = await newLead(null);
  const before = await money();

  assert.equal((await pay(lead.id, tok.finance, 1000)).status, 403, "Finance doesn't record lead payments");
  assert.equal((await pay(lead.id, tok.clients, 1000)).status, 403);
  assert.equal((await pay(lead.id, tok.repB, 1000)).status, 403, "another rep's lead");
  assert.equal((await call("POST", `/crm/leads/${lead.id}/payments`, null, { amount: 1, paymentDate: today, mode: "UPI" })).status, 401);
  assert.equal((await pay(open.id, tok.repA, 1000)).status, 403, "unclaimed: a rep claims it first");
  assert.equal((await pay(open.id, tok.admin, 1000)).status, 400, "Admin can't record on a lead nobody owns (no one to earn commission)");

  for (const bad of [
    { amount: 0 }, { amount: -5 }, { amount: "100" }, { amount: 10.005 }, { amount: 1e12 }, { amount: undefined },
    { paymentDate: "2999-01-01" }, { paymentDate: day(400) }, { paymentDate: "2026-02-31" }, { paymentDate: "05/10/2026" },
    { mode: "BITCOIN" }, { mode: undefined }, { note: "x".repeat(501) },
  ]) {
    assert.equal((await call("POST", `/crm/leads/${lead.id}/payments`, tok.repA, { amount: 1000, paymentDate: day(1), mode: "UPI", ...bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal(await prisma.leadPayment.count({ where: { leadId: lead.id } }), 0, "nothing stored by the refusals");

  const ok = await pay(lead.id, tok.repA, 1000.5, 2, { note: "  token  " });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.payment.amount, 1000.5);
  assert.equal(ok.body.payment.status, "AWAITING_INVOICE");
  assert.equal(ok.body.payment.note, "token");
  assert.equal(ok.body.converted, null);
  assert.equal(ok.body.paidTotal, 1000.5);
  assert.equal((await pay(lead.id, tok.head, 500)).status, 201, "Sales Head can record on any lead");
  const row = await prisma.leadPayment.findFirstOrThrow({ where: { leadId: lead.id } });
  assert.equal(row.salesPerson, names.repA, "commission goes to the lead owner");
  assert.equal(row.invoicePendingPaymentId, null);

  assert.deepEqual(await money(), before, "recording an advance creates no bank entry, invoice payment, commission or invoice");
  const audit = await prisma.auditLog.findFirst({ where: { action: "CRM_LEAD_PAYMENT_RECORDED", entityId: lead.id } });
  assert.equal((audit!.afterData as any).amount, 1000.5);

  // listing: owner sees theirs, another rep doesn't
  const list = await call("GET", `/crm/leads/${lead.id}/payments`, tok.repA);
  assert.equal(list.body.payments.length, 2);
  assert.equal(list.body.threshold, 5000);
  assert.equal((await call("GET", `/crm/leads/${lead.id}/payments`, tok.repB)).status, 403);
  // the leads list carries what each has paid
  assert.equal((await call("GET", "/crm/leads", tok.repA)).body.leads.find((l: any) => l.id === lead.id).paidTotal, 1500.5);
});

test("a Lost lead can't take a payment until it's back in the pipeline", async () => {
  const lead = await newLead();
  await call("POST", `/crm/leads/${lead.id}/lost`, tok.repA, { reason: "Budget" });
  assert.equal((await pay(lead.id, tok.repA, 1000)).status, 409);
  await call("PATCH", `/crm/leads/${lead.id}/stage`, tok.repA, { stage: "CONTACTED" });
  assert.equal((await pay(lead.id, tok.repA, 1000)).status, 201);
});

test("auto-convert: reaching the threshold turns the lead into a client (once), moves no money; further payments are refused", async () => {
  const lead = await newLead();
  const before = await money();
  const first = await pay(lead.id, tok.repA, 3000, 3);
  assert.equal(first.body.converted, null);
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).convertedClientId, null);

  const second = await pay(lead.id, tok.repA, 2000, 2);
  assert.equal(second.status, 201);
  assert.ok(second.body.converted?.clientId);
  assert.equal(second.body.converted.created, true);
  const row = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.deepEqual([row.stage, row.status, row.convertedClientId], ["WON", "CONVERTED", second.body.converted.clientId]);
  assert.match(row.stageSetBy!, /^Auto-converted — paid ₹5,000/);
  const client = await prisma.client.findUniqueOrThrow({ where: { id: row.convertedClientId! } });
  assert.deepEqual([client.name, client.salesPerson, client.accountManager, client.status], [lead.name, names.repA, names.repA, "ACTIVE"]);
  assert.ok(await prisma.auditLog.findFirst({ where: { action: "CRM_LEAD_AUTO_CONVERTED", entityId: lead.id } }));
  assert.deepEqual(await money(), before, "converting a lead is a client record, not money");

  assert.equal((await pay(lead.id, tok.repA, 100)).status, 409, "already a client: pay against their invoice");
  assert.equal((await call("POST", `/crm/leads/${lead.id}/convert`, tok.repA, {})).status, 409);
});

test("auto-convert links to an existing client of the same name instead of duplicating", async () => {
  const lead = await newLead();
  const existing = await prisma.client.create({ data: { clientCode: `ADV-${run}-x`, name: lead.name.toUpperCase(), services: [], onboardedAt: new Date() } });
  const r = await pay(lead.id, tok.repA, 5000);
  assert.equal(r.body.converted.created, false);
  assert.equal(r.body.converted.clientId, existing.id);
  assert.equal(await prisma.client.count({ where: { name: { equals: lead.name, mode: "insensitive" } } }), 1);
});

test("manual convert: any amount; owner / Admin / Sales Head; refused for the wrong person, twice, or a lead nobody owns", async () => {
  const lead = await newLead();
  const open = await newLead(null);
  assert.equal((await call("POST", `/crm/leads/${lead.id}/convert`, tok.repB, {})).status, 403);
  assert.equal((await call("POST", `/crm/leads/${lead.id}/convert`, tok.finance, {})).status, 403);
  assert.equal((await call("POST", `/crm/leads/${open.id}/convert`, tok.repA, {})).status, 403, "claim first");
  assert.equal((await call("POST", `/crm/leads/${lead.id}/convert`, tok.repA, { billingType: "MONTHLY" })).status, 400);
  assert.equal((await call("POST", `/crm/leads/${lead.id}/convert`, tok.repA, { onboardedAt: "2999-01-01" })).status, 400);

  const r = await call("POST", `/crm/leads/${lead.id}/convert`, tok.repA, { industry: "Interiors", city: "Dubai", services: ["Performance Marketing"], billingType: "POSTPAID" });
  assert.equal(r.status, 201);
  const client = await prisma.client.findUniqueOrThrow({ where: { id: r.body.clientId } });
  assert.deepEqual([client.industry, client.city, client.services, client.billingType], ["Interiors", "Dubai", ["Performance Marketing"], "POSTPAID"]);
  const row = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.deepEqual([row.stage, row.status], ["WON", "CONVERTED"]);
  assert.equal(row.stageSetBy, `Converted by ${names.repA}`);
  assert.equal((await call("POST", `/crm/leads/${lead.id}/convert`, tok.admin, {})).status, 409, "already converted");
  assert.equal((await call("PATCH", `/crm/leads/${lead.id}/stage`, tok.repA, { stage: "CONTACTED" })).status, 409, "Won stays Won");
  assert.ok(await prisma.auditLog.findFirst({ where: { action: "CRM_LEAD_CONVERTED", entityId: lead.id } }));
  assert.equal((await call("POST", `/crm/leads/${open.id}/convert`, tok.admin, {})).status, 201, "Admin converts an unowned lead");
});

test("THE LINK: an advance becomes a pending payment on the client's first invoice, Finance approves it like any other (bank, commission, revenue by received date)", async () => {
  const lead = await newLead();
  await pay(lead.id, tok.repA, 3000, 5, { note: "token advance" });
  await pay(lead.id, tok.repA, 1500, 4, { mode: "CASH" });
  const clientId = await convert(lead.id);
  const beforeInvoice = await money();

  const inv = await invoiceFor(clientId, 20_000);
  const after = await money();
  assert.equal(after.invoices, beforeInvoice.invoices + 1);
  assert.equal(after.bank, beforeInvoice.bank, "creating the invoice moved no money");
  assert.equal(after.invPayments, beforeInvoice.invPayments);
  assert.equal(after.payables, beforeInvoice.payables, "no commission until Finance approves");

  const pend = await pendings(inv.id);
  assert.equal(pend.length, 2);
  assert.deepEqual(pend.map((p) => [Number(p.amount), p.salesPerson, p.approved, p.invoicePayment]), [[3000, names.repA, false, null], [1500, names.repA, false, null]]);
  assert.deepEqual(pend.map((p) => p.paymentDate.toISOString().slice(0, 10)), [day(5), day(4)], "carries Sales' reported dates");
  assert.match(pend[0].note!, /Advance received while a lead \(UPI\) — MLD-\d+ — token advance/);
  assert.match(pend[1].note!, /\(Cash\)/);
  assert.equal(inv.pendingPayments.length, 2, "the create response already shows them");

  const lp = await prisma.leadPayment.findMany({ where: { leadId: lead.id }, orderBy: { paymentDate: "asc" } });
  assert.deepEqual(lp.map((x) => x.invoicePendingPaymentId), pend.map((p) => p.id));
  assert.ok(lp.every((x) => x.carriedAt));
  assert.equal((await call("GET", `/crm/clients/${clientId}/lead-advances`, tok.repA)).body.totals.onInvoicePending, 4500);

  // Finance approves with the TRUE received date (differs from Sales' report) — same endpoint as always
  const received = day(7);
  const balBefore = Number((await prisma.bankTransaction.aggregate({ where: { accountId: bank.id, type: "CREDIT" }, _sum: { amount: true } }))._sum.amount ?? 0);
  const ok = await approve(inv.id, pend[0].id, received);
  assert.equal(ok.status, 201);
  const payment = await prisma.invoicePayment.findUniqueOrThrow({ where: { id: ok.body.payment.id } });
  assert.deepEqual([Number(payment.amount), payment.paidDate.toISOString().slice(0, 10), payment.accountId], [3000, received, bank.id]);
  const txn = await prisma.bankTransaction.findFirstOrThrow({ where: { refId: payment.id } });
  assert.deepEqual([txn.type, Number(txn.amount), txn.date.toISOString().slice(0, 10), txn.refType], ["CREDIT", 3000, received, "INVOICE_PAYMENT"]);
  assert.equal(Number((await prisma.bankTransaction.aggregate({ where: { accountId: bank.id, type: "CREDIT" }, _sum: { amount: true } }))._sum.amount ?? 0), balBefore + 3000);
  const commission = await prisma.payable.findFirstOrThrow({ where: { sourcePaymentId: payment.id, category: "COMMISSION" } });
  assert.deepEqual([Number(commission.amount), commission.salesPerson, commission.dueAt.toISOString().slice(0, 10)], [300, names.repA, received], "10% to the lead owner, dated by the RECEIVED date");
  assert.equal((await call("GET", `/crm/clients/${clientId}/lead-advances`, tok.repA)).body.totals.approved, 3000);
  assert.equal((await call("GET", `/crm/leads/${lead.id}/payments`, tok.repA)).body.payments[0].status, "APPROVED");

  // identical to an ordinary Sales-pushed payment of the same amount approved the same way
  const l2 = await newLead();
  const c2 = await convert(l2.id);
  const inv2 = await invoiceFor(c2, 20_000);
  const normal = await call("POST", `/finance/invoices/${inv2.id}/pending-payments`, tok.repA, { amount: 3000, paymentDate: day(5) });
  assert.equal(normal.status, 201);
  const ok2 = await approve(inv2.id, normal.body.pending.id, received);
  const commission2 = await prisma.payable.findFirstOrThrow({ where: { sourcePaymentId: ok2.body.payment.id, category: "COMMISSION" } });
  assert.deepEqual([Number(commission2.amount), commission2.dueAt.toISOString()], [Number(commission.amount), commission.dueAt.toISOString()]);
  assert.equal(commission2.commissionRate?.toString(), commission.commissionRate?.toString());
  // Finance can still override the commission rate at approval, as ever
  const ok3 = await approve(inv.id, pend[1].id, received, { commissionRate: 5 });
  assert.equal(Number((await prisma.payable.findFirstOrThrow({ where: { sourcePaymentId: ok3.body.payment.id, category: "COMMISSION" } })).amount), 75);

  const carried = await prisma.auditLog.findMany({ where: { action: "CRM_LEAD_ADVANCE_CARRIED", entityId: inv.id } });
  assert.equal(carried.length, 2);
});

test("carry never over-pays an invoice: whole payments only, oldest first, what doesn't fit waits for the next invoice", async () => {
  const lead = await newLead();
  await pay(lead.id, tok.repA, 3000, 4);
  await pay(lead.id, tok.repA, 1000, 3);
  const clientId = await convert(lead.id);

  const small = await invoiceFor(clientId, 1500);
  assert.deepEqual((await pendings(small.id)).map((p) => Number(p.amount)), [1000], "the 3000 doesn't fit a 1500 invoice, so the 1000 that does is carried");
  const mid = await invoiceFor(clientId, 2000);
  assert.equal((await pendings(mid.id)).length, 0, "nothing left that fits — the 3000 still waits");
  const big = await invoiceFor(clientId, 3000);
  assert.deepEqual((await pendings(big.id)).map((p) => Number(p.amount)), [3000]);
  const done = await invoiceFor(clientId, 9000);
  assert.equal((await pendings(done.id)).length, 0, "everything is already attached");
  assert.equal(await prisma.leadPayment.count({ where: { leadId: lead.id, invoicePendingPaymentId: null } }), 0);

  // an invoice that already has a pending payment counts it
  const l2 = await newLead(); await pay(l2.id, tok.repA, 2000, 2); const c2 = await convert(l2.id);
  const inv = await invoiceFor(c2, 4000); // advance 2000 carried → 2000 left
  assert.equal((await pendings(inv.id)).length, 1);
  const extra = await call("POST", `/finance/invoices/${inv.id}/pending-payments`, tok.repA, { amount: 2000, paymentDate: today });
  assert.equal(extra.status, 201, "the invoice's balance still has room for a normal payment (2000 + 2000 = 4000)");
});

test("quote -> invoice (Draft/Sent conversion): the lead's advance is carried onto the new invoice", async () => {
  const lead = await newLead();
  await pay(lead.id, tok.repA, 3000, 2);
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).convertedClientId, null, "below the threshold: still a lead");
  const q = await call("POST", "/crm/quotes", tok.repA, { leadId: lead.id, title: `Q ${run} ${++seq}`, items: [{ dept: "Web Development", amount: 10_000 }] });
  const conv = await call("POST", `/crm/quotes/${q.body.quote.id}/convert-to-invoice`, tok.repA, { issuedAt: today, dueAt: today });
  assert.equal(conv.status, 201);
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage, "WON");
  const pend = await pendings(conv.body.invoiceId);
  assert.deepEqual(pend.map((p) => [Number(p.amount), p.salesPerson]), [[3000, names.repA]]);
  assert.equal(await prisma.invoicePayment.count({ where: { invoiceId: conv.body.invoiceId } }), 0, "still no money until Finance approves");
});

test("quote pay-first path: the advance is carried when that approval creates the invoice, and never over-pays it", async () => {
  // fits exactly: 7000 approved + 3000 advance = 10,000
  const a = await newLead(); await pay(a.id, tok.repA, 3000, 3);
  const qa = (await call("POST", "/crm/quotes", tok.repA, { leadId: a.id, title: `QA ${run}`, items: [{ dept: "Web Development", amount: 10_000 }] })).body.quote;
  await call("POST", `/crm/quotes/${qa.id}/send`, tok.repA);
  const pa = await call("POST", `/crm/quotes/${qa.id}/pending-payments`, tok.repA, { amount: 7000, paymentDate: today });
  const oka = await call("POST", `/crm/quotes/${qa.id}/pending-payments/${pa.body.pending.id}/approve`, tok.finance, { accountId: bank.id, date: today });
  assert.equal(oka.status, 201);
  assert.deepEqual((await pendings(oka.body.invoiceId)).map((p) => [Number(p.amount), p.approved]), [[3000, false]]);
  assert.equal((await prisma.invoicePayment.aggregate({ where: { invoiceId: oka.body.invoiceId }, _sum: { amount: true } }))._sum.amount?.toString(), "7000");

  // doesn't fit: 7000 approved leaves 3000, a 4000 advance would over-pay → stays awaiting
  const b = await newLead(); await pay(b.id, tok.repA, 4000, 3);
  const qb = (await call("POST", "/crm/quotes", tok.repA, { leadId: b.id, title: `QB ${run}`, items: [{ dept: "Web Development", amount: 10_000 }] })).body.quote;
  await call("POST", `/crm/quotes/${qb.id}/send`, tok.repA);
  const pb = await call("POST", `/crm/quotes/${qb.id}/pending-payments`, tok.repA, { amount: 7000, paymentDate: today });
  const okb = await call("POST", `/crm/quotes/${qb.id}/pending-payments/${pb.body.pending.id}/approve`, tok.finance, { accountId: bank.id, date: today });
  assert.equal((await pendings(okb.body.invoiceId)).length, 0);
  assert.equal(await prisma.leadPayment.count({ where: { leadId: b.id, invoicePendingPaymentId: null } }), 1);

  // another quote payment still waiting for Finance also reserves room
  const c = await newLead(); await pay(c.id, tok.repA, 3000, 3);
  const qc = (await call("POST", "/crm/quotes", tok.repA, { leadId: c.id, title: `QC ${run}`, items: [{ dept: "Web Development", amount: 10_000 }] })).body.quote;
  await call("POST", `/crm/quotes/${qc.id}/send`, tok.repA);
  const p1 = await call("POST", `/crm/quotes/${qc.id}/pending-payments`, tok.repA, { amount: 7000, paymentDate: today });
  await call("POST", `/crm/quotes/${qc.id}/pending-payments`, tok.repA, { amount: 3000, paymentDate: today });
  const okc = await call("POST", `/crm/quotes/${qc.id}/pending-payments/${p1.body.pending.id}/approve`, tok.finance, { accountId: bank.id, date: today });
  assert.equal((await pendings(okc.body.invoiceId)).length, 0, "the other 3000 quote payment already takes the remaining room");
});

test("a released advance: deleting the pending entry sends it back to waiting; Finance can re-apply it once; deleting rules", async () => {
  const lead = await newLead(); await pay(lead.id, tok.repA, 2000, 2); await pay(lead.id, tok.repA, 2000, 1);
  const clientId = await convert(lead.id);
  const inv = await invoiceFor(clientId, 10_000);
  const pend = await pendings(inv.id);
  assert.equal(pend.length, 2);

  const lps = await prisma.leadPayment.findMany({ where: { leadId: lead.id }, orderBy: { paymentDate: "asc" } });
  assert.equal((await call("DELETE", `/crm/leads/${lead.id}/payments/${lps[0].id}`, tok.repA)).status, 409, "on an invoice now — remove the pending entry instead");
  assert.equal((await call("DELETE", `/crm/leads/${lead.id}`, tok.admin)).status, 409, "a lead holding payments can't be deleted");

  const del = await call("DELETE", `/finance/invoices/${inv.id}/pending-payments/${pend[0].id}`, tok.finance);
  assert.equal(del.status, 204);
  const released = await prisma.leadPayment.findUniqueOrThrow({ where: { id: lps[0].id } });
  assert.equal(released.invoicePendingPaymentId, null, "released, not lost");
  assert.equal((await call("GET", `/crm/leads/${lead.id}/payments`, tok.repA)).body.payments[0].status, "AWAITING_INVOICE");

  assert.equal((await call("POST", `/finance/invoices/${inv.id}/apply-lead-advances`, tok.repA)).status, 403);
  const re = await call("POST", `/finance/invoices/${inv.id}/apply-lead-advances`, tok.finance);
  assert.equal(re.status, 200);
  assert.equal(re.body.carried.length, 1);
  assert.equal((await call("POST", `/finance/invoices/${inv.id}/apply-lead-advances`, tok.finance)).body.carried.length, 0, "applying again attaches nothing — never twice");
  assert.equal((await pendings(inv.id)).length, 2);
  assert.equal(await prisma.leadPayment.count({ where: { leadId: lead.id, invoicePendingPaymentId: { not: null } } }), 2);
  assert.equal((await call("POST", `/finance/invoices/00000000-0000-0000-0000-000000000000/apply-lead-advances`, tok.finance)).status, 404);

  // an advance that was never carried can be removed by its owner (a mistake), audited; ids are matched to the lead
  const l2 = await newLead(); const l3 = await newLead();
  const mistake = await pay(l2.id, tok.repA, 700, 1);
  const other = await pay(l3.id, tok.repA, 700, 1);
  assert.equal((await call("DELETE", `/crm/leads/${l2.id}/payments/${mistake.body.payment.id}`, tok.repB)).status, 403);
  assert.equal((await call("DELETE", `/crm/leads/${l2.id}/payments/${other.body.payment.id}`, tok.repA)).status, 404, "another lead's payment id");
  assert.equal((await call("DELETE", `/crm/leads/${l2.id}/payments/${mistake.body.payment.id}`, tok.repA)).status, 204);
  assert.equal(await prisma.leadPayment.count({ where: { id: other.body.payment.id } }), 1, "untouched");
  assert.equal((await prisma.auditLog.findFirst({ where: { action: "CRM_LEAD_PAYMENT_DELETED", entityId: l2.id } }))!.beforeData !== null, true);
  assert.equal((await call("DELETE", `/crm/leads/${l2.id}`, tok.repA)).status, 204, "with its payment gone the lead can be deleted again");
});

test("threshold: anyone in CRM can read; only Admin changes it (audited old -> new); validated; lowering converts leads already over it", async () => {
  assert.equal((await call("GET", "/crm/lead-settings", tok.repA)).body.conversionThreshold, 5000);
  assert.equal((await call("GET", "/crm/lead-settings", tok.finance)).status, 403);
  for (const t of [tok.head, tok.finance, tok.repA, tok.clients]) assert.equal((await call("PUT", "/crm/lead-settings", t, { conversionThreshold: 1 })).status, 403);
  for (const bad of [0, -1, "5000", 1e12, undefined]) assert.equal((await call("PUT", "/crm/lead-settings", tok.admin, { conversionThreshold: bad })).status, 400, String(bad));
  assert.equal((await call("GET", "/crm/lead-settings", tok.repA)).body.conversionThreshold, 5000, "refusals changed nothing");

  const over = await newLead(); const under = await newLead();
  await pay(over.id, tok.repA, 3500, 1); await pay(under.id, tok.repA, 2000, 1);
  const r = await call("PUT", "/crm/lead-settings", tok.admin, { conversionThreshold: 3000 });
  assert.equal(r.status, 200);
  assert.ok(r.body.converted.some((c: any) => c.leadId === over.id), "the lead already over the new figure converts");
  assert.ok(!r.body.converted.some((c: any) => c.leadId === under.id));
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: over.id } })).stage, "WON");
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: under.id } })).convertedClientId, null);
  const audit = await prisma.auditLog.findFirst({ where: { action: "CRM_LEAD_THRESHOLD_UPDATE" }, orderBy: { createdAt: "desc" } });
  assert.deepEqual([(audit!.beforeData as any).conversionThreshold, (audit!.afterData as any).conversionThreshold], [5000, 3000]);
  assert.equal((await call("PUT", "/crm/lead-settings", tok.admin, { conversionThreshold: 5000 })).status, 200);
});

test("Finance's list of advances not yet on the books: Finance/Admin only; shows age and flags ones older than the approval window", async () => {
  const lead = await newLead();
  await pay(lead.id, tok.repA, 900, 10);
  const stale = await prisma.leadPayment.create({ data: { leadId: lead.id, amount: 400, paymentDate: new Date(Date.now() - 200 * 86400_000), mode: "CASH", recordedBy: "old", salesPerson: names.repA } });

  assert.equal((await call("GET", "/finance/lead-advances", tok.repA)).status, 403);
  assert.equal((await call("GET", "/finance/lead-advances", tok.head)).status, 403);
  assert.equal((await call("GET", "/finance/lead-advances", null)).status, 401);
  const r = await call("GET", "/finance/lead-advances", tok.finance);
  assert.equal(r.status, 200);
  assert.equal(r.body.maxBackdateDays, 120);
  const mine = r.body.advances.filter((a: any) => a.lead.id === lead.id);
  assert.equal(mine.length, 2);
  const s = mine.find((a: any) => a.id === stale.id);
  assert.deepEqual([s.olderThanApprovalWindow, s.status, s.salesPerson], [true, "AWAITING_INVOICE", names.repA]);
  assert.equal(mine.find((a: any) => a.id !== stale.id).olderThanApprovalWindow, false);
  assert.equal((await call("GET", "/finance/lead-advances", tok.admin)).status, 200);
});

test("a client's advance summary follows the client page's visibility", async () => {
  const lead = await newLead(); await pay(lead.id, tok.repA, 1000, 1);
  const clientId = await convert(lead.id);
  const url = `/crm/clients/${clientId}/lead-advances`;
  const r = await call("GET", url, tok.repA);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.totals, { awaitingInvoice: 1000, onInvoicePending: 0, approved: 0 });
  assert.equal((await call("GET", url, tok.repB)).status, 403, "another rep's client");
  for (const t of [tok.admin, tok.head, tok.clients]) assert.equal((await call("GET", url, t)).status, 200);
  assert.equal((await call("GET", url, tok.finance)).status, 403);
  assert.equal((await call("GET", "/crm/clients/00000000-0000-0000-0000-000000000000/lead-advances", tok.admin)).status, 404);
});
