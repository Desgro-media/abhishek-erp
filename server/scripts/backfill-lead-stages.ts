// One-off: gives leads that predate the pipeline a starting stage. SAFE BY DEFAULT.
//
//   npx tsx scripts/backfill-lead-stages.ts            DRY RUN (default). Read-only. Prints how many leads
//                                                      would land in each stage. Works BEFORE the lead_stages
//                                                      migration is applied, so it can be run on production
//                                                      to see the numbers first.
//   npx tsx scripts/backfill-lead-stages.ts --apply    Writes the stages. Needs the migration. Only touches
//                                                      leads nobody has staged yet (stage_set_by IS NULL), so
//                                                      running it twice changes nothing the second time.
//   npx tsx scripts/backfill-lead-stages.ts --undo     Puts back ONLY the leads this script staged
//                                                      (stage_set_by = 'migration'); stages people set by
//                                                      hand are left alone.
//   npx tsx scripts/backfill-lead-stages.ts --print-sql  Prints the classification SQL (for psql).
//
// In Docker: docker compose exec api npx tsx scripts/backfill-lead-stages.ts
// It never touches leads.status, quotes, invoices, payments or anything outside the leads stage columns.
import { PrismaClient } from "@prisma/client";
import { CLASSIFY_SQL, MIGRATED_LOST_REASON } from "../src/services/leadStage";
import { recordAudit } from "../src/services/audit.service";

const prisma = new PrismaClient();
const ORDER = ["NEW", "CONTACTED", "MEETING", "PROPOSAL_SENT", "NEGOTIATION", "WON", "LOST"];
const num = (v: unknown) => Number(v);

