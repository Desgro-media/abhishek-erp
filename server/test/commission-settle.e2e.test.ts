/**
 * Sales Commissions: server-computed summary (month filter + previous balance) and "Settle all".
 *   TEST_DATABASE_URL=postgresql://.../desgro_erp_test npm run test:e2e
 * Same throwaway-DB guard as the other e2e tests.
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
let admin: string, sales: string;
let accountId: string;
const run = `cs${Date.now().toString(36)}`;
const person = `Rep ${run}`;

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const d = (s: string) => new Date(s + "T00:00:00Z");
const mkEntry = (payee: string, amount: number, due: string, salesPerson = person) =>
  prisma.payable.create({ data: { category: "COMMISSION", payee, salesPerson, amount, dueAt: d(due) } });
const row = async (period: string, who = person) => (await call("GET", `/finance/commissions/summary?period=${period}`, admin)).body.rows.find((r: any) => r.salesPerson === who);
const balanceOf = async () => {
  const txns = await prisma.bankTransaction.findMany({ where: { accountId } });
  return txns.reduce((s, t) => s + (t.type === "DEBIT" ? -1 : 1) * Number(t.amount), 0);
};

before(async () => {
  ({ prisma } = await import("../src/db/prisma"));
  const { app } = await import("../src/app");
  const { signAccessToken } = await import("../src/utils/tokens");
  const mk = async (label: string, roles: any[]) => {
    const u = await prisma.user.create({ data: { name: `${label} ${run}`, email: `${label}-${run}@test.local`, passwordHash: "x", roles } });
    return signAccessToken({ sub: u.id, email: u.email, name: u.name, roles, department: null, employeeId: null });
  };
  admin = await mk("admin", ["ADMIN"]);
  sales = await mk("sales", ["SALES"]);
  accountId = (await prisma.bankAccount.create({ data: { name: `Bank ${run}`, bank: "Test Bank", number: "0000", opening: 100000, openedAt: new Date() } })).id;
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(async () => { server?.close(); await prisma?.$disconnect(); });

test("summary buckets by month and reports the previous balance live", async () => {
  const aug = await mkEntry("Aug-1", 1000, "2026-08-10");
  await mkEntry("Aug-2", 500, "2026-08-20");
  await mkEntry("Sep-1", 2000, "2026-09-05");
  await prisma.payablePayment.create({ data: { payableId: aug.id, amount: 400, paidDate: d("2026-08-15"), accountId } });

  const all = await row("all");
  assert.equal(all.earned, 3500); assert.equal(all.paid, 400); assert.equal(all.balance, 3100); assert.equal(all.previousBalance, 0);
  assert.equal(all.totalOutstanding, 3100);

  const sep = await row("2026-09");
  assert.equal(sep.previousBalance, 1100, "Aug: 600 + 500 still unpaid");
  assert.equal(sep.earned, 2000); assert.equal(sep.paid, 0); assert.equal(sep.balance, 2000);
  assert.equal(sep.entries.length, 1);
  assert.equal(sep.totalOutstanding, 3100, "settle amount doesn't depend on the filter");

  const augRow = await row("2026-08");
  assert.equal(augRow.previousBalance, 0); assert.equal(augRow.earned, 1500); assert.equal(augRow.paid, 400); assert.equal(augRow.balance, 1100);

  // someone with only older entries still shows up (carrying a balance into the period)
  const oct = await row("2026-10");
  assert.equal(oct.previousBalance, 3100); assert.equal(oct.entries.length, 0);
  assert.equal((await call("GET", "/finance/commissions/summary?period=bogus", admin)).status, 400);
  assert.equal((await call("GET", "/finance/commissions/summary?period=all", sales)).status, 403, "Finance/Admin only");
});

test("Settle all pays every entry with its own payment record and zeroes the balance", async () => {
  const before = await balanceOf();
  const res = await call("POST", "/finance/commissions/settle", admin, { salesPerson: person, accountId, paidDate: "2026-09-30" });
  assert.equal(res.status, 201);
  assert.equal(res.body.paid, 3100); assert.equal(res.body.remaining, 0); assert.equal(res.body.payments.length, 3);

  const after = await row("all");
  assert.equal(after.totalOutstanding, 0); assert.equal(after.balance, 0); assert.equal(after.paid, 3500);
  const entries = await prisma.payable.findMany({ where: { salesPerson: person }, include: { payments: true } });
  assert.ok(entries.every((e) => e.payments.length >= 1), "every entry has its own payment line");
  assert.equal(await balanceOf(), before - 3100, "one bank debit per payment, totalling the amount");
  assert.ok(await prisma.auditLog.findFirst({ where: { action: "FIN_COMMISSION_SETTLE", entityId: person } }), "audited");

  const again = await call("POST", "/finance/commissions/settle", admin, { salesPerson: person, accountId, paidDate: "2026-09-30" });
  assert.equal(again.status, 400, "nothing left to settle");
});

test("a partial settle amount is applied oldest-due-first", async () => {
  const who = `FIFO ${run}`;
  const old = await mkEntry("Old", 1000, "2026-07-01", who);
  const mid = await mkEntry("Mid", 1000, "2026-08-01", who);
  const recent = await mkEntry("New", 1000, "2026-09-01", who);

  const res = await call("POST", "/finance/commissions/settle", admin, { salesPerson: who, accountId, paidDate: "2026-09-30", amount: 1500 });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.payments.map((p: any) => p.amount), [1000, 500]);
  assert.equal(res.body.remaining, 1500);

  const paid = async (id: string) => (await prisma.payablePayment.findMany({ where: { payableId: id } })).reduce((s, p) => s + Number(p.amount), 0);
  assert.equal(await paid(old.id), 1000); assert.equal(await paid(mid.id), 500); assert.equal(await paid(recent.id), 0);

  assert.equal((await call("POST", "/finance/commissions/settle", admin, { salesPerson: who, accountId, paidDate: "2026-09-30", amount: 99999 })).status, 400, "more than owed");
  assert.equal((await call("POST", "/finance/commissions/settle", sales, { salesPerson: who, accountId, paidDate: "2026-09-30" })).status, 403, "Sales can't settle");
  assert.equal(await paid(recent.id), 0, "rejected requests changed nothing");
});
