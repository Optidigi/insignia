/**
 * Decoration Methods Service
 *
 * Business logic for managing decoration methods (Embroidery, DTG, etc.)
 */

import { Prisma } from "@prisma/client";
import { z } from "zod";
import db from "../../db.server";
import { AppError, ErrorCodes } from "../errors.server";

// ============================================================================
// Validation Schemas
// ============================================================================

const artworkConstraintsSchema = z.object({
  fileTypes: z
    .array(
      z.enum([
        "svg",
        "png",
        "jpg",
        "webp",
        "gif",
        "tiff",
        "heic",
        "pdf",
        "ai",
        "eps",
      ])
    )
    .optional()
    .default([]),
  maxColors: z.number().int().min(1).max(100).optional(),
  minDpi: z.number().int().min(72).max(1200).optional(),
});

export const CreateMethodSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name too long"),
  basePriceCents: z.number().int().min(0).optional().default(0),
  hidePriceWhenZero: z.boolean().optional(),
  description: z.string().max(500).optional(),
  customerName: z.string().max(100).optional(),
  customerDescription: z.string().max(300).optional(),
  artworkConstraints: artworkConstraintsSchema.optional(),
});

export const UpdateMethodSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name too long").optional(),
  basePriceCents: z.number().int().min(0).optional(),
  hidePriceWhenZero: z.boolean().optional(),
  description: z.string().max(500).optional().nullable(),
  customerName: z.string().max(100).optional().nullable(),
  artworkConstraints: artworkConstraintsSchema.optional().nullable(),
});

export type CreateMethodInput = z.infer<typeof CreateMethodSchema>;
export type UpdateMethodInput = z.infer<typeof UpdateMethodSchema>;

// ============================================================================
// Service Functions
// ============================================================================

/**
 * List all decoration methods for a shop
 */
export async function listMethods(shopId: string) {
  return db.decorationMethod.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Get a single decoration method
 */
export async function getMethod(shopId: string, methodId: string) {
  const method = await db.decorationMethod.findFirst({
    where: {
      id: methodId,
      shopId,
    },
  });

  if (!method) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Method not found", 404);
  }

  return method;
}

/**
 * Create a new decoration method
 */
export async function createMethod(shopId: string, input: CreateMethodInput) {
  const parsed = CreateMethodSchema.parse(input);

  // Check for duplicate name
  const existing = await db.decorationMethod.findUnique({
    where: {
      shopId_name: {
        shopId,
        name: parsed.name,
      },
    },
  });

  if (existing) {
    throw new AppError(
      ErrorCodes.CONFLICT,
      `A method named "${parsed.name}" already exists`,
      409,
      { field: "name" }
    );
  }

  return db.decorationMethod.create({
    data: {
      shopId,
      name: parsed.name,
      basePriceCents: parsed.basePriceCents,
      hidePriceWhenZero: parsed.hidePriceWhenZero ?? false,
      description: parsed.description,
      customerName: parsed.customerName,
      customerDescription: parsed.customerDescription,
      artworkConstraints: parsed.artworkConstraints ?? undefined,
    },
  });
}

/**
 * Update a decoration method
 */
export async function updateMethod(
  shopId: string,
  methodId: string,
  input: UpdateMethodInput
) {
  const parsed = UpdateMethodSchema.parse(input);

  // Check that method exists and belongs to shop
  const method = await db.decorationMethod.findFirst({
    where: {
      id: methodId,
      shopId,
    },
  });

  if (!method) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Method not found", 404);
  }

  // Check for duplicate name (excluding current method)
  if (parsed.name !== undefined && parsed.name !== method.name) {
    const existing = await db.decorationMethod.findUnique({
      where: {
        shopId_name: {
          shopId,
          name: parsed.name,
        },
      },
    });

    if (existing) {
      throw new AppError(
        ErrorCodes.CONFLICT,
        `A method named "${parsed.name}" already exists`,
        409,
        { field: "name" }
      );
    }
  }

  return db.decorationMethod.update({
    where: { id: methodId },
    data: {
      ...(parsed.name !== undefined && { name: parsed.name }),
      ...(parsed.basePriceCents !== undefined && {
        basePriceCents: parsed.basePriceCents,
      }),
      ...(parsed.hidePriceWhenZero !== undefined && {
        hidePriceWhenZero: parsed.hidePriceWhenZero,
      }),
      ...(parsed.description !== undefined && {
        description: parsed.description,
      }),
      ...(parsed.customerName !== undefined && {
        customerName: parsed.customerName,
      }),
      ...(parsed.artworkConstraints !== undefined && {
        artworkConstraints: parsed.artworkConstraints === null ? Prisma.JsonNull : parsed.artworkConstraints,
      }),
    },
  });
}

/**
 * Resolve the price a given ProductConfigMethod row charges.
 * Override semantics: null/undefined = inherit method base; non-null = full replacement.
 */
export function effectiveMethodPriceCents(
  methodBasePriceCents: number,
  overrideCents: number | null | undefined
): number {
  return overrideCents ?? methodBasePriceCents;
}

/**
 * Resolve the effective base price adjustment for a (placement, method) pair.
 * null/undefined override => fall back to the placement's own basePriceAdjustmentCents.
 * Non-null override => full replacement.
 */
export function effectivePlacementAdjustmentCents(
  placementDefaultCents: number,
  methodOverrideCents: number | null | undefined
): number {
  return methodOverrideCents ?? placementDefaultCents;
}

/**
 * Delete a decoration method
 */
export async function deleteMethod(shopId: string, methodId: string) {
  // Check that method exists and belongs to shop
  const method = await db.decorationMethod.findFirst({
    where: {
      id: methodId,
      shopId,
    },
  });

  if (!method) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Method not found", 404);
  }

  // Check for related records
  const relatedConfigs = await db.productConfigMethod.count({
    where: { decorationMethodId: methodId },
  });

  if (relatedConfigs > 0) {
    throw new AppError(
      ErrorCodes.CONFLICT,
      "Cannot delete method that is used by product configurations",
      409,
      { relatedConfigs }
    );
  }

  await db.decorationMethod.delete({
    where: { id: methodId },
  });
}
