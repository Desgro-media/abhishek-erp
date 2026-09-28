import { Router } from "express";
import rateLimit from "express-rate-limit";
import { listOpenPositionsPublic, submitApplicationPublic } from "../controllers/public.controller";

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
router.post("/apply", applyRateLimiter, submitApplicationPublic);

export default router;
