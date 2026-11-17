import pino from "pino";
import { prisma } from "../db/prisma";
import { recordAudit } from "./audit.service";
import { SERVICE_DEPARTMENTS } from "./departmentAccess";
import { nextSequentialCode } from "../utils/sequentialCode";

/*
  Meta leads from the performance team's Google Sheet → ERP Leads.

  The sheet is Meta's own lead export, one tab per campaign/service. Marketing > Leads > "Meta sheet" stores the sheet,
  which ERP service each tab belongs to, and an "import from" date. Every few minutes (and on "Sync now") each mapped tab
  is read and every row we haven't seen becomes an Open lead (source "Meta", no owner) for Sales to claim. A row is
  recognised by Meta's own lead id in column `id`, so nothing is ever imported twice, however often it runs.

  The sheet must be shared "Anyone with the link: Viewer" — it is read through Google's public CSV export, so no
  Google login/API key is involved.
*/

const log = pino({ name: "lead-sheet" });
const SHEET_BASE = "https://docs.google.com/spreadsheets/d";

// ---- helpers (pure; unit-tested) ----

// Accepts a full Google Sheets URL or the bare id.
export function extractSheetId(input: string): string | null {
  const s = input.trim();
  const m = s.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : null;
}

// RFC 4180 CSV: quoted fields, "" escapes, commas/newlines inside quotes.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  const t = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

// The service a tab's leads are filed under: the tab's own name, exactly as it is written in the sheet
// ("consultation", "Web kerala", "PB NEW"…), so the ERP shows the same service names the performance team uses.
export function guessService(tabName: string): string {
  return tabName.trim().slice(0, 60) || "Meta";
}

// A phone number reduced to what identifies it: digits only, last 10 (drops +91 / 0 / spaces / "p:"), so
// "+91 99999 12345" and "09999912345" are the same person. Too short to trust (< 7 digits) = no phone to compare.
export function phoneKey(phone?: string | null): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-10) : null;
}

const STANDARD = new Set(["id", "created_time", "ad_id", "ad_name", "adset_id", "adset_name", "campaign_id", "campaign_name", "form_id", "form_name", "is_organic", "platform", "lead_status", "full_name", "name", "phone", "phone_number", "email", "city"]);

export type SheetLead = { metaLeadId: string; name: string; phone?: string; email?: string; createdAt: Date; notes?: string };

// One sheet row → lead fields, or null for rows to ignore (blank, Meta's "<test lead: dummy data>" rows, no id, no contact).
export function rowToLead(header: string[], row: string[]): SheetLead | null {
  const h = header.map((x) => x.trim().toLowerCase());
  const get = (...keys: string[]) => {
    for (const k of keys) { const i = h.indexOf(k); if (i >= 0 && (row[i] ?? "").trim()) return row[i].trim(); }
    return undefined;
  };
  const id = get("id");
  if (!id || row.some((c) => /<test lead/i.test(c))) return null;
  const name = get("full_name", "name");
  const phone = get("phone_number", "phone")?.replace(/^p:/i, "").trim();
  const emailRaw = get("email");
  if (!name && !phone) return null;
  const created = new Date(get("created_time") ?? "");
  const extra = h.map((k, i) => ({ k, v: (row[i] ?? "").trim() })).filter((x) => x.k && x.v && !STANDARD.has(x.k)).map((x) => `${x.k.replace(/_/g, " ")}: ${x.v}`);
  const where = [get("campaign_name"), get("adset_name"), get("ad_name")].filter(Boolean).join(" / ");
  const notes = [where && `Campaign: ${where}`, get("form_name") && `Form: ${get("form_name")}`, get("platform") && `Platform: ${get("platform")}`, get("city") && `City: ${get("city")}`, ...extra].filter(Boolean).join("\n").slice(0, 1000) || undefined;
  return { metaLeadId: id, name: (name ?? "Meta lead").slice(0, 120), phone: phone?.slice(0, 30), email: emailRaw && /^\S+@\S+\.\S+$/.test(emailRaw) ? emailRaw : undefined, createdAt: isNaN(created.getTime()) ? new Date() : created, notes };
}

// ---- talking to Google (public export; swapped out in tests) ----

export class SheetAccessError extends Error {}

export type SheetSource = {
  tabs(sheetId: string): Promise<{ gid: string; name: string }[]>;
  csv(sheetId: string, gid: string): Promise<string>;
};

