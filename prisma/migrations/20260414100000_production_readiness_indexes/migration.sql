-- DropIndex
DROP INDEX "Shop_shopifyDomain_idx";

-- AlterTable: add timestamps to PlacementStep (backfill existing rows with now())
ALTER TABLE "PlacementStep" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Remove the default on updatedAt (Prisma @updatedAt is app-level, not DB default)
ALTER TABLE "PlacementStep" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "CustomizationDraft_productConfigId_idx" ON "CustomizationDraft"("productConfigId");

-- CreateIndex
CREATE INDEX "CustomizationDraft_variantId_idx" ON "CustomizationDraft"("variantId");

-- GIN index for array column queried with @> operator (Prisma `has:` filter)
CREATE INDEX IF NOT EXISTS "ProductConfig_linkedProductIds_gin" ON "ProductConfig" USING gin ("linkedProductIds");
