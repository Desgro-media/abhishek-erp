import { prisma } from "../db/prisma";
import { env } from "../config/env";
import { detailsHtml, sendMailNow, type MailOptions, type Mailbox } from "./mail.service";
import pino from "pino";

const log = pino({ name: "ad-reminders" });

// Daily reminder: "you haven't logged the ad numbers". Two things are checked each day —
//   • each active Performance Marketing client's daily ad numbers (Clients > client page > Ad Performance), and
//   • DesGro Media's own Meta ad numbers (Marketing and Sales > Meta Ads > Daily Tracking).
// Who is told: a client's account manager; for our own ads, the whole Performance Marketing department. Each
// person gets ONE digest listing everything still missing, not a mail per client. Anything missing for
// ESCALATE_AFTER working days in a row also copies the Admins. If no account manager / department member can be
// found, the Admins are told instead, so a gap never goes unnoticed.
//
// What is NOT counted as missing (so nobody is nagged for nothing): company holidays and the weekly off day
// (HR Settings), Paused / Churned / archived clients, clients whose ad-account access isn't Granted, days before
// the client was onboarded, days the person is on approved full-day leave, and anything before these reminders
// began. This reads data and sends email only — it never writes ad numbers or touches any money record.

export const PERFORMANCE_DEPT = "Performance Marketing";
export const LOOKBACK_DAYS = 7;
export const ESCALATE_AFTER = 3;
const DAY = 86400_000;

export type Mailer = (box: Mailbox, opts: MailOptions) => Promise<void>;
export type Digest = {
  to: { name: string; email: string };
  cc: string[];
  subject: string;
  items: { label: string; dates: string[]; streak: number }[];
  escalated: boolean;
  /** Admin was told instead of the person who'd normally get it (no account manager / team found). */
  fallback: boolean;
};

const istDate = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
export const todayIst = () => istDate();

// "6 Oct" — same style the ERP shows dates in.
const label = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** Where the reminders begin: the first day one ever ran. Before any run, a first run would only look at yesterday. */
export async function reminderStartDate(today: string): Promise<string> {
  const first = await prisma.adReminderRun.findFirst({ orderBy: { runDate: "asc" }, select: { runDate: true } });
  return first ? addDays(first.runDate.toISOString().slice(0, 10), -1) : addDays(today, -1);
}

