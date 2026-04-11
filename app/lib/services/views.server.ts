/**
 * Views Service
 * 
 * Business logic for managing product views and variant view configurations.
 */

import { z } from "zod";
import { Prisma } from "@prisma/client";
import db from "../../db.server";
import { AppError, ErrorCodes } from "../errors.server";
import type { ViewPerspective } from "@prisma/client";

// ============================================================================
// Validation Schemas
// ============================================================================

export const CreateViewSchema = z.object({
  perspective: z.enum(["front", "back", "left", "right", "side", "custom"]),
  name: z.string().min(1).max(100).optional(),
  displayOrder: z.number().int().min(0).optional().default(0),
});

export const UpdateViewSchema = z.object({
  perspective: z.enum(["front", "back", "left", "right", "side", "custom"]).optional(),
  displayOrder: z.number().int().min(0).optional(),
});

export const UpdateVariantViewConfigSchema = z.object({
  imageUrl: z.string().url().nullable().optional(),
  placementGeometry: z.any().nullable().optional(), // JSON object or null
});

export type CreateViewInput = z.infer<typeof CreateViewSchema>;
export type UpdateViewInput = z.infer<typeof UpdateViewSchema>;
export type UpdateVariantViewConfigInput = {
  imageUrl?: string | null;
  placementGeometry?: Record<string, unknown> | null;
};

// ============================================================================
// View Service Functions
// ============================================================================

/**
 * List all views for a product config
 */
export async function listViews(productConfigId: string) {
  return db.productView.findMany({
    where: { productConfigId },
    orderBy: { displayOrder: "asc" },
  });
}

/**
 * Get a single view
 */
export async function getView(productConfigId: string, viewId: string) {
  const view = await db.productView.findFirst({
    where: {
      id: viewId,
      productConfigId,
    },
  });

  if (!view) {
    throw new AppError(ErrorCodes.NOT_FOUND, "View not found", 404);
  }

  return view;
}

/**
 * Create a new view for a product config
 */
export async function createView(
  productConfigId: string,
  input: CreateViewInput
) {
  return db.productView.create({
    data: {
      productConfigId,
      perspective: input.perspective as ViewPerspective,
      name: input.name ?? null,
      displayOrder: input.displayOrder,
    },
  });
}

/**
 * Update a view
 */
export async function updateView(
  productConfigId: string,
  viewId: string,
  input: UpdateViewInput
) {
  const view = await getView(productConfigId, viewId);

  // If changing perspective, check for duplicates
  if (input.perspective && input.perspective !== view.perspective) {
    const existing = await db.productView.findFirst({
      where: {
        productConfigId,
        perspective: input.perspective as ViewPerspective,
        NOT: { id: viewId },
      },
    });

    if (existing) {
      throw new AppError(
        ErrorCodes.CONFLICT,
        `A ${input.perspective} view already exists for this configuration`,
        409
      );
    }
  }

  return db.productView.update({
    where: { id: viewId },
    data: {
      ...(input.perspective && { perspective: input.perspective as ViewPerspective }),
      ...(input.displayOrder !== undefined && { displayOrder: input.displayOrder }),
    },
  });
}

/**
 * Delete a view
 */
export async function deleteView(productConfigId: string, viewId: string) {
  await getView(productConfigId, viewId);

  // Cascade delete handles variant view configurations
  await db.productView.delete({
    where: { id: viewId },
  });
}

/**
 * Reorder views
 */
export async function reorderViews(
  productConfigId: string,
  viewIds: string[]
) {
  await db.$transaction(
    viewIds.map((id, index) =>
      db.productView.update({
        where: { id },
        data: { displayOrder: index },
      })
    )
  );

  return listViews(productConfigId);
}

// ============================================================================
// Variant View Configuration Service Functions
// ============================================================================

/**
 * List variant view configurations for a product config
 */
export async function listVariantViewConfigs(productConfigId: string) {
  return db.variantViewConfiguration.findMany({
    where: { productConfigId },
    include: {
      productView: true,
    },
  });
}

/**
 * Get variant view configs grouped by variant
 */
export async function getVariantViewConfigsByVariant(
  productConfigId: string,
  variantId: string
) {
  return db.variantViewConfiguration.findMany({
    where: {
      productConfigId,
      variantId,
    },
    include: {
      productView: true,
    },
  });
}

/**
 * Update or create a variant view configuration
 */
export async function upsertVariantViewConfig(
  productConfigId: string,
  variantId: string,
  viewId: string,
  input: UpdateVariantViewConfigInput
) {
  const existing = await db.variantViewConfiguration.findUnique({
    where: {
      productConfigId_variantId_viewId: {
        productConfigId,
        variantId,
        viewId,
      },
    },
  });

  if (existing) {
    return db.variantViewConfiguration.update({
      where: { id: existing.id },
      data: {
        ...(input.imageUrl !== undefined && { imageUrl: input.imageUrl }),
        ...(input.placementGeometry !== undefined && {
          placementGeometry: input.placementGeometry === null 
            ? Prisma.DbNull 
            : (input.placementGeometry as Prisma.InputJsonValue),
        }),
      },
    });
  }

  return db.variantViewConfiguration.create({
    data: {
      productConfigId,
      variantId,
      viewId,
      imageUrl: input.imageUrl ?? null,
      placementGeometry: input.placementGeometry === null || input.placementGeometry === undefined 
        ? Prisma.DbNull 
        : (input.placementGeometry as Prisma.InputJsonValue),
    },
  });
}

/**
 * Delete a variant view configuration
 */
export async function deleteVariantViewConfig(
  productConfigId: string,
  variantId: string,
  viewId: string
) {
  await db.variantViewConfiguration.deleteMany({
    where: {
      productConfigId,
      variantId,
      viewId,
    },
  });
}

/**
 * Copy variant view configurations from one variant to another.
 * When copyImages is false (duplicate), copies only placement geometry; target images stay unset.
 */
export async function copyVariantViewConfigs(
  productConfigId: string,
  sourceVariantId: string,
  targetVariantId: string,
  options: { copyImages?: boolean } = {}
) {
  const { copyImages = true } = options;

  const sourceConfigs = await db.variantViewConfiguration.findMany({
    where: {
      productConfigId,
      variantId: sourceVariantId,
    },
  });

  await db.variantViewConfiguration.deleteMany({
    where: {
      productConfigId,
      variantId: targetVariantId,
    },
  });

  if (sourceConfigs.length > 0) {
    await db.variantViewConfiguration.createMany({
      data: sourceConfigs.map((config) => ({
        productConfigId,
        variantId: targetVariantId,
        viewId: config.viewId,
        imageUrl: copyImages ? config.imageUrl : null,
        placementGeometry: config.placementGeometry ?? Prisma.DbNull,
      })),
    });
  }

  return getVariantViewConfigsByVariant(productConfigId, targetVariantId);
}
