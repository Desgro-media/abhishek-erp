/**
 * Top-bar search finds clients with the same scope as the Clients page.
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
const run = `g${Date.now().toString(36)}`;
const tok: Record<string, string> = {};
const created = { users: [] as string[] };
let clientId = "";

const search = async (who: string, q: string) => {
  const res = await fetch(`${base}/search?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${tok[who]}` } });
  return (await res.json()).results.filter((r: any) => r.type === "Client").map((r: any) => r.title);
};

before(async () => {
  ({ prisma } = await import("../src/db/prisma"));
  const { app } = await import("../src/app");
  const { signAccessToken } = await import("../src/utils/tokens");
  const mk = async (label: string, roles: any[]) => {
    const u = await prisma.user.create({ data: { name: `${label} ${run}`, email: `${label}-${run}@test.local`, passwordHash: "x", roles } });
    created.users.push(u.id);
    tok[label] = signAccessToken({ sub: u.id, email: u.email, name: u.name, roles, department: null, employeeId: null });
  };
  await mk("salesclients", ["SALES", "CLIENTS"]);
  await mk("clientsonly", ["CLIENTS"]);
  await mk("sales", ["SALES"]);
  await mk("staff", ["EMPLOYEE"]);
  clientId = (await prisma.client.create({ data: { clientCode: `GS-${run}`, name: `Qatar Fresh ${run}`, services: [], onboardedAt: new Date(), salesPerson: `someone-else ${run}` } })).id;
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  await prisma.client.deleteMany({ where: { id: clientId } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  server?.close();
  await prisma.$disconnect();
});

test("Clients-module logins find every client; a plain Sales rep only their own; staff none", async () => {
  const q = `Qatar Fresh ${run}`;
  assert.deepEqual(await search("salesclients", q), [q]);
  assert.deepEqual(await search("clientsonly", q), [q]);
  assert.deepEqual(await search("sales", q), []);
  assert.deepEqual(await search("staff", q), []);
});
