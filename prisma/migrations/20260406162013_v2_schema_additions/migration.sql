-- AlterTable
ALTER TABLE "DecorationMethod" ADD COLUMN     "artworkConstraints" JSONB,
ADD COLUMN     "customerDescription" TEXT,
ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "MerchantSettings" ADD COLUMN     "setupGuideDismissedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OrderLineCustomization" ADD COLUMN     "orderStatusUrl" TEXT;

-- AlterTable
ALTER TABLE "ProductConfig" ADD COLUMN     "presetKey" TEXT;

-- AlterTable
ALTER TABLE "ProductView" ADD COLUMN     "defaultImageKey" TEXT,
ADD COLUMN     "placementGeometry" JSONB;

-- CreateIndex
CREATE INDEX "VariantViewConfiguration_productConfigId_viewId_idx" ON "VariantViewConfiguration"("productConfigId", "viewId");
