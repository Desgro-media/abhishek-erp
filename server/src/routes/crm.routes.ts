import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { requireCrmUser, requireClientsUser } from "../middleware/crmAccess";
import { requireFinanceAdmin } from "../middleware/financeAccess";
import * as clients from "../controllers/crm/clients.controller";
import * as leads from "../controllers/crm/leads.controller";
import * as quotes from "../controllers/crm/quotes.controller";
import * as tasks from "../controllers/crm/tasks.controller";
import * as collab from "../controllers/crm/clientCollab.controller";
import * as adMetrics from "../controllers/crm/clientAdMetrics.controller";
import * as boardCards from "../controllers/crm/boardCards.controller";
import * as boardSetup from "../controllers/crm/boardSetup.controller";
import * as serviceMeetings from "../controllers/crm/serviceMeetings.controller";
import * as clientFeedback from "../controllers/crm/clientFeedback.controller";
import * as salesMeetings from "../controllers/crm/salesMeetings.controller";
import * as clientReport from "../controllers/crm/clientReport.controller";

const router = Router();

// Approving a quote payment is a Finance decision (it posts to the bank ledger and credits
// commission), exactly like approving an invoice payment — so it's gated on Finance/Admin,
// not on CRM access. Registered before the CRM-wide guard so a Finance-only user (not a CRM
// user) can reach it, and so Sales can't approve their own payment.
router.post("/quotes/:id/pending-payments/:pendingId/approve", authenticate, requireFinanceAdmin, quotes.approveQuotePendingPayment);

router.use(authenticate);

// Clients and client tasks are open to a Clients-only login as well; leads and quotes stay Sales/Admin.
router.get("/clients", requireClientsUser, clients.listClients);
router.get("/clients/:id", requireClientsUser, clients.getClient);
// Any signed-in login: tasksForUser scopes it (assignee / creator / book / all), so an Employee sees their own assigned work.
router.get("/tasks", tasks.listTasks);
router.patch("/tasks/:id", tasks.updateTask); // assignee-only stage moves enforced inside
router.post("/tasks/:id/attachments", tasks.addTaskAttachment);
router.delete("/tasks/:id/attachments/:attachmentId", tasks.removeTaskAttachment);
router.get("/clients/:id/lead-advances", requireClientsUser, leads.getClientLeadAdvances);
// Client satisfaction feedback — who may read/share/log is decided inside each handler (account manager, leadership, heads).
router.get("/clients/:clientId/feedback", clientFeedback.getClientFeedback);
router.post("/clients/:clientId/feedback", clientFeedback.logClientFeedback);
router.post("/clients/:clientId/feedback-link", clientFeedback.upsertFeedbackLink);
// Shareable read-only report for a Performance Marketing client (the public side lives in public.routes).
router.get("/clients/:id/report-link", clientReport.getReportLink);
router.post("/clients/:id/report-link", clientReport.makeReportLink);
router.delete("/clients/:id/report-link", clientReport.removeReportLink);
router.get("/sales-meetings", salesMeetings.listSalesMeetings);
router.post("/sales-meetings", salesMeetings.logSalesMeeting);

// Client collaboration data (ad access, brief, brand assets, meetings) — row-scoped to the one client in
// the URL inside each handler, so it's open to anyone with Clients access, reads and writes alike.
router.get("/clients/:id/collab", requireClientsUser, collab.getClientCollab);
router.put("/clients/:id/ad-access", requireClientsUser, collab.upsertAdAccess);
router.put("/clients/:id/campaign-brief", requireClientsUser, collab.upsertCampaignBrief);
router.post("/clients/:id/brand-assets", requireClientsUser, collab.addBrandAsset);
router.delete("/clients/:id/brand-assets/:assetId", requireClientsUser, collab.removeBrandAsset);
router.post("/clients/:id/meetings", requireClientsUser, collab.logMeeting);
router.delete("/clients/:id/meetings/:meetingId", requireClientsUser, collab.deleteMeeting);
router.get("/clients/:id/ad-metrics", requireClientsUser, adMetrics.listClientAdMetrics);
router.get("/service-boards", boardCards.getServiceBoards);
router.get("/client-meetings", requireClientsUser, serviceMeetings.listCalendarMeetings);
router.post("/clients/:id/service-meetings", requireClientsUser, serviceMeetings.createServiceMeeting);
router.put("/clients/:id/service-meetings/:meetingId", requireClientsUser, serviceMeetings.updateServiceMeeting);
router.post("/clients/:id/service-meetings/:meetingId/cancel", requireClientsUser, serviceMeetings.cancelServiceMeeting);
router.delete("/clients/:id/service-meetings/:meetingId", requireClientsUser, serviceMeetings.deleteServiceMeeting);
router.put("/clients/:id/web-details", requireClientsUser, serviceMeetings.saveWebDetails);
router.put("/service-boards/:service", boardSetup.saveBoardSetup); // leadership / the department head, checked inside
router.post("/clients/:id/board-cards", requireClientsUser, boardCards.createBoardCard);
router.patch("/board-cards/:id", requireClientsUser, boardCards.updateBoardCard);
router.delete("/board-cards/:id", requireClientsUser, boardCards.deleteBoardCard);
router.post("/clients/:id/board-projects", requireClientsUser, boardCards.createBoardProject);
router.post("/clients/:id/board-cycles", requireClientsUser, boardCards.createBoardCycle);
router.delete("/clients/:id/board-projects/:projectId", requireClientsUser, boardCards.deleteBoardProject);
router.put("/clients/:id/ad-currency", requireClientsUser, adMetrics.setClientAdCurrency);
router.post("/clients/:id/ad-metrics", requireClientsUser, adMetrics.upsertClientAdMetric);
router.delete("/clients/:id/ad-metrics/:metricId", requireClientsUser, adMetrics.deleteClientAdMetric);

router.use(requireCrmUser);
router.post("/clients", clients.createClient);
router.patch("/clients/:id", clients.updateClient);
router.patch("/clients/:id/archive", clients.archiveClient);
router.patch("/clients/:id/restore", clients.restoreClient);
router.delete("/clients/:id", clients.deleteClient);

router.get("/leads", leads.listLeads);
router.post("/leads", leads.createLead);
router.patch("/leads/:id", leads.updateLead);
router.patch("/leads/:id/stage", leads.setLeadStage);
router.post("/leads/:id/lost", leads.markLeadLost);
router.get("/leads/:id/payments", leads.listLeadPayments);
router.post("/leads/:id/payments", leads.recordLeadPayment);
router.delete("/leads/:id/payments/:paymentId", leads.deleteLeadPayment);
router.post("/leads/:id/convert", leads.convertLead);
router.get("/lead-settings", leads.getLeadSettings);
router.put("/lead-settings", leads.updateLeadSettings);
router.delete("/leads/:id", leads.deleteLead);

router.get("/quotes", quotes.listQuotes);
router.post("/quotes", quotes.createQuote);
router.patch("/quotes/:id", quotes.updateQuote);
router.delete("/quotes/:id", quotes.deleteQuote);
router.post("/quotes/:id/send", quotes.sendQuote);
router.post("/quotes/:id/lost", quotes.markQuoteLost);
router.post("/quotes/:id/convert-to-invoice", quotes.convertQuoteToInvoice);
router.post("/quotes/:id/pending-payments", quotes.submitQuotePendingPayment);
router.delete("/quotes/:id/pending-payments/:pendingId", quotes.deleteQuotePendingPayment);

router.post("/clients/:clientId/tasks", tasks.createTask);

export default router;
