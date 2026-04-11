-- CreateEnum
CREATE TYPE "ViewPerspective" AS ENUM ('front', 'back', 'left', 'right', 'side', 'custom');

-- CreateEnum
CREATE TYPE "LogoAssetKind" AS ENUM ('buyer_upload', 'merchant_placeholder');

-- CreateEnum
CREATE TYPE "VariantSlotState" AS ENUM ('FREE', 'RESERVED', 'IN_CART');

-- CreateEnum
CREATE TYPE "CustomizationConfigState" AS ENUM ('RESERVED', 'IN_CART', 'ORDERED', 'PURCHASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ArtworkStatus" AS ENUM ('PROVIDED', 'PENDING_CUSTOMER');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shopifyDomain" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecorationMethod" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecorationMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductConfig" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "linkedProductIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductConfigMethod" (
    "productConfigId" TEXT NOT NULL,
    "decorationMethodId" TEXT NOT NULL,

    CONSTRAINT "ProductConfigMethod_pkey" PRIMARY KEY ("productConfigId","decorationMethodId")
);

-- CreateTable
CREATE TABLE "ProductView" (
    "id" TEXT NOT NULL,
    "productConfigId" TEXT NOT NULL,
    "perspective" "ViewPerspective" NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantViewConfiguration" (
    "id" TEXT NOT NULL,
    "productConfigId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "viewId" TEXT NOT NULL,
    "imageUrl" TEXT,
    "placementGeometry" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VariantViewConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlacementDefinition" (
    "id" TEXT NOT NULL,
    "productConfigId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "basePriceAdjustmentCents" INTEGER NOT NULL DEFAULT 0,
    "hidePriceWhenZero" BOOLEAN NOT NULL DEFAULT false,
    "defaultStepIndex" INTEGER NOT NULL DEFAULT 0,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlacementDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlacementStep" (
    "id" TEXT NOT NULL,
    "placementDefinitionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "priceAdjustmentCents" INTEGER NOT NULL DEFAULT 0,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PlacementStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantSettings" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "placeholderLogoImageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogoAsset" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "kind" "LogoAssetKind" NOT NULL,
    "sanitizedSvgUrl" TEXT,
    "previewPngUrl" TEXT NOT NULL,
    "originalFileName" TEXT,
    "fileSizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogoAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantSlot" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "shopifyVariantId" TEXT NOT NULL,
    "state" "VariantSlotState" NOT NULL DEFAULT 'FREE',
    "reservedAt" TIMESTAMP(3),
    "reservedUntil" TIMESTAMP(3),
    "inCartUntil" TIMESTAMP(3),
    "currentConfigId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VariantSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomizationConfig" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "configHash" TEXT NOT NULL,
    "pricingVersion" TEXT NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "state" "CustomizationConfigState" NOT NULL DEFAULT 'RESERVED',
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inCartAt" TIMESTAMP(3),
    "orderedAt" TIMESTAMP(3),
    "purchasedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "variantSlotId" TEXT,

    CONSTRAINT "CustomizationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLineCustomization" (
    "id" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyLineId" TEXT NOT NULL,
    "productConfigId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "customizationConfigId" TEXT,
    "artworkStatus" "ArtworkStatus" NOT NULL DEFAULT 'PROVIDED',
    "logoAssetIdsByPlacementId" JSONB,
    "placementGeometrySnapshotByViewId" JSONB,
    "useLiveConfigFallback" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderLineCustomization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopifyDomain_key" ON "Shop"("shopifyDomain");

-- CreateIndex
CREATE INDEX "Shop_shopifyDomain_idx" ON "Shop"("shopifyDomain");

-- CreateIndex
CREATE INDEX "DecorationMethod_shopId_idx" ON "DecorationMethod"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "DecorationMethod_shopId_name_key" ON "DecorationMethod"("shopId", "name");

-- CreateIndex
CREATE INDEX "ProductConfig_shopId_idx" ON "ProductConfig"("shopId");

-- CreateIndex
CREATE INDEX "ProductView_productConfigId_idx" ON "ProductView"("productConfigId");

-- CreateIndex
CREATE INDEX "VariantViewConfiguration_productConfigId_idx" ON "VariantViewConfiguration"("productConfigId");

-- CreateIndex
CREATE INDEX "VariantViewConfiguration_variantId_idx" ON "VariantViewConfiguration"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "VariantViewConfiguration_productConfigId_variantId_viewId_key" ON "VariantViewConfiguration"("productConfigId", "variantId", "viewId");

-- CreateIndex
CREATE INDEX "PlacementDefinition_productConfigId_idx" ON "PlacementDefinition"("productConfigId");

-- CreateIndex
CREATE INDEX "PlacementStep_placementDefinitionId_idx" ON "PlacementStep"("placementDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantSettings_shopId_key" ON "MerchantSettings"("shopId");

-- CreateIndex
CREATE INDEX "LogoAsset_shopId_idx" ON "LogoAsset"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "VariantSlot_currentConfigId_key" ON "VariantSlot"("currentConfigId");

-- CreateIndex
CREATE INDEX "VariantSlot_shopId_methodId_state_idx" ON "VariantSlot"("shopId", "methodId", "state");

-- CreateIndex
CREATE INDEX "VariantSlot_state_reservedUntil_idx" ON "VariantSlot"("state", "reservedUntil");

-- CreateIndex
CREATE INDEX "VariantSlot_state_inCartUntil_idx" ON "VariantSlot"("state", "inCartUntil");

-- CreateIndex
CREATE UNIQUE INDEX "VariantSlot_shopId_shopifyVariantId_key" ON "VariantSlot"("shopId", "shopifyVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomizationConfig_variantSlotId_key" ON "CustomizationConfig"("variantSlotId");

-- CreateIndex
CREATE INDEX "CustomizationConfig_shopId_configHash_idx" ON "CustomizationConfig"("shopId", "configHash");

-- CreateIndex
CREATE INDEX "CustomizationConfig_state_idx" ON "CustomizationConfig"("state");

-- CreateIndex
CREATE INDEX "OrderLineCustomization_shopifyOrderId_idx" ON "OrderLineCustomization"("shopifyOrderId");

-- CreateIndex
CREATE INDEX "OrderLineCustomization_productConfigId_idx" ON "OrderLineCustomization"("productConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLineCustomization_shopifyOrderId_shopifyLineId_key" ON "OrderLineCustomization"("shopifyOrderId", "shopifyLineId");

-- CreateIndex
CREATE INDEX "WebhookEvent_shopId_topic_idx" ON "WebhookEvent"("shopId", "topic");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_eventId_key" ON "WebhookEvent"("eventId");

-- AddForeignKey
ALTER TABLE "DecorationMethod" ADD CONSTRAINT "DecorationMethod_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductConfig" ADD CONSTRAINT "ProductConfig_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductConfigMethod" ADD CONSTRAINT "ProductConfigMethod_productConfigId_fkey" FOREIGN KEY ("productConfigId") REFERENCES "ProductConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductConfigMethod" ADD CONSTRAINT "ProductConfigMethod_decorationMethodId_fkey" FOREIGN KEY ("decorationMethodId") REFERENCES "DecorationMethod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductView" ADD CONSTRAINT "ProductView_productConfigId_fkey" FOREIGN KEY ("productConfigId") REFERENCES "ProductConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantViewConfiguration" ADD CONSTRAINT "VariantViewConfiguration_productConfigId_fkey" FOREIGN KEY ("productConfigId") REFERENCES "ProductConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantViewConfiguration" ADD CONSTRAINT "VariantViewConfiguration_viewId_fkey" FOREIGN KEY ("viewId") REFERENCES "ProductView"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementDefinition" ADD CONSTRAINT "PlacementDefinition_productConfigId_fkey" FOREIGN KEY ("productConfigId") REFERENCES "ProductConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementStep" ADD CONSTRAINT "PlacementStep_placementDefinitionId_fkey" FOREIGN KEY ("placementDefinitionId") REFERENCES "PlacementDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantSettings" ADD CONSTRAINT "MerchantSettings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogoAsset" ADD CONSTRAINT "LogoAsset_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantSlot" ADD CONSTRAINT "VariantSlot_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantSlot" ADD CONSTRAINT "VariantSlot_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "DecorationMethod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomizationConfig" ADD CONSTRAINT "CustomizationConfig_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomizationConfig" ADD CONSTRAINT "CustomizationConfig_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "DecorationMethod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomizationConfig" ADD CONSTRAINT "CustomizationConfig_variantSlotId_fkey" FOREIGN KEY ("variantSlotId") REFERENCES "VariantSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLineCustomization" ADD CONSTRAINT "OrderLineCustomization_productConfigId_fkey" FOREIGN KEY ("productConfigId") REFERENCES "ProductConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLineCustomization" ADD CONSTRAINT "OrderLineCustomization_customizationConfigId_fkey" FOREIGN KEY ("customizationConfigId") REFERENCES "CustomizationConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
