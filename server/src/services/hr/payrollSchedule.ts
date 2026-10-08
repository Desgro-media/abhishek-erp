import type { Prisma } from "@prisma/client";

// Payout schedule for one employee-month. Only the plan (amount + due date) is stored; everything about
// money actually paid is derived here from the PayrollPayment records, never stored:
//   - payments settle instalments oldest-first, so recording a payment through the normal payroll path is
//     what marks an instalment Paid (and its paid date is the date of the payment that completed it);
//   - if net pay changed after the plan was made (LOP, WFH, advance recovery, a gross edit), only the
//     UNPAID part of the plan adjusts — last instalment first — and paid money is never rewritten;
//   - if net fell below what was already paid, the difference is an overpayment to resolve, not a
//     negative instalment.

export type SplitRow = { percent: number; day: number }; // day 1-31, 0 = last day of the month
export const DEFAULT_SPLIT: SplitRow[] = [{ percent: 100, day: 0 }];

const round2 = (n: number) => Math.round(n * 100) / 100;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function dueDateFor(month: string, day: number): string {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const d = day === 0 ? last : Math.min(day, last);
  return `${month}-${String(d).padStart(2, "0")}`;
}

// Splits `net` by the default percentages. Every row but the last is rounded to whole rupees; the last
// takes the remainder, so the instalments always add up to net exactly (no rupee lost on an odd amount).
export function buildSchedule(net: number, month: string, split: SplitRow[]): { amount: number; dueDate: string }[] {
  const rows = [...split].sort((a, b) => (a.day || 99) - (b.day || 99));
  let allocated = 0;
  return rows.map((r, i) => {
    const amount = i === rows.length - 1 ? round2(net - allocated) : Math.round((net * r.percent) / 100);
    allocated += amount;
    return { amount, dueDate: dueDateFor(month, r.day) };
  });
}

export function parseSplit(v: unknown): SplitRow[] {
  if (!Array.isArray(v) || !v.length) return DEFAULT_SPLIT;
  return v.map((x: any) => ({ percent: Number(x.percent), day: Number(x.day) }));
}

type Stored = { seq: number; amount: unknown; dueDate: Date };
type Payment = { amount: unknown; paidDate: Date };
export type ScheduleInstalment = {
  seq: number; amount: number; dueDate: string; paid: number; outstanding: number;
  status: "Paid" | "Scheduled" | "Overdue"; paidDate: string | null; adjustment: boolean;
};

export function effectiveSchedule(stored: Stored[], payments: Payment[], net: number, today: string) {
  const plan = [...stored].sort((a, b) => a.seq - b.seq).map((s) => ({ seq: s.seq, amount: Number(s.amount), dueDate: iso(s.dueDate), adjustment: false }));
  const pays = [...payments].sort((a, b) => a.paidDate.getTime() - b.paidDate.getTime());
  const totalPaid = round2(pays.reduce((s, p) => s + Number(p.amount), 0));
  if (!plan.length) return { scheduled: false as const, instalments: [] as ScheduleInstalment[], nextDue: null, overpayment: Math.max(0, round2(totalPaid - net)), planTotal: 0 };

  // How much of each planned instalment is already covered (oldest first).
  let rem = totalPaid;
  const covered = plan.map((p) => { const c = Math.min(p.amount, Math.max(0, rem)); rem -= c; return c; });

  // Net moved since the plan was made: adjust only the unpaid part, last unpaid instalment first.
  const diff = round2(net - plan.reduce((s, p) => s + p.amount, 0));
  const eff = plan.map((p) => ({ ...p }));
  if (diff > 0.005) {
    let i = eff.length - 1;
    while (i >= 0 && eff[i].amount - covered[i] <= 0.005) i--;
    if (i >= 0) eff[i].amount = round2(eff[i].amount + diff);
    else eff.push({ seq: (eff[eff.length - 1].seq ?? 0) + 1, amount: diff, dueDate: eff[eff.length - 1].dueDate, adjustment: true });
  } else if (diff < -0.005) {
    let need = -diff;
    for (let i = eff.length - 1; i >= 0 && need > 0.005; i--) {
      const take = Math.min(Math.max(0, eff[i].amount - (covered[i] ?? 0)), need);
      eff[i].amount = round2(eff[i].amount - take); need = round2(need - take);
    }
  }

  // Re-derive paid state on the adjusted amounts; paid date = date of the payment that completed it.
  let left = totalPaid, endsAt = 0;
  const instalments: ScheduleInstalment[] = [];
  for (const e of eff) {
    const paid = Math.min(e.amount, Math.max(0, left)); left -= paid; endsAt += e.amount;
    const done = e.amount > 0 && paid >= e.amount - 0.005;
    if (e.amount <= 0.005 && paid <= 0.005) continue; // fully absorbed by a lower net — nothing left to pay here
    let run = 0, paidDate: string | null = null;
    if (done) for (const p of pays) { run += Number(p.amount); if (run >= endsAt - 0.005) { paidDate = iso(p.paidDate); break; } }
    instalments.push({
      seq: e.seq, amount: e.amount, dueDate: e.dueDate, paid: round2(paid), outstanding: round2(e.amount - paid),
      status: done ? "Paid" : e.dueDate < today ? "Overdue" : "Scheduled", paidDate, adjustment: e.adjustment,
    });
  }
  const next = instalments.find((i) => i.status !== "Paid") ?? null;
  return {
    scheduled: true as const, instalments,
    nextDue: next ? { seq: next.seq, amount: next.outstanding, dueDate: next.dueDate, status: next.status } : null,
    overpayment: Math.max(0, round2(totalPaid - net)),
    planTotal: round2(plan.reduce((s, p) => s + p.amount, 0)),
  };
}

export async function replaceSchedule(tx: Prisma.TransactionClient, payrollEntryId: string, rows: { amount: number; dueDate: string }[]) {
  await tx.payrollInstalment.deleteMany({ where: { payrollEntryId } });
  await tx.payrollInstalment.createMany({ data: rows.map((r, i) => ({ payrollEntryId, seq: i + 1, amount: r.amount, dueDate: new Date(r.dueDate) })) });
}