export async function buildDigests(today: string): Promise<{ digests: Digest[]; startDate: string; checkedDates: string[] }> {
  const start = await reminderStartDate(today);
  const policy = await prisma.hrPolicy.findUnique({ where: { id: 1 } });
  const weeklyOff = policy?.weeklyOff ?? 0;
  const holidays = new Set((await prisma.holiday.findMany({ select: { date: true } })).map((h) => h.date.toISOString().slice(0, 10)));
  const isWorkingDay = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() !== weeklyOff && !holidays.has(d);

  // Newest first: yesterday, the day before, ... (only working days, not before the reminders began).
  const dates: string[] = [];
  for (let i = 1; i <= LOOKBACK_DAYS; i++) {
    const d = addDays(today, -i);
    if (d < start) break;
    if (isWorkingDay(d)) dates.push(d);
  }
  if (!dates.length) return { digests: [], startDate: start, checkedDates: [] };
  const oldest = dates[dates.length - 1], newest = dates[0];
  const range = { gte: new Date(`${oldest}T00:00:00Z`), lte: new Date(`${newest}T00:00:00Z`) };

  const employees = await prisma.employee.findMany({ where: { employmentStatus: { not: "LEFT" } }, select: { id: true, name: true, email: true, dept: true } });
  const admins = (await prisma.user.findMany({ where: { active: true, roles: { has: "ADMIN" } }, select: { name: true, email: true } })).sort((a, b) => a.email.localeCompare(b.email));
  const byName = new Map<string, (typeof employees)[number]>();
  for (const e of employees) if (!byName.has(norm(e.name))) byName.set(norm(e.name), e);

  // Approved FULL-day casual/sick leave only: half/quarter days and WFH are still working days, so they can log.
  const leaves = await prisma.leaveRequest.findMany({
    where: { status: "APPROVED", type: "CASUAL_SICK", duration: "FULL_DAY", fromDate: { lte: range.lte }, toDate: { gte: range.gte } },
    select: { employeeId: true, fromDate: true, toDate: true },
  });
  const onLeave = (empId: string, d: string) => leaves.some((l) => l.employeeId === empId && l.fromDate.toISOString().slice(0, 10) <= d && d <= l.toDate.toISOString().slice(0, 10));

  // What each person is on the hook for: email -> items (label + the dates still missing for them).
  type Owner = { name: string; email: string; fallback: boolean; empId: string | null };
  const items = new Map<string, { owner: Owner; label: string; missing: string[] }[]>();
  const add = (owner: Owner, itemLabel: string, missing: string[]) => {
    if (!missing.length) return;
    const list = items.get(owner.email) ?? [];
    list.push({ owner, label: itemLabel, missing });
    items.set(owner.email, list);
  };
  const adminOwners: Owner[] = admins.map((a) => ({ name: a.name, email: a.email, fallback: true, empId: null }));

  // --- clients ---
  const clients = await prisma.client.findMany({
    where: { status: "ACTIVE", archivedAt: null, services: { has: PERFORMANCE_DEPT }, adAccess: { is: { status: "GRANTED" } } },
    select: { id: true, name: true, accountManager: true, onboardedAt: true },
  });
  const logged = await prisma.clientAdMetric.findMany({ where: { clientId: { in: clients.map((c) => c.id) }, date: range }, select: { clientId: true, date: true } });
  const loggedBy = new Map<string, Set<string>>();
  for (const m of logged) { const s = loggedBy.get(m.clientId) ?? new Set(); s.add(m.date.toISOString().slice(0, 10)); loggedBy.set(m.clientId, s); }
  for (const c of clients) {
    const onboarded = c.onboardedAt.toISOString().slice(0, 10);
    const have = loggedBy.get(c.id) ?? new Set<string>();
    const missing = dates.filter((d) => d >= onboarded && !have.has(d));
    if (!missing.length) continue;
    const am = c.accountManager ? byName.get(norm(c.accountManager)) : undefined;
    if (am) add({ name: am.name, email: am.email, fallback: false, empId: am.id }, c.name, missing);
    else for (const a of adminOwners) add(a, `${c.name} (no account manager found)`, missing);
  }

  // --- DesGro's own ads ---
  const own = await prisma.ownAdMetric.findMany({ where: { date: range }, select: { date: true } });
  const ownHave = new Set(own.map((m) => m.date.toISOString().slice(0, 10)));
  const ownMissing = dates.filter((d) => !ownHave.has(d));
  if (ownMissing.length) {
    const team = employees.filter((e) => e.dept === PERFORMANCE_DEPT);
    if (team.length) for (const e of team) add({ name: e.name, email: e.email, fallback: false, empId: e.id }, "DesGro Media's own Meta ads", ownMissing);
    else for (const a of adminOwners) add(a, "DesGro Media's own Meta ads (no Performance Marketing team found)", ownMissing);
  }

  // --- one digest per person; leave days dropped; streak decides escalation ---
  const digests: Digest[] = [];
  for (const [email, list] of items) {
    const owner = list[0].owner;
    const rows: Digest["items"] = [];
    for (const it of list) {
      const days = owner.empId ? it.missing.filter((d) => !onLeave(owner.empId!, d)) : it.missing;
      if (!days.length) continue;
      // Consecutive missing working days up to the latest one; a day the person was on leave neither counts nor breaks it.
      let streak = 0;
      for (const d of dates) {
        if (owner.empId && onLeave(owner.empId, d)) continue;
        if (it.missing.includes(d)) streak++; else break;
      }
      rows.push({ label: it.label, dates: [...days].sort(), streak });
    }
    if (!rows.length) continue;
    rows.sort((a, b) => a.label.localeCompare(b.label));
    const escalated = rows.some((r) => r.streak >= ESCALATE_AFTER);
    const cc = escalated ? admins.filter((a) => a.email !== email).map((a) => a.email) : [];
    digests.push({
      to: { name: owner.name, email },
      cc,
      subject: `Ad numbers not logged — ${rows.length} item${rows.length === 1 ? "" : "s"} need an update`,
      items: rows,
      escalated,
      fallback: owner.fallback,
    });
  }
  digests.sort((a, b) => a.to.email.localeCompare(b.to.email));
  return { digests, startDate: start, checkedDates: dates };
}

