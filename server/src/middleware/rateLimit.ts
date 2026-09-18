import rateLimit from "express-rate-limit";

// IP-level throttle on the login endpoint. Per-account lockout (failedLoginCount /
// lockedUntil on User, in auth.service.ts) is the other half — this stops a
// single source from hammering many accounts, that stops one account being
// hammered from many sources.
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts from this address — try again later." },
});
