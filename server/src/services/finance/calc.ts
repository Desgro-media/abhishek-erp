// Pure computed-figure helpers shared between the invoice/payable
// controllers and the P&L/Balance Sheet report endpoints — mirrors the old
// prototype's invoiceTotal/Paid/Balance/Status and payablePaid/Balance/Status,
// which were always derived, never stored.
type Money = { amount: unknown }; // Decimal | number, always passed through Number()

export function sumAmounts(rows: Money[]): number {
  return rows.reduce((s, r) => s + Number(r.amount), 0);
}

export function invoiceTotal(items: Money[]): number {
  return sumAmounts(items);
}

export function invoicePaidAsOf(payments: { amount: unknown; paidDate: Date }[], asOf?: Date): number {
  return sumAmounts(payments.filter((p) => !asOf || p.paidDate <= asOf));
}

export function invoiceStatus(total: number, paid: number, dueAt: Date, today: Date): "Paid" | "Partially Paid" | "Pending" | "Overdue" {
  const balance = total - paid;
  if (balance <= 0) return "Paid";
  if (paid > 0) return "Partially Paid";
  return dueAt < today ? "Overdue" : "Pending";
}

export function payableStatus(amount: number, paid: number): "Paid" | "Partially Paid" | "Pending" {
  const balance = amount - paid;
  if (balance <= 0) return "Paid";
  if (paid > 0) return "Partially Paid";
  return "Pending";
}
