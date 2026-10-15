import { Router } from "express";
import { authenticate } from "../middleware/auth";
import * as s from "../controllers/departments/scores.controller";
import * as soc from "../controllers/departments/social.controller";

const router = Router();
router.use(authenticate);

router.get("/targets", s.getScoreTargets);
router.put("/targets", s.setScoreTargets);     // leadership only (checked in the handler)
router.get("/departments", s.departmentScores); // leadership: all; a head: their own department
router.get("/meta-ads", s.metaScore);
router.get("/sales", s.salesOverview);
router.get("/social", soc.getSocial);                 // Marketing viewers + the owner
router.get("/social/status", soc.socialStatus);       // any signed-in user: "am I the owner, and are this month's numbers in?"
router.put("/social/:month", soc.saveSocial);         // the owner or leadership (checked in the handler)
router.put("/social-owner", soc.setSocialOwner);      // leadership only
export default router;
