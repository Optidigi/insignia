-- CreateEnum
CREATE TYPE "ProductionStatus" AS ENUM ('ARTWORK_PENDING', 'ARTWORK_PROVIDED', 'IN_PRODUCTION', 'QUALITY_CHECK', 'SHIPPED');

-- AlterTable
ALTER TABLE "OrderLineCustomization" ADD COLUMN     "productionStatus" "ProductionStatus" NOT NULL DEFAULT 'ARTWORK_PENDING';
