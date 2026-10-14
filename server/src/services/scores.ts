import { prisma } from "../db/prisma";
import { SERVICE_DEPARTMENTS } from "./departmentAccess";

/* Monthly scores, out of 100. Each is a set of weighted parts; a part with nothing to measure that month is left out
   and the rest re-weighted (so a brand-new department isn't scored 0 for what doesn't exist yet).

   Department (service departments)  Client growth 25 · Client satisfaction 30 · Feedback coverage 15 · Revenue 30
   Sales                             Target completion 45 · Lead conversion 30 · Meetings 25
   Meta Ads (our own ads)            ROAS 30 · Cost per lead 25 · Lead→sale 15 · Lead pace 15 · Daily tracking 15
   Satisfaction/coverage come from client feedback (a rating of 1-5 per client, service and month); Meetings needs the
   sales meeting log and reports "n/a" until that exists. */

export interface Targets {
  deptRevenue: Record<string, number>;
  deptClientGrowth: number;       // % a month
  sales: { revenue: number; conversion: number; meetings: number };
  meta: { roas: number; cpl: number; conv: number };
}
export const DEFAULT_TARGETS: Targets = {
  deptRevenue: { "Marketing Consultation": 100000, "Web Development": 75000, "Production": 50000, "Graphic Design": 50000, "Performance Marketing": 75000 },
  deptClientGrowth: 10,
  sales: { revenue: 300000, conversion: 20, meetings: 20 },
  meta: { roas: 5, cpl: 250, conv: 5 },
};

export async function getTargets(): Promise<Targets> {
  const row = await prisma.scoreSettings.findUnique({ where: { id: 1 } });
  const t = (row?.targets ?? {}) as Partial<Targets>;
  return {
    deptRevenue: { ...DEFAULT_TARGETS.deptRevenue, ...(t.deptRevenue ?? {}) },
    deptClientGrowth: t.deptClientGrowth ?? DEFAULT_TARGETS.deptClientGrowth,
    sales: { ...DEFAULT_TARGETS.sales, ...(t.sales ?? {}) },
    meta: { ...DEFAULT_TARGETS.meta, ...(t.meta ?? {}) },
  };
}

export interface Part { key: string; label: string; w: number; v: number | null; detail: string }
export interface Score { score: number | null; parts: Part[]; month: string }

export const weightedScore = (parts: Part[]): number | null => {
  const live = parts.filter((p) => p.v != null);
  const w = live.reduce((s, p) => s + p.w, 0);
  return w ? Math.round((live.reduce((s, p) => s + (p.v as number) * p.w, 0) / w) * 100) : null;
};

