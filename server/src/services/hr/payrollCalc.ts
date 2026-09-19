import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { computeLopDays } from "./leaveBalance";
import { workingDaysInMonth } from "./workingDays";

// Same formula as the old computePayrollRow() in app.js: 60/20/20 basic/HRA/
// special split, 12% PF on basic, flat ₹200 PT, LOP priced at gross/working
// days, advance deduction capped at each Recovering advance's balance.
// `db` defaults to the shared client; a caller already inside a transaction passes its
// own client so the whole calculation runs on that one connection — otherwise a burst of
// concurrent transactions each holding a connection while waiting for a second one can
// exhaust the pool and stall.
export async function computePayrollRow(employeeId: string, month: string, db: Prisma.TransactionClient = prisma) {
  const entry = await db.payrollEntry.findUnique({
    where: { employeeId_month: { employeeId, month } },
    include: { payments: { orderBy: { paidDate: "asc" } } },
  });
  if (!entry) return null;

  const gross = Number(entry.gross);
  const basic = Math.round(gross * 0.6);
  const hra = Math.round(gross * 0.2);
  const special = gross - basic - hra;
  const pf = Math.round(basic * 0.12);
  const pt = 200;

  const recoveringAdvances = await db.advance.findMany({ where: { employeeId, status: "RECOVERING" } });
  const advDeduction = recoveringAdvances.reduce((sum, a) => sum + Math.min(Number(a.monthlyDeduction), Number(a.balance)), 0);

  const monthWorkingDays = await workingDaysInMonth(month, db);
  const lopDays = await computeLopDays(employeeId, db);
  const perDayRate = monthWorkingDays ? gross / monthWorkingDays : 0;
  const lopDeduction = Math.round(perDayRate * lopDays);

  const totalDeductions = pf + pt + advDeduction + lopDeduction;
  const net = gross - totalDeductions;
  const paid = entry.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const balance = Math.max(0, net - paid);
  const payStatus = paid <= 0 ? "Unpaid" : balance > 0 ? "Partially Paid" : "Paid";

  return {
    employeeId,
    month,
    gross,
    basic,
    hra,
    special,
    pf,
    pt,
    advDeduction,
    lopDays,
    lopDeduction,
    monthWorkingDays,
    totalDeductions,
    net,
    paid,
    balance,
    payStatus,
    payments: entry.payments,
  };
}

// A payment that fully clears a month's balance also applies that month's
// deduction to every Recovering advance for the employee — the deduction was
// already taken out of net pay, so this is what actually pays the advance down.
// Shared by HR's manual payroll payment and by an approved withdrawal request
// that happens to clear the balance, so the two can never drift apart.
export async function applyAdvanceRecovery(db: Pick<Prisma.TransactionClient, "advance">, employeeId: string): Promise<void> {
  const recovering = await db.advance.findMany({ where: { employeeId, status: "RECOVERING" } });
  for (const a of recovering) {
    const newBalance = Math.max(0, Number(a.balance) - Number(a.monthlyDeduction));
    await db.advance.update({
      where: { id: a.id },
      data: { balance: newBalance, status: newBalance === 0 ? "RECOVERED" : "RECOVERING" },
    });
  }
}

// The payroll month a Withdrawal Request can draw against: the most recent one
// that has fully ended, i.e. the calendar month before today's. (Uses the
// server's local calendar, like workingDaysInMonth — for a couple of hours
// around midnight on the 1st the server and IST can disagree by a month.)
export function closedPayrollMonth(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
