-- DropForeignKey
ALTER TABLE "PlacementStepMethodPrice" DROP CONSTRAINT IF EXISTS "PlacementStepMethodPrice_placementStepId_fkey";
ALTER TABLE "PlacementStepMethodPrice" DROP CONSTRAINT IF EXISTS "PlacementStepMethodPrice_decorationMethodId_fkey";

-- DropTable
DROP TABLE IF EXISTS "PlacementStepMethodPrice";