const num = (x: unknown) => Number(x);
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const prevMonthOf = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7); };
const monthEnd = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)); };
const monthStart = (m: string) => new Date(`${m}-01T00:00:00Z`);
const daysIn = (m: string) => monthEnd(m).getUTCDate();
// Share of the month gone (1 for past months) — targets for the month in progress are paced by it.
export const elapsedShare = (m: string) => (m !== istToday().slice(0, 7) ? 1 : Number(istToday().slice(8)) / daysIn(m));
const shortInr = (n: number) => { n = Math.round(n || 0); return n >= 100000 ? "₹" + (n / 100000).toFixed(n >= 1000000 ? 1 : 2).replace(/\.?0+$/, "") + "L" : n >= 1000 ? "₹" + (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "K" : "₹" + n; };
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const addDays = (ds: string, n: number) => { const d = new Date(`${ds}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ---- Department (service) ----
export async function liveClientCount(dept: string, month: string) {
  return prisma.client.count({ where: { services: { has: dept }, onboardedAt: { lte: monthEnd(month) }, status: "ACTIVE", archivedAt: null } });
}
export async function deptRevenueCollected(dept: string, month: string) {
  const invoices = await prisma.invoice.findMany({ where: { items: { some: { dept } }, payments: { some: { paidDate: { gte: monthStart(month), lte: monthEnd(month) } } } }, include: { items: true, payments: true } });
  let collected = 0;
  for (const inv of invoices) {
    const total = inv.items.reduce((s, it) => s + num(it.amount), 0);
    if (total <= 0) continue;
    const frac = inv.items.filter((it) => it.dept === dept).reduce((s, it) => s + num(it.amount), 0) / total;
    inv.payments.filter((p) => p.paidDate >= monthStart(month) && p.paidDate <= monthEnd(month)).forEach((p) => { collected += num(p.amount) * frac; });
  }
  return collected;
}
export async function deptClientScore(dept: string, month: string, t: Targets): Promise<Score> {
  const prev = prevMonthOf(month), Ps = new Date(`${prev}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const [now, was, rev, fb] = await Promise.all([liveClientCount(dept, month), liveClientCount(dept, prev), deptRevenueCollected(dept, month), prisma.clientFeedback.findMany({ where: { dept, month }, select: { rating: true } })]);
  const avg = fb.length ? fb.reduce((s, f) => s + f.rating, 0) / fb.length : null;
  const goal = was * (1 + t.deptClientGrowth / 100);
  const growthV = now || was ? (was ? Math.min(1, now / goal) : 1) : null;
  const target = t.deptRevenue[dept] ?? 0, share = elapsedShare(month), due = target * share;
  const parts: Part[] = [
    { key: "growth", label: "Client growth", w: 25, v: growthV, detail: now || was ? `${now} client${now === 1 ? "" : "s"} vs ${was} in ${Ps}${now > was ? ` · +${now - was}` : now < was ? ` · lost ${was - now}` : " · no change"} · target +${t.deptClientGrowth}%` : "no clients either month" },
    { key: "satisfaction", label: "Client satisfaction", w: 30, v: avg == null ? null : (avg - 1) / 4, detail: fb.length ? `${avg!.toFixed(1)} ★ average from ${fb.length} client${fb.length === 1 ? "" : "s"}` : "no client feedback yet" },
    { key: "feedback", label: "Feedback coverage", w: 15, v: now ? Math.min(1, fb.length / now) : null, detail: now ? `${fb.length} of ${now} clients gave feedback` : "no clients this month" },
    { key: "revenue", label: "Department revenue", w: 30, v: due ? Math.min(1, rev / due) : null, detail: !target ? "no revenue target set" : `${shortInr(rev)} received of ${shortInr(target)} target${share < 1 ? ` · ${Math.round(share * 100)}% of the month gone` : ""}` },
  ];
  return { score: weightedScore(parts), parts, month };
}

// ---- Sales ----
export async function salesScore(month: string, t: Targets): Promise<Score & { booked: number }> {
  const names = (await prisma.employee.findMany({ where: { dept: "Sales", NOT: { employmentStatus: "LEFT" } }, select: { name: true } })).map((e) => e.name);
  const invoices = await prisma.invoice.findMany({ where: { issuedAt: { gte: monthStart(month), lte: monthEnd(month) }, client: { salesPerson: { in: names } } }, include: { items: true } });
  const booked = invoices.reduce((s, i) => s + i.items.reduce((a, it) => a + num(it.amount), 0), 0);
  const share = elapsedShare(month);
  const endStr = [istToday(), monthEnd(month).toISOString().slice(0, 10)].sort()[0];
  const startStr = addDays(endStr, -59);
  const pool = await prisma.lead.findMany({ where: { createdAt: { gte: new Date(`${startStr}T00:00:00Z`), lte: new Date(`${endStr}T23:59:59Z`) } }, select: { convertedClientId: true } });
  const won = pool.filter((l) => l.convertedClientId).length;
  const rate = pool.length ? (won / pool.length) * 100 : null;
  const dueTarget = t.sales.revenue * share;
  const parts: Part[] = [
    { key: "target", label: "Target completion", w: 45, v: dueTarget ? Math.min(1, booked / dueTarget) : null, detail: `${shortInr(booked)} of ${shortInr(t.sales.revenue)} (${Math.round((booked / t.sales.revenue) * 100)}%)${share < 1 ? ` · ${Math.round(share * 100)}% of the month gone` : ""}` },
    { key: "conversion", label: "Lead conversion", w: 30, v: rate == null ? null : Math.min(1, rate / t.sales.conversion), detail: pool.length ? `${won} of ${pool.length} leads (60 days) became clients · ${rate!.toFixed(0)}% · target ${t.sales.conversion}%` : "no leads in the last 60 days" },
    { key: "meetings", label: "Meetings", w: 25, v: null, detail: "sales meetings aren't logged yet" },
  ];
  return { score: weightedScore(parts), parts, month, booked };
}

// ---- Meta Ads (our own) ----
export async function metaAdsScore(month: string, t: Targets): Promise<Score> {
  const rows = await prisma.ownAdMetric.findMany({ where: { date: { gte: monthStart(month), lte: monthEnd(month) } }, orderBy: { date: "asc" } });
  const prevRows = await prisma.ownAdMetric.findMany({ where: { date: { gte: monthStart(prevMonthOf(month)), lte: monthEnd(prevMonthOf(month)) } } });
  const sum = (r: typeof rows, k: "spend" | "leads" | "purchases" | "revenue") => r.reduce((s, x) => s + num(x[k]), 0);
  const spend = sum(rows, "spend"), leads = sum(rows, "leads"), purchases = sum(rows, "purchases"), revenue = sum(rows, "revenue");
  const roas = spend ? revenue / spend : null, cpl = leads ? spend / leads : null, conv = leads ? (purchases / leads) * 100 : null;
  const today = istToday();
  const daysSoFar = month === today.slice(0, 7) ? Number(today.slice(8)) : daysIn(month);
  const prevDays = daysIn(prevMonthOf(month));
  const pace = rows.length ? leads / daysSoFar : null, pacePrev = prevRows.length ? sum(prevRows, "leads") / prevDays : null;
  // Daily tracking: days logged ÷ days that should have been logged (from the first log of the month to yesterday / month end).
  let tracking: number | null = null, trackDetail = "no daily numbers logged";
  if (rows.length) {
    const logged = rows.map((r) => r.date.toISOString().slice(0, 10));
    const start = [`${month}-01`, logged[0]].sort().pop()!;
    const end = month === today.slice(0, 7) ? addDays(today, -1) : monthEnd(month).toISOString().slice(0, 10);
    let due = 0, done = 0;
    for (let d = start; d <= end; d = addDays(d, 1)) { due++; if (logged.includes(d)) done++; }
    tracking = due ? done / due : null;
    trackDetail = due ? `${done} of ${due} days logged since ${start.slice(8)}/${start.slice(5, 7)}` : "nothing due yet";
  }
  const parts: Part[] = [
    { key: "roas", label: "Return on ad spend", w: 30, v: roas == null ? null : Math.min(1, roas / t.meta.roas), detail: roas == null ? "no spend logged" : `${roas.toFixed(1)}x · target ${t.meta.roas}x` },
    { key: "cpl", label: "Cost per lead", w: 25, v: cpl == null ? null : Math.min(1, t.meta.cpl / cpl), detail: cpl == null ? "no leads yet" : `${inr(cpl)} · target ${inr(t.meta.cpl)}` },
    { key: "conv", label: "Lead → sale", w: 15, v: conv == null ? null : Math.min(1, conv / t.meta.conv), detail: conv == null ? "no leads yet" : `${conv.toFixed(1)}% of leads bought · target ${t.meta.conv}%` },
    { key: "pace", label: "Lead pace", w: 15, v: pace == null || !pacePrev ? null : Math.min(1, pace / pacePrev), detail: pace == null ? "no leads yet" : `${pace.toFixed(1)} leads/day${pacePrev ? ` · last month ${pacePrev.toFixed(1)}/day` : ""}` },
    { key: "tracking", label: "Daily tracking", w: 15, v: tracking, detail: trackDetail },
  ];
  return { score: weightedScore(parts), parts, month };
}

export { SERVICE_DEPARTMENTS };
