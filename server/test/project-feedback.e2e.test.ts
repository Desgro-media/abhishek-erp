/**
 * Client feedback: a website is rated once per delivered project (not monthly).
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
let tok: { admin: string; clients: string; repA: string; repB: string; finance: string; content: string };
let names: { repA: string; repB: string };
let pm: { id: string }; // PM client in repA's book
let plain: { id: string }; // non-PM client in repA's book
let other: { id: string }; // PM client in repB's book
const run = `m${Date.now().toString(36)}`;

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
  const [admin, clients, a, b, finance, content] = [await mk("admin", ["ADMIN"]), await mk("clients", ["CLIENTS"]), await mk("repa", ["SALES"]), await mk("repb", ["SALES"]), await mk("finance", ["FINANCE"]), await mk("content", ["CONTENT"])];
  tok = { admin: admin.token, clients: clients.token, repA: a.token, repB: b.token, finance: finance.token, content: content.token };
  names = { repA: a.u.name, repB: b.u.name };
  const mkClient = (label: string, services: string[], salesPerson: string, n: number) =>
    prisma.client.create({ data: { clientCode: `CAM-${run}-${n}`, name: `${label} ${run}`, services, salesPerson, onboardedAt: new Date() } });
  pm = await mkClient("PM client", ["Web Development", "Graphic Design"], names.repA, 1);
  plain = await mkClient("Plain client", ["Graphic Design"], names.repA, 2);
  other = await mkClient("Other rep PM", ["Web Development"], names.repB, 3);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(async () => {
  await prisma?.client.deleteMany({ where: { id: { in: [pm?.id, plain?.id, other?.id].filter(Boolean) } } });
  server?.close();
  await prisma?.$disconnect();
});

const C = (c: { id: string }, rest = "") => `/crm/clients/${c.id}${rest}`;
const month = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7);
async function project(clientId: string, name: string, statuses: ("TODO" | "DONE")[]) {
  const projectId = `proj-${name}-${run}`;
  for (const [i, status] of statuses.entries())
    await prisma.clientTask.create({ data: { clientId, title: `t${i}`, service: "Web Development", stage: status === "DONE" ? "Done" : "Open", status, projectId, projectName: name, projectKind: "Static website", dueAt: new Date("2026-09-10"), doneAt: status === "DONE" ? new Date("2026-09-12") : null } });
  return projectId;
}

test("a website can't be rated until a project is delivered; then once per project, replaced on re-rating; monthly services unaffected", async () => {
  const log = (ratings: unknown[], t = tok.admin) => call("POST", C(pm, "/feedback"), t, { ratings });
  assert.equal((await log([{ dept: "Web Development", rating: 4 }])).status, 400, "nothing delivered yet");
  const p1 = await project(pm.id, "Site A", ["DONE", "TODO"]);
  assert.equal((await log([{ dept: "Web Development", rating: 4 }])).status, 400, "a project with open tasks isn't delivered");
  await prisma.clientTask.updateMany({ where: { projectId: p1 }, data: { status: "DONE", stage: "Done", doneAt: new Date("2026-09-14") } });
  assert.equal((await log([{ dept: "Web Development", rating: 4, comment: "great" }, { dept: "Graphic Design", rating: 5 }])).status, 201);
  const rows = await prisma.clientFeedback.findMany({ where: { clientId: pm.id }, orderBy: { dept: "asc" } });
  assert.deepEqual(rows.map((r) => [r.dept, r.projectId]), [["Graphic Design", null], ["Web Development", p1]]);
  assert.equal(rows[1].month, month(), "counts in the month it was rated");
  await log([{ dept: "Web Development", rating: 2 }]);
  assert.equal(await prisma.clientFeedback.count({ where: { projectId: p1 } }), 1, "re-rating replaces");
  assert.equal((await prisma.clientFeedback.findFirstOrThrow({ where: { projectId: p1 } })).rating, 2);
  assert.equal((await log([{ dept: "Web Development", rating: 3, projectId: "someone-elses" }])).status, 400, "a project that isn't this client's / isn't delivered");
  // a second delivered project is asked for next, on its own
  const p2 = await project(pm.id, "Site B", ["DONE"]);
  await log([{ dept: "Web Development", rating: 5 }]);
  assert.deepEqual((await prisma.clientFeedback.findMany({ where: { clientId: pm.id, dept: "Web Development" }, orderBy: { rating: "asc" } })).map((r) => [r.projectId, r.rating]), [[p1, 2], [p2, 5]]);
  // the same month's monthly rating for another service is still one per month
  await log([{ dept: "Graphic Design", rating: 1 }]);
  assert.equal(await prisma.clientFeedback.count({ where: { clientId: pm.id, dept: "Graphic Design" } }), 1);
});

test("public link: the website is on the form only once delivered, names the project, and the rating is pinned to it", async () => {
  await prisma.clientFeedback.deleteMany({ where: { clientId: other.id } });
  const link = (await call("POST", C(other, "/feedback-link"), tok.admin, { depts: ["Web Development"] }));
  assert.equal(link.status, 200);
  const token = link.body.link.token;
  const none = (await call("GET", `/public/client-feedback/${token}`, null)).body;
  assert.deepEqual(none.depts, [], "nothing delivered yet");
  assert.equal((await call("POST", `/public/client-feedback/${token}`, null, { ratings: [{ dept: "Web Development", rating: 5 }] })).status, 400);
  const p = await project(other.id, "Shop", ["DONE", "DONE"]);
  const view = (await call("GET", `/public/client-feedback/${token}`, null)).body;
  assert.deepEqual(view.depts, ["Web Development"]);
  assert.equal(view.projects["Web Development"].title, "Shop");
  assert.equal((await call("POST", `/public/client-feedback/${token}`, null, { ratings: [{ dept: "Web Development", rating: 4 }], name: "Anu" })).status, 201);
  assert.equal((await prisma.clientFeedback.findFirstOrThrow({ where: { projectId: p } })).by, "Anu");
  assert.deepEqual((await call("GET", `/public/client-feedback/${token}`, null)).body.rated, { "Web Development": 4 });
});