async function hasStageColumns(): Promise<boolean> {
  const r = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM information_schema.columns WHERE table_name = 'leads' AND column_name IN ('stage', 'stage_set_by')`,
  );
  return num(r[0].n) === 2;
}

async function counts() {
  const rows = await prisma.$queryRawUnsafe<{ stage: string; n: bigint }[]>(`SELECT stage, count(*) AS n FROM (${CLASSIFY_SQL}) c GROUP BY stage`);
  const m = new Map(rows.map((r) => [r.stage, num(r.n)]));
  return ORDER.map((s) => ({ stage: s, count: m.get(s) ?? 0 }));
}

// Cases the rules classify in a way worth a human glance. Read-only, and uses only columns that exist today.
async function flags() {
  const one = async (sql: string) => num((await prisma.$queryRawUnsafe<{ n: bigint }[]>(sql))[0].n);
  return {
    total: await one(`SELECT count(*) AS n FROM leads`),
    legacyStatus: await prisma.$queryRawUnsafe<{ status: string; n: bigint }[]>(`SELECT status::text AS status, count(*) AS n FROM leads GROUP BY status ORDER BY status`),
    ownedOnlyDraftOrLostQuotes: await one(
      `SELECT count(*) AS n FROM leads l WHERE l.lead_owner IS NOT NULL AND l.converted_client_id IS NULL AND l.status NOT IN ('CONVERTED','LOST')
         AND EXISTS (SELECT 1 FROM quotes q WHERE q.lead_id = l.id) AND NOT EXISTS (SELECT 1 FROM quotes q WHERE q.lead_id = l.id AND q.status IN ('SENT','SUBMITTED_TO_FINANCE'))`,
    ),
    unownedWithSentQuote: await one(
      `SELECT count(*) AS n FROM leads l WHERE l.lead_owner IS NULL AND l.converted_client_id IS NULL AND l.status NOT IN ('CONVERTED','LOST')
         AND EXISTS (SELECT 1 FROM quotes q WHERE q.lead_id = l.id AND q.status IN ('SENT','SUBMITTED_TO_FINANCE'))`,
    ),
    convertedStatusWithoutClient: await one(`SELECT count(*) AS n FROM leads WHERE status = 'CONVERTED' AND converted_client_id IS NULL`),
    clientLinkedButStatusNotConverted: await one(`SELECT count(*) AS n FROM leads WHERE converted_client_id IS NOT NULL AND status <> 'CONVERTED'`),
  };
}

async function main() {
  const mode = process.argv.includes("--apply") ? "apply" : process.argv.includes("--undo") ? "undo" : "dry";
  if (process.argv.includes("--print-sql")) { console.log(CLASSIFY_SQL.trim()); return; }

  const [{ db }] = await prisma.$queryRawUnsafe<{ db: string }[]>(`SELECT current_database() AS db`);
  const migrated = await hasStageColumns();
  console.log(`Database: ${db}   Mode: ${mode === "dry" ? "DRY RUN (read-only)" : mode.toUpperCase()}   lead_stages migration applied: ${migrated ? "yes" : "NO"}\n`);

  if (mode === "dry") {
    const c = await counts();
    const f = await flags();
    console.log(`Leads that would be staged: ${f.total}`);
    for (const r of c) console.log(`  ${r.stage.padEnd(14)} ${String(r.count).padStart(6)}`);
    console.log(`  (${MIGRATED_LOST_REASON} is recorded as the reason for every LOST lead)\n`);
    console.log("Existing leads.status values (left untouched):", f.legacyStatus.map((r) => `${r.status}=${num(r.n)}`).join("  ") || "none");
    console.log("Worth a look:");
    console.log(`  owned leads whose only quotes are Draft/Lost (no SENT quote) -> CONTACTED : ${f.ownedOnlyDraftOrLostQuotes}`);
    console.log(`  UNOWNED leads that have a sent quote -> NEW (rule: no owner = New)       : ${f.unownedWithSentQuote}`);
    console.log(`  status CONVERTED but no client link -> WON                                : ${f.convertedStatusWithoutClient}`);
    console.log(`  linked to a client but status not CONVERTED -> WON                        : ${f.clientLinkedButStatusNotConverted}`);
    if (migrated) {
      const done = num((await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM leads WHERE stage_set_by IS NOT NULL`))[0].n);
      console.log(`\nAlready staged (by the script or by a person): ${done}. --apply would skip these.`);
    }
    console.log("\nNothing was changed. Re-run with --apply to write these stages.");
    return;
  }

  if (!migrated) { console.error("The lead_stages migration has not been applied to this database, so there is nothing to write to. Nothing changed."); process.exitCode = 1; return; }

  if (mode === "apply") {
    const changed = await prisma.$transaction(async (tx) => {
      const n = await tx.$executeRawUnsafe(
        `UPDATE leads l SET stage = c.stage::"LeadStage",
                            lost_reason = CASE WHEN c.stage = 'LOST' THEN $1 END,
                            stage_changed_at = now(), stage_set_by = 'migration'
         FROM (${CLASSIFY_SQL}) c
         WHERE l.id = c.id AND l.stage_set_by IS NULL`,
        MIGRATED_LOST_REASON,
      );
      await recordAudit({ action: "CRM_LEAD_STAGE_BACKFILL", entityType: "Lead", afterData: { updated: n } }, tx);
      return n;
    });
    console.log(`Staged ${changed} lead(s). Running --apply again changes nothing.`);
    for (const r of await prisma.$queryRawUnsafe<{ stage: string; n: bigint }[]>(`SELECT stage::text AS stage, count(*) AS n FROM leads WHERE stage_set_by = 'migration' GROUP BY stage`)) console.log(`  ${r.stage.padEnd(14)} ${num(r.n)}`);
    return;
  }

  const undone = await prisma.$transaction(async (tx) => {
    const n = await tx.$executeRawUnsafe(
      `UPDATE leads SET stage = 'NEW', lost_reason = NULL, lost_note = NULL, stage_changed_at = NULL, stage_set_by = NULL WHERE stage_set_by = 'migration'`,
    );
    await recordAudit({ action: "CRM_LEAD_STAGE_BACKFILL_UNDO", entityType: "Lead", afterData: { reverted: n } }, tx);
    return n;
  });
  console.log(`Reverted ${undone} lead(s) staged by this script. Stages set by people were not touched.`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
