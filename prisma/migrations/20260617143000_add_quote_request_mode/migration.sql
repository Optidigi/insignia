-- Add per-product-config storefront mode for standard customizer vs quote-request flow.
ALTER TABLE "ProductConfig"
ADD COLUMN "storefrontMode" TEXT NOT NULL DEFAULT 'standard';

-- Persist Stitchs-style quote requests independently from cart/order customizations.
CREATE TABLE "QuoteRequest" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productConfigId" TEXT NOT NULL,
    "logoAssetId" TEXT,
    "artworkStatus" TEXT NOT NULL DEFAULT 'PENDING_CUSTOMER',
    "decorationChoice" TEXT NOT NULL,
    "maxFormatChoice" TEXT NOT NULL,
    "maxFormatCustom" TEXT,
    "placementWish" TEXT NOT NULL,
    "notes" TEXT,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "companyName" TEXT,
    "productSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QuoteRequest_shopId_createdAt_idx" ON "QuoteRequest"("shopId", "createdAt");
CREATE INDEX "QuoteRequest_productConfigId_idx" ON "QuoteRequest"("productConfigId");
CREATE INDEX "QuoteRequest_productId_idx" ON "QuoteRequest"("productId");

ALTER TABLE "QuoteRequest"
ADD CONSTRAINT "QuoteRequest_shopId_fkey"
FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuoteRequest"
ADD CONSTRAINT "QuoteRequest_productConfigId_fkey"
FOREIGN KEY ("productConfigId") REFERENCES "ProductConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
