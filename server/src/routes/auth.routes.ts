import { Router } from "express";
import { loginHandler, refreshHandler, logoutHandler, meHandler } from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth";
import { loginRateLimiter } from "../middleware/rateLimit";

const router = Router();

router.post("/login", loginRateLimiter, loginHandler);
router.post("/refresh", refreshHandler);
router.post("/logout", logoutHandler);
router.get("/me", authenticate, meHandler);

export default router;
