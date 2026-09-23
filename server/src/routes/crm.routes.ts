import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { requireCrmUser } from "../middleware/crmAccess";
import * as clients from "../controllers/crm/clients.controller";
import * as leads from "../controllers/crm/leads.controller";
import * as quotes from "../controllers/crm/quotes.controller";
import * as tasks from "../controllers/crm/tasks.controller";

const router = Router();
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
router.post("/quotes/:id/pending-payments/:pendingId/approve", quotes.approveQuotePendingPayment);

router.get("/tasks", tasks.listTasks);
router.post("/clients/:clientId/tasks", tasks.createTask);
router.patch("/tasks/:id", tasks.updateTask);
router.post("/tasks/:id/attachments", tasks.addTaskAttachment);
router.delete("/tasks/:id/attachments/:attachmentId", tasks.removeTaskAttachment);

export default router;
