import { Router } from "express";
import { authenticate } from "../middleware/auth";
import * as d from "../controllers/departments/departments.controller";
import * as pm from "../controllers/departments/pmTracking.controller";

const router = Router();
router.use(authenticate);

router.get("/heads", d.listHeads);
router.get("/overview", d.departmentsOverview);
router.put("/:dept/head", d.setHead);          // leadership only (checked in the handler)
router.put("/:dept/team-leads", d.setTeamLeads); // leadership only (checked in the handler)
// Performance Marketing tracking (access checked in the handlers: leadership/head/team leads see all, members their own)
router.get("/pm/tracking", pm.getPmTracking);
router.put("/pm/clients/:clientId", pm.setPmClient);
router.put("/pm/adjustments/:employeeId", pm.setPmAdjustment);
router.get("/:dept/summary", d.departmentSummary); // leadership or that department's head
export default router;
