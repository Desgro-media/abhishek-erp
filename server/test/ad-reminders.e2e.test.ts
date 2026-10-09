/**
 * Daily "ad numbers not logged" reminders (Performance Marketing clients + DesGro's own Meta ads).
 *   TEST_DATABASE_URL=postgresql://.../desgro_erp_test npm run test:e2e
 * Same throwaway-DB guard as the other e2e files. A recording mock mailer is used throughout — nothing can send.
 *
 * Fixed calendar (weekly off = Sunday): today is a Thursday in 2031, so
 *   d1 Wed, d2 Tue (company holiday), d3 Mon, d4 Sun (weekly off), d5 Sat, d6 Fri, d7 Thu
 * and the working days checked are d1, d3, d5, d6, d7.
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
let svc: typeof import("../src/services/adReminders");
let tok: { admin: string; content: string; sales: string; finance: string };
let adminUser: { email: string };
const run = `r${Date.now().toString(36)}`;

// today = the first Thursday on/after 2031-03-10
const dayStr = (d: Date) => d.toISOString().slice(0, 10);
let today = "";
const off = (n: number) => dayStr(new Date(new Date(`${today}T00:00:00Z`).getTime() + n * 86400_000));
const D = (n: number) => off(-n); // D(1) = yesterday
const dt = (s: string) => new Date(`${s}T00:00:00Z`);

let oldWeeklyOff: number | null = null;
const created = { employees: [] as string[], clients: [] as string[], holidays: [] as string[] };

async function call(method: string, path: string, token: string | null) {
  const res = await fetch(base + path, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const mkEmp = async (label: string, dept: string, status: "ACTIVE" | "LEFT" = "ACTIVE") => {
  const e = await prisma.employee.create({ data: { employeeCode: `RM-${run}-${created.employees.length}`, name: `${label} ${run}`, dept, role: "Exec", joinedAt: new Date("2030-01-01"), email: `${label.replace(/\W/g, "").toLowerCase()}-${run}@test.local`, salary: 0, empType: "PERMANENT", employmentStatus: status } });
  created.employees.push(e.id);
  return e;
};
const mkClient = async (label: string, o: { am?: string | null; status?: any; archived?: boolean; services?: string[]; access?: "GRANTED" | "PENDING" | "REVOKED" | null; onboarded?: string }) => {
  const c = await prisma.client.create({
    data: {
      clientCode: `RC-${run}-${created.clients.length}`, name: `${label} ${run}`, services: o.services ?? ["Performance Marketing"], status: o.status ?? "ACTIVE",
      archivedAt: o.archived ? new Date() : null, accountManager: o.am ?? null, onboardedAt: new Date(o.onboarded ?? "2030-01-01"),
    },
  });
  created.clients.push(c.id);
  if (o.access !== null) await prisma.clientAdAccess.create({ data: { clientId: c.id, platform: "Meta", status: o.access ?? "GRANTED", updatedBy: "t" } });
  return c;
};
const log = (c: { id: string }, dates: string[]) => prisma.clientAdMetric.createMany({ data: dates.map((d) => ({ clientId: c.id, date: dt(d), spend: 1, leads: 1, purchases: 0, revenue: 0 })) });
const leave = (empId: string, date: string, o: { status?: any; type?: any; duration?: any } = {}) =>
  prisma.leaveRequest.create({ data: { employeeId: empId, type: o.type ?? "CASUAL_SICK", duration: o.duration ?? "FULL_DAY", fromDate: dt(date), toDate: dt(date), days: 1, reason: "t", status: o.status ?? "APPROVED" } });

let emp: Record<string, { id: string; email: string; name: string }> = {};
let cl: Record<string, { id: string }> = {};

before(async () => {
  ({ prisma } = await import("../src/db/prisma"));
  svc = await import("../src/services/adReminders");
  const { app } = await import("../src/app");
  const { signAccessToken } = await import("../src/utils/tokens");

  let t = new Date("2031-03-10T00:00:00Z");
  while (t.getUTCDay() !== 4) t = new Date(t.getTime() + 86400_000);
  today = dayStr(t);

  const mk = async (label: string, roles: any[]) => {
    const u = await prisma.user.create({ data: { name: `${label} ${run}`, email: `${label}-${run}@test.local`, passwordHash: "x", roles } });
    return { u, token: signAccessToken({ sub: u.id, email: u.email, name: u.name, roles, department: null, employeeId: null }) };
  };
  const [a, c, s, f] = [await mk("admin", ["ADMIN"]), await mk("content", ["CONTENT"]), await mk("sales", ["SALES"]), await mk("finance", ["FINANCE"])];
  tok = { admin: a.token, content: c.token, sales: s.token, finance: f.token };
  adminUser = a.u;

  // calendar: weekly off = Sunday, d2 is a company holiday
  const pol = await prisma.hrPolicy.findUnique({ where: { id: 1 } });
  oldWeeklyOff = pol ? pol.weeklyOff : null;
  if (pol) await prisma.hrPolicy.update({ where: { id: 1 }, data: { weeklyOff: 0 } });
  else await prisma.hrPolicy.create({ data: { id: 1, weeklyOff: 0 } as any });
  await prisma.holiday.deleteMany({ where: { date: dt(D(2)) } });
  const h = await prisma.holiday.create({ data: { date: dt(D(2)), name: "Test holiday" } });
  created.holidays.push(h.id);
  // reminders "began" long ago, so the whole 7-day window is in scope
  await prisma.adReminderRun.deleteMany({});
  await prisma.adReminderRun.create({ data: { runDate: dt(off(-30)) } });

  emp = {
    am1: await mkEmp("Asha", "Marketing Consultation"),
    t1: await mkEmp("Tara", "Performance Marketing"),
    t2: await mkEmp("Tejas", "Performance Marketing"),
    am3: await mkEmp("Leaver", "Graphic Design"),
    am4: await mkEmp("Halfday", "Graphic Design"),
    am5: await mkEmp("Wfh", "Graphic Design"),
    am6: await mkEmp("Pending", "Graphic Design"),
    left: await mkEmp("Gone", "Graphic Design", "LEFT"),
  };
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  // ---- clients ----
  cl.c1 = await mkClient("C1 nothing logged", { am: emp.am1.name });                       // missing every working day
  cl.c12 = await mkClient("C12 spaced name", { am: `  ${emp.am1.name.toUpperCase()}  ` });  // AM matched ignoring case/space
  cl.c3 = await mkClient("C3 only d1 missing", { am: emp.t1.name });
  await log(cl.c3, [D(3), D(5), D(6), D(7)]);
  cl.c10 = await mkClient("C10 onboarded yesterday", { am: emp.am1.name, onboarded: D(1) }); // only d1 is in scope
  // excluded by the skip rules (all would otherwise be missing):
  cl.paused = await mkClient("C4 paused", { am: emp.am1.name, status: "PAUSED" });
  cl.churned = await mkClient("C5 churned", { am: emp.am1.name, status: "CHURNED" });
  cl.archived = await mkClient("C6 archived", { am: emp.am1.name, archived: true });
  cl.nonpm = await mkClient("C7 not performance", { am: emp.am1.name, services: ["Graphic Design"] });
  cl.pending = await mkClient("C8 access pending", { am: emp.am1.name, access: "PENDING" });
  cl.revoked = await mkClient("C8b access revoked", { am: emp.am1.name, access: "REVOKED" });
  cl.noaccess = await mkClient("C9 no access row", { am: emp.am1.name, access: null });
  // unknown / departed AM -> Admin is told
  cl.unknown = await mkClient("C11 unknown AM", { am: "Nobody Here" });
  cl.leftAm = await mkClient("C11b departed AM", { am: emp.left.name });
  // leave handling (each AM has one client missing d1 and d3)
  cl.l3 = await mkClient("L3 approved leave d1", { am: emp.am3.name });
  cl.l4 = await mkClient("L4 half day d1", { am: emp.am4.name });
  cl.l5 = await mkClient("L5 wfh d1", { am: emp.am5.name });
  cl.l6 = await mkClient("L6 pending leave d1", { am: emp.am6.name });
  for (const k of ["l3", "l4", "l5", "l6"]) await log(cl[k], [D(5), D(6), D(7)]); // so only d1 and d3 are missing
  await leave(emp.am3.id, D(1));
  await leave(emp.am4.id, D(1), { duration: "HALF_DAY" });
  await leave(emp.am5.id, D(1), { type: "WFH" });
  await leave(emp.am6.id, D(1), { status: "PENDING" });
  await leave(emp.am6.id, D(3), { status: "REJECTED" });

  // DesGro's own ads: logged every working day except d1
  await prisma.ownAdMetric.createMany({ data: [D(3), D(5), D(6), D(7)].map((d) => ({ date: dt(d), spend: 1, leads: 1, purchases: 0, revenue: 0 })) });
});

after(async () => {
  await prisma?.ownAdMetric.deleteMany({ where: { date: { in: [3, 5, 6, 7].map((n) => dt(D(n))).concat(dt(D(1))) } } });
  await prisma?.client.deleteMany({ where: { id: { in: created.clients } } });
  await prisma?.employee.deleteMany({ where: { id: { in: created.employees } } });
  await prisma?.holiday.deleteMany({ where: { id: { in: created.holidays } } });
  await prisma?.adReminderRun.deleteMany({ where: { OR: [{ runDate: dt(today) }, { runDate: dt(off(-30)) }] } });
  if (oldWeeklyOff !== null) await prisma?.hrPolicy.update({ where: { id: 1 }, data: { weeklyOff: oldWeeklyOff } });
  server?.close();
  await prisma?.$disconnect();
});

const digestFor = async (email: string) => (await svc.buildDigests(today)).digests.find((d) => d.to.email === email);
const itemMap = (d: any) => Object.fromEntries(d.items.map((i: any) => [i.label.replace(` ${run}`, ""), i.dates]));

test("calendar: only working days are checked — weekly off and company holidays are skipped", async () => {
  const r = await svc.buildDigests(today);
  assert.deepEqual(r.checkedDates, [D(1), D(3), D(5), D(6), D(7)], "d4 is Sunday (weekly off), d2 is the holiday");
});

test("a client's account manager gets ONE digest listing every client still missing numbers (name matched ignoring case/spaces)", async () => {
  const d = await digestFor(emp.am1.email);
  assert.ok(d);
  const m = itemMap(d);
  assert.deepEqual(m["C1 nothing logged"], [D(7), D(6), D(5), D(3), D(1)], "ascending");
  assert.deepEqual(m["C12 spaced name"], [D(7), D(6), D(5), D(3), D(1)], "same person even with odd casing/spacing -> same digest");
  assert.deepEqual(m["C10 onboarded yesterday"], [D(1)], "days before the client was onboarded aren't missing");
  assert.equal(d.items.length, 3, "one mail, three clients — nothing else");
  assert.match(d.subject, /3 items/);
  assert.equal(d.fallback, false);
});

test("skip rules: Paused, Churned, archived, non-Performance, access Pending/Revoked/none are never reminded", async () => {
  const all = (await svc.buildDigests(today)).digests.flatMap((d) => d.items.map((i) => i.label));
  for (const n of ["C4 paused", "C5 churned", "C6 archived", "C7 not performance", "C8 access pending", "C8b access revoked", "C9 no access row"]) {
    assert.equal(all.some((l) => l.includes(`${n} ${run}`)), false, n);
  }
});

test("days a client DID log aren't missing, and a short gap isn't escalated; DesGro's own ads go to the whole Performance Marketing team", async () => {
  const t1 = await digestFor(emp.t1.email);
  assert.deepEqual(itemMap(t1), { "C3 only d1 missing": [D(1)], "DesGro Media's own Meta ads": [D(1)] }, "T1 owns C3 and is on the team");
  assert.equal(t1!.items.every((i) => i.streak === 1), true);
  assert.deepEqual(t1!.cc, [], "1 day missing: no Admin copy");
  assert.equal(t1!.escalated, false);
  const t2 = await digestFor(emp.t2.email);
  assert.deepEqual(itemMap(t2), { "DesGro Media's own Meta ads": [D(1)] });
  // someone outside the team never gets the own-ads item
  assert.equal(itemMap(await digestFor(emp.am1.email))["DesGro Media's own Meta ads"], undefined);
});

test("escalation: 3+ working days missing in a row copies the Admins (never the person themself); mail lists the streak", async () => {
  const d = await digestFor(emp.am1.email);
  assert.equal(d!.escalated, true);
  assert.ok(d!.cc.includes(adminUser.email));
  assert.equal(d!.cc.includes(emp.am1.email), false);
  assert.equal(d!.items.find((i) => i.label.includes("C1 nothing"))!.streak, 5);
  assert.equal(d!.items.find((i) => i.label.includes("C10"))!.streak, 1);

  // exactly at the boundary: 2 in a row is not enough, 3 is
  const c = await mkClient("Streak client", { am: emp.t2.name });
  await log(c, [D(7), D(6)]); // missing d5, d3, d1 -> 3 in a row
  assert.equal((await digestFor(emp.t2.email))!.escalated, true);
  await log(c, [D(5)]); // now missing d3, d1 -> 2 in a row
  assert.equal((await digestFor(emp.t2.email))!.escalated, false);
});

test("no account manager / departed employee: the Admins are told directly (so nothing goes unnoticed)", async () => {
  const d = await digestFor(adminUser.email);
  assert.ok(d, "Admin gets a digest");
  assert.equal(d!.fallback, true);
  const labels = d!.items.map((i) => i.label);
  assert.ok(labels.some((l) => l.includes(`C11 unknown AM ${run}`) && l.includes("no account manager found")));
  assert.ok(labels.some((l) => l.includes(`C11b departed AM ${run}`)), "a departed employee isn't an account manager any more");
  // and the departed employee is not emailed
  assert.equal(await digestFor(emp.left.email), undefined);
});

test("leave: approved FULL-day leave drops that day for that person; half-day, WFH, pending and rejected don't", async () => {
  assert.deepEqual(itemMap(await digestFor(emp.am3.email))["L3 approved leave d1"], [D(3)], "d1 dropped (on leave), d3 still missing");
  assert.deepEqual(itemMap(await digestFor(emp.am4.email))["L4 half day d1"], [D(3), D(1)].sort(), "half day: still expected to log");
  assert.deepEqual(itemMap(await digestFor(emp.am5.email))["L5 wfh d1"], [D(3), D(1)].sort(), "WFH is a working day");
  assert.deepEqual(itemMap(await digestFor(emp.am6.email))["L6 pending leave d1"], [D(3), D(1)].sort(), "pending/rejected leave doesn't excuse");
  // on leave for the only missing day -> no digest at all
  const solo = await mkEmp("Sololeave", "Graphic Design");
  const c = await mkClient("Solo", { am: solo.name, onboarded: D(1) });
  await leave(solo.id, D(1));
  assert.equal(await digestFor(solo.email), undefined);
  void c;
});

test("start boundary: before any run has happened, only yesterday is checked (old history is never flagged)", async () => {
  await prisma.adReminderRun.deleteMany({});
  assert.equal(await svc.reminderStartDate(today), D(1));
  assert.deepEqual((await svc.buildDigests(today)).checkedDates, [D(1)]);
  const m = itemMap((await digestFor(emp.am1.email))!);
  assert.deepEqual(m["C1 nothing logged"], [D(1)]);
  await prisma.adReminderRun.create({ data: { runDate: dt(off(-30)) } }); // back to the long-running state
  assert.deepEqual((await svc.buildDigests(today)).checkedDates, [D(1), D(3), D(5), D(6), D(7)]);
});

test("a dry run emails nothing and writes nothing; a real run sends one mail per digest and a failed mail never stops the rest", async () => {
  const calls: any[] = [];
  const mailer = async (_box: string, o: any) => { calls.push(o); };
  const runsBefore = await prisma.adReminderRun.count();

  const dry = await svc.runAdReminders({ today, send: false, mailer: mailer as any });
  assert.equal(calls.length, 0);
  assert.equal(dry.sent, 0);
  assert.ok(dry.digests.length >= 6);
  assert.equal(await prisma.adReminderRun.count(), runsBefore, "dry run records nothing");

  const real = await svc.runAdReminders({ today, send: true, mailer: mailer as any });
  assert.equal(real.sent, real.digests.length);
  assert.equal(calls.length, real.digests.length);
  const am1 = calls.find((c) => c.to === emp.am1.email);
  assert.match(am1.subject, /Ad numbers not logged — 3 items/);
  assert.match(am1.html, /C1 nothing logged/);
  assert.match(am1.html, /5 working days in a row/);
  assert.ok(am1.cc.includes(adminUser.email));
  const t2 = calls.find((c) => c.to === emp.t2.email);
  assert.equal(t2.cc, undefined, "no escalation -> no cc");
  assert.match(t2.html, /own Meta ads/);
  assert.ok(calls.every((c) => c.to !== emp.left.email && c.to !== emp.l3?.email));

  const bad = emp.t1.email;
  const flaky = await svc.runAdReminders({ today, send: true, mailer: (async (_b: string, o: any) => { if (o.to === bad) throw new Error("mailbox full"); }) as any });
  assert.equal(flaky.failed, 1);
  assert.equal(flaky.sent, flaky.digests.length - 1, "everyone else still got theirs");
  assert.match(flaky.errors[0], /mailbox full/);
});

test("once a day: the first scheduled run claims the date and records what it did; a second run the same day does nothing", async () => {
  const calls: any[] = [];
  const mailer = (async (_b: string, o: any) => { calls.push(o); }) as any;
  const first = await svc.runScheduledReminders(mailer, today);
  assert.ok(first && (first as any).sent > 0);
  const row = await prisma.adReminderRun.findUniqueOrThrow({ where: { runDate: dt(today) } });
  assert.ok(row.finishedAt);
  assert.equal((row.summary as any).sent, (first as any).sent);
  const n = calls.length;
  assert.equal(await svc.runScheduledReminders(mailer, today), null, "already ran today");
  assert.equal(calls.length, n, "no second batch of emails");
  // two racing claims: exactly one wins
  const d = off(1);
  const wins = await Promise.all([svc.claimDailyRun(d), svc.claimDailyRun(d), svc.claimDailyRun(d)]);
  assert.equal(wins.filter(Boolean).length, 1);
  await prisma.adReminderRun.deleteMany({ where: { runDate: dt(d) } });
  // a mail failure still finishes and records the day (it is not retried — nobody gets a second batch)
  const d2 = off(2);
  const r = await svc.runScheduledReminders((async () => { throw new Error("smtp down"); }) as any, d2);
  assert.equal((r as any).sent, 0);
  assert.equal((r as any).failed, (r as any).digests, "every mail failed, and it was counted rather than thrown");
  assert.ok((await prisma.adReminderRun.findUniqueOrThrow({ where: { runDate: dt(d2) } })).finishedAt);
  await prisma.adReminderRun.deleteMany({ where: { runDate: dt(d2) } });
});

test("Admin-only preview shows what would be sent and the on/off state — and sends nothing", async () => {
  assert.equal((await call("GET", "/ad-reminders/preview", null)).status, 401);
  for (const t of [tok.content, tok.sales, tok.finance]) assert.equal((await call("GET", "/ad-reminders/preview", t)).status, 403);
  const r = await call("GET", "/ad-reminders/preview", tok.admin);
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, false, "off unless AD_REMINDERS_ENABLED=true");
  assert.equal(r.body.escalateAfter, 3);
  assert.ok(Array.isArray(r.body.digests));
  assert.ok(r.body.digests.every((d: any) => d.to.email && Array.isArray(d.items)));
  assert.equal(typeof r.body.emailConfigured, "boolean");
});