function render(d: Digest) {
  const rows: Record<string, string> = {};
  for (const it of d.items) rows[it.label] = `${it.dates.map(label).join(", ")}${it.streak >= ESCALATE_AFTER ? `  — ${it.streak} working days in a row` : ""}`;
  const intro = d.fallback
    ? "No account manager / team member could be found for the items below, so you're being told directly. These daily ad updates haven't been logged:"
    : `Hi ${d.to.name.split(" ")[0]}, these daily ad updates haven't been logged yet:`;
  return detailsHtml(`${intro} Please add them in DesGro ERP — client numbers on the client's page under Ad Performance, our own on Marketing and Sales → Meta Ads.`, rows);
}

/**
 * Sends today's reminders. `send:false` is a dry run (nothing emailed). Never throws on a mail failure — it is
 * counted — so one bad address can't stop everyone else's reminder.
 */
export async function runAdReminders(opts: { today?: string; send: boolean; mailer?: Mailer }) {
  const today = opts.today ?? todayIst();
  const { digests, startDate, checkedDates } = await buildDigests(today);
  const result = { today, startDate, checkedDates, digests, sent: 0, failed: 0, errors: [] as string[] };
  if (!opts.send) return result;
  const mailer = opts.mailer ?? sendMailNow;
  for (const d of digests) {
    try {
      await mailer("company", { to: d.to.email, cc: d.cc.length ? d.cc : undefined, subject: d.subject, html: render(d) });
      result.sent++;
    } catch (err) {
      result.failed++;
      result.errors.push(`${d.to.email}: ${(err as Error).message}`);
      log.warn({ to: d.to.email, err: (err as Error).message }, "ad reminder not sent");
    }
  }
  return result;
}

/**
 * Once-a-day guard: the unique date in ad_reminder_runs means only ONE caller ever gets `true` for a given
 * day, even across restarts or a second instance. The row also marks where the reminders began.
 */
export async function claimDailyRun(today: string): Promise<boolean> {
  const n = await prisma.$executeRaw`INSERT INTO ad_reminder_runs (id, run_date) VALUES (gen_random_uuid()::text, ${today}::date) ON CONFLICT (run_date) DO NOTHING`;
  return n === 1;
}

export async function runScheduledReminders(mailer?: Mailer, today = todayIst()) {
  if (!(await claimDailyRun(today))) return null;
  let summary: Record<string, unknown>;
  try {
    const r = await runAdReminders({ today, send: true, mailer });
    summary = { digests: r.digests.length, sent: r.sent, failed: r.failed, errors: r.errors };
  } catch (err) {
    summary = { error: (err as Error).message };
    log.error({ err: (err as Error).message }, "ad reminder run failed");
  }
  await prisma.adReminderRun.update({ where: { runDate: new Date(`${today}T00:00:00Z`) }, data: { finishedAt: new Date(), summary: summary as object } });
  return summary;
}

let timer: NodeJS.Timeout | null = null;
/** Checks every minute; the first check at/after the configured IST hour does the day's run. Off by default. */
export function startAdReminderScheduler() {
  if (!env.AD_REMINDERS_ENABLED || timer) return;
  log.info({ hour: env.AD_REMINDERS_HOUR }, "ad reminders enabled — runs daily, IST");
  const tick = async () => {
    const hourIst = Number(new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(11, 13));
    if (hourIst < env.AD_REMINDERS_HOUR) return;
    try { await runScheduledReminders(); } catch (err) { log.error({ err: (err as Error).message }, "ad reminder tick failed"); }
  };
  timer = setInterval(tick, 60_000);
  timer.unref();
  void tick();
}
