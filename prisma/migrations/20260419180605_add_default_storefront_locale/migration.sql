-- DropIndex
DROP INDEX "ProductConfig_linkedProductIds_gin";

-- AlterTable
ALTER TABLE "MerchantSettings" ADD COLUMN     "defaultStorefrontLocale" TEXT NOT NULL DEFAULT 'en';

-- CreateIndex
CREATE INDEX "CustomizationConfig_shopId_state_expiredAt_idx" ON "CustomizationConfig"("shopId", "state", "expiredAt");

-- CreateIndex
CREATE INDEX "OrderLineCustomization_artworkStatus_productionStatus_idx" ON "OrderLineCustomization"("artworkStatus", "productionStatus");
