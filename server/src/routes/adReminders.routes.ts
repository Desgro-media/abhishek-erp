import { Router, RequestHandler } from "express";
import { authenticate } from "../middleware/auth";
import { env } from "../config/env";
import { prisma } from "../db/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { runAdReminders, ESCALATE_AFTER, LOOKBACK_DAYS } from "../services/adReminders";

const router = Router();
router.use(authenticate);

const requireAdmin: RequestHandler = (req, res, next) =>
  (req.user?.roles ?? []).includes("ADMIN") ? next() : res.status(403).json({ error: "Forbidden — Admin only" });

// What today's reminder WOULD send, without sending anything (always a dry run) — so Admin can check who gets
// told and what's missing before trusting it. Also reports whether the daily job and email are switched on.
router.get("/preview", requireAdmin, asyncHandler(async (_req, res) => {
  const r = await runAdReminders({ send: false });
  const last = await prisma.adReminderRun.findFirst({ orderBy: { runDate: "desc" } });
  res.json({
    enabled: env.AD_REMINDERS_ENABLED,
    hourIst: env.AD_REMINDERS_HOUR,
    emailConfigured: !!(env.SMTP_USER && env.SMTP_PASS),
    escalateAfter: ESCALATE_AFTER,
    lookbackDays: LOOKBACK_DAYS,
    lastRun: last ? { date: last.runDate.toISOString().slice(0, 10), finishedAt: last.finishedAt, summary: last.summary } : null,
    today: r.today, startDate: r.startDate, checkedDates: r.checkedDates, digests: r.digests,
  });
}));

export default router;
