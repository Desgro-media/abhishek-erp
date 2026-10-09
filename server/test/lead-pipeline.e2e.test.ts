/**
 * Marketing > Leads: pipeline stages, Lost, and the one-off backfill of old leads.
 *   TEST_DATABASE_URL=postgresql://.../desgro_erp_test npm run test:e2e
 * Same throwaway-DB guard as the other e2e files.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
let tok: { admin: string; head: string; repA: string; repB: string; finance: string };
let names: { repA: string; repB: string };
const run = `p${Date.now().toString(36)}`;
const today = new Date().toISOString().slice(0, 10);
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
  const [admin, head, a, b, finance] = [await mk("admin", ["ADMIN"]), await mk("head", ["SALES_HEAD"]), await mk("repa", ["SALES"]), await mk("repb", ["SALES"]), await mk("finance", ["FINANCE"])];
  tok = { admin: admin.token, head: head.token, repA: a.token, repB: b.token, finance: finance.token };
  names = { repA: a.u.name, repB: b.u.name };
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(async () => { server?.close(); await prisma?.$disconnect(); });

const newLead = async (token: string, owner?: string) => {
  const r = await call("POST", "/crm/leads", token, { name: `Lead ${run} ${++seq}`, source: "test", serviceInterested: "Web Development", leadOwner: owner });
  assert.equal(r.status, 201);
  return r.body.lead as { id: string; stage: string };
};
const db = (id: string) => prisma.lead.findUniqueOrThrow({ where: { id } });

test("a new lead starts at New with nothing set; the board data comes back on the list", async () => {
  const l = await newLead(tok.repA, names.repA);
  assert.equal(l.stage, "NEW");
  const row = await db(l.id);
  assert.equal(row.stageSetBy, null);
  assert.equal(row.lostReason, null);
  const listed = (await call("GET", "/crm/leads", tok.repA)).body.leads.find((x: any) => x.id === l.id);
  assert.equal(listed.stage, "NEW");
});

test("stage moves: a rep moves their own; status stays in step; audited; same-stage is a no-op; bad stages refused", async () => {
  const l = await newLead(tok.repA, names.repA);
  const mv = (stage: string, t = tok.repA) => call("PATCH", `/crm/leads/${l.id}/stage`, t, { stage });

  assert.equal((await mv("CONTACTED")).status, 200);
  assert.equal((await db(l.id)).status, "CONTACTED");
  assert.equal((await mv("MEETING")).status, 200);
  assert.equal((await db(l.id)).status, "QUALIFIED", "meeting or later counts as Qualified for the Dashboard card");
  const r = await mv("NEGOTIATION");
  assert.equal(r.body.lead.stage, "NEGOTIATION");
  const row = await db(l.id);
  assert.equal(row.stageSetBy, names.repA);
  assert.ok(row.stageChangedAt);

  const audits = await prisma.auditLog.findMany({ where: { action: "CRM_LEAD_STAGE", entityId: l.id }, orderBy: { createdAt: "asc" } });
  assert.equal(audits.length, 3);
  assert.equal((audits[2].beforeData as any).stage, "MEETING");
  assert.equal((audits[2].afterData as any).stage, "NEGOTIATION");

  assert.equal((await mv("NEGOTIATION")).status, 200);
  assert.equal(await prisma.auditLog.count({ where: { action: "CRM_LEAD_STAGE", entityId: l.id } }), 3, "no-op writes nothing");

  for (const bad of ["WON", "LOST", "won", "", "NOPE"]) assert.equal((await mv(bad)).status, 400, `stage ${bad}`);
  assert.equal((await call("PATCH", `/crm/leads/${l.id}/stage`, tok.repA, {})).status, 400);
  assert.equal((await db(l.id)).stage, "NEGOTIATION");
});

test("who may move a lead: another rep no; an unclaimed lead needs claiming first for a rep; Admin / Sales Head any; Finance no", async () => {
  const mine = await newLead(tok.repA, names.repA);
  const open = await newLead(tok.admin);
  const mv = (id: string, t: string | null) => call("PATCH", `/crm/leads/${id}/stage`, t, { stage: "CONTACTED" });
  assert.equal((await mv(mine.id, null)).status, 401);
  assert.equal((await mv(mine.id, tok.finance)).status, 403);
  assert.equal((await mv(mine.id, tok.repB)).status, 403);
  assert.equal((await mv(open.id, tok.repA)).status, 403, "unclaimed: claim first");
  assert.equal((await db(open.id)).stage, "NEW");
  assert.equal((await mv(mine.id, tok.head)).status, 200);
  assert.equal((await mv(open.id, tok.admin)).status, 200);
  assert.equal((await call("PATCH", "/crm/leads/00000000-0000-0000-0000-000000000000/stage", tok.admin, { stage: "NEW" })).status, 404);
  // once claimed it's theirs
  await call("PATCH", `/crm/leads/${open.id}`, tok.repA, { leadOwner: names.repA });
  assert.equal((await mv(open.id, tok.repA)).status, 200);
});

test("Lost: reason from the list, optional note; refused otherwise; reopening clears the reason; audited", async () => {
  const l = await newLead(tok.repA, names.repA);
  const lost = (b: unknown, t = tok.repA) => call("POST", `/crm/leads/${l.id}/lost`, t, b);
  for (const bad of [{}, { reason: "Because" }, { reason: "Not recorded (migrated)" }, { reason: "Budget", note: "x".repeat(501) }, { reason: "budget" }]) {
    assert.equal((await lost(bad)).status, 400, JSON.stringify(bad).slice(0, 50));
  }
  assert.equal((await lost({ reason: "Budget" }, tok.repB)).status, 403);
  assert.equal((await db(l.id)).stage, "NEW", "nothing stored by the refusals");

  const r = await lost({ reason: "Went with a competitor", note: "  chose Acme  " });
  assert.equal(r.status, 200);
  const row = await db(l.id);
  assert.deepEqual([row.stage, row.status, row.lostReason, row.lostNote], ["LOST", "LOST", "Went with a competitor", "chose Acme"]);
  assert.equal((await lost({ reason: "Budget" })).status, 409, "already lost");
  const audit = await prisma.auditLog.findFirst({ where: { action: "CRM_LEAD_LOST", entityId: l.id } });
  assert.equal((audit!.afterData as any).reason, "Went with a competitor");

  const back = await call("PATCH", `/crm/leads/${l.id}/stage`, tok.repA, { stage: "CONTACTED" });
  assert.equal(back.status, 200);
  const re = await db(l.id);
  assert.deepEqual([re.stage, re.status, re.lostReason, re.lostNote], ["CONTACTED", "CONTACTED", null, null]);
});

test("the older PATCH status still works and keeps the stage in step", async () => {
  const l = await newLead(tok.repA, names.repA);
  assert.equal((await call("PATCH", `/crm/leads/${l.id}`, tok.repA, { status: "LOST" })).status, 200);
  assert.deepEqual([(await db(l.id)).stage, (await db(l.id)).status], ["LOST", "LOST"]);
  assert.equal((await call("PATCH", `/crm/leads/${l.id}`, tok.repA, { status: "QUALIFIED" })).status, 200);
  const r = await db(l.id);
  assert.deepEqual([r.stage, r.lostReason], ["MEETING", null]);
  // edits that don't mention status leave the stage alone
  await call("PATCH", `/crm/leads/${l.id}`, tok.repA, { phone: "999" });
  assert.equal((await db(l.id)).stage, "MEETING");
});

test("quote -> invoice conversion makes the lead Won (and Won leads can't be moved or marked lost)", async () => {
  const l = await newLead(tok.repA, names.repA);
  const q = await call("POST", "/crm/quotes", tok.repA, { leadId: l.id, title: `Q ${run}`, items: [{ dept: "Web Development", amount: 10_000 }] });
  assert.equal(q.status, 201);
  assert.equal((await call("POST", `/crm/quotes/${q.body.quote.id}/send`, tok.repA)).status, 200);
  const conv = await call("POST", `/crm/quotes/${q.body.quote.id}/convert-to-invoice`, tok.repA, { issuedAt: today, dueAt: today });
  assert.equal(conv.status, 201);
  const row = await db(l.id);
  assert.deepEqual([row.stage, row.status, row.stageSetBy], ["WON", "CONVERTED", "Converted via quote"]);
  assert.ok(row.convertedClientId);
  assert.equal((await call("PATCH", `/crm/leads/${l.id}/stage`, tok.repA, { stage: "CONTACTED" })).status, 409);
  assert.equal((await call("POST", `/crm/leads/${l.id}/lost`, tok.admin, { reason: "Budget" })).status, 409);
  assert.equal((await db(l.id)).stage, "WON");
});

// ---- backfill of leads that predate stages ----
const exec = (...args: string[]) =>
  execFileSync("npx", ["tsx", "scripts/backfill-lead-stages.ts", ...args], { env: { ...process.env, DATABASE_URL: testDbUrl! }, encoding: "utf8" });

test("backfill: the five rules, dry run writes nothing, apply is idempotent, undo reverts only its own", async () => {
  const mkLead = (label: string, d: Record<string, unknown>) =>
    prisma.lead.create({ data: { leadCode: `BF-${run}-${label}`, name: `BF ${label} ${run}`, source: "test", serviceInterested: "Web Development", ...d } as any });
  const client = await prisma.client.create({ data: { clientCode: `BFC-${run}`, name: `BF client ${run}`, services: [], onboardedAt: new Date() } });
  const quote = (leadId: string, status: any, n: string) => prisma.quote.create({ data: { quoteCode: `BFQ-${run}-${n}`, leadId, title: n, status } });

  const f = {
    won1: await mkLead("won1", { status: "CONVERTED", convertedClientId: client.id, leadOwner: names.repA }),
    won2: await mkLead("won2", { status: "NEW", convertedClientId: client.id, leadOwner: names.repA }),
    lost: await mkLead("lost", { status: "LOST", leadOwner: names.repA }),
    lostNoOwner: await mkLead("lostNoOwner", { status: "LOST" }),
    new1: await mkLead("new1", {}),
    proposal: await mkLead("proposal", { leadOwner: names.repA }),
    proposalFin: await mkLead("proposalFin", { leadOwner: names.repA }),
    contacted: await mkLead("contacted", { leadOwner: names.repA }),
    draftOnly: await mkLead("draftOnly", { leadOwner: names.repA }),
    lostQuoteOnly: await mkLead("lostQuoteOnly", { leadOwner: names.repA }),
    unownedSent: await mkLead("unownedSent", {}),
    qualifiedOwned: await mkLead("qualifiedOwned", { status: "QUALIFIED", leadOwner: names.repA }),
    manual: await mkLead("manual", { leadOwner: names.repA }),
  };
  await quote(f.proposal.id, "SENT", "a");
  await quote(f.proposalFin.id, "SUBMITTED_TO_FINANCE", "b");
  await quote(f.draftOnly.id, "DRAFT", "c");
  await quote(f.lostQuoteOnly.id, "LOST", "d");
  await quote(f.unownedSent.id, "SENT", "e");

  const expected: Record<string, string> = {
    won1: "WON", won2: "WON", lost: "LOST", lostNoOwner: "LOST", new1: "NEW", proposal: "PROPOSAL_SENT", proposalFin: "PROPOSAL_SENT",
    contacted: "CONTACTED", draftOnly: "CONTACTED", lostQuoteOnly: "CONTACTED", unownedSent: "NEW", qualifiedOwned: "CONTACTED", manual: "CONTACTED",
  };
  const stages = async () => Object.fromEntries(await Promise.all(Object.entries(f).map(async ([k, l]) => [k, (await db(l.id)).stage])));

  // a person stages one of them by hand BEFORE the backfill: it must be left alone
  await call("PATCH", `/crm/leads/${f.manual.id}/stage`, tok.repA, { stage: "NEGOTIATION" });

  // dry run: prints counts, changes nothing
  const before = await prisma.lead.count({ where: { stageSetBy: { not: null } } });
  const dry = exec();
  assert.match(dry, /DRY RUN \(read-only\)/);
  assert.match(dry, /Nothing was changed/);
  assert.equal(await prisma.lead.count({ where: { stageSetBy: { not: null } } }), before);
  assert.ok((await stages()).won1 === "NEW", "still the default after a dry run");

  // apply
  assert.match(exec("--apply"), /Staged \d+ lead/);
  const after = await stages();
  for (const [k, want] of Object.entries(expected)) {
    if (k === "manual") continue;
    assert.equal(after[k], want, k);
  }
  assert.equal(after.manual, "NEGOTIATION", "a stage a person set is never overwritten");
  assert.equal((await db(f.lost.id)).lostReason, "Not recorded (migrated)");
  assert.equal((await db(f.lostNoOwner.id)).lostReason, "Not recorded (migrated)");
  assert.equal((await db(f.won1.id)).stageSetBy, "migration");
  assert.equal((await db(f.contacted.id)).status, "NEW", "the older status field is left untouched");
  assert.equal(await prisma.auditLog.count({ where: { action: "CRM_LEAD_STAGE_BACKFILL" } }) >= 1, true);

  // idempotent: a second apply changes nothing
  assert.match(exec("--apply"), /Staged 0 lead/);
  assert.deepEqual(await stages(), after);

  // a person moves a migrated lead afterwards; undo must leave that one alone and revert the rest
  await call("PATCH", `/crm/leads/${f.proposal.id}/stage`, tok.repA, { stage: "NEGOTIATION" });
  assert.match(exec("--undo"), /Reverted \d+ lead/);
  const undone = await stages();
  for (const k of Object.keys(f)) {
    if (k === "manual") assert.equal(undone[k], "NEGOTIATION", "manual stage survives undo");
    else if (k === "proposal") assert.equal(undone[k], "NEGOTIATION", "a migrated lead a person moved since is theirs now");
    else assert.equal(undone[k], "NEW", k);
  }
  assert.equal((await db(f.lost.id)).lostReason, null);
  assert.equal((await db(f.won1.id)).stageSetBy, null);

  // and after an undo the backfill can be re-applied cleanly
  assert.match(exec("--apply"), /Staged \d+ lead/);
  assert.equal((await db(f.won1.id)).stage, "WON");

  await prisma.quote.deleteMany({ where: { quoteCode: { startsWith: `BFQ-${run}` } } });
  await prisma.lead.deleteMany({ where: { leadCode: { startsWith: `BF-${run}` } } });
  await prisma.client.delete({ where: { id: client.id } });
});
