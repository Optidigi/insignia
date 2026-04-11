-- CreateTable
CREATE TABLE "StorefrontUploadSession" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "fileName" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorefrontUploadSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StorefrontUploadSession_shopId_idx" ON "StorefrontUploadSession"("shopId");

-- CreateIndex
CREATE INDEX "StorefrontUploadSession_createdAt_idx" ON "StorefrontUploadSession"("createdAt");

-- AddForeignKey
ALTER TABLE "StorefrontUploadSession" ADD CONSTRAINT "StorefrontUploadSession_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
