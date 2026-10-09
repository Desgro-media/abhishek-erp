import { RequestHandler } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordAudit } from "../../services/audit.service";
import { MAX_BACKDATE_DAYS } from "../../services/finance/pendingPayment";
import { carryLeadAdvances, LEAD_PAYMENT_MODE_LABEL } from "../../services/leadPayments";

// Finance's read-only view of advances leads have paid that haven't reached the books yet, so none is
// forgotten. Seeing a row here moves no money: money moves only when Finance approves the pending payment
// an advance becomes on an invoice (Payment Receipts), exactly like any other payment.
export const listLeadAdvances: RequestHandler = asyncHandler(async (req, res) => {
  const includeApproved = req.query.status === "all";
  const rows = await prisma.leadPayment.findMany({
    where: includeApproved ? {} : { OR: [{ invoicePendingPaymentId: null }, { invoicePendingPayment: { approved: false } }] },
    include: { lead: { select: { id: true, leadCode: true, name: true, leadOwner: true, convertedClientId: true, stage: true } }, invoicePendingPayment: { include: { invoice: { select: { invoiceNo: true } } } } },
    orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
    take: 500,
  });
  const clientIds = [...new Set(rows.map((r) => r.lead.convertedClientId).filter((x): x is string => !!x))];
  const clients = await prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } });
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const today = Date.now();
  res.json({
    maxBackdateDays: MAX_BACKDATE_DAYS,
    advances: rows.map((r) => {
      const ageDays = Math.floor((today - r.paymentDate.getTime()) / 86400_000);
      return {
        id: r.id, amount: Number(r.amount), reportedDate: r.paymentDate.toISOString().slice(0, 10), mode: LEAD_PAYMENT_MODE_LABEL[r.mode], note: r.note,
        salesPerson: r.salesPerson, lead: { id: r.lead.id, code: r.lead.leadCode, name: r.lead.name, stage: r.lead.stage },
        clientId: r.lead.convertedClientId, clientName: r.lead.convertedClientId ? clientName.get(r.lead.convertedClientId) ?? null : null,
        status: !r.invoicePendingPayment ? "AWAITING_INVOICE" : r.invoicePendingPayment.approved ? "APPROVED" : "ON_INVOICE_PENDING",
        invoiceNo: r.invoicePendingPayment?.invoice.invoiceNo ?? null,
        ageDays,
        // Finance can only approve with a received date inside the window; an older advance needs a decision.
        olderThanApprovalWindow: ageDays > MAX_BACKDATE_DAYS,
      };
    }),
  });
});

// For advances that didn't fit the invoice they were first offered to (or arrived after it): attach what
// fits to this invoice now. Same carry as at invoice creation — pending entries only, nothing is approved here.
export const applyLeadAdvancesToInvoice: RequestHandler = asyncHandler(async (req, res) => {
  const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id }, select: { id: true, clientId: true, invoiceNo: true } });
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  const carried = await prisma.$transaction((tx) => carryLeadAdvances(tx, { clientId: invoice.clientId, invoiceId: invoice.id, actorUserId: req.user!.sub }));
  await recordAudit({ userId: req.user!.sub, action: "FIN_LEAD_ADVANCES_APPLIED", entityType: "Invoice", entityId: invoice.id, afterData: { carried } });
  res.json({ carried });
});
