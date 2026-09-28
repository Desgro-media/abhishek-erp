import { Router } from "express";
import rateLimit from "express-rate-limit";
import { listOpenPositionsPublic, submitApplicationPublic, handleResumeUpload } from "../controllers/public.controller";

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

router.get("/positions", listOpenPositionsPublic);
// Body is multipart/form-data (the optional resume file plus the same text fields as before) —
// handleResumeUpload parses it and populates req.file before submitApplicationPublic runs.
router.post("/apply", applyRateLimiter, handleResumeUpload, submitApplicationPublic);

export default router;
