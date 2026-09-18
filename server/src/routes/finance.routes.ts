import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { requireFinanceAdmin, requireFinanceAdminOrSales } from "../middleware/financeAccess";
import * as bank from "../controllers/finance/bankAccounts.controller";
import * as invoices from "../controllers/finance/invoices.controller";
import * as payables from "../controllers/finance/payables.controller";
import * as expenses from "../controllers/finance/expenses.controller";
import * as coa from "../controllers/finance/coa.controller";
import * as journal from "../controllers/finance/journal.controller";
import * as commissions from "../controllers/finance/commissions.controller";
import * as reports from "../controllers/finance/reports.controller";

const router = Router();
router.use(authenticate);

// Bank accounts, ledger, transfers — Finance/Admin only.
router.get("/bank-accounts", requireFinanceAdmin, bank.listBankAccounts);
router.post("/bank-accounts", requireFinanceAdmin, bank.createBankAccount);
router.patch("/bank-accounts/:id", requireFinanceAdmin, bank.updateBankAccount);
router.get("/bank-accounts/:id/ledger", requireFinanceAdmin, bank.getLedger);
router.post("/transfers", requireFinanceAdmin, bank.createTransfer);

// Invoices — full CRUD is Finance/Admin; Sales gets a narrow self-service
// slice (list their own, submit a collected payment) — see ACCESS MODEL.
router.get("/invoices", requireFinanceAdminOrSales, invoices.listInvoices);
router.get("/invoices/:id", requireFinanceAdminOrSales, invoices.getInvoice);
router.post("/invoices", requireFinanceAdmin, invoices.createInvoice);
router.patch("/invoices/:id", requireFinanceAdmin, invoices.updateInvoice);
router.post("/invoices/:id/payments", requireFinanceAdmin, invoices.recordInvoicePayment);
router.post("/invoices/:id/pending-payments", requireFinanceAdminOrSales, invoices.submitPendingPayment);
router.post("/invoices/:id/pending-payments/:pendingId/approve", requireFinanceAdmin, invoices.approvePendingPayment);

// Payables, expenses, chart of accounts, journal — Finance/Admin only.
router.get("/payables", requireFinanceAdmin, payables.listPayables);
router.post("/payables", requireFinanceAdmin, payables.createPayable);
router.patch("/payables/:id", requireFinanceAdmin, payables.updatePayable);
router.post("/payables/:id/payments", requireFinanceAdmin, payables.recordPayablePayment);

router.get("/expenses", requireFinanceAdmin, expenses.listExpenses);
router.post("/expenses", requireFinanceAdmin, expenses.createExpense);
router.patch("/expenses/:id", requireFinanceAdmin, expenses.updateExpense);

router.get("/coa", requireFinanceAdmin, coa.listAccounts);
router.post("/coa", requireFinanceAdmin, coa.createAccount);
router.patch("/coa/:id", requireFinanceAdmin, coa.updateAccountType);
router.delete("/coa/:id", requireFinanceAdmin, coa.removeAccount);

router.get("/journal", requireFinanceAdmin, journal.listJournalEntries);
router.post("/journal", requireFinanceAdmin, journal.createJournalEntry);

// Commissions — Finance/Admin sees everyone; Sales sees/acts on their own.
router.get("/commissions", requireFinanceAdmin, commissions.listCommissionsByPerson);
router.get("/commission-withdrawals", requireFinanceAdminOrSales, commissions.listCommissionWithdrawals);
router.post("/commission-withdrawals", requireFinanceAdminOrSales, commissions.requestCommissionWithdrawal);
router.post("/commission-withdrawals/:id/approve", requireFinanceAdmin, commissions.approveCommissionWithdrawal);
router.post("/commission-withdrawals/:id/reject", requireFinanceAdmin, commissions.rejectCommissionWithdrawal);

// Reports — Finance/Admin only.
router.get("/reports/dept-profitability", requireFinanceAdmin, reports.deptProfitability);
router.get("/reports/pl", requireFinanceAdmin, reports.profitAndLoss);
router.get("/reports/balance-sheet", requireFinanceAdmin, reports.balanceSheet);

export default router;
