/**
 * Product Configs Service
 * 
 * Business logic for managing product configurations.
 * Links Shopify products to customization rules.
 */

import { z } from "zod";
import { Prisma, ViewPerspective } from "@prisma/client";
import db from "../../db.server";
import { AppError, ErrorCodes } from "../errors.server";

// ============================================================================
// Validation Schemas
// ============================================================================

export const CreateProductConfigSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  linkedProductIds: z.array(z.string()).min(1, "At least one product required"),
  allowedMethodIds: z.array(z.string()).optional().default([]),
  presetKey: z.string().nullable().optional(),
});

export const UpdateProductConfigSchema = z.object({
  name: z.string().min(1, "Name is required").max(200).optional(),
  linkedProductIds: z.array(z.string()).min(1).optional(),
  allowedMethodIds: z.array(z.string()).optional(),
});

export type CreateProductConfigInput = z.infer<typeof CreateProductConfigSchema>;
export type UpdateProductConfigInput = z.infer<typeof UpdateProductConfigSchema>;

// ============================================================================
// Service Functions
// ============================================================================

/**
 * List all product configs for a shop
 */
export async function listProductConfigs(shopId: string) {
  return db.productConfig.findMany({
    where: { shopId },
    include: {
      allowedMethods: {
        include: {
          decorationMethod: true,
        },
      },
      views: {
        orderBy: { displayOrder: "asc" },
      },
      placements: {
        orderBy: { displayOrder: "asc" },
      },
      _count: {
        select: {
          variantViewConfigurations: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Get a single product config with all related data
 */
export async function getProductConfig(shopId: string, configId: string) {
  const config = await db.productConfig.findFirst({
    where: {
      id: configId,
      shopId,
    },
    include: {
      allowedMethods: {
        include: {
          decorationMethod: true,
        },
      },
      views: {
        orderBy: { displayOrder: "asc" },
      },
      placements: {
        include: {
          steps: {
            orderBy: { displayOrder: "asc" },
          },
        },
        orderBy: { displayOrder: "asc" },
      },
      variantViewConfigurations: true,
    },
  });

  if (!config) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Product config not found", 404);
  }

  return config;
}

/**
 * Create a new product config
 */
export async function createProductConfig(
  shopId: string,
  input: CreateProductConfigInput
) {
  const config = await db.$transaction(async (tx) => {
    // Create the config
    const newConfig = await tx.productConfig.create({
      data: {
        shopId,
        name: input.name,
        linkedProductIds: input.linkedProductIds,
        presetKey: input.presetKey ?? null,
      },
    });

    // Link allowed methods if provided
    if (input.allowedMethodIds && input.allowedMethodIds.length > 0) {
      await tx.productConfigMethod.createMany({
        data: input.allowedMethodIds.map((methodId) => ({
          productConfigId: newConfig.id,
          decorationMethodId: methodId,
        })),
      });
    }

    return newConfig;
  });

  // Fetch the full config with relations after transaction commits
  return getProductConfig(shopId, config.id);
}

/**
 * Update a product config
 */
export async function updateProductConfig(
  shopId: string,
  configId: string,
  input: UpdateProductConfigInput
) {
  // Check that config exists and belongs to shop
  const existing = await db.productConfig.findFirst({
    where: {
      id: configId,
      shopId,
    },
  });

  if (!existing) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Product config not found", 404);
  }

  return db.$transaction(async (tx) => {
    // Update basic fields
    await tx.productConfig.update({
      where: { id: configId },
      data: {
        ...(input.name && { name: input.name }),
        ...(input.linkedProductIds && { linkedProductIds: input.linkedProductIds }),
      },
    });

    // Update allowed methods if provided
    if (input.allowedMethodIds !== undefined) {
      // Remove existing
      await tx.productConfigMethod.deleteMany({
        where: { productConfigId: configId },
      });

      // Add new
      if (input.allowedMethodIds.length > 0) {
        await tx.productConfigMethod.createMany({
          data: input.allowedMethodIds.map((methodId) => ({
            productConfigId: configId,
            decorationMethodId: methodId,
          })),
        });
      }
    }

    return getProductConfig(shopId, configId);
  });
}

/**
 * Delete a product config
 */
export async function deleteProductConfig(shopId: string, configId: string) {
  const config = await db.productConfig.findFirst({
    where: {
      id: configId,
      shopId,
    },
  });

  if (!config) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Product config not found", 404);
  }

  // Cascade delete handles related records via Prisma schema
  await db.productConfig.delete({
    where: { id: configId },
  });
}

// ============================================================================
// Clone Layout
// ============================================================================

/**
 * Clone print areas, positions, sizes, and pricing from a source config
 * INTO a target config. Replaces all existing placements on the target.
 */
export async function cloneLayoutInto(
  shopId: string,
  targetConfigId: string,
  sourceConfigId: string,
) {
  const [source, target] = await Promise.all([
    getProductConfig(shopId, sourceConfigId),
    getProductConfig(shopId, targetConfigId),
  ]);
  if (!source || !target) throw new AppError(ErrorCodes.NOT_FOUND, "Config not found", 404);

  return db.$transaction(async (tx) => {
    // Delete all existing placements on target (cascade deletes steps)
    await tx.placementDefinition.deleteMany({
      where: { productConfigId: targetConfigId },
    });

    // Clear view-level geometry on target views
    await tx.productView.updateMany({
      where: { productConfigId: targetConfigId },
      data: { placementGeometry: Prisma.DbNull },
    });

    // Copy placements from source
    for (const placement of source.placements) {
      const newPlacement = await tx.placementDefinition.create({
        data: {
          productConfigId: targetConfigId,
          name: placement.name,
          basePriceAdjustmentCents: placement.basePriceAdjustmentCents,
          hidePriceWhenZero: placement.hidePriceWhenZero,
          defaultStepIndex: placement.defaultStepIndex,
          displayOrder: placement.displayOrder,
        },
      });

      if (placement.steps.length > 0) {
        await tx.placementStep.createMany({
          data: placement.steps.map((step) => ({
            placementDefinitionId: newPlacement.id,
            label: step.label,
            scaleFactor: step.scaleFactor,
            priceAdjustmentCents: step.priceAdjustmentCents,
            displayOrder: step.displayOrder,
          })),
        });
      }
    }

    // Copy view-level geometry from source to matching target views (by perspective)
    const sourceViews = await tx.productView.findMany({
      where: { productConfigId: sourceConfigId },
      select: { perspective: true, placementGeometry: true },
    });
    for (const sv of sourceViews) {
      if (sv.placementGeometry) {
        await tx.productView.updateMany({
          where: { productConfigId: targetConfigId, perspective: sv.perspective },
          data: { placementGeometry: sv.placementGeometry as Prisma.InputJsonValue },
        });
      }
    }
  });
}

// ============================================================================
// Preset Templates
// ============================================================================

type PresetTemplate = {
  name: string;
  views: Array<{ perspective: ViewPerspective; displayOrder: number }>;
  placements: Array<{
    name: string;
    displayOrder: number;
    steps: Array<{ label: string; scaleFactor: number; displayOrder: number }>;
  }>;
};

export const PRESETS: Record<string, PresetTemplate> = {
  "t-shirt": {
    name: "T-Shirt",
    views: [
      { perspective: ViewPerspective.front, displayOrder: 0 },
      { perspective: ViewPerspective.back, displayOrder: 1 },
    ],
    placements: [
      {
        name: "Left Chest",
        displayOrder: 0,
        steps: [
          { label: "Small", scaleFactor: 0.5, displayOrder: 0 },
          { label: "Medium", scaleFactor: 0.75, displayOrder: 1 },
          { label: "Large", scaleFactor: 1.0, displayOrder: 2 },
        ],
      },
      {
        name: "Full Front",
        displayOrder: 1,
        steps: [
          { label: "Standard", scaleFactor: 0.8, displayOrder: 0 },
          { label: "Full", scaleFactor: 1.0, displayOrder: 1 },
        ],
      },
    ],
  },
  hoodie: {
    name: "Hoodie",
    views: [
      { perspective: ViewPerspective.front, displayOrder: 0 },
      { perspective: ViewPerspective.back, displayOrder: 1 },
    ],
    placements: [
      {
        name: "Left Chest",
        displayOrder: 0,
        steps: [
          { label: "Small", scaleFactor: 0.5, displayOrder: 0 },
          { label: "Medium", scaleFactor: 0.75, displayOrder: 1 },
        ],
      },
      {
        name: "Full Front",
        displayOrder: 1,
        steps: [
          { label: "Standard", scaleFactor: 0.8, displayOrder: 0 },
          { label: "Full", scaleFactor: 1.0, displayOrder: 1 },
        ],
      },
    ],
  },
  polo: {
    name: "Polo",
    views: [
      { perspective: ViewPerspective.front, displayOrder: 0 },
      { perspective: ViewPerspective.back, displayOrder: 1 },
      { perspective: ViewPerspective.left, displayOrder: 2 },
    ],
    placements: [
      {
        name: "Left Chest",
        displayOrder: 0,
        steps: [
          { label: "Small", scaleFactor: 0.5, displayOrder: 0 },
          { label: "Medium", scaleFactor: 0.75, displayOrder: 1 },
        ],
      },
    ],
  },
  cap: {
    name: "Cap",
    views: [{ perspective: ViewPerspective.front, displayOrder: 0 }],
    placements: [
      {
        name: "Front Center",
        displayOrder: 0,
        steps: [
          { label: "Small", scaleFactor: 0.6, displayOrder: 0 },
          { label: "Standard", scaleFactor: 1.0, displayOrder: 1 },
        ],
      },
    ],
  },
};

export async function applyPreset(
  productConfigId: string,
  presetKey: string
): Promise<void> {
  const preset = PRESETS[presetKey];
  if (!preset) return; // Unknown preset — silently skip

  await db.$transaction(async (tx) => {
    // Create views
    for (const view of preset.views) {
      await tx.productView.create({
        data: {
          productConfigId,
          perspective: view.perspective,
          displayOrder: view.displayOrder,
        },
      });
    }

    // Create placements with steps
    for (const placement of preset.placements) {
      const created = await tx.placementDefinition.create({
        data: {
          productConfigId,
          name: placement.name,
          displayOrder: placement.displayOrder,
        },
      });
      for (const step of placement.steps) {
        await tx.placementStep.create({
          data: {
            placementDefinitionId: created.id,
            label: step.label,
            scaleFactor: step.scaleFactor,
            displayOrder: step.displayOrder,
          },
        });
      }
    }
  });
}

/**
 * Duplicate a product config (for copying settings to new products)
 */
export async function duplicateProductConfig(
  shopId: string,
  sourceConfigId: string,
  newName: string,
  newProductIds: string[]
) {
  const source = await getProductConfig(shopId, sourceConfigId);

  const newConfigId = await db.$transaction(async (tx) => {
    // Create new config
    const newConfig = await tx.productConfig.create({
      data: {
        shopId,
        name: newName,
        linkedProductIds: newProductIds,
      },
    });

    // Copy allowed methods
    const methodIds = source.allowedMethods.map((m) => m.decorationMethodId);
    if (methodIds.length > 0) {
      await tx.productConfigMethod.createMany({
        data: methodIds.map((methodId) => ({
          productConfigId: newConfig.id,
          decorationMethodId: methodId,
        })),
      });
    }

    // Copy views
    for (const view of source.views) {
      await tx.productView.create({
        data: {
          productConfigId: newConfig.id,
          name: view.name ?? null,
          perspective: view.perspective,
          displayOrder: view.displayOrder,
        },
      });
    }

    // Copy placements with steps
    for (const placement of source.placements) {
      const newPlacement = await tx.placementDefinition.create({
        data: {
          productConfigId: newConfig.id,
          name: placement.name,
          basePriceAdjustmentCents: placement.basePriceAdjustmentCents,
          hidePriceWhenZero: placement.hidePriceWhenZero,
          defaultStepIndex: placement.defaultStepIndex,
          displayOrder: placement.displayOrder,
        },
      });

      // Copy steps
      if (placement.steps.length > 0) {
        await tx.placementStep.createMany({
          data: placement.steps.map((step) => ({
            placementDefinitionId: newPlacement.id,
            label: step.label,
            scaleFactor: step.scaleFactor,
            priceAdjustmentCents: step.priceAdjustmentCents,
            displayOrder: step.displayOrder,
          })),
        });
      }
    }

    return newConfig.id;
  });

  // Fetch the full config with relations after transaction commits
  return getProductConfig(shopId, newConfigId);
}
