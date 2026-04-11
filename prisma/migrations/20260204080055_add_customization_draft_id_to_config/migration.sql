-- AlterTable
ALTER TABLE "CustomizationConfig" ADD COLUMN     "customizationDraftId" TEXT;

-- CreateIndex
CREATE INDEX "CustomizationConfig_customizationDraftId_idx" ON "CustomizationConfig"("customizationDraftId");
