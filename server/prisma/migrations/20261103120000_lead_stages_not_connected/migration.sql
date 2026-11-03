-- AlterEnum: three more pipeline stages right after New (calling attempts that didn't connect, and call-back). Additive.
ALTER TYPE "LeadStage" ADD VALUE 'NOT_CONNECTED_1' AFTER 'NEW';
ALTER TYPE "LeadStage" ADD VALUE 'NOT_CONNECTED_2' AFTER 'NOT_CONNECTED_1';
ALTER TYPE "LeadStage" ADD VALUE 'CALL_BACK' AFTER 'NOT_CONNECTED_2';
