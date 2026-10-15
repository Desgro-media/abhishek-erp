/**
 * Social media numbers: who may read / enter them, validation, upsert, the month note and the owner setting.
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
const run = `so${Date.now().toString(36)}`;
const NOW = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7);
const PAST = "2025-03";
let tok: { admin: string; owner: string; content: string; plain: string };
let ownerId = "", otherId = "";
let savedSettings: { ownerEmployeeId: string | null; updatedBy: string } | null = null;
let existing: { month: string }[] = [];
const created = { users: [] as string[], employees: [] as string[] };

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  ({ prisma } = await import("../src/db/prisma"));
  const { app } = await import("../src/app");
  const { signAccessToken } = await import("../src/utils/tokens");
  const s = await prisma.marketingSettings.findUnique({ where: { id: 1 } });
  savedSettings = s ? { ownerEmployeeId: s.ownerEmployeeId, updatedBy: s.updatedBy } : null;
  existing = await prisma.socialStat.findMany({ where: { month: { in: [NOW, PAST] } }, select: { month: true } });
  assert.equal(existing.length, 0, "test database already has social numbers for the months used here");
  const mkEmp = async (label: string) => { const e = await prisma.employee.create({ data: { employeeCode: `SO-${run}-${created.employees.length}`, name: `${label} ${run}`, dept: "Marketing Consultation", role: "Exec", joinedAt: new Date("2030-01-01"), email: `${label}-${run}@test.local`, salary: 0, empType: "PERMANENT", employmentStatus: "ACTIVE" } }); created.employees.push(e.id); return e; };
  const mkTok = async (label: string, roles: any[], emp: { id: string; dept: string } | null) => {
    const u = await prisma.user.create({ data: { name: `${label} ${run}`, email: `${label}-${run}@test.local`, passwordHash: "x", roles } });
    created.users.push(u.id);
    return signAccessToken({ sub: u.id, email: u.email, name: u.name, roles, department: emp?.dept ?? null, employeeId: emp?.id ?? null });
  };
  const owner = await mkEmp("owner"), other = await mkEmp("other");
  ownerId = owner.id; otherId = other.id;
  await prisma.marketingSettings.upsert({ where: { id: 1 }, create: { id: 1, ownerEmployeeId: owner.id, updatedBy: "t" }, update: { ownerEmployeeId: owner.id } });
  tok = { admin: await mkTok("admin", ["ADMIN"], null), owner: await mkTok("ownr", ["EMPLOYEE"], owner), content: await mkTok("content", ["CONTENT"], null), plain: await mkTok("plain", ["EMPLOYEE"], other) };
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  await prisma.socialStat.deleteMany({ where: { month: { in: [NOW, PAST] } } });
  await prisma.socialNote.deleteMany({ where: { month: { in: [NOW, PAST] } } });
  if (savedSettings) await prisma.marketingSettings.update({ where: { id: 1 }, data: savedSettings }); else await prisma.marketingSettings.deleteMany({ where: { id: 1 } });
  await prisma.employee.deleteMany({ where: { id: { in: created.employees } } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  server?.close();
  await prisma.$disconnect();
});

const row = (platform: string, followers: number, extra: object = {}) => ({ platform, followers, reach: 1000, engagements: 50, ...extra });

test("only the owner and leadership can enter numbers; validation and future months are refused", async () => {
  const body = { stats: [row("Instagram", 1200), row("LinkedIn", 300)] };
  assert.equal((await call("PUT", `/scores/social/${PAST}`, tok.plain, body)).status, 403);
  assert.equal((await call("PUT", `/scores/social/${PAST}`, tok.content, body)).status, 403, "Content access alone isn't enough");
  assert.equal((await call("PUT", `/scores/social/2999-01`, tok.admin, body)).status, 400, "future month");
  assert.equal((await call("PUT", `/scores/social/bad`, tok.admin, body)).status, 400);
  assert.equal((await call("PUT", `/scores/social/${PAST}`, tok.admin, { stats: [row("TikTok", 5)] })).status, 400, "unknown platform");
  assert.equal((await call("PUT", `/scores/social/${PAST}`, tok.admin, { stats: [row("Instagram", -5)] })).status, 400);
  assert.equal((await call("PUT", `/scores/social/${PAST}`, tok.owner, body)).status, 200);
});

test("saving again updates in place; the note is kept, replaced, and cleared when left blank", async () => {
  await call("PUT", `/scores/social/${PAST}`, tok.owner, { stats: [row("Instagram", 1300)], note: "Reels did well" });
  let r = await call("GET", "/scores/social", tok.admin);
  const ig = r.body.stats.filter((s: any) => s.month === PAST && s.platform === "Instagram");
  assert.equal(ig.length, 1); assert.equal(ig[0].followers, 1300);
  assert.equal(r.body.notes[PAST].text, "Reels did well");
  await call("PUT", `/scores/social/${PAST}`, tok.admin, { stats: [row("Instagram", 1300)] });
  r = await call("GET", "/scores/social", tok.admin);
  assert.equal(r.body.notes[PAST], undefined, "blank note clears it");
});

test("reads: Admin, Content and the owner can; a plain employee can't; canUpdate follows owner/leadership", async () => {
  assert.equal((await call("GET", "/scores/social", tok.plain)).status, 403);
  assert.equal((await call("GET", "/scores/social", tok.content)).body.canUpdate, false);
  const o = await call("GET", "/scores/social", tok.owner);
  assert.equal(o.status, 200); assert.equal(o.body.canUpdate, true); assert.equal(o.body.owner.id, ownerId);
  assert.equal((await call("GET", "/scores/social", tok.admin)).body.canUpdate, true);
});

test("status: the owner is told this month is pending until someone saves it", async () => {
  let s = await call("GET", "/scores/social/status", tok.owner);
  assert.deepEqual({ isOwner: s.body.isOwner, pending: s.body.pending }, { isOwner: true, pending: true });
  assert.equal((await call("GET", "/scores/social/status", tok.plain)).body.isOwner, false);
  await call("PUT", `/scores/social/${NOW}`, tok.owner, { stats: [row("Instagram", 10), row("LinkedIn", 5)] });
  s = await call("GET", "/scores/social/status", tok.owner);
  assert.equal(s.body.pending, false);
});

test("owner setting: leadership only, a real current employee", async () => {
  assert.equal((await call("PUT", "/scores/social-owner", tok.owner, { employeeId: otherId })).status, 403);
  assert.equal((await call("PUT", "/scores/social-owner", tok.admin, { employeeId: "nope" })).status, 400);
  assert.equal((await call("PUT", "/scores/social-owner", tok.admin, { employeeId: otherId })).status, 200);
  assert.equal((await call("GET", "/scores/social", tok.plain)).body.canUpdate, true, "the new owner can now update");
  assert.equal((await call("PUT", `/scores/social/${PAST}`, tok.owner, { stats: [row("Instagram", 1)] })).status, 403, "the old owner can't");
});
