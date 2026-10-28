-- A day's ad numbers can carry a note (why spend couldn't be updated, etc.). Additive and nullable.
ALTER TABLE "own_ad_metrics" ADD COLUMN "note" TEXT;
ALTER TABLE "client_ad_metrics" ADD COLUMN "note" TEXT;
