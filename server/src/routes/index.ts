import { Router } from "express";
import authRoutes from "./auth.routes";
import hrRoutes from "./hr.routes";
import financeRoutes from "./finance.routes";
import crmRoutes from "./crm.routes";
import contentRoutes from "./content.routes";
import notificationRoutes from "./notifications.routes";
import searchRoutes from "./search.routes";
import publicRoutes from "./public.routes";
import adReminderRoutes from "./adReminders.routes";
import calendarRoutes from "./calendar.routes";
import departmentRoutes from "./departments.routes";
import actionPlanRoutes from "./actionPlans.routes";
import scoreRoutes from "./scores.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/hr", hrRoutes);
router.use("/finance", financeRoutes);
router.use("/crm", crmRoutes);
router.use("/content", contentRoutes);
router.use("/notifications", notificationRoutes);
router.use("/search", searchRoutes);
router.use("/ad-reminders", adReminderRoutes);
router.use("/calendar", calendarRoutes);
router.use("/departments", departmentRoutes);
router.use("/action-plans", actionPlanRoutes);
router.use("/scores", scoreRoutes);
// Genuinely unauthenticated — see public.controller.ts. Mounted last so it reads, next to the
// others, as the one deliberate exception rather than an accident of ordering.
router.use("/public", publicRoutes);

export default router;
