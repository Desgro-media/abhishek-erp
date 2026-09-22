import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { recordBankTxn } from "../../services/finance/bankLedger";
import { advanceDisburseSchema } from "../../validation/finance.schemas";

const EMPLOYEE_SELECT = { select: { id: true, name: true, employeeCode: true } } as const;

// Finance/Admin only (mounted behind requireFinanceAdmin) — advances HR has
// already approved but Finance hasn't actually paid out yet. Recovery back
// out of payroll is separate and automatic (see payrollCalc's advDeduction);
// this is just the cash leaving the company for the first time.
export const listPendingAdvanceDisbursements: RequestHandler = asyncHandler(async (req, res) => {
  const advances = await prisma.advance.findMany({
    where: { status: "RECOVERING", paidDate: null },
    include: { employee: EMPLOYEE_SELECT },
    orderBy: { decidedAt: "asc" },
  });
  res.json({ advances });
});

// One-time lump-sum payout of the full approved amount, same "approve ==
// pay, compare-and-set, one transaction" shape as approvePaymentRequest.
// Previously HR approving an advance only flipped a status — no bank
// account was ever debited, so the money leaving the company had no
// ledger record at all.
export const disburseAdvance: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = advanceDisburseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
  const d = parsed.data;
  const id = req.params.id;

  const advance = await prisma.advance.findUnique({ where: { id }, include: { employee: EMPLOYEE_SELECT } });
  if (!advance) return res.status(404).json({ error: "Advance not found" });
  if (advance.status !== "RECOVERING") return res.status(409).json({ error: "Only an HR-approved advance can be paid out" });
  if (advance.paidDate) return res.status(409).json({ error: "Already paid out" });
  const account = await prisma.bankAccount.findUnique({ where: { id: d.accountId } });
  if (!account) return res.status(400).json({ error: "Bank account not found" });

  const date = new Date(d.date);
  const outcome = await prisma.$transaction(async (tx) => {
    const claimed = await tx.advance.updateMany({
      where: { id, status: "RECOVERING", paidDate: null },
      data: { paidDate: date, accountId: d.accountId, paidBy: req.user!.sub },
    });
    if (claimed.count === 0) return null;
    await recordBankTxn(tx, {
      accountId: d.accountId,
      date,
      type: "DEBIT",
      amount: Number(advance.amount),
      note: `Advance salary — ${advance.employee.name} (${advance.employee.employeeCode})`,
      refType: "ADVANCE",
      refId: id,
    });
    await recordAudit({
      userId: req.user!.sub,
      action: "FIN_ADVANCE_DISBURSE",
      entityType: "Advance",
      entityId: id,
      afterData: { accountId: d.accountId, paidDate: d.date, amount: Number(advance.amount) },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] ?? null,
    }, tx);
    return tx.advance.findUniqueOrThrow({ where: { id }, include: { employee: EMPLOYEE_SELECT } });
  });
  if (!outcome) return res.status(409).json({ error: "Already paid out" });
  res.json({ advance: outcome });
});
