-- AlterTable
ALTER TABLE "CustomizationDraft" ADD COLUMN "customerEmail" TEXT;

-- CreateIndex
CREATE INDEX "CustomizationDraft_shopId_customerEmail_idx" ON "CustomizationDraft"("shopId", "customerEmail");
