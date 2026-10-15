/**
 * Monthly scores: targets (leadership only), department / Sales / Meta Ads scores and who may see them.
 * Uses a far-future month (2031-07) so nothing already in the database can leak into the figures.
 *   TEST_DATABASE_URL=postgresql://.../desgro_erp_test npm run test:e2e
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
let scores: typeof import("../src/services/scores");
const run = `s${Date.now().toString(36)}`;
const M = "2031-07", DEPT = "Graphic Design";
let tok: { admin: string; head: string; plain: string; content: string };
let savedSettings: { targets: unknown; updatedBy: string } | null = null;
let savedHead: { employeeId: string | null } | null = null;
const created = { users: [] as string[], employees: [] as string[], clients: [] as string[], invoices: [] as string[], banks: [] as string[], metrics: [] as string[] };

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  ({ prisma } = await import("../src/db/prisma"));
  scores = await import("../src/services/scores");
  const { app } = await import("../src/app");
  const { signAccessToken } = await import("../src/utils/tokens");
  const s = await prisma.scoreSettings.findUnique({ where: { id: 1 } });
  savedSettings = s ? { targets: s.targets, updatedBy: s.updatedBy } : null;
  const h = await prisma.departmentHead.findUnique({ where: { dept: DEPT } });
  savedHead = h ? { employeeId: h.employeeId } : null;

  const mkEmp = async (label: string, dept: string) => { const e = await prisma.employee.create({ data: { employeeCode: `SC-${run}-${created.employees.length}`, name: `${label} ${run}`, dept, role: "Exec", joinedAt: new Date("2030-01-01"), email: `${label}-${run}@test.local`, salary: 0, empType: "PERMANENT", employmentStatus: "ACTIVE" } }); created.employees.push(e.id); return e; };
  const mkTok = async (label: string, roles: any[], emp: { id: string; dept: string } | null) => {
    const u = await prisma.user.create({ data: { name: `${label} ${run}`, email: `${label}-${run}@test.local`, passwordHash: "x", roles } });
    created.users.push(u.id);
    return signAccessToken({ sub: u.id, email: u.email, name: u.name, roles, department: emp?.dept ?? null, employeeId: emp?.id ?? null });
  };
  const headEmp = await mkEmp("gdhead", DEPT), seller = await mkEmp("seller", "Sales");
  await prisma.departmentHead.upsert({ where: { dept: DEPT }, create: { dept: DEPT, employeeId: headEmp.id, updatedBy: "t" }, update: { employeeId: headEmp.id } });
  tok = { admin: await mkTok("admin", ["ADMIN"], null), head: await mkTok("gdhead", ["EMPLOYEE"], headEmp), plain: await mkTok("plain", ["EMPLOYEE"], null), content: await mkTok("content", ["CONTENT"], null) };

  // a client sold by `seller`, invoiced ₹10,000 (₹6,000 Graphic Design + ₹4,000 Web) in 2031-07, ₹3,000 paid that month
  const bank = await prisma.bankAccount.create({ data: { name: `T ${run}`, bank: "T", number: "1", opening: 0, openedAt: new Date("2030-01-01") } });
  created.banks.push(bank.id);
  const c = await prisma.client.create({ data: { clientCode: `SCC-${run}`, name: `Scored ${run}`, services: [DEPT], status: "ACTIVE", onboardedAt: new Date("2030-02-01"), salesPerson: seller.name } });
  created.clients.push(c.id);
  const inv = await prisma.invoice.create({ data: { invoiceNo: `DG/${run}`, clientId: c.id, issuedAt: new Date(`${M}-10`), dueAt: new Date(`${M}-25`), items: { create: [{ dept: DEPT, amount: 6000 }, { dept: "Web Development", amount: 4000 }] }, payments: { create: [{ amount: 3000, paidDate: new Date(`${M}-12`), accountId: bank.id }] } } as any });
  created.invoices.push(inv.id);
  // own Meta ads: 4 days logged in the month — spend 1000, 10 leads, 2 sales, ₹5,000 revenue
  for (const [d, sp, l, p, r] of [["01", 250, 3, 1, 2500], ["02", 250, 3, 1, 2500], ["03", 250, 2, 0, 0], ["04", 250, 2, 0, 0]] as const) {
    const m = await prisma.ownAdMetric.create({ data: { date: new Date(`${M}-${d}`), spend: sp, leads: l, purchases: p, revenue: r } });
    created.metrics.push(m.id);
  }
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  await prisma.ownAdMetric.deleteMany({ where: { id: { in: created.metrics } } });
  await prisma.invoice.deleteMany({ where: { id: { in: created.invoices } } });
  await prisma.client.deleteMany({ where: { id: { in: created.clients } } });
  await prisma.bankAccount.deleteMany({ where: { id: { in: created.banks } } });
  if (savedSettings) await prisma.scoreSettings.update({ where: { id: 1 }, data: { targets: savedSettings.targets as any } }); else await prisma.scoreSettings.deleteMany({ where: { id: 1 } });
  if (savedHead) await prisma.departmentHead.update({ where: { dept: DEPT }, data: { employeeId: savedHead.employeeId } }); else await prisma.departmentHead.deleteMany({ where: { dept: DEPT } });
  await prisma.employee.deleteMany({ where: { id: { in: created.employees } } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  server?.close();
  await prisma.$disconnect();
});

test("weightedScore leaves out parts with nothing to measure and re-weights the rest", () => {
  const p = (w: number, v: number | null) => ({ key: "k", label: "l", w, v, detail: "" });
  assert.equal(scores.weightedScore([p(50, 1), p(50, 0)]), 50);
  assert.equal(scores.weightedScore([p(25, 1), p(75, null)]), 100, "the only live part carries the whole score");
  assert.equal(scores.weightedScore([p(10, null)]), null);
});

test("targets: anyone can read, only leadership can change, validated and merged", async () => {
  assert.equal((await call("GET", "/scores/targets", tok.plain)).status, 200);
  assert.equal((await call("PUT", "/scores/targets", tok.head, { deptClientGrowth: 5 })).status, 403);
  assert.equal((await call("PUT", "/scores/targets", tok.admin, { deptClientGrowth: 500 })).status, 400);
  assert.equal((await call("PUT", "/scores/targets", tok.admin, { deptRevenue: { Nonsense: 1 } })).status, 400);
  const ok = await call("PUT", "/scores/targets", tok.admin, { deptRevenue: { [DEPT]: 6000 }, sales: { revenue: 20000 }, meta: { roas: 5, cpl: 100, conv: 10 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.targets.deptRevenue[DEPT], 6000); assert.equal(ok.body.targets.sales.revenue, 20000);
  assert.equal(ok.body.targets.sales.conversion > 0, true, "untouched sales targets keep their values");
});

test("department score: head sees only their own; revenue part uses the department's share of payments", async () => {
  assert.equal((await call("GET", `/scores/departments?month=${M}`, tok.plain)).body.scores[DEPT], undefined);
  const mine = await call("GET", `/scores/departments?month=${M}`, tok.head);
  assert.deepEqual(Object.keys(mine.body.scores), [DEPT]);
  const rev = mine.body.scores[DEPT].now.parts.find((p: any) => p.key === "revenue");
  // ₹3,000 paid × 60% = ₹1,800 against a ₹6,000 target (past month → whole target due) = 0.3
  assert.equal(Math.round(rev.v * 100), 30);
  assert.match(rev.detail, /1\.8K.*6K/);
  assert.equal(mine.body.scores[DEPT].now.parts.find((p: any) => p.key === "satisfaction").v, null, "no client feedback yet");
  const all = await call("GET", `/scores/departments?month=${M}`, tok.admin);
  assert.ok(["Marketing Consultation", "Web Development", "Production", "Graphic Design", "Performance Marketing", "Sales"].every((d) => all.body.scores[d]));
  assert.equal((await call("GET", `/scores/departments?month=bad`, tok.admin)).status, 400);
});

test("sales score: booked revenue of the team's clients against the target", async () => {
  const sales = (await call("GET", `/scores/departments?month=${M}`, tok.admin)).body.scores.Sales.now;
  assert.equal(sales.booked, 10000);
  assert.equal(Math.round(sales.parts.find((p: any) => p.key === "target").v * 100), 50, "₹10,000 of a ₹20,000 target");
  assert.equal(sales.parts.find((p: any) => p.key === "meetings").v, 0, "no meetings logged in that month yet");
});

test("meta ads score: from the daily numbers, Admin/Content only", async () => {
  assert.equal((await call("GET", `/scores/meta-ads?month=${M}`, tok.plain)).status, 403);
  assert.equal((await call("GET", `/scores/meta-ads?month=${M}`, tok.head)).status, 403);
  const r = await call("GET", `/scores/meta-ads?month=${M}`, tok.content);
  assert.equal(r.status, 200);
  assert.deepEqual({ spend: r.body.totals.now.spend, leads: r.body.totals.now.leads, purchases: r.body.totals.now.purchases }, { spend: 1000, leads: 10, purchases: 2 });
  const part = (k: string) => r.body.now.parts.find((p: any) => p.key === k);
  assert.equal(part("roas").v, 1, "5x return vs a 5x target");
  assert.equal(part("cpl").v, 1, "₹100 per lead vs a ₹100 target");
  assert.equal(part("conv").v, 1, "20% of leads bought vs a 10% target (capped)");
  assert.equal(part("pace").v, null, "no previous month to compare");
  // a past month is measured to its end: 4 of 31 days logged. (70 + 15×4/31) ÷ 85 = 85
  assert.equal(Math.round(part("tracking").v * 31), 4);
  assert.equal(r.body.now.score, 85);
});

test("sales overview: Sales access only; team table shows each person's month against the one before", async () => {
  const sales = await prisma.user.create({ data: { name: `salesrole ${run}`, email: `salesrole-${run}@test.local`, passwordHash: "x", roles: ["SALES"] } });
  created.users.push(sales.id);
  const { signAccessToken } = await import("../src/utils/tokens");
  const salesTok = signAccessToken({ sub: sales.id, email: sales.email, name: sales.name, roles: ["SALES"], department: null, employeeId: null });
  assert.equal((await call("GET", `/scores/sales?month=${M}`, tok.plain)).status, 403);
  assert.equal((await call("GET", `/scores/sales?month=${M}`, tok.content)).status, 403);
  assert.equal((await call("GET", `/scores/sales?month=bad`, tok.admin)).status, 400);
  const r = await call("GET", `/scores/sales?month=${M}`, salesTok);
  assert.equal(r.status, 200);
  assert.equal(r.body.now.booked, 10000);
  assert.equal(r.body.now.stats.leadsNew, 0);
  const me = r.body.people.find((p: any) => p.name === `seller ${run}`);
  assert.deepEqual({ billed: me.now.billed, revenue: me.now.revenue, invoices: me.now.invoices, meetings: me.now.meetings }, { billed: 10000, revenue: 3000, invoices: 1, meetings: 0 });
  assert.equal(me.prev.billed, 0, "nothing the month before");
});
