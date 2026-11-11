/**
 * Marketing > Leads > Meta sheet: tab mapping, import (once only), old/test rows skipped, access rules.
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

let server: Server, base: string;
let prisma: typeof import("../src/db/prisma").prisma;
let svc: typeof import("../src/services/leadSheet");
let tok: { admin: string; head: string; rep: string };
const run = `s${Date.now().toString(36)}`;
// Phone numbers are unique per run: leads from earlier runs stay in the test DB and the importer rejects repeat numbers.
const PB = String(Date.now()).slice(-8);
const ph = (n: number) => `9${PB}${n}`; // 10 digits
const SHEET = "1CvKPMuJM5FRfaPSlNwuayWCfiBB96rdP01AfSE5MllA";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET}/edit?gid=0#gid=0`;

const today = new Date().toISOString().slice(0, 10);
const old = "2020-01-01T10:00:00-05:00";
const fresh = new Date().toISOString();
const HEADER = "id,created_time,ad_name,campaign_name,form_name,platform,what_is_your_budget?,full_name,phone_number,city,lead_status";
const csvWeb = [
  HEADER,
  `l:test-${run}-0,${fresh},,,,,<test lead: dummy data for budget>,<test lead: dummy data for full_name>,<test lead: dummy data for phone_number>,<test lead: dummy data for city>,CREATED`,
  `l:${run}-1,${fresh},Web Dev ad,Web camp,Form A,ig,"₹40,000",Asha Nair,p:+91${ph(1)},Kochi,CREATED`,
  `l:${run}-2,${fresh},Web Dev ad,Web camp,Form A,fb,"₹75,000, more",Ravi K,p:+91${ph(2)},"Calicut, Kerala",CREATED`,
  `l:${run}-3,${old},Web Dev ad,Web camp,Form A,fb,x,Old Person,p:+91${ph(3)},Pune,CREATED`,
].join("\n");
let webCsv = csvWeb;
let failPb = false;

const fake = {
  tabs: async () => [{ gid: "0", name: "Web kerala" }, { gid: "11", name: "PB NEW" }, { gid: "22", name: "PM sheet" }],
  csv: async (_s: string, gid: string) => {
    if (gid === "0") return webCsv;
    if (gid === "22") return `${HEADER.replace("phone_number", "phone")}\nl:${run}-9,${fresh},,,,,x,Pm Person,p:+91${ph(9)},Delhi,CREATED`;
    if (gid === "11") { if (failPb) throw new Error("PB tab broke"); return HEADER; }
    throw new Error("unknown tab");
  },
};

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  ({ prisma } = await import("../src/db/prisma"));
  svc = await import("../src/services/leadSheet");
  const { __setLeadSheetSource } = await import("../src/controllers/crm/leadSheet.controller");
  __setLeadSheetSource(fake);
  const { app } = await import("../src/app");
  const { signAccessToken } = await import("../src/utils/tokens");
  const mk = async (label: string, roles: any[]) => {
    const u = await prisma.user.create({ data: { name: `${label} ${run}`, email: `${label}-${run}@test.local`, passwordHash: "x", roles } });
    return signAccessToken({ sub: u.id, email: u.email, name: u.name, roles, department: null, employeeId: null });
  };
  tok = { admin: await mk("admin", ["ADMIN"]), head: await mk("head", ["SALES_HEAD"]), rep: await mk("rep", ["SALES"]) };
  await prisma.leadSheetTab.deleteMany(); await prisma.leadSheetConfig.deleteMany();
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(async () => { server?.close(); await prisma?.$disconnect(); });

test("pure helpers: sheet id from URL, CSV quoting, service guess from tab name", () => {
  assert.equal(svc.extractSheetId(SHEET_URL), SHEET);
  assert.equal(svc.extractSheetId(SHEET), SHEET);
  assert.equal(svc.extractSheetId("hello"), null);
  assert.deepEqual(svc.parseCsv('a,"b,c","d ""q"""\n1,2,3\n'), [["a", "b,c", 'd "q"'], ["1", "2", "3"]]);
  assert.equal(svc.guessService("Web kerala"), "Web Development");
  assert.equal(svc.guessService("GRAPHIC KERALA"), "Graphic Design");
  assert.equal(svc.guessService("PM sheet"), "Performance Marketing");
  assert.equal(svc.phoneKey("+91 99999-12345"), "9999912345");
  assert.equal(svc.phoneKey("p:09999912345"), "9999912345");
  assert.equal(svc.phoneKey("123"), null);
  assert.equal(svc.guessService("consultation"), "Marketing Consultation");
  assert.equal(svc.guessService("PB NEW"), "Personal Branding");
  assert.equal(svc.guessService("MASTER PAKAGE NEW"), "Master Package");
  assert.equal(svc.guessService("ERP"), "ERP", "a tab nobody recognises is filed under its own name");
});

test("only Admin / Sales Head can see or change it; a rep cannot", async () => {
  assert.equal((await call("GET", "/crm/lead-sheet", tok.rep)).status, 403);
  assert.equal((await call("PUT", "/crm/lead-sheet", tok.rep, { sheetUrl: SHEET_URL })).status, 403);
  assert.equal((await call("POST", "/crm/lead-sheet/sync", tok.rep)).status, 403);
  assert.equal((await call("GET", "/crm/lead-sheet", tok.head)).status, 200);
});

test("connecting lists every tab with a service (own label where it is not an ERP service); bad link refused", async () => {
  assert.equal((await call("PUT", "/crm/lead-sheet", tok.admin, { sheetUrl: "nonsense" })).status, 400);
  const r = await call("PUT", "/crm/lead-sheet", tok.head, { sheetUrl: SHEET_URL, autoSync: false, importFrom: "2026-01-01" });
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.body.tabs.map((t: any) => [t.name, t.service]));
  assert.deepEqual(by, { "Web kerala": "Web Development", "PB NEW": "Personal Branding", "PM sheet": "Performance Marketing" });
  assert.equal(r.body.config.sheetId, SHEET);
  assert.equal(r.body.config.autoSync, false, "saved as the admin chose");
});

test("sync imports new rows once: right service, Open queue, test + old rows skipped, original date kept", async () => {
  const first = await call("POST", "/crm/lead-sheet/sync", tok.admin);
  assert.equal(first.status, 200);
  assert.equal(first.body.summary.created, 3, "2 web + 1 PM; the test row and the 2020 row are not imported");
  assert.equal(first.body.summary.skippedOld, 1);
  const leads = await prisma.lead.findMany({ where: { metaLeadId: { startsWith: `l:${run}` } }, orderBy: { metaLeadId: "asc" } });
  assert.equal(leads.length, 3);
  const asha = leads.find((l) => l.name === "Asha Nair")!;
  assert.equal(asha.source, "Meta");
  assert.equal(asha.leadOwner, null);
  assert.equal(asha.serviceInterested, "Web Development");
  assert.equal(asha.phone, `+91${ph(1)}`);
  assert.match(asha.notes!, /City: Kochi/);
  assert.match(asha.notes!, /what is your budget\?: ₹40,000/);
  assert.equal(leads.find((l) => l.name === "Pm Person")!.serviceInterested, "Performance Marketing");
  assert.equal(await prisma.lead.count({ where: { name: "Old Person", metaLeadId: { startsWith: `l:${run}` } } }), 0);

  const again = await call("POST", "/crm/lead-sheet/sync", tok.admin);
  assert.equal(again.body.summary.created, 0, "running again adds nothing");
  assert.equal(await prisma.lead.count({ where: { metaLeadId: { startsWith: `l:${run}` } } }), 3);
});

test("a row added to the sheet later is picked up; a tab can be re-labelled or skipped", async () => {
  webCsv = csvWeb + `\nl:${run}-4,${fresh},,,,,x,Late Joiner,p:+91${ph(4)},Goa,CREATED`;
  assert.equal((await call("POST", "/crm/lead-sheet/sync", tok.head)).body.summary.created, 1);

  const pb = (await call("GET", "/crm/lead-sheet", tok.head)).body.tabs.find((t: any) => t.name === "PB NEW");
  const r = await call("PUT", "/crm/lead-sheet", tok.head, { tabs: [{ gid: pb.gid, service: "Brand Packages" }, { gid: "22", service: null }] });
  assert.equal(r.body.tabs.find((t: any) => t.name === "PB NEW").service, "Brand Packages");
  assert.equal(r.body.tabs.find((t: any) => t.name === "PM sheet").service, null);
});

test("a tab that errors is reported, others still import", async () => {
  failPb = true;
  const r = await call("POST", "/crm/lead-sheet/sync", tok.admin);
  assert.equal(r.status, 200);
  assert.match(r.body.summary.tabs.find((t: any) => t.name === "PB NEW").error, /PB tab broke/);
});

test("daily intake: counts per service per day, from the lead's own date", async () => {
  const r = await call("GET", "/crm/lead-sheet", tok.admin);
  const { days, counts } = r.body.daily;
  assert.equal(days.length, 7);
  assert.equal(days[6], new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10));
  assert.ok(counts["Web Development"][days[6]] >= 3, "today's web leads are counted");
});

test("a lead with a sheet-only service converts to a client without that label as a client service", async () => {
  const lead = await prisma.lead.create({ data: { leadCode: `T-${run}`, name: `PB Client ${run}`, source: "Meta", serviceInterested: "Personal Branding", metaLeadId: `l:${run}-pbconv` } });
  const { convertLeadToClient } = await import("../src/services/leadPayments");
  const res = await prisma.$transaction((tx) => convertLeadToClient(tx, lead, { onboardedAt: new Date() }));
  const client = await prisma.client.findUniqueOrThrow({ where: { id: res.clientId } });
  assert.deepEqual(client.services, []);
});

test("a fresh connect turns auto-sync on by default", async () => {
  await prisma.leadSheetConfig.deleteMany();
  const r = await call("PUT", "/crm/lead-sheet", tok.admin, { sheetUrl: SHEET_URL });
  assert.equal(r.body.config.autoSync, true);
});

test("duplicates are rejected: same phone as an existing lead, or repeated within the sheet", async () => {
  await prisma.leadSheetTab.updateMany({ where: { gid: "22" }, data: { service: "Performance Marketing" } });
  failPb = false;
  webCsv = csvWeb
    + `\nl:${run}-5,${fresh},,,,,x,Asha Again,+91 ${ph(1).slice(0,5)} ${ph(1).slice(5)},Kochi,CREATED`            // Asha Nair's number, different Meta id and format
    + `\nl:${run}-6,${fresh},,,,,x,Fresh Person,p:+91${ph(6)},Goa,CREATED`
    + `\nl:${run}-7,${fresh},,,,,x,Fresh Person Twice,p:0${ph(6)},Goa,CREATED`;       // same number twice in one run
  const r = await call("POST", "/crm/lead-sheet/sync", tok.admin);
  assert.equal(r.body.summary.created, 1, "only Fresh Person is new");
  assert.ok(r.body.summary.duplicates >= 2, "Asha Again and Fresh Person Twice are rejected");
  assert.equal(await prisma.lead.count({ where: { name: { in: ["Asha Again", "Fresh Person Twice"] } } }), 0);
  assert.equal(await prisma.lead.count({ where: { phone: { contains: ph(6) } } }), 1);
  const again = await call("POST", "/crm/lead-sheet/sync", tok.admin);
  assert.equal(again.body.summary.created, 0);
});
