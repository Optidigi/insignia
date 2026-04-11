-- CreateTable
CREATE TABLE "StorefrontTranslation" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "StorefrontTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StorefrontTranslation_shopId_locale_idx" ON "StorefrontTranslation"("shopId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "StorefrontTranslation_shopId_locale_key_key" ON "StorefrontTranslation"("shopId", "locale", "key");

-- AddForeignKey
ALTER TABLE "StorefrontTranslation" ADD CONSTRAINT "StorefrontTranslation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
