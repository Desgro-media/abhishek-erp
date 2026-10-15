import { Router } from "express";
import { authenticate } from "../middleware/auth";
import * as s from "../controllers/departments/scores.controller";

const router = Router();
router.use(authenticate);

router.get("/targets", s.getScoreTargets);
router.put("/targets", s.setScoreTargets);     // leadership only (checked in the handler)
router.get("/departments", s.departmentScores); // leadership: all; a head: their own department
router.get("/meta-ads", s.metaScore);
router.get("/sales", s.salesOverview);
export default router;
