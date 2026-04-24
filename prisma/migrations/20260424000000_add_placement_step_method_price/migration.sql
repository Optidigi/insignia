-- CreateTable
CREATE TABLE "PlacementStepMethodPrice" (
    "placementStepId" TEXT NOT NULL,
    "decorationMethodId" TEXT NOT NULL,
    "priceAdjustmentCents" INTEGER NOT NULL,

    CONSTRAINT "PlacementStepMethodPrice_pkey" PRIMARY KEY ("placementStepId","decorationMethodId")
);

-- CreateIndex
CREATE INDEX "PlacementStepMethodPrice_decorationMethodId_idx"
    ON "PlacementStepMethodPrice"("decorationMethodId");

-- AddForeignKey
ALTER TABLE "PlacementStepMethodPrice"
    ADD CONSTRAINT "PlacementStepMethodPrice_placementStepId_fkey"
    FOREIGN KEY ("placementStepId") REFERENCES "PlacementStep"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlacementStepMethodPrice"
    ADD CONSTRAINT "PlacementStepMethodPrice_decorationMethodId_fkey"
    FOREIGN KEY ("decorationMethodId") REFERENCES "DecorationMethod"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
