-- CreateTable
CREATE TABLE "OrderNote" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorUserId" BIGINT,
    "authorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderNote_shopId_shopifyOrderId_idx" ON "OrderNote"("shopId", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "OrderNote_createdAt_idx" ON "OrderNote"("createdAt");

-- AddForeignKey
ALTER TABLE "OrderNote" ADD CONSTRAINT "OrderNote_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
