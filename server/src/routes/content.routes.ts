import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { requireContentUser } from "../middleware/crmAccess";
import * as items from "../controllers/content/items.controller";
import * as campaigns from "../controllers/content/metaCampaigns.controller";
import * as ownAd from "../controllers/content/ownAdMetrics.controller";

const router = Router();
// Any signed-in employee can see the cards assigned to them (My Workspace > My Tasks), whether or
// not they hold the Content role — scoped to the caller's own name, nothing else is exposed here.
router.get("/items/mine", authenticate, items.listMyContentItems);

// Everything below needs ADMIN or CONTENT, and the list is unfiltered: both see every card from every
// creator and assignee.
router.use(authenticate, requireContentUser);

router.get("/items", items.listContentItems);
router.post("/items", items.createContentItem);
router.patch("/items/:id", items.updateContentItem);
router.delete("/items/:id", items.deleteContentItem);

router.get("/meta-campaigns", campaigns.listMetaCampaigns);
router.post("/meta-campaigns", campaigns.createMetaCampaign);
router.patch("/meta-campaigns/:id", campaigns.updateMetaCampaign);

router.get("/own-ad-metrics", ownAd.listOwnAdMetrics);
router.post("/own-ad-metrics", ownAd.upsertOwnAdMetric);
router.delete("/own-ad-metrics/:id", ownAd.deleteOwnAdMetric);

export default router;
