import { Router } from "express";
import { authenticate } from "../middleware/auth";
import * as p from "../controllers/departments/actionPlans.controller";

const router = Router();
router.use(authenticate);

// Who may do what (head vs leadership) is decided inside each handler.
router.get("/", p.listPlans);
router.post("/", p.createPlan);
router.patch("/:id", p.updatePlan);
router.post("/:id/items", p.addItem);
router.patch("/:id/items/:itemId", p.updateItem);
router.delete("/:id/items/:itemId", p.deleteItem);
router.post("/:id/comments", p.addComment);
export default router;
