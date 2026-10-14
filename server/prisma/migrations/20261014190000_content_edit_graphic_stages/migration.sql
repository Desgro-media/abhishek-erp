-- AlterEnum: two new content pipeline stages, placed between Production and Review.
-- Additive: existing rows keep their stage; nothing is rewritten.
ALTER TYPE "ContentStage" ADD VALUE 'EDIT' AFTER 'PRODUCTION';
ALTER TYPE "ContentStage" ADD VALUE 'GRAPHIC' AFTER 'EDIT';
