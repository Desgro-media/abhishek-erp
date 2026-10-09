// Daily ad numbers are logged in two places — DesGro's own Meta ads (content module) and each
// Performance Marketing client's ads (CRM) — and both must show identical derived figures and obey
// identical date rules, so that logic lives here once.

type MetricRow = { id: string; date: Date; spend: unknown; leads: number; purchases: number; revenue: unknown; loggedBy: string | null };

// CPL / CPA / ROAS only mean something with a non-zero divisor; null means "show —", never
// Infinity or NaN.
export function serializeAdMetric(m: MetricRow) {
  const spend = Number(m.spend);
  const revenue = Number(m.revenue);
  return {
    id: m.id,
    date: m.date.toISOString().slice(0, 10),
    spend,
    leads: m.leads,
    purchases: m.purchases,
    revenue,
    loggedBy: m.loggedBy,
    cpl: m.leads > 0 ? spend / m.leads : null,
    cpa: m.purchases > 0 ? spend / m.purchases : null,
    roas: spend > 0 ? revenue / spend : null,
  };
}

// A real calendar date that hasn't started yet is refused. One day of slack so a server clock behind
// the caller's timezone (IST is ahead of UTC) doesn't reject a legitimate "today".
export function parseMetricDate(yyyyMmDd: string): { date: Date } | { error: string } {
  const date = new Date(`${yyyyMmDd}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== yyyyMmDd) return { error: "Invalid date" };
  const latest = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  if (yyyyMmDd > latest) return { error: "Can't log ad numbers for a future date" };
  return { date };
}
