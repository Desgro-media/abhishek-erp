import { Router } from "express";
import { authenticate } from "../middleware/auth";
import * as d from "../controllers/departments/departments.controller";

const router = Router();
router.use(authenticate);

router.get("/heads", d.listHeads);
router.get("/overview", d.departmentsOverview);
router.put("/:dept/head", d.setHead);          // leadership only (checked in the handler)
router.get("/:dept/summary", d.departmentSummary); // leadership or that department's head
export default router;
