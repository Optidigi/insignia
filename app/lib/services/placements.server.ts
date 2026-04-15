/**
 * Placements Service
 *
 * Business logic for placement definitions and steps per product view.
 * Canonical: docs/core/placement-editor.md, docs/core/api-contracts/admin.md
 */

import { z } from "zod";
import db from "../../db.server";
import { AppError, ErrorCodes } from "../errors.server";

// ============================================================================
// Validation Schemas
// ============================================================================

const PlacementStepSchema = z.object({
  label: z.string().min(1, "Step label is required").max(100),
  priceAdjustmentCents: z.number().int(),
  scaleFactor: z.number().min(0.1).max(2.0).optional().default(1.0),
});

export const CreatePlacementSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  basePriceAdjustmentCents: z.number().int().optional().default(0),
  hidePriceWhenZero: z.boolean().optional().default(false),
  defaultStepIndex: z.number().int().min(0).optional().default(0),
  steps: z.array(PlacementStepSchema).optional().default([]),
});

export const UpdatePlacementSchema = z.object({
  name: z.string().min(1, "Name is required").max(100).optional(),
  basePriceAdjustmentCents: z.number().int().optional(),
  hidePriceWhenZero: z.boolean().optional(),
  defaultStepIndex: z.number().int().min(0).optional(),
  steps: z.array(PlacementStepSchema).optional(),
});

export type CreatePlacementInput = z.infer<typeof CreatePlacementSchema>;
export type UpdatePlacementInput = z.infer<typeof UpdatePlacementSchema>;

// ============================================================================
// Helpers
// ============================================================================

async function ensureViewBelongsToShop(
  productViewId: string,
  shopId: string
) {
  const view = await db.productView.findFirst({
    where: { id: productViewId, productConfig: { shopId } },
    select: { id: true },
  });
  if (!view) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Product view not found", 404);
  }
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * List all placement definitions for a product view
 */
export async function listPlacements(shopId: string, productViewId: string) {
  await ensureViewBelongsToShop(productViewId, shopId);

  return db.placementDefinition.findMany({
    where: { productViewId },
    include: {
      steps: { orderBy: { displayOrder: "asc" } },
    },
    orderBy: { displayOrder: "asc" },
  });
}

/**
 * Get a single placement definition with steps
 */
export async function getPlacement(
  shopId: string,
  productViewId: string,
  placementId: string
) {
  await ensureViewBelongsToShop(productViewId, shopId);

  const placement = await db.placementDefinition.findFirst({
    where: {
      id: placementId,
      productViewId,
    },
    include: {
      steps: { orderBy: { displayOrder: "asc" } },
    },
  });

  if (!placement) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Placement not found", 404);
  }

  return placement;
}

/**
 * Create a new placement definition with optional steps
 */
export async function createPlacement(
  shopId: string,
  productViewId: string,
  input: CreatePlacementInput
) {
  await ensureViewBelongsToShop(productViewId, shopId);

  const maxOrder = await db.placementDefinition
    .aggregate({
      where: { productViewId },
      _max: { displayOrder: true },
    })
    .then((r) => (r._max.displayOrder ?? -1) + 1);

  const placement = await db.placementDefinition.create({
    data: {
      productViewId,
      name: input.name,
      basePriceAdjustmentCents: input.basePriceAdjustmentCents ?? 0,
      hidePriceWhenZero: input.hidePriceWhenZero ?? false,
      defaultStepIndex: Math.min(
        input.defaultStepIndex ?? 0,
        Math.max(0, input.steps.length - 1)
      ),
      displayOrder: maxOrder,
    },
  });

  if (input.steps && input.steps.length > 0) {
    await db.placementStep.createMany({
      data: input.steps.map((step, i) => ({
        placementDefinitionId: placement.id,
        label: step.label,
        priceAdjustmentCents: step.priceAdjustmentCents,
        scaleFactor: step.scaleFactor ?? 1.0,
        displayOrder: i,
      })),
    });
  }

  return getPlacement(shopId, productViewId, placement.id);
}

/**
 * Update a placement definition and optionally replace steps
 */
export async function updatePlacement(
  shopId: string,
  productViewId: string,
  placementId: string,
  input: UpdatePlacementInput
) {
  const existing = await getPlacement(shopId, productViewId, placementId);

  const data: Parameters<typeof db.placementDefinition.update>[0]["data"] = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.basePriceAdjustmentCents !== undefined)
    data.basePriceAdjustmentCents = input.basePriceAdjustmentCents;
  if (input.hidePriceWhenZero !== undefined)
    data.hidePriceWhenZero = input.hidePriceWhenZero;
  if (input.defaultStepIndex !== undefined)
    data.defaultStepIndex = Math.max(0, input.defaultStepIndex);

  if (Object.keys(data).length > 0) {
    await db.placementDefinition.update({
      where: { id: placementId },
      data,
    });
  }

  if (input.steps !== undefined) {
    await db.placementStep.deleteMany({
      where: { placementDefinitionId: placementId },
    });
    if (input.steps.length > 0) {
      await db.placementStep.createMany({
        data: input.steps.map((step, i) => ({
          placementDefinitionId: placementId,
          label: step.label,
          priceAdjustmentCents: step.priceAdjustmentCents,
          scaleFactor: step.scaleFactor ?? 1.0,
          displayOrder: i,
        })),
      });
    }
    const stepCount = input.steps.length;
    const clampedDefault = Math.min(
      input.defaultStepIndex ?? existing.defaultStepIndex,
      Math.max(0, stepCount - 1)
    );
    await db.placementDefinition.update({
      where: { id: placementId },
      data: { defaultStepIndex: clampedDefault },
    });
  }

  return getPlacement(shopId, productViewId, placementId);
}

/**
 * Delete a placement definition (and its steps via cascade)
 */
export async function deletePlacement(
  shopId: string,
  productViewId: string,
  placementId: string
) {
  await getPlacement(shopId, productViewId, placementId);

  await db.placementDefinition.delete({
    where: { id: placementId },
  });
}
