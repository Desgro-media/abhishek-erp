import { Router } from "express";
import rateLimit from "express-rate-limit";
import { getClientReportPublic } from "../controllers/crm/clientReport.controller";
import { listOpenPositionsPublic, submitApplicationPublic, handleResumeUpload, listLeadServicesPublic, submitLeadPublic, getClientFeedbackPublic, submitClientFeedbackPublic } from "../controllers/public.controller";

const router = Router();

// No authenticate() here — see the comment in public.controller.ts. The rate limiter is this
// route's actual defense (careers.html has no login, no CAPTCHA, nothing else standing between
// the internet and a database write) — same shape as loginRateLimiter, tuned for an occasional
// genuine applicant rather than a login form.
const applyRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many applications submitted from this address — please try again later." },
});

// Same idea for the public lead form: a genuine visitor submits once, so a handful per hour per
// address is plenty; the honeypot field in submitLeadPublic catches the bots that get past this.
const leadRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many submissions from this address — please try again later." },
});

// Client feedback links: a client may rate a few services a month; reads are looser than writes.
const feedbackReadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests — please try again later." } });
const feedbackWriteLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Too many submissions from this address — please try again later." } });
router.get("/client-feedback/:token", feedbackReadLimiter, getClientFeedbackPublic);
router.get("/client-report/:token", feedbackReadLimiter, getClientReportPublic);
router.post("/client-feedback/:token", feedbackWriteLimiter, submitClientFeedbackPublic);

router.get("/lead-services", listLeadServicesPublic);
router.post("/lead", leadRateLimiter, submitLeadPublic);
router.get("/positions", listOpenPositionsPublic);
// Body is multipart/form-data (the optional resume file plus the same text fields as before) —
// handleResumeUpload parses it and populates req.file before submitApplicationPublic runs.
router.post("/apply", applyRateLimiter, handleResumeUpload, submitApplicationPublic);

export default router;
