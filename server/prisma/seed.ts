// Creates the first Admin login so there's a way into the app at all, then
// loads Phase 2's sample HR data (see seed-hr.ts), Phase 3's sample Finance
// data (see seed-finance.ts), and Phase 4's sample CRM/Content data (see
// seed-crm.ts). Client/lead creation runs before seedFinance() (Finance's
// invoices need real client UUIDs) and the rest of CRM runs after it (one
// historical quote settles against a real bank account) — see seed-crm.ts.
// Safe to re-run: each step no-ops if its data already exists.
import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { seedHr } from "./seed-hr";
import { seedFinance } from "./seed-finance";
import { seedCrmClients, seedCrmRest } from "./seed-crm";

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL || "admin@desgromedia.com").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || "ChangeMe!2026";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Seed admin already exists: ${email} (skipping)`);
  } else {
    const passwordHash = await bcrypt.hash(password, Number(process.env.BCRYPT_SALT_ROUNDS) || 12);
    await prisma.user.create({
      data: {
        name: "System Admin",
        email,
        passwordHash,
        roles: [Role.ADMIN],
        active: true,
      },
    });

    console.log(`Seed admin created: ${email} / ${password}`);
    console.log("Log in and change this password immediately — it's only meant to get you into the app once.");
  }

  await seedHr();
  const { clientIdByCode, leadIdByCode, created } = await seedCrmClients();
  await seedFinance(clientIdByCode);
  await seedCrmRest(clientIdByCode, leadIdByCode, created);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
