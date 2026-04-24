-- CreateTable
CREATE TABLE "PlacementDefinitionMethodPrice" (
    "placementDefinitionId" TEXT NOT NULL,
    "decorationMethodId" TEXT NOT NULL,
    "basePriceAdjustmentCents" INTEGER NOT NULL,

    CONSTRAINT "PlacementDefinitionMethodPrice_pkey" PRIMARY KEY ("placementDefinitionId","decorationMethodId")
);

-- CreateIndex
CREATE INDEX "PlacementDefinitionMethodPrice_decorationMethodId_idx"
    ON "PlacementDefinitionMethodPrice"("decorationMethodId");

-- AddForeignKey
ALTER TABLE "PlacementDefinitionMethodPrice"
    ADD CONSTRAINT "PlacementDefinitionMethodPrice_placementDefinitionId_fkey"
    FOREIGN KEY ("placementDefinitionId") REFERENCES "PlacementDefinition"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlacementDefinitionMethodPrice"
    ADD CONSTRAINT "PlacementDefinitionMethodPrice_decorationMethodId_fkey"
    FOREIGN KEY ("decorationMethodId") REFERENCES "DecorationMethod"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
