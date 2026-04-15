-- Step 1: Add nullable productViewId
ALTER TABLE "PlacementDefinition" ADD COLUMN "productViewId" TEXT;

-- Step 2: Populate from first view of each config
UPDATE "PlacementDefinition" pd
SET "productViewId" = (
  SELECT pv.id FROM "ProductView" pv
  WHERE pv."productConfigId" = pd."productConfigId"
  ORDER BY pv."displayOrder" ASC, pv."createdAt" ASC
  LIMIT 1
);

-- Step 3: Delete orphaned placements (configs with no views)
DELETE FROM "PlacementDefinition" WHERE "productViewId" IS NULL;

-- Step 4: Make NOT NULL
ALTER TABLE "PlacementDefinition" ALTER COLUMN "productViewId" SET NOT NULL;

-- Step 5: Drop old column and index
DROP INDEX IF EXISTS "PlacementDefinition_productConfigId_idx";
ALTER TABLE "PlacementDefinition" DROP COLUMN "productConfigId";

-- Step 6: Add new FK and index
ALTER TABLE "PlacementDefinition"
  ADD CONSTRAINT "PlacementDefinition_productViewId_fkey"
  FOREIGN KEY ("productViewId") REFERENCES "ProductView"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "PlacementDefinition_productViewId_idx" ON "PlacementDefinition"("productViewId");
