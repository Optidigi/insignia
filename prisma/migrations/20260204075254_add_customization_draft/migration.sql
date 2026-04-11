-- CreateEnum
CREATE TYPE "ArtworkStatusDraft" AS ENUM ('PROVIDED', 'PENDING_CUSTOMER');

-- CreateTable
CREATE TABLE "CustomizationDraft" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productConfigId" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "placements" JSONB NOT NULL,
    "logoAssetIdsByPlacementId" JSONB NOT NULL,
    "artworkStatus" "ArtworkStatusDraft" NOT NULL DEFAULT 'PROVIDED',
    "unitPriceCents" INTEGER,
    "configHash" TEXT,
    "pricingVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomizationDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomizationDraft_shopId_idx" ON "CustomizationDraft"("shopId");

-- CreateIndex
CREATE INDEX "CustomizationDraft_createdAt_idx" ON "CustomizationDraft"("createdAt");

-- AddForeignKey
ALTER TABLE "CustomizationDraft" ADD CONSTRAINT "CustomizationDraft_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
