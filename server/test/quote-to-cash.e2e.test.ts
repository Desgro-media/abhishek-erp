/**
 * Acceptance test: quote -> invoice -> Sales records payment -> Finance approves.
 *
 * The invariant under test: a payment Sales records is only *pending* until
 * Finance approves it. Only the approval (a) posts to the bank ledger,
 * (b) credits sales commission, and (c) counts toward Accounts Overview /
 * Department Profitability revenue. Before approval it must be visible to
 * Finance as pending and appear in none of those numbers.
 *
 * Runs the real Express app over HTTP against a THROWAWAY database:
 *   TEST_DATABASE_URL=postgresql://.../desgro_erp_test npm run test:e2e
 * It refuses to run unless the database name contains "test".
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

type Api = { status: number; body: any };
let server: Server;
let base: string;
let prisma: typeof import("../src/db/prisma").prisma;
let tokens: { admin: string; finance: string; sales: string };
let salesName: string;
let bankId: string;

const month = new Date().toISOString().slice(0, 7);
const today = new Date().toISOString().slice(0, 10);
const run = Date.now().toString(36); // unique per run so reruns on the same DB don't collide

async function call(method: string, path: string, token: string, body?: unknown): Promise<Api> {
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

  const mkUser = async (label: string, roles: any[]) => {
    const u = await prisma.user.create({ data: { name: `${label} ${run}`, email: `${label}-${run}@test.local`, passwordHash: "x", roles } });
    return { u, token: signAccessToken({ sub: u.id, email: u.email, name: u.name, roles, department: null, employeeId: null }) };
  };
  const admin = await mkUser("admin", ["ADMIN"]);
  const finance = await mkUser("finance", ["FINANCE"]); // Finance only — NOT an Admin, NOT a CRM user
  const sales = await mkUser("sales", ["SALES"]);
  tokens = { admin: admin.token, finance: finance.token, sales: sales.token };
  salesName = sales.u.name;

  bankId = (await prisma.bankAccount.create({ data: { name: `HDFC ${run}`, bank: "HDFC", number: run, opening: 0, openedAt: new Date() } })).id;

  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  server?.close();
  await prisma?.$disconnect();
});

// ---- helpers reading exactly what the UI reads ----
const overview = async () => {
  const r = await call("GET", `/finance/reports/dept-profitability?month=${month}`, tokens.finance);
  assert.equal(r.status, 200);
  const web = r.body.rows.find((x: any) => x.dept === "Web Development");
  return {
    gross: r.body.rows.reduce((s: number, x: any) => s + x.grossRevenue, 0) as number,
    net: r.body.rows.reduce((s: number, x: any) => s + x.revenue, 0) as number,
    webGross: web.grossRevenue as number,
  };
};
const bankBalance = async () => {
  const r = await call("GET", "/finance/bank-accounts", tokens.finance);
  return Number(r.body.accounts.find((a: any) => a.id === bankId).balance);
};
const ledgerRows = (refId: string) => prisma.bankTransaction.count({ where: { refId } });
const commissionFor = async (needle: string) =>
  (await prisma.payable.findMany({ where: { category: "COMMISSION", salesPerson: salesName, payee: { contains: needle } } })).map((p) => Number(p.amount));

async function newLeadQuote(title: string, amount: number) {
  const lead = await prisma.lead.create({ data: { leadCode: `L-${run}-${title}`, name: `Lead ${title} ${run}`, source: "test", serviceInterested: "Web Development", leadOwner: salesName } });
  const q = await call("POST", "/crm/quotes", tokens.sales, { leadId: lead.id, title: `${title}-${run}`, items: [{ dept: "Web Development", amount }] });
  assert.equal(q.status, 201);
  const sent = await call("POST", `/crm/quotes/${q.body.quote.id}/send`, tokens.sales);
  assert.equal(sent.status, 200);
  return { lead, quote: q.body.quote };
}

test("quote -> invoice -> Sales records payment -> Finance approves", async (t) => {
  const { quote, lead } = await newLeadQuote("A", 100_000);
  const base0 = { overview: await overview(), bank: await bankBalance() };

  let invoiceId: string, invoiceNo: string, pendingId: string;

  await t.test("1. quote converts to an invoice (lead becomes a client); no money moves", async () => {
    const r = await call("POST", `/crm/quotes/${quote.id}/convert-to-invoice`, tokens.sales, { issuedAt: today, dueAt: today });
    assert.equal(r.status, 201);
    invoiceId = r.body.invoiceId; invoiceNo = r.body.invoiceNo;
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status, "CONVERTED");
    assert.equal(await prisma.invoicePayment.count({ where: { invoiceId } }), 0);
    assert.deepEqual(await overview(), base0.overview, "invoicing alone must not create revenue");
  });

  await t.test("2. Sales records a payment -> visible to Finance as PENDING", async () => {
    const r = await call("POST", `/finance/invoices/${invoiceId}/pending-payments`, tokens.sales, { amount: 60_000, paymentDate: today, note: "UPI" });
    assert.equal(r.status, 201);
    pendingId = r.body.pending.id;

    // What Accounts > Payment Receipts renders: invoices' pendingPayments where approved=false.
    const list = await call("GET", "/finance/invoices", tokens.finance);
    const inv = list.body.invoices.find((i: any) => i.id === invoiceId);
    const p = inv.pendingPayments.find((x: any) => x.id === pendingId);
    assert.ok(p && p.approved === false, "pending payment listed for Finance");
    assert.equal(inv.payments.length, 0);
  });

  await t.test("3. BEFORE approval: nothing in Overview, bank ledger or commission", async () => {
    assert.deepEqual(await overview(), base0.overview, "Overview unchanged");
    assert.equal(await bankBalance(), base0.bank, "bank balance unchanged");
    assert.equal(await prisma.bankTransaction.count({ where: { note: { contains: invoiceNo } } }), 0, "no ledger row");
    assert.deepEqual(await commissionFor(invoiceNo), [], "no commission credited");
  });

  await t.test("4. Sales cannot approve their own payment", async () => {
    const r = await call("POST", `/finance/invoices/${invoiceId}/pending-payments/${pendingId}/approve`, tokens.sales, { accountId: bankId });
    assert.equal(r.status, 403);
    assert.deepEqual(await overview(), base0.overview);
  });

  await t.test("5. Finance approves -> ledger + commission + Overview, all at once", async () => {
    const r = await call("POST", `/finance/invoices/${invoiceId}/pending-payments/${pendingId}/approve`, tokens.finance, { accountId: bankId });
    assert.equal(r.status, 201);

    assert.equal(await bankBalance(), base0.bank + 60_000, "(a) bank credited");
    assert.equal(await ledgerRows(r.body.payment.id), 1, "(a) exactly one ledger row");
    assert.deepEqual(await commissionFor(invoiceNo), [6_000], "(b) 10% commission credited to the Sales rep");

    const o = await overview();
    assert.equal(o.gross, base0.overview.gross + 60_000, "(c) gross revenue up by the payment");
    assert.equal(o.webGross, base0.overview.webGross + 60_000, "(c) attributed to the invoice's department");
    assert.equal(o.net, base0.overview.net + 54_000, "(c) net of the 10% commission");
  });

  await t.test("6. approving again (or a double-click race) never double-posts", async () => {
    const again = await call("POST", `/finance/invoices/${invoiceId}/pending-payments/${pendingId}/approve`, tokens.finance, { accountId: bankId });
    assert.equal(again.status, 409);

    // Second payment approved by two simultaneous requests: exactly one may win.
    const p2 = await call("POST", `/finance/invoices/${invoiceId}/pending-payments`, tokens.sales, { amount: 10_000, paymentDate: today });
    const id2 = p2.body.pending.id;
    const [a, b] = await Promise.all([
      call("POST", `/finance/invoices/${invoiceId}/pending-payments/${id2}/approve`, tokens.finance, { accountId: bankId }),
      call("POST", `/finance/invoices/${invoiceId}/pending-payments/${id2}/approve`, tokens.finance, { accountId: bankId }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
    assert.equal(await bankBalance(), base0.bank + 70_000, "bank credited once per payment");
    assert.deepEqual((await commissionFor(invoiceNo)).sort((x, y) => x - y), [1_000, 6_000], "commission credited once per payment");
    assert.equal((await overview()).gross, base0.overview.gross + 70_000);
  });
});

test("pay-first path (Sent quote -> record payment on the quote -> Finance approves)", async (t) => {
  const { quote, lead } = await newLeadQuote("B", 50_000);
  const before = { overview: await overview(), bank: await bankBalance() };
  const approveUrl = (pid: string) => `/crm/quotes/${quote.id}/pending-payments/${pid}/approve`;

  const sub = await call("POST", `/crm/quotes/${quote.id}/pending-payments`, tokens.sales, { amount: 20_000, paymentDate: today, note: "advance" });
  assert.equal(sub.status, 201);
  const pid = sub.body.pending.id;

  await t.test("pending: no ledger, commission, invoice, client conversion or Overview impact", async () => {
    assert.deepEqual(await overview(), before.overview);
    assert.equal(await bankBalance(), before.bank);
    assert.deepEqual(await commissionFor(quote.quoteCode), []);
    const q = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    assert.equal(q.invoiceId, null);
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status, "NEW");
  });

  await t.test("Sales cannot approve it", async () => {
    const r = await call("POST", approveUrl(pid), tokens.sales, { accountId: bankId });
    assert.equal(r.status, 403);
    assert.deepEqual(await overview(), before.overview);
  });

  await t.test("a Finance-role user (not Admin) can approve it", async () => {
    const r = await call("POST", approveUrl(pid), tokens.finance, { accountId: bankId });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(await bankBalance(), before.bank + 20_000);
    assert.deepEqual(await commissionFor(quote.quoteCode), [2_000]);
    const o = await overview();
    assert.equal(o.gross, before.overview.gross + 20_000);
    assert.equal(o.net, before.overview.net + 18_000);
    assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status, "CONVERTED", "lead -> client on first approved payment");
  });

  await t.test("a payment larger than what's left on the quote is rejected", async () => {
    const tooMuch = await call("POST", `/crm/quotes/${quote.id}/pending-payments`, tokens.sales, { amount: 999_999, paymentDate: today });
    assert.equal(tooMuch.status, 400);
  });

  await t.test("discarding a pending payment leaves every number untouched", async () => {
    const p = await call("POST", `/crm/quotes/${quote.id}/pending-payments`, tokens.sales, { amount: 5_000, paymentDate: today });
    const snapshot = { o: await overview(), bank: await bankBalance() };
    const d = await call("DELETE", `/crm/quotes/${quote.id}/pending-payments/${p.body.pending.id}`, tokens.admin);
    assert.equal(d.status, 204);
    assert.deepEqual(await overview(), snapshot.o);
    assert.equal(await bankBalance(), snapshot.bank);
  });
});

test("Department profitability: rent is charged only to the month it's due in", async () => {
  const rentIn = async (m: string) => (await call("GET", `/finance/reports/dept-profitability?month=${m}`, tokens.finance)).body.rent as number;
  const [thisMonthBefore, oldMonthBefore] = [await rentIn(month), await rentIn("2019-05")];
  await prisma.payable.create({ data: { category: "RENT", payee: `Office rent — May 2019 ${run}`, amount: 7_000, dueAt: new Date("2019-05-05") } });
  assert.equal(await rentIn(month), thisMonthBefore, "an old month's rent must not leak into this month");
  assert.equal(await rentIn("2019-05"), oldMonthBefore + 7_000, "and it does land in its own month");
});
