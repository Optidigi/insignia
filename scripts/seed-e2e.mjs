/**
 * E2E seed script — creates PlacementDefinition + PlacementStep + placementGeometry
 * for the "The Complete Snowboard" product config used in the storefront E2E test.
 *
 * Run: node scripts/seed-e2e.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PRODUCT_CONFIG_ID = "3bcf19ff-d052-4038-8170-7bcfb6bcc1ba";
const VIEW_ID = "4b495ff1-4d87-4775-95af-9036d85b055e";

async function main() {
  // Verify the product config exists
  const config = await prisma.productConfig.findUnique({
    where: { id: PRODUCT_CONFIG_ID },
    include: { views: true, placements: true },
  });

  if (!config) {
    console.error("ProductConfig not found:", PRODUCT_CONFIG_ID);
    process.exit(1);
  }

  console.log("ProductConfig:", config.name, "| views:", config.views.length, "| placements:", config.placements.length);

  // Clean up any existing placements from previous runs
  for (const p of config.placements) {
    await prisma.placementStep.deleteMany({ where: { placementDefinitionId: p.id } });
    await prisma.placementDefinition.delete({ where: { id: p.id } });
    console.log("Cleaned up existing placement:", p.name);
  }

  // Create PlacementDefinition
  const placement = await prisma.placementDefinition.create({
    data: {
      productConfigId: PRODUCT_CONFIG_ID,
      name: "Front Center",
      basePriceAdjustmentCents: 0,
      hidePriceWhenZero: true,
      defaultStepIndex: 0,
      displayOrder: 0,
    },
  });
  console.log("Created PlacementDefinition:", placement.id, placement.name);

  // Create PlacementStep
  const step = await prisma.placementStep.create({
    data: {
      placementDefinitionId: placement.id,
      label: "Standard",
      priceAdjustmentCents: 0,
      scaleFactor: 1.0,
      displayOrder: 0,
    },
  });
  console.log("Created PlacementStep:", step.id, step.label);

  // Update ProductView with placementGeometry
  // Format: { [placementId]: { centerXPercent, centerYPercent, maxWidthPercent } }
  const placementGeometry = {
    [placement.id]: {
      centerXPercent: 50,
      centerYPercent: 40,
      maxWidthPercent: 60,
    },
  };

  const view = await prisma.productView.update({
    where: { id: VIEW_ID },
    data: { placementGeometry },
  });
  console.log("Updated ProductView placementGeometry:", JSON.stringify(view.placementGeometry, null, 2));

  console.log("\n--- Seed complete ---");
  console.log("PlacementDefinition ID:", placement.id);
  console.log("PlacementStep ID:", step.id);
  console.log("View ID:", VIEW_ID, "has geometry:", !!view.placementGeometry);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
