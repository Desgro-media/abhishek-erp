import { prisma } from "../../db/prisma";
import { invoiceTotal } from "./calc";

// Single source of truth for "how much revenue did we actually receive this
// month" — cash basis, not accrual: only Finance-approved invoice payments
// (InvoicePayment rows), attributed to the month the payment landed, not the
// month the invoice was raised. An invoice with no approved payment yet
// contributes zero. Both deptProfitability and the P&L's income line must
// call this instead of recomputing it themselves, so the two reports can
// never drift out of sync with each other.
export type MonthlyInvoiceRevenue = {
  totalRevenue: number;
  byDept: Map<string, number>;
  incomeDetail: { invoiceNo: string; clientId: string; amount: number; date: Date }[];
};

function isoMonth(d: Date): string {
  return d.toISOString().slice(0, 7);
}

export async function monthlyApprovedInvoiceRevenue(month: string): Promise<MonthlyInvoiceRevenue> {
  const invoices = await prisma.invoice.findMany({ include: { items: true, payments: true } });
  const byDept = new Map<string, number>();
  const incomeDetail: { invoiceNo: string; clientId: string; amount: number; date: Date }[] = [];
  let totalRevenue = 0;

  for (const inv of invoices) {
    const total = invoiceTotal(inv.items);
    if (total <= 0) continue;
    for (const p of inv.payments) {
      if (isoMonth(p.paidDate) !== month) continue;
      const amount = Number(p.amount);
      totalRevenue += amount;
      incomeDetail.push({ invoiceNo: inv.invoiceNo, clientId: inv.clientId, amount, date: p.paidDate });
      for (const item of inv.items) {
        byDept.set(item.dept, (byDept.get(item.dept) ?? 0) + amount * (Number(item.amount) / total));
      }
    }
  }

  return { totalRevenue, byDept, incomeDetail };
}
