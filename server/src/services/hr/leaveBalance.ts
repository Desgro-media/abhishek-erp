import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { Decimal } from "@prisma/client/runtime/library";

type LeaveTypeKey = "CASUAL" | "SICK" | "EARNED";
const TYPES: LeaveTypeKey[] = ["CASUAL", "SICK", "EARNED"];
const POLICY_FIELD: Record<LeaveTypeKey, "casualLeaveDays" | "sickLeaveDays" | "earnedLeaveDays"> = {
  CASUAL: "casualLeaveDays",
  SICK: "sickLeaveDays",
  EARNED: "earnedLeaveDays",
};

// Real computation from the actual request/adjustment history — the old
// prototype hardcoded "days used" per employee instead of deriving it from
// `leaveRequests`, so this is a genuine fix, not a straight port.
// `db` lets a caller already inside a transaction run this on that same connection.
export async function computeLeaveBalance(employeeId: string, db: Prisma.TransactionClient = prisma) {
  const policy = await db.hrPolicy.findUnique({ where: { id: 1 } });
  const base = {
    casualLeaveDays: policy?.casualLeaveDays ?? 12,
    sickLeaveDays: policy?.sickLeaveDays ?? 8,
    earnedLeaveDays: policy?.earnedLeaveDays ?? 15,
  };

  const [adjustments, approved] = await Promise.all([
    db.leaveBalanceAdjustment.groupBy({ by: ["type"], where: { employeeId }, _sum: { days: true } }),
    db.leaveRequest.groupBy({ by: ["type"], where: { employeeId, status: "APPROVED" }, _sum: { days: true } }),
  ]);

  const adjByType = Object.fromEntries(adjustments.map((a) => [a.type, Number(a._sum.days ?? 0)]));
  const usedByType = Object.fromEntries(approved.map((a) => [a.type, Number(a._sum.days ?? 0)]));

  const balance: Record<string, { used: number; total: number; remaining: number }> = {};
  for (const type of TYPES) {
    const total = base[POLICY_FIELD[type]] + (adjByType[type] ?? 0);
    const used = usedByType[type] ?? 0;
    balance[type.toLowerCase()] = { used, total, remaining: total - used };
  }
  return balance;
}

// Loss-of-pay days = approved leave taken beyond the computed balance for
// CASUAL/SICK/EARNED, plus all approved UNPAID leave outright.
export async function computeLopDays(employeeId: string, db: Prisma.TransactionClient = prisma): Promise<number> {
  const balance = await computeLeaveBalance(employeeId, db);
  const overBalance = TYPES.reduce((sum, t) => sum + Math.max(0, -balance[t.toLowerCase()].remaining), 0);

  const unpaid = await db.leaveRequest.aggregate({
    where: { employeeId, status: "APPROVED", type: "UNPAID" },
    _sum: { days: true },
  });

  return overBalance + Number(unpaid._sum.days ?? 0);
}

export function decimalToNumber(d: Decimal | number | null | undefined): number {
  if (d == null) return 0;
  return typeof d === "number" ? d : Number(d);
}
