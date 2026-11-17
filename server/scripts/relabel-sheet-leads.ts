// One-off: files leads already imported from the Meta sheet under the exact name of the tab they appear in
// (they were filed under the five ERP service names before tabs became services).
//
//   npx tsx scripts/relabel-sheet-leads.ts            DRY RUN. Prints what would change.
//   npx tsx scripts/relabel-sheet-leads.ts --apply    Writes it. Safe to re-run.
import "dotenv/config";
import { prisma } from "../src/db/prisma";
import { googleSheetSource, parseCsv, rowToLead } from "../src/services/leadSheet";

(async () => {
  const apply = process.argv.includes("--apply");
  const config = await prisma.leadSheetConfig.findUnique({ where: { id: 1 } });
  if (!config?.sheetId) { console.log("No sheet connected."); return; }
  for (const tab of await prisma.leadSheetTab.findMany({ orderBy: { position: "asc" } })) {
    if (!tab.service) continue;
    let rows: string[][];
    try { rows = parseCsv(await googleSheetSource.csv(config.sheetId, tab.gid)); } catch (e) { console.log(`${tab.name.padEnd(20)} skipped: ${(e as Error).message}`); continue; }
    const ids = rows.slice(1).map((r) => rowToLead(rows[0] ?? [], r)?.metaLeadId).filter((x): x is string => !!x);
    const where = { metaLeadId: { in: ids }, serviceInterested: { not: tab.service } };
    const n = apply ? (await prisma.lead.updateMany({ where, data: { serviceInterested: tab.service } })).count : await prisma.lead.count({ where });
    console.log(`${tab.name.padEnd(20)} -> ${tab.service}: ${n} lead(s) ${apply ? "relabelled" : "would change"}`);
  }
})().finally(() => prisma.$disconnect());
