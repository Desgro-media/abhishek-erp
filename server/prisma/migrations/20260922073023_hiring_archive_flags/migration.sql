-- AlterTable
ALTER TABLE "candidates" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "open_positions" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false;
