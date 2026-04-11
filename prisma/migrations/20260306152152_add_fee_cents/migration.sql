-- AlterTable
ALTER TABLE "CustomizationConfig" ADD COLUMN     "feeCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CustomizationDraft" ADD COLUMN     "feeCents" INTEGER;
