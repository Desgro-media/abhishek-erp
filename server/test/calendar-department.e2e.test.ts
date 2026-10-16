/**
 * Calendar department view: everyone can see what their own department is working on (read-only), nothing from others.
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
const run = `d${Date.now().toString(36)}`;
const tok: Record<string, string> = {};
const uid: Record<string, string> = {};
const created = { users: [] as string[], employees: [] as string[] };
let clientId = "";

async function call(method: string, path: string, who: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { Authorization: `Bearer ${tok[who]}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  ({ prisma } = await import("../src/db/prisma"));
  const { app } = await import("../src/app");
  const { signAccessToken } = await import("../src/utils/tokens");
  const mk = async (label: string, dept: string, roles: any[]) => {
    const e = await prisma.employee.create({ data: { employeeCode: `E-${label}-${run}`, name: `${label} ${run}`, dept, role: "Staff", joinedAt: new Date("2025-01-01"), email: `${label}-${run}@test.local`, salary: 1, empType: "PERMANENT" } });
    const u = await prisma.user.create({ data: { name: e.name, email: e.email, passwordHash: "x", roles, employeeId: e.id } });
    created.users.push(u.id); created.employees.push(e.id); uid[label] = u.id;
    tok[label] = signAccessToken({ sub: u.id, email: u.email, name: u.name, roles, department: null, employeeId: e.id });
  };
  await mk("admin", "Administration", ["ADMIN"]);
  await mk("videoA", "Video", ["EMPLOYEE"]);
  await mk("videoB", "Video", ["EMPLOYEE"]);
  await mk("webA", "Web", ["EMPLOYEE"]);
  clientId = (await prisma.client.create({ data: { clientCode: `CD-${run}`, name: `Client ${run}`, services: [], onboardedAt: new Date() } })).id;
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  await prisma.contentItem.deleteMany({ where: { title: { contains: run } } });
  await prisma.client.deleteMany({ where: { id: clientId } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  await prisma.employee.deleteMany({ where: { id: { in: created.employees } } });
  await prisma.$disconnect();
  server?.close();
});

test("a teammate's task and content card show in the department view, another department's do not", async () => {
  await call("POST", `/crm/clients/${clientId}/tasks`, "admin", { title: `Video task ${run}`, assigneeUserId: uid.videoB, dueAt: "2031-03-01" });
  await call("POST", `/crm/clients/${clientId}/tasks`, "admin", { title: `Web task ${run}`, assigneeUserId: uid.webA, dueAt: "2031-03-01" });
  await call("POST", "/content/items", "admin", { title: `Video reel ${run}`, type: "Reel", platforms: [], dueAt: "2031-03-01", assigneeUserId: uid.videoB });

  const dept = (await call("GET", "/crm/tasks?scope=department", "videoA")).body.tasks.map((t: any) => t.title).filter((t: string) => t.includes(run));
  assert.deepEqual(dept, [`Video task ${run}`]);
  // The normal list is unchanged: videoA still only gets their own.
  assert.equal((await call("GET", "/crm/tasks", "videoA")).body.tasks.filter((t: any) => t.title.includes(run)).length, 0);
  const content = (await call("GET", "/content/items/mine?scope=department", "videoA")).body.items.map((i: any) => i.title).filter((t: string) => t.includes(run));
  assert.deepEqual(content, [`Video reel ${run}`]);
  // Read-only: a teammate can't move it.
  const t = (await call("GET", "/crm/tasks?scope=department", "videoA")).body.tasks.find((x: any) => x.title.includes(run));
  assert.equal((await call("PATCH", `/crm/tasks/${t.id}`, "videoA", { status: "DONE" })).status, 403);
});

test("colleagues: staff see only their own department; Admin sees everyone", async () => {
  const mine = (await call("GET", "/hr/employees/colleagues", "videoA")).body;
  assert.equal(mine.dept, "Video");
  assert.equal(mine.employees.every((e: any) => e.dept === "Video"), true);
  assert.equal(mine.employees.some((e: any) => e.name === `videoB ${run}`), true);
  const all = (await call("GET", "/hr/employees/colleagues", "admin")).body.employees.map((e: any) => e.name);
  assert.equal(all.includes(`webA ${run}`) && all.includes(`videoA ${run}`), true);
});
