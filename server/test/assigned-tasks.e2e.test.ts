/**
 * Assigned work is visible to its assignee (by user ID), whatever their role.
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
const run = `a${Date.now().toString(36)}`;
const tok: Record<string, string> = {};
const uid: Record<string, string> = {};
let clientId = "";
const created = { users: [] as string[] };

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const mine = async (who: string) => (await call("GET", "/crm/tasks", tok[who])).body.tasks.filter((t: any) => t.title.includes(run)).map((t: any) => t.title);

before(async () => {
  ({ prisma } = await import("../src/db/prisma"));
  const { app } = await import("../src/app");
  const { signAccessToken } = await import("../src/utils/tokens");
  const mk = async (label: string, roles: any[]) => {
    const u = await prisma.user.create({ data: { name: `${label} ${run}`, email: `${label}-${run}@test.local`, passwordHash: "x", roles } });
    created.users.push(u.id); uid[label] = u.id;
    tok[label] = signAccessToken({ sub: u.id, email: u.email, name: u.name, roles, department: null, employeeId: null });
  };
  await mk("admin", ["ADMIN"]);
  await mk("employee", ["EMPLOYEE"]); // like Fardeen's case, no Sales/Clients role
  await mk("employee2", ["EMPLOYEE"]);
  await mk("sales", ["SALES"]);
  await mk("hr", ["HR"]);
  await mk("content", ["CONTENT"]);
  const c = await prisma.client.create({ data: { clientCode: `T-${run}`, name: `Client ${run}`, services: [], onboardedAt: new Date() } });
  clientId = c.id;
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  await prisma.notification.deleteMany({ where: { userId: { in: created.users } } });
  await prisma.contentItem.deleteMany({ where: { title: { contains: run } } });
  await prisma.client.deleteMany({ where: { id: clientId } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  server?.close();
  await prisma.$disconnect();
});

test("every role sees its own assigned task and only its own", async () => {
  for (const who of ["employee", "hr", "content", "sales"]) {
    const r = await call("POST", `/crm/clients/${clientId}/tasks`, tok.admin, { title: `Task for ${who} ${run}`, assigneeUserId: uid[who], dueAt: "2031-03-01" });
    assert.equal(r.status, 201, who);
  }
  for (const who of ["employee", "hr", "content"]) assert.deepEqual(await mine(who), [`Task for ${who} ${run}`], who);
  assert.equal((await mine("employee2")).length, 0, "an unrelated employee sees nothing");
  assert.equal((await mine("admin")).length, 4, "admin sees everything");
  // A task card exposes the client's id+name only.
  const card = (await call("GET", "/crm/tasks", tok.employee)).body.tasks[0];
  assert.deepEqual(Object.keys(card.client).sort(), ["id", "name"]);
});

test("assignee moves and attaches on their own task; 403 on someone else's; reassign moves it", async () => {
  const t = (await call("POST", `/crm/clients/${clientId}/tasks`, tok.admin, { title: `Move ${run}`, assigneeUserId: uid.employee, dueAt: "2031-03-01" })).body.task;
  const ok = await call("PATCH", `/crm/tasks/${t.id}`, tok.employee, { status: "IN_PROGRESS" });
  assert.equal(ok.status, 200); assert.equal(ok.body.task.status, "IN_PROGRESS");
  assert.equal((await call("POST", `/crm/tasks/${t.id}/attachments`, tok.employee, { name: "a.png", size: 5 })).status, 201);
  assert.equal((await call("PATCH", `/crm/tasks/${t.id}`, tok.employee, { title: "hijack" })).status, 403, "assignee can't edit more than the stage");
  assert.equal((await call("PATCH", `/crm/tasks/${t.id}`, tok.employee2, { status: "DONE" })).status, 403);
  assert.equal((await call("POST", `/crm/tasks/${t.id}/attachments`, tok.employee2, { name: "b.png", size: 5 })).status, 403);

  assert.ok((await mine("employee")).includes(`Move ${run}`));
  assert.equal((await call("PATCH", `/crm/tasks/${t.id}`, tok.admin, { assigneeUserId: uid.employee2 })).status, 200);
  assert.ok(!(await mine("employee")).includes(`Move ${run}`), "old assignee loses it");
  assert.ok((await mine("employee2")).includes(`Move ${run}`), "new assignee gets it");

  const n2 = (await call("GET", "/notifications", tok.employee2)).body;
  assert.ok(n2.notifications.some((n: any) => n.kind === "TASK_ASSIGNED" && n.body.includes(`Move ${run}`)));
  assert.ok((await call("GET", "/notifications", tok.employee)).body.notifications.some((n: any) => n.kind === "TASK_REASSIGNED"));
});

test("content cards: assignee sees and moves their own, not others'", async () => {
  const made = await call("POST", "/content/items", tok.admin, { title: `Reel ${run}`, type: "Reel", platforms: [], dueAt: "2031-03-01", assigneeUserId: uid.employee });
  assert.equal(made.status, 201);
  const id = made.body.item.id;
  assert.equal((await call("GET", "/content/items/mine", tok.employee)).body.items.filter((i: any) => i.title.includes(run)).length, 1);
  assert.equal((await call("GET", "/content/items/mine", tok.employee2)).body.items.filter((i: any) => i.title.includes(run)).length, 0);
  assert.equal((await call("PATCH", `/content/items/mine/${id}`, tok.employee, { stage: "EDIT" })).status, 200);
  assert.equal((await call("PATCH", `/content/items/mine/${id}`, tok.employee2, { stage: "EDIT" })).status, 403);
  assert.equal((await call("PATCH", `/content/items/${id}`, tok.admin, { assigneeUserId: uid.employee2 })).status, 200);
  assert.equal((await call("GET", "/content/items/mine", tok.employee2)).body.items.filter((i: any) => i.title.includes(run)).length, 1);
});

test("regression: admin client workflow + content pipeline listings still work", async () => {
  assert.equal((await call("GET", `/crm/tasks?clientId=${clientId}`, tok.admin)).body.tasks.length >= 4, true);
  assert.equal((await call("GET", "/content/items", tok.content)).status, 200);
  assert.equal((await call("GET", "/content/items", tok.employee)).status, 403, "pipeline board stays Content/Admin only");
  assert.equal((await call("POST", `/crm/clients/${clientId}/tasks`, tok.employee, { title: `x ${run}`, dueAt: "2031-03-01" })).status, 403, "creating tasks stays Sales/Admin");
});
