import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { requireContentUser } from "../middleware/crmAccess";
import * as items from "../controllers/content/items.controller";
import * as campaigns from "../controllers/content/metaCampaigns.controller";

const router = Router();
router.use(authenticate, requireContentUser);

router.get("/items", items.listContentItems);
router.post("/items", items.createContentItem);
router.patch("/items/:id", items.updateContentItem);
router.delete("/items/:id", items.deleteContentItem);

router.get("/meta-campaigns", campaigns.listMetaCampaigns);
router.post("/meta-campaigns", campaigns.createMetaCampaign);
router.patch("/meta-campaigns/:id", campaigns.updateMetaCampaign);

export default router;