export const googleSheetSource: SheetSource = {
  async tabs(sheetId) {
    const res = await fetch(`${SHEET_BASE}/${sheetId}/htmlview`, { redirect: "follow" });
    const html = await res.text();
    const tabs = [...html.matchAll(/items\.push\(\{name: "((?:[^"\\]|\\.)*)".*?gid: "(\d+)"/g)].map((m) => ({ gid: m[2], name: JSON.parse(`"${m[1]}"`) as string }));
    if (!res.ok || !tabs.length) throw new SheetAccessError("Couldn't read that sheet. Open it in Google Sheets → Share → General access → \"Anyone with the link\" → Viewer.");
    return tabs;
  },
  async csv(sheetId, gid) {
    const res = await fetch(`${SHEET_BASE}/${sheetId}/export?format=csv&gid=${encodeURIComponent(gid)}`, { redirect: "follow" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("csv")) throw new SheetAccessError("The sheet isn't shared as \"Anyone with the link: Viewer\", or the tab was removed.");
    return res.text();
  },
};

// ---- config ----

// Sheet leads per IST day per service, over the last `window` (a Postgres interval, e.g. "400 days").
// created_at is a plain timestamp holding UTC, so it's read as UTC first and then shifted to IST.
export async function sheetLeadsPerDay(window: string) {
  return prisma.$queryRaw<{ day: string; service: string; n: number }[]>`
    SELECT to_char((created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS day, service_interested AS service, count(*)::int AS n
    FROM leads WHERE meta_lead_id IS NOT NULL AND created_at >= now() - ${window}::interval GROUP BY 1, 2`;
}

// How many leads the Meta sheet brought in during a month (YYYY-MM, by IST date) — or null when no sheet tab is
// filed under a service yet, so callers can fall back to the leads typed into the ad tracker.
export async function sheetLeadsInMonth(month: string): Promise<number | null> {
  if (!(await prisma.leadSheetTab.count({ where: { service: { not: null } } }))) return null;
  const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM leads
    WHERE meta_lead_id IS NOT NULL AND to_char((created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM') = ${month}`;
  return n;
}

// The services the sheet's tabs are filed under (skipped tabs left out).
export async function sheetServices() {
  const tabs = await prisma.leadSheetTab.findMany({ where: { service: { not: null } }, orderBy: { position: "asc" }, select: { service: true } });
  return [...new Set(tabs.map((t) => t.service!))];
}

// How many sheet leads arrived each of the last `days` days (IST, by the lead's own date) per service — so a service
// that got nothing on a day shows as a gap.
export async function dailyIntake(days = 7) {
  const rows = await sheetLeadsPerDay(`${days + 1} days`);
  const dayList = Array.from({ length: days }, (_, i) => new Date(Date.now() + 5.5 * 3600_000 - (days - 1 - i) * 86400_000).toISOString().slice(0, 10));
  const counts: Record<string, Record<string, number>> = {};
  for (const r of rows) (counts[r.service] ??= {})[r.day] = r.n;
  return { days: dayList, counts };
}

export async function getLeadSheet() {
  const [config, tabs, daily] = await Promise.all([prisma.leadSheetConfig.findUnique({ where: { id: 1 } }), prisma.leadSheetTab.findMany({ orderBy: { position: "asc" } }), dailyIntake()]);
  return { config, tabs, daily };
}

export const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

// Reads the sheet's tab list and brings lead_sheet_tabs in line: new tabs get a guessed service (or skip), tabs that
// were already set up keep their choice, tabs that no longer exist are dropped. A tab that was deleted and made again
// (or replaced by a copy) gets a new gid from Google — when its name matches a tab that's gone, it keeps that tab's
// service instead of a guess, so its leads keep landing under the same service.
export async function refreshTabs(sheetId: string, source: SheetSource = googleSheetSource) {
  const found = await source.tabs(sheetId);
  const all = await prisma.leadSheetTab.findMany();
  const existing = new Map(all.map((t) => [t.gid, t]));
  const foundGids = new Set(found.map((f) => f.gid));
  const key = (name: string) => name.trim().toLowerCase();
  const goneByName = new Map(all.filter((t) => !foundGids.has(t.gid)).map((t) => [key(t.name), t]));
  await prisma.$transaction([
    prisma.leadSheetTab.deleteMany({ where: { gid: { notIn: [...foundGids] } } }),
    ...found.map((f, i) => {
      const prev = existing.has(f.gid) ? undefined : goneByName.get(key(f.name));
      return prisma.leadSheetTab.upsert({
        where: { gid: f.gid },
        create: { gid: f.gid, name: f.name, service: prev ? prev.service : guessService(f.name), position: i },
        update: { name: f.name, position: i },
      });
    }),
  ]);
  return found.length - existing.size;
}

export { SERVICE_DEPARTMENTS };

// ---- sync ----

export type SyncSummary = { created: number; duplicates: number; skippedOld: number; seen: number; tabs: { name: string; service: string; created: number; error?: string }[]; at: string };
let running = false;

export async function syncLeadSheet(opts: { source?: SheetSource; actorUserId?: string | null } = {}): Promise<SyncSummary | null> {
  const source = opts.source ?? googleSheetSource;
  const config = await prisma.leadSheetConfig.findUnique({ where: { id: 1 } });
  if (!config?.sheetId || running) return null;
  running = true;
  try {
    // Pick up tabs that were added, renamed or recreated since the last sync. If the tab list can't be read right
    // now, carry on with the tabs already on file — each tab's own read reports its error below.
    await refreshTabs(config.sheetId, source).catch((err) => log.warn({ err }, "lead sheet: couldn't refresh tab list"));
    const tabs = (await prisma.leadSheetTab.findMany({ orderBy: { position: "asc" } })).filter((t) => t.service);
    const from = config.importFrom ? config.importFrom.getTime() : 0;
    const summary: SyncSummary = { created: 0, duplicates: 0, skippedOld: 0, seen: 0, tabs: [], at: new Date().toISOString() };
    let codes: string[] | null = null;
    // Everyone already in Leads, by phone. A row whose number is in here — or repeats earlier in this very run — is a
    // duplicate and is rejected, not imported.
    const phones = new Set((await prisma.lead.findMany({ where: { phone: { not: null } }, select: { phone: true } })).map((l) => phoneKey(l.phone)).filter((k): k is string => !!k));

    for (const tab of tabs) {
      const t = { name: tab.name, service: tab.service!, created: 0, error: undefined as string | undefined };
      try {
        const rows = parseCsv(await source.csv(config.sheetId, tab.gid));
        const header = rows[0] ?? [];
        const leads = rows.slice(1).map((r) => rowToLead(header, r)).filter((l): l is SheetLead => !!l);
        summary.seen += leads.length;
        // One-off after tabs became services: leads imported earlier were filed under the five ERP names; file them under the tab they came from.
        if (!config.tabNamesApplied && leads.length) await prisma.lead.updateMany({ where: { metaLeadId: { in: leads.map((l) => l.metaLeadId) }, serviceInterested: { not: tab.service! } }, data: { serviceInterested: tab.service! } });
        const known = new Set((await prisma.lead.findMany({ where: { metaLeadId: { in: leads.map((l) => l.metaLeadId) } }, select: { metaLeadId: true } })).map((l) => l.metaLeadId));
        // Oldest first, so lead codes (MLD-nn) follow the order the leads came in.
        const fresh = leads.filter((l) => !known.has(l.metaLeadId)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        for (const l of fresh) {
          if (l.createdAt.getTime() < from) { summary.skippedOld++; continue; }
          const key = phoneKey(l.phone);
          if (key && phones.has(key)) { summary.duplicates++; continue; }
          codes ??= (await prisma.lead.findMany({ select: { leadCode: true } })).map((x) => x.leadCode);
          for (let attempt = 0; ; attempt++) {
            const leadCode = nextSequentialCode("MLD-", codes);
            try {
              await prisma.lead.create({ data: { leadCode, name: l.name, phone: l.phone, email: l.email, source: "Meta", serviceInterested: tab.service!, leadOwner: null, notes: l.notes, metaLeadId: l.metaLeadId, createdAt: l.createdAt } });
              codes.push(leadCode); t.created++;
              if (key) phones.add(key);
              break;
            } catch (err: any) {
              if (err?.code !== "P2002") throw err;
              // Same row imported by another run, or a code taken in the meantime.
              if (await prisma.lead.findUnique({ where: { metaLeadId: l.metaLeadId }, select: { id: true } })) break;
              if (attempt >= 3) throw err;
              codes = (await prisma.lead.findMany({ select: { leadCode: true } })).map((x) => x.leadCode);
            }
          }
        }
      } catch (err) {
        t.error = (err as Error).message;
        log.warn({ tab: tab.name, err: t.error }, "lead sheet tab failed");
      }
      summary.created += t.created;
      summary.tabs.push(t);
      await prisma.leadSheetTab.update({ where: { id: tab.id }, data: { lastError: t.error ?? null, lastRows: t.created ? tab.lastRows + t.created : tab.lastRows } });
    }

    await prisma.leadSheetConfig.update({ where: { id: 1 }, data: { lastSyncAt: new Date(), lastSummary: summary as object, tabNamesApplied: true } });
    if (summary.created) await recordAudit({ userId: opts.actorUserId ?? null, action: "LEAD_SHEET_SYNC", entityType: "LeadSheetConfig", entityId: "1", afterData: { created: summary.created, tabs: summary.tabs.filter((x) => x.created).map((x) => `${x.name}: ${x.created}`) } });
    return summary;
  } finally {
    running = false;
  }
}

let timer: NodeJS.Timeout | null = null;
/** Every 5 minutes, if "auto-sync" is on in the Meta sheet settings. Runs on every instance; the unique Meta id keeps that safe. */
export function startLeadSheetScheduler() {
  if (timer) return;
  const tick = async () => {
    try {
      const c = await prisma.leadSheetConfig.findUnique({ where: { id: 1 }, select: { autoSync: true } });
      if (c?.autoSync) await syncLeadSheet();
    } catch (err) { log.error({ err: (err as Error).message }, "lead sheet tick failed"); }
  };
  timer = setInterval(tick, 5 * 60_000);
  timer.unref();
}
