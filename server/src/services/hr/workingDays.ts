import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";

// Mirrors app.js's workingDaysInRange/workingDaysInMonth exactly (same
// weeklyOff + holiday-list logic) so payroll math matches what HR already
// sees on the calendar/attendance screens.
// `db` lets a caller already inside a transaction run this on that same connection.
export async function workingDaysInMonth(month: string, db: Prisma.TransactionClient = prisma): Promise<number> {
  const policy = await db.hrPolicy.findUnique({ where: { id: 1 } });
  const weeklyOff = policy?.weeklyOff ?? 0;
  const holidays = await db.holiday.findMany({ select: { date: true } });
  const holidaySet = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));

  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  let count = 0;
  for (let day = 1; day <= lastDay; day++) {
    const d = new Date(y, m - 1, day);
    const ds = d.toISOString().slice(0, 10);
    if (d.getDay() !== weeklyOff && !holidaySet.has(ds)) count++;
  }
  return count;
}
