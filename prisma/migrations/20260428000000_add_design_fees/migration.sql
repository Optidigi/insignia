-- design-fees: merchant-configurable one-time design fees subsystem.
-- Additive migration: new tables + nullable columns only. Safe under live traffic.

-- AlterTable: LogoAsset.contentHash (SHA256 hex of raw upload buffer)
ALTER TABLE "LogoAsset" ADD COLUMN "contentHash" TEXT;
CREATE INDEX "LogoAsset_shopId_contentHash_idx" ON "LogoAsset"("shopId", "contentHash");

-- AlterTable: PlacementDefinition.feeCategoryId (null = no fee for this placement)
ALTER TABLE "PlacementDefinition" ADD COLUMN "feeCategoryId" TEXT;
CREATE INDEX "PlacementDefinition_feeCategoryId_idx" ON "PlacementDefinition"("feeCategoryId");

-- CreateTable: DesignFeeCategory
CREATE TABLE "DesignFeeCategory" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DesignFeeCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DesignFeeCategory_methodId_name_key" ON "DesignFeeCategory"("methodId", "name");
CREATE INDEX "DesignFeeCategory_shopId_idx" ON "DesignFeeCategory"("shopId");
CREATE INDEX "DesignFeeCategory_methodId_idx" ON "DesignFeeCategory"("methodId");

ALTER TABLE "DesignFeeCategory" ADD CONSTRAINT "DesignFeeCategory_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DesignFeeCategory" ADD CONSTRAINT "DesignFeeCategory_methodId_fkey"
    FOREIGN KEY ("methodId") REFERENCES "DecorationMethod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: PlacementDefinition.feeCategoryId -> DesignFeeCategory.id (SET NULL on category delete)
ALTER TABLE "PlacementDefinition" ADD CONSTRAINT "PlacementDefinition_feeCategoryId_fkey"
    FOREIGN KEY ("feeCategoryId") REFERENCES "DesignFeeCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: CartDesignFeeCharge
CREATE TABLE "CartDesignFeeCharge" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "cartToken" TEXT NOT NULL,
    "logoContentHash" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "feeCentsCharged" INTEGER NOT NULL,
    "shopifyVariantId" TEXT,
    "shopifyLineKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CartDesignFeeCharge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CartDesignFeeCharge_cartToken_logoContentHash_categoryId_methodId_key"
    ON "CartDesignFeeCharge"("cartToken", "logoContentHash", "categoryId", "methodId");
CREATE INDEX "CartDesignFeeCharge_shopId_createdAt_idx"
    ON "CartDesignFeeCharge"("shopId", "createdAt");
CREATE INDEX "CartDesignFeeCharge_cartToken_idx"
    ON "CartDesignFeeCharge"("cartToken");

ALTER TABLE "CartDesignFeeCharge" ADD CONSTRAINT "CartDesignFeeCharge_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CartDesignFeeCharge" ADD CONSTRAINT "CartDesignFeeCharge_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "DesignFeeCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CartDesignFeeCharge" ADD CONSTRAINT "CartDesignFeeCharge_methodId_fkey"
    FOREIGN KEY ("methodId") REFERENCES "DecorationMethod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum: DesignFeeSlotState
CREATE TYPE "DesignFeeSlotState" AS ENUM ('FREE', 'RESERVED', 'IN_CART');

-- CreateTable: DesignFeeSlot (independent slot pool — does not share with VariantSlot)
CREATE TABLE "DesignFeeSlot" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "shopifyVariantId" TEXT NOT NULL,
    "state" "DesignFeeSlotState" NOT NULL DEFAULT 'FREE',
    "reservedAt" TIMESTAMP(3),
    "reservedUntil" TIMESTAMP(3),
    "inCartUntil" TIMESTAMP(3),
    "currentChargeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DesignFeeSlot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DesignFeeSlot_shopifyVariantId_key" ON "DesignFeeSlot"("shopifyVariantId");
CREATE INDEX "DesignFeeSlot_shopId_state_idx" ON "DesignFeeSlot"("shopId", "state");

ALTER TABLE "DesignFeeSlot" ADD CONSTRAINT "DesignFeeSlot_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
