/**
 * Clients > client detail > Services boards (cards per service, project task lists).
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
  pm = await mkClient("PM client", ["Web Development", "Production"], names.repA, 1);
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
let card: string;

test("boards config is served to any signed-in login", async () => {
  const r = await call("GET", "/crm/service-boards", tok.finance);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.boards["Web Development"].stages, ["Open", "In progress", "Review", "Done"]);
  assert.equal((await call("GET", "/crm/service-boards", null)).status, 401);
});

test("access: no token 401; Finance / Content-only 403; a rep only on their own client; Admin / Clients on any", async () => {
  const b = { service: "Production", title: "Reel" };
  assert.equal((await call("POST", C(pm, "/board-cards"), null, b)).status, 401);
  for (const t of [tok.finance, tok.content]) assert.equal((await call("POST", C(pm, "/board-cards"), t, b)).status, 403);
  assert.equal((await call("POST", C(other, "/board-cards"), tok.repA, { ...b, service: "Web Development" })).status, 403);
  assert.equal((await call("POST", C(other, "/board-cards"), tok.clients, { ...b, service: "Web Development" })).status, 201);
});

test("create: service must be one the client takes; column / type / platform / dates validated; status follows the column", async () => {
  const b = { service: "Production", title: "Reel 1", type: "Reel", platforms: ["Instagram"], due: "2026-09-20" };
  assert.equal((await call("POST", C(plain, "/board-cards"), tok.repA, { ...b, service: "Web Development" })).status, 400, "client doesn't take it");
  assert.equal((await call("POST", C(pm, "/board-cards"), tok.repA, { ...b, service: "Performance Marketing" })).status, 400, "no board");
  for (const x of [{ stage: "Nope" }, { type: "Hologram" }, { platforms: ["MySpace"] }, { due: "2026-02-31" }, { start: "2026-09-10", due: "2026-09-01" }, { title: "" }])
    assert.equal((await call("POST", C(pm, "/board-cards"), tok.repA, { ...b, ...x })).status, 400, JSON.stringify(x));
  const r = await call("POST", C(pm, "/board-cards"), tok.repA, b);
  assert.equal(r.status, 201);
  card = r.body.task.id;
  assert.equal(r.body.task.stage, "Idea");
  assert.equal(r.body.task.status, "TODO");
  const done = await call("POST", C(pm, "/board-cards"), tok.repA, { ...b, stage: "Published" });
  assert.equal(done.body.task.status, "DONE");
  assert.ok(done.body.task.doneAt);
});

test("move: column sets status (To Do / In Progress / Review / Done) and stamps or clears doneAt; edits validated", async () => {
  const mv = (stage: string) => call("PATCH", `/crm/board-cards/${card}`, tok.repA, { stage });
  assert.equal((await mv("Edit")).body.task.status, "IN_PROGRESS");
  assert.equal((await mv("Review")).body.task.status, "REVIEW");
  const d = await mv("Published");
  assert.equal(d.body.task.status, "DONE");
  assert.ok(d.body.task.doneAt);
  const back = await mv("Scripting");
  assert.equal(back.body.task.doneAt, null);
  assert.equal((await mv("Nope")).status, 400);
  assert.equal((await call("PATCH", `/crm/board-cards/${card}`, tok.repA, { start: "2026-09-30", due: "2026-09-01" })).status, 400);
  assert.equal((await call("PATCH", `/crm/board-cards/${card}`, tok.repB, { title: "x" })).status, 403, "another rep's client");
  assert.equal((await call("PATCH", `/crm/board-cards/${card}`, tok.finance, { title: "x" })).status, 403);
  const e = await call("PATCH", `/crm/board-cards/${card}`, tok.repA, { title: "Reel v2", clientAssigned: true });
  assert.equal(e.body.task.title, "Reel v2");
  assert.equal(e.body.task.assignedTo, pm ? `PM client ${run}` : "");
  assert.equal(e.body.task.clientAssigned, true);
  assert.equal(e.body.task.stage, "Scripting", "an edit that names no column leaves it where it is");
});

test("a card moved by status elsewhere (My Tasks) lands in the matching column", async () => {
  const r = await call("PATCH", `/crm/tasks/${card}`, tok.admin, { status: "DONE" });
  assert.equal(r.status, 200);
  assert.equal(r.body.task.stage, "Published");
  assert.equal((await call("PATCH", `/crm/tasks/${card}`, tok.admin, { status: "REVIEW" })).body.task.stage, "Review");
});

test("start project: tasks must match the type's list; created in the first column with their days; remove deletes the lot", async () => {
  const boards = (await call("GET", "/crm/service-boards", tok.repA)).body.boards;
  const list: { name: string; days: number }[] = boards["Web Development"].projectTasks["Static website"];
  const tasks = list.map((t, i) => ({ title: t.name, start: `2026-09-${String(7 + i).padStart(2, "0")}`, due: `2026-09-${String(7 + i).padStart(2, "0")}` }));
  const b = { service: "Web Development", type: "Static website", name: "Site", start: "2026-09-07", tasks };
  assert.equal((await call("POST", C(pm, "/board-projects"), tok.repA, { ...b, tasks: tasks.slice(1) })).status, 400, "missing a task");
  assert.equal((await call("POST", C(pm, "/board-projects"), tok.repA, { ...b, type: "Nonsense" })).status, 400);
  assert.equal((await call("POST", C(pm, "/board-projects"), tok.repA, { ...b, tasks: [{ ...tasks[0], title: "Other" }, ...tasks.slice(1)] })).status, 400);
  assert.equal((await call("POST", C(pm, "/board-projects"), tok.repB, b)).status, 403);
  const r = await call("POST", C(pm, "/board-projects"), tok.repA, b);
  assert.equal(r.status, 201);
  assert.equal(r.body.tasks.length, list.length);
  assert.ok(r.body.tasks.every((t: any) => t.stage === "Open" && t.status === "TODO" && t.projectId === r.body.projectId && t.projectName === "Site"));
  assert.deepEqual(r.body.tasks.map((t: any) => t.maxDays), list.map((t) => t.days));
  assert.equal((await call("DELETE", C(other, `/board-projects/${r.body.projectId}`), tok.admin)).status, 404, "never through another client's URL");
  assert.equal((await call("DELETE", C(pm, `/board-projects/${r.body.projectId}`), tok.repA)).status, 204);
  assert.equal(await prisma.clientTask.count({ where: { projectId: r.body.projectId } }), 0);
});

test("delete card: guarded like the client page; audited; the client's other cards are untouched", async () => {
  assert.equal((await call("DELETE", `/crm/board-cards/${card}`, tok.repB)).status, 403);
  assert.equal((await call("DELETE", `/crm/board-cards/${card}`, tok.repA)).status, 204);
  assert.equal((await call("DELETE", `/crm/board-cards/${card}`, tok.repA)).status, 404);
  assert.ok((await prisma.clientTask.count({ where: { clientId: pm.id } })) >= 1);
  assert.equal(await prisma.auditLog.count({ where: { entityId: card, action: "CRM_BOARD_CARD_DELETE" } }), 1);
});
