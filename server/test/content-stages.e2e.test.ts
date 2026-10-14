/**
 * Content pipeline: the Edit and Graphic stages sit between Production and Review.
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
const run = `c${Date.now().toString(36)}`;
let admin = "", content = "";
const created = { users: [] as string[] };

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  ({ prisma } = await import("../src/db/prisma"));
  const { app } = await import("../src/app");
  const { signAccessToken } = await import("../src/utils/tokens");
  const mk = async (label: string, roles: any[]) => { const u = await prisma.user.create({ data: { name: `${label} ${run}`, email: `${label}-${run}@test.local`, passwordHash: "x", roles } }); created.users.push(u.id); return signAccessToken({ sub: u.id, email: u.email, name: u.name, roles, department: null, employeeId: null }); };
  admin = await mk("admin", ["ADMIN"]); content = await mk("content", ["CONTENT"]);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  await prisma.contentItem.deleteMany({ where: { title: { contains: run } } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  server?.close();
  await prisma.$disconnect();
});

test("a content card can be created in, and moved through, the Edit and Graphic stages", async () => {
  const base_ = { title: `Reel ${run}`, type: "Reel", platforms: ["Instagram"], dueAt: "2031-03-01" };
  const made = await call("POST", "/content/items", content, { ...base_, stage: "EDIT" });
  assert.equal(made.status, 201); assert.equal(made.body.item.stage, "EDIT");
  const id = made.body.item.id;
  for (const stage of ["GRAPHIC", "REVIEW", "EDIT", "PRODUCTION"]) {
    const r = await call("PATCH", `/content/items/${id}`, content, { stage });
    assert.equal(r.status, 200, stage); assert.equal(r.body.item.stage, stage);
  }
  assert.equal((await call("PATCH", `/content/items/${id}`, content, { stage: "NOPE" })).status, 400);
  const listed = (await call("GET", "/content/items?stage=GRAPHIC", admin)).body.items;
  assert.equal(listed.every((i: any) => i.stage === "GRAPHIC"), true);
});
