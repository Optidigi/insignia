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
        include: {
          placements: {
            orderBy: { displayOrder: "asc" },
          },
        },
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
        include: {
          placements: {
            include: {
              steps: {
                orderBy: { displayOrder: "asc" },
              },
            },
            orderBy: { displayOrder: "asc" },
          },
        },
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

    // Auto-create a default "Front" view so the image manager is immediately usable
    await tx.productView.create({
      data: {
        productConfigId: newConfig.id,
        perspective: "front",
        name: "Front",
        displayOrder: 0,
      },
    });

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
    // Get target views for matching by perspective
    const targetViews = await tx.productView.findMany({
      where: { productConfigId: targetConfigId },
    });

    // Delete all existing placements on target views (cascade deletes steps)
    for (const tv of targetViews) {
      await tx.placementDefinition.deleteMany({
        where: { productViewId: tv.id },
      });
    }

    // Clear view-level geometry on target views
    await tx.productView.updateMany({
      where: { productConfigId: targetConfigId },
      data: { placementGeometry: Prisma.DbNull },
    });

    // Copy placements per-view from source to matching target views (by perspective)
    for (const sourceView of source.views) {
      const targetView = targetViews.find(
        (tv) => tv.perspective === sourceView.perspective
      );
      if (!targetView) continue;

      // Build mapping from source placement IDs to new target placement IDs
      const oldIdToNewId = new Map<string, string>();

      // Copy placements from this source view to the matching target view
      for (const placement of sourceView.placements) {
        const newPlacement = await tx.placementDefinition.create({
          data: {
            productViewId: targetView.id,
            name: placement.name,
            basePriceAdjustmentCents: placement.basePriceAdjustmentCents,
            hidePriceWhenZero: placement.hidePriceWhenZero,
            defaultStepIndex: placement.defaultStepIndex,
            displayOrder: placement.displayOrder,
          },
        });

        oldIdToNewId.set(placement.id, newPlacement.id);

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

      // Copy geometry with re-keyed placement IDs
      if (sourceView.placementGeometry) {
        const sourceGeometry = sourceView.placementGeometry as Record<string, unknown>;
        const reKeyedGeometry: Record<string, unknown> = {};
        for (const [oldId, geom] of Object.entries(sourceGeometry)) {
          const newId = oldIdToNewId.get(oldId);
          if (newId && geom) reKeyedGeometry[newId] = geom;
        }
        await tx.productView.update({
          where: { id: targetView.id },
          data: { placementGeometry: reKeyedGeometry as Prisma.InputJsonValue },
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
    // Create views and track them
    const createdViews: Array<{ id: string; displayOrder: number }> = [];
    for (const view of preset.views) {
      const created = await tx.productView.create({
        data: {
          productConfigId,
          perspective: view.perspective,
          displayOrder: view.displayOrder,
        },
      });
      createdViews.push({ id: created.id, displayOrder: view.displayOrder });
    }

    // Assign placements to the first view (front view in all presets)
    const firstView = createdViews.sort((a, b) => a.displayOrder - b.displayOrder)[0];
    if (!firstView) return;

    // Create placements with steps on the first view
    for (const placement of preset.placements) {
      const created = await tx.placementDefinition.create({
        data: {
          productViewId: firstView.id,
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

    // Copy views with their placements
    for (const view of source.views) {
      const newView = await tx.productView.create({
        data: {
          productConfigId: newConfig.id,
          name: view.name ?? null,
          perspective: view.perspective,
          displayOrder: view.displayOrder,
        },
      });

      // Copy placements for this view
      for (const placement of view.placements) {
        const newPlacement = await tx.placementDefinition.create({
          data: {
            productViewId: newView.id,
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
    }

    return newConfig.id;
  });

  // Fetch the full config with relations after transaction commits
  return getProductConfig(shopId, newConfigId);
}
