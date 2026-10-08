// READ-ONLY. Lists existing Commission / Sales Bonus entries whose month differs from the month the
// client's money was RECEIVED (InvoicePayment.paidDate), i.e. the entries that would move if re-dated to
// the received date. Changes nothing. Run: npx tsx scripts/report-commission-redate.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ym = (d: Date) => d.toISOString().slice(0, 7);

async function main() {
  const entries = await prisma.payable.findMany({
    where: { category: { in: ["COMMISSION", "SALES_BONUS"] }, sourcePaymentId: { not: null } },
    include: { payments: true },
  });
  const payments = await prisma.invoicePayment.findMany({ where: { id: { in: entries.map((e) => e.sourcePaymentId!) } }, select: { id: true, paidDate: true } });
  const received = new Map(payments.map((p) => [p.id, p.paidDate]));

  const groups = new Map<string, { count: number; amount: number; paidOut: number }>();
  const rows: string[] = [];
  for (const e of entries) {
    const rd = received.get(e.sourcePaymentId!);
    if (!rd || ym(rd) === ym(e.dueAt)) continue;
    const key = `${e.category}: ${ym(e.dueAt)} -> ${ym(rd)}`;
    const g = groups.get(key) ?? { count: 0, amount: 0, paidOut: 0 };
    g.count++; g.amount += Number(e.amount); g.paidOut += e.payments.reduce((s, p) => s + Number(p.amount), 0);
    groups.set(key, g);
    rows.push(`${e.id}  ${e.salesPerson}  ${e.category}  ${Number(e.amount)}  ${ym(e.dueAt)} -> ${ym(rd)}  ${e.payments.length ? "(partly/fully paid)" : ""}`);
  }
  console.log(`${rows.length} of ${entries.length} entries would move month.\n`);
  for (const [k, g] of [...groups].sort()) console.log(`${k}   entries=${g.count}  amount=${g.amount}  already paid out=${g.paidOut}`);
  if (rows.length) console.log("\nDetail:\n" + rows.join("\n"));
}
main().finally(() => prisma.$disconnect());
