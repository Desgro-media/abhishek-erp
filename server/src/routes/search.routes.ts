import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { globalSearch } from "../controllers/search.controller";

const router = Router();
router.use(authenticate);

// No per-route role gate — globalSearch() itself checks module access per entity type,
// same as each entity's own list endpoint (see the comment there).
router.get("/", globalSearch);

export default router;
