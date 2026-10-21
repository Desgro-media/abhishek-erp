import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";

// Which dates count as working days (not the weekly off, not a company holiday) — the same rule attendance, the calendar and payroll
// use. A leave / WFH request only ever uses working days: a Friday-to-Monday request is two days off, not four.
export async function loadWorkingDayCheck(db: Prisma.TransactionClient = prisma): Promise<(ds: string) => boolean> {
  const policy = await db.hrPolicy.findUnique({ where: { id: 1 } });
  const weeklyOff = policy?.weeklyOff ?? 0;
  const holidays = new Set((await db.holiday.findMany({ select: { date: true } })).map((h) => h.date.toISOString().slice(0, 10)));
  return (ds) => new Date(`${ds}T00:00:00.000Z`).getUTCDay() !== weeklyOff && !holidays.has(ds);
}

// Every calendar date from..to inclusive (YYYY-MM-DD).
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00.000Z`), end = new Date(`${to}T00:00:00.000Z`); d <= end; d = new Date(d.getTime() + 86400000)) out.push(d.toISOString().slice(0, 10));
  return out;
}

export const DURATION_FRACTION = { FULL_DAY: 1, HALF_DAY: 0.5, QUARTER_DAY: 0.25 } as const;

// How much of each date a request takes: 1 per working date for full days, or the fraction for a single-date half / quarter day.
export function requestLoad(r: { duration: keyof typeof DURATION_FRACTION; fromDate: Date; toDate: Date }, isWorking: (ds: string) => boolean): Record<string, number> {
  const from = r.fromDate.toISOString().slice(0, 10), to = r.toDate.toISOString().slice(0, 10);
  if (r.duration !== "FULL_DAY") return { [from]: DURATION_FRACTION[r.duration] };
  return Object.fromEntries(eachDay(from, to).filter(isWorking).map((d) => [d, 1]));
}
