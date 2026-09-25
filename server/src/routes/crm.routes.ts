import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { requireCrmUser } from "../middleware/crmAccess";
import { requireFinanceAdmin } from "../middleware/financeAccess";
import * as clients from "../controllers/crm/clients.controller";
import * as leads from "../controllers/crm/leads.controller";
import * as quotes from "../controllers/crm/quotes.controller";
import * as tasks from "../controllers/crm/tasks.controller";

const router = Router();

// Approving a quote payment is a Finance decision (it posts to the bank ledger and credits
// commission), exactly like approving an invoice payment — so it's gated on Finance/Admin,
// not on CRM access. Registered before the CRM-wide guard so a Finance-only user (not a CRM
// user) can reach it, and so Sales can't approve their own payment.
router.post("/quotes/:id/pending-payments/:pendingId/approve", authenticate, requireFinanceAdmin, quotes.approveQuotePendingPayment);

router.use(authenticate, requireCrmUser);

router.get("/clients", clients.listClients);
router.get("/clients/:id", clients.getClient);
router.post("/clients", clients.createClient);
router.patch("/clients/:id", clients.updateClient);

router.get("/leads", leads.listLeads);
router.post("/leads", leads.createLead);
router.patch("/leads/:id", leads.updateLead);

router.get("/quotes", quotes.listQuotes);
router.post("/quotes", quotes.createQuote);
router.patch("/quotes/:id", quotes.updateQuote);
router.delete("/quotes/:id", quotes.deleteQuote);
router.post("/quotes/:id/send", quotes.sendQuote);
router.post("/quotes/:id/lost", quotes.markQuoteLost);
router.post("/quotes/:id/convert-to-invoice", quotes.convertQuoteToInvoice);
router.post("/quotes/:id/pending-payments", quotes.submitQuotePendingPayment);
router.delete("/quotes/:id/pending-payments/:pendingId", quotes.deleteQuotePendingPayment);

router.get("/tasks", tasks.listTasks);
router.post("/clients/:clientId/tasks", tasks.createTask);
router.patch("/tasks/:id", tasks.updateTask);
router.post("/tasks/:id/attachments", tasks.addTaskAttachment);
router.delete("/tasks/:id/attachments/:attachmentId", tasks.removeTaskAttachment);

export default router;
