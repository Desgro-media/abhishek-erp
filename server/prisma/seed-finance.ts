// Loads sample Finance data — bank accounts, chart of accounts, a handful
// of invoices/payables/expenses and one journal entry — matching the shapes
// documented in the old public/js/app.js prototype (not a byte-identical
// replica of every seeded row there, which would need another research pass;
// this is enough to make the module demonstrable end to end). Safe to
// re-run: no-ops if bank accounts already exist.
import { PrismaClient } from "@prisma/client";
import { recordBankTxn } from "../src/services/finance/bankLedger";

const prisma = new PrismaClient();

export async function seedFinance() {
  const already = await prisma.bankAccount.count();
  if (already > 0) {
    console.log("Finance seed skipped — bank accounts already present.");
    return;
  }

  const [bank1, bank2, bank3] = await Promise.all([
    prisma.bankAccount.create({ data: { name: "Federal Bank — Current A/c", bank: "Federal Bank", number: "•••• 4821", opening: 250000, openedAt: new Date("2026-01-01") } }),
    prisma.bankAccount.create({ data: { name: "HDFC Bank", bank: "HDFC Bank", number: "•••• 7734", opening: 120000, openedAt: new Date("2026-01-01") } }),
    prisma.bankAccount.create({ data: { name: "Cash in Hand", bank: "Cash", number: "—", opening: 15000, openedAt: new Date("2026-01-01") } }),
  ]);
  console.log("Seeded 3 bank accounts.");

  const mainAccounts: { name: string; type: "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" }[] = [
    { name: "Bank Balances", type: "ASSET" },
    { name: "Accounts Receivable", type: "ASSET" },
    { name: "Service Revenue", type: "INCOME" },
    { name: "Salaries", type: "EXPENSE" },
    { name: "Rent", type: "EXPENSE" },
    { name: "Commission", type: "EXPENSE" },
    { name: "Vendor", type: "EXPENSE" },
    { name: "Software", type: "EXPENSE" },
    { name: "Equipment", type: "EXPENSE" },
    { name: "Travel", type: "EXPENSE" },
    { name: "Utilities", type: "EXPENSE" },
    { name: "Misc", type: "EXPENSE" },
    { name: "Bad Debts", type: "EXPENSE" },
    { name: "Internal Loan", type: "LIABILITY" },
    { name: "Accounts Payable", type: "LIABILITY" },
  ];
  const coaByName = new Map<string, string>();
  for (const a of mainAccounts) {
    const acc = await prisma.chartOfAccount.create({ data: a });
    coaByName.set(a.name, acc.id);
  }
  for (const cat of ["Rent", "Commission", "Vendor"]) {
    const acc = await prisma.chartOfAccount.create({ data: { name: `${cat} Payable`, type: "LIABILITY", parentId: coaByName.get("Accounts Payable") } });
    coaByName.set(`${cat} Payable`, acc.id);
  }
  console.log(`Seeded ${mainAccounts.length + 3} chart-of-accounts entries.`);

  const invoice1 = await prisma.invoice.create({
    data: {
      invoiceNo: "DG-2026-1041", clientId: "CLI-01", issuedAt: new Date("2026-09-01"), dueAt: new Date("2026-09-15"),
      items: { create: [{ dept: "Marketing Consultation", amount: 45000 }] },
    },
  });
  const payment1 = await prisma.invoicePayment.create({
    data: { invoiceId: invoice1.id, amount: 15000, paidDate: new Date("2026-09-08"), accountId: bank2.id, note: "Partial payment received" },
  });
  await prisma.invoice.create({
    data: {
      invoiceNo: "DG-2026-1042", clientId: "CLI-02", issuedAt: new Date("2026-09-05"), dueAt: new Date("2026-09-10"),
      items: { create: [{ dept: "Performance Marketing", amount: 33000 }] },
    },
  });
  await prisma.invoice.create({
    data: {
      invoiceNo: "DG-2026-1044", clientId: "CLI-03", issuedAt: new Date("2026-08-20"), dueAt: new Date("2026-09-04"),
      items: { create: [{ dept: "Web Development", amount: 28000 }] },
    },
  });
  console.log("Seeded 3 invoices (one partially paid).");

  const rentPayable = await prisma.payable.create({ data: { category: "RENT", payee: "Office rent — September", amount: 45000, dueAt: new Date("2026-09-05") } });
  const rentPayment = await prisma.payablePayment.create({ data: { payableId: rentPayable.id, amount: 45000, paidDate: new Date("2026-09-05"), accountId: bank1.id } });
  const commissionPayable = await prisma.payable.create({
    data: { category: "COMMISSION", payee: "Vishnu Prakash — commission on DG-2026-1041 (Al Noor Interiors)", salesPerson: "Vishnu Prakash", amount: 1500, dueAt: new Date("2026-09-08") },
  });
  await prisma.payable.create({ data: { category: "VENDOR", payee: "Freelance video editor — September batch", amount: 12000, dueAt: new Date("2026-09-20") } });
  console.log("Seeded 3 payables (rent settled, one commission, one vendor).");

  const expense1 = await prisma.expense.create({ data: { category: "SOFTWARE", description: "Canva Pro + Adobe CC renewal", amount: 18500, date: new Date("2026-09-03"), accountId: bank1.id, dept: null } });
  const expense2 = await prisma.expense.create({ data: { category: "TRAVEL", description: "Client site visit — Kochi", amount: 6200, date: new Date("2026-09-10"), accountId: bank3.id, dept: "Marketing Consultation" } });
  console.log("Seeded 2 expenses.");

  await prisma.$transaction(async (tx) => {
    await recordBankTxn(tx, { accountId: bank2.id, date: new Date("2026-09-08"), type: "CREDIT", amount: 15000, note: `Invoice ${invoice1.invoiceNo}`, refType: "INVOICE_PAYMENT", refId: payment1.id });
    await recordBankTxn(tx, { accountId: bank1.id, date: new Date("2026-09-05"), type: "DEBIT", amount: 45000, note: "RENT — Office rent — September", refType: "PAYABLE_PAYMENT", refId: rentPayment.id });
    await recordBankTxn(tx, { accountId: bank1.id, date: new Date("2026-09-03"), type: "DEBIT", amount: 18500, note: expense1.description, refType: "EXPENSE", refId: expense1.id });
    await recordBankTxn(tx, { accountId: bank3.id, date: new Date("2026-09-10"), type: "DEBIT", amount: 6200, note: expense2.description, refType: "EXPENSE", refId: expense2.id });
  });
  console.log("Posted matching ledger rows for the seeded payment/rent/expenses.");

  await prisma.journalEntry.create({
    data: {
      date: new Date("2026-09-08"),
      memo: "Write off old outstanding balance — Green Leaf Wellness (pre-system, uncollectable)",
      lines: {
        create: [
          { coaAccountId: coaByName.get("Bad Debts"), side: "DEBIT", amount: 5000 },
          { coaAccountId: coaByName.get("Accounts Receivable"), side: "CREDIT", amount: 5000 },
        ],
      },
    },
  });
  console.log("Seeded 1 journal entry.");

  console.log("Commission payable seeded for Vishnu Prakash — try a commission withdrawal request against it.");
  void commissionPayable;
}

if (require.main === module) {
  seedFinance()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
