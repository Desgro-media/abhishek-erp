import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { isFinanceAdmin } from "../../middleware/financeAccess";
import { getSalesPolicy, monthlyApprovedSales, bonusForTotal } from "../../services/finance/salesTarget";
import { salesPolicyUpdateSchema } from "../../validation/finance.schemas";

// Readable by Finance/Admin (to manage it) and Sales (to know what they're
// aiming for on their own workspace) — writes stay Finance/Admin only, see
// updateSalesPolicy below.
export const getSalesPolicyHandler: RequestHandler = asyncHandler(async (_req, res) => {
  res.json(await getSalesPolicy());
});

export const updateSalesPolicy: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = salesPolicyUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;

  const before = await getSalesPolicy();
  const policy = await prisma.salesPolicy.upsert({
    where: { id: 1 },
    create: { id: 1, monthlyTarget: d.monthlyTarget ?? 500000, bonusRate: d.bonusRate ?? 0.1 },
    update: { monthlyTarget: d.monthlyTarget, bonusRate: d.bonusRate },
  });

  await recordAudit({
    userId: req.user!.sub,
    action: "FIN_SALES_POLICY_UPDATE",
    entityType: "SalesPolicy",
    entityId: "1",
    beforeData: before,
    afterData: { monthlyTarget: Number(policy.monthlyTarget), bonusRate: Number(policy.bonusRate) },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] ?? null,
  });

  res.json({ monthlyTarget: Number(policy.monthlyTarget), bonusRate: Number(policy.bonusRate) });
});

// Finance/Admin sees every Sales-dept employee's this-month standing; a
// Sales login only ever sees their own row, regardless of ?salesPerson.
export const listSalesTargets: RequestHandler = asyncHandler(async (req, res) => {
  const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
  const { monthlyTarget, bonusRate } = await getSalesPolicy();
  const admin = isFinanceAdmin(req.user?.roles);

  const names = admin
    ? (await prisma.employee.findMany({ where: { dept: "Sales", employmentStatus: { not: "LEFT" } }, select: { name: true } })).map((e) => e.name)
    : [req.user!.name];

  const { start, end } = (() => {
    const [y, m] = month.split("-").map(Number);
    return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 0, 23, 59, 59)) };
  })();

  const rows = await Promise.all(
    names.map(async (salesPerson) => {
      const monthlySales = await monthlyApprovedSales(prisma, salesPerson, month);
      const bonusPayables = await prisma.payable.aggregate({
        where: { category: "SALES_BONUS", salesPerson, dueAt: { gte: start, lte: end } },
        _sum: { amount: true },
      });
      return {
        salesPerson,
        monthlySales,
        target: monthlyTarget,
        bonusRate,
        bonusEarnedThisMonth: Number(bonusPayables._sum.amount ?? 0),
        // Live, not-yet-materialized figure — useful for a progress bar
        // mid-month before the next approval actually creates the payable.
        projectedBonus: Math.round(bonusForTotal(monthlySales, monthlyTarget, bonusRate)),
      };
    })
  );

  res.json({ month, rows });
});
