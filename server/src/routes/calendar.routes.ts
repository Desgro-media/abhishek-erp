import { Router } from "express";
import { authenticate } from "../middleware/auth";
import * as events from "../controllers/calendar/events.controller";

const router = Router();
router.use(authenticate);

// Visibility is filtered inside the handler (audience); writes are HR/Admin only.
router.get("/events", events.listEvents);
router.post("/events", events.createEvent);
router.put("/events/:id", events.updateEvent);
router.delete("/events/:id", events.deleteEvent);

export default router;
