import { Router } from "express";
import { authenticate } from "../middleware/auth";
import * as n from "../controllers/notifications.controller";

const router = Router();
router.use(authenticate);
router.get("/", n.listNotifications);
router.post("/read-all", n.markAllRead);
router.post("/:id/read", n.markRead);

export default router;
