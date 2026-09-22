import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { requireFinanceAdmin, requireFinanceAdminOrSales } from "../middleware/financeAccess";
import * as bank from "../controllers/finance/bankAccounts.controller";
import * as invoices from "../controllers/finance/invoices.controller";
import * as payables from "../controllers/finance/payables.controller";
import * as expenses from "../controllers/finance/expenses.controller";
import * as coa from "../controllers/finance/coa.controller";
import * as journal from "../controllers/finance/journal.controller";
import * as paymentRequests from "../controllers/finance/paymentRequests.controller";
import * as withdrawals from "../controllers/finance/withdrawalRequests.controller";
import * as commissions from "../controllers/finance/commissions.controller";
import * as salesTargets from "../controllers/finance/salesTargets.controller";
import * as reports from "../controllers/finance/reports.controller";

const router = Router();
router.use(authenticate);

// Bank accounts, ledger, transfers — Finance/Admin only.
router.get("/bank-accounts", requireFinanceAdmin, bank.listBankAccounts);
router.post("/bank-accounts", requireFinanceAdmin, bank.createBankAccount);
router.patch("/bank-accounts/:id", requireFinanceAdmin, bank.updateBankAccount);
router.delete("/bank-accounts/:id", requireFinanceAdmin, bank.deleteBankAccount);
router.get("/bank-accounts/:id/ledger", requireFinanceAdmin, bank.getLedger);
router.post("/transfers", requireFinanceAdmin, bank.createTransfer);

// Invoices — full CRUD is Finance/Admin; Sales gets a narrow self-service
// slice (list their own, submit a collected payment) — see ACCESS MODEL.
router.get("/invoices", requireFinanceAdminOrSales, invoices.listInvoices);
router.get("/invoices/:id", requireFinanceAdminOrSales, invoices.getInvoice);
router.post("/invoices", requireFinanceAdmin, invoices.createInvoice);
router.patch("/invoices/:id", requireFinanceAdmin, invoices.updateInvoice);
router.delete("/invoices/:id", requireFinanceAdmin, invoices.deleteInvoice);
router.post("/invoices/:id/payments", requireFinanceAdmin, invoices.recordInvoicePayment);
router.post("/invoices/:id/pending-payments", requireFinanceAdminOrSales, invoices.submitPendingPayment);
router.delete("/invoices/:id/pending-payments/:pendingId", requireFinanceAdminOrSales, invoices.deletePendingPayment);
router.post("/invoices/:id/pending-payments/:pendingId/approve", requireFinanceAdmin, invoices.approvePendingPayment);

// Payables — writes are Finance/Admin only; reads also let Sales through
// (the controller itself scopes a Sales caller to just their own
// Commission/Sales Bonus rows — see listPayables).
// Expenses, chart of accounts, journal remain Finance/Admin only.
router.get("/payables", requireFinanceAdminOrSales, payables.listPayables);
router.post("/payables", requireFinanceAdmin, payables.createPayable);
router.patch("/payables/:id", requireFinanceAdmin, payables.updatePayable);
router.delete("/payables/:id", requireFinanceAdmin, payables.deletePayable);
router.post("/payables/:id/payments", requireFinanceAdmin, payables.recordPayablePayment);

router.get("/expenses", requireFinanceAdmin, expenses.listExpenses);
router.post("/expenses", requireFinanceAdmin, expenses.createExpense);
router.patch("/expenses/:id", requireFinanceAdmin, expenses.updateExpense);
router.delete("/expenses/:id", requireFinanceAdmin, expenses.deleteExpense);

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

// Payment requests (reimbursement / travel / purchase — anything but salary).
// Raising and viewing your own is open to ANY signed-in employee, so there's
// deliberately no role guard on those two — the controller scopes the list to
// the caller's own linked Employee and files requests only as the caller.
// Deciding one moves real money out, so approve/reject are Finance/Admin only
// and both write an audit row (who, what, when) atomically with the decision.
router.get("/payment-requests", paymentRequests.listPaymentRequests);
router.post("/payment-requests", paymentRequests.createPaymentRequest);
router.post("/payment-requests/:id/approve", requireFinanceAdmin, paymentRequests.approvePaymentRequest);
router.post("/payment-requests/:id/reject", requireFinanceAdmin, paymentRequests.rejectPaymentRequest);

// Salary withdrawal requests — salary ALREADY EARNED in a closed payroll month,
// paid out early (distinct from Advance Salary, which is HR-approved against the
// still-open month). Raising one and checking your own eligibility is open to any
// signed-in employee; the controller pins both to the caller's own linked Employee
// and the server — not the client — decides the month and caps the amount. Listing
// also lets HR (who run payroll) see everyone's. Deciding one moves real money out,
// so approve/reject are Finance/Admin only, audit-logged atomically.
router.get("/withdrawal-requests", withdrawals.listWithdrawalRequests);
router.get("/withdrawal-requests/eligibility", withdrawals.getWithdrawalEligibility);
router.post("/withdrawal-requests", withdrawals.createWithdrawalRequest);
router.post("/withdrawal-requests/:id/approve", requireFinanceAdmin, withdrawals.approveWithdrawalRequest);
router.post("/withdrawal-requests/:id/reject", requireFinanceAdmin, withdrawals.rejectWithdrawalRequest);

// Monthly sales target + bonus — the target/rate are readable by Sales (to
// show progress on their own workspace) but only writable by Finance/Admin;
// the team-wide view is scoped to "just me" for a Sales caller inside the
// controller itself, same pattern as commission-withdrawals above.
router.get("/sales-policy", requireFinanceAdminOrSales, salesTargets.getSalesPolicyHandler);
router.patch("/sales-policy", requireFinanceAdmin, salesTargets.updateSalesPolicy);
router.get("/sales-targets", requireFinanceAdminOrSales, salesTargets.listSalesTargets);

// Reports — Finance/Admin only.
router.get("/reports/dept-profitability", requireFinanceAdmin, reports.deptProfitability);
router.get("/reports/pl", requireFinanceAdmin, reports.profitAndLoss);
router.get("/reports/balance-sheet", requireFinanceAdmin, reports.balanceSheet);

export default router;
