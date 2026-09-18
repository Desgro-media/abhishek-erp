import { Router } from "express";
import authRoutes from "./auth.routes";
import hrRoutes from "./hr.routes";
import financeRoutes from "./finance.routes";
import crmRoutes from "./crm.routes";
import contentRoutes from "./content.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/hr", hrRoutes);
router.use("/finance", financeRoutes);
router.use("/crm", crmRoutes);
router.use("/content", contentRoutes);

export default router;
