// design-fees: CRUD for DesignFeeCategory + placement-mapping helpers.
// Mirrors style of methods.server.ts. All functions are shop-scoped.

import db from "../../../db.server";
import { AppError, ErrorCodes } from "../../errors.server";

export type DesignFeeCategoryRecord = {
  id: string;
  shopId: string;
  methodId: string;
  name: string;
  feeCents: number;
  displayOrder: number;
};

export async function listCategoriesForMethod(
  shopId: string,
  methodId: string,
): Promise<DesignFeeCategoryRecord[]> {
  return db.designFeeCategory.findMany({
    where: { shopId, methodId },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      shopId: true,
      methodId: true,
      name: true,
      feeCents: true,
      displayOrder: true,
    },
  });
}

export async function listCategoriesForShop(
  shopId: string,
): Promise<DesignFeeCategoryRecord[]> {
  return db.designFeeCategory.findMany({
    where: { shopId },
    orderBy: [{ methodId: "asc" }, { displayOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      shopId: true,
      methodId: true,
      name: true,
      feeCents: true,
      displayOrder: true,
    },
  });
}

export type CreateCategoryInput = {
  name: string;
  feeCents: number;
  displayOrder?: number;
};

export async function createCategory(
  shopId: string,
  methodId: string,
  input: CreateCategoryInput,
): Promise<DesignFeeCategoryRecord> {
  const name = input.name.trim();
  if (!name) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "Category name is required", 400);
  }
  if (!Number.isFinite(input.feeCents) || input.feeCents < 0) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "feeCents must be a non-negative integer", 400);
  }

  // Validate method belongs to this shop
  const method = await db.decorationMethod.findFirst({
    where: { id: methodId, shopId },
    select: { id: true },
  });
  if (!method) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Decoration method not found", 404);
  }

  return db.designFeeCategory.create({
    data: {
      shopId,
      methodId,
      name,
      feeCents: Math.round(input.feeCents),
      displayOrder: input.displayOrder ?? 0,
    },
    select: {
      id: true,
      shopId: true,
      methodId: true,
      name: true,
      feeCents: true,
      displayOrder: true,
    },
  });
}

export type UpdateCategoryInput = Partial<CreateCategoryInput>;

export async function updateCategory(
  shopId: string,
  categoryId: string,
  input: UpdateCategoryInput,
): Promise<DesignFeeCategoryRecord> {
  // Shop-scope: ensure category belongs to shop
  const existing = await db.designFeeCategory.findFirst({
    where: { id: categoryId, shopId },
    select: { id: true },
  });
  if (!existing) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Design fee category not found", 404);
  }

  const data: { name?: string; feeCents?: number; displayOrder?: number } = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "Category name cannot be empty", 400);
    }
    data.name = name;
  }
  if (input.feeCents !== undefined) {
    if (!Number.isFinite(input.feeCents) || input.feeCents < 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "feeCents must be a non-negative integer", 400);
    }
    // Note: editing feeCents does NOT retroactively change existing
    // CartDesignFeeCharge.feeCentsCharged values — those are snapshots.
    data.feeCents = Math.round(input.feeCents);
  }
  if (input.displayOrder !== undefined) {
    data.displayOrder = input.displayOrder;
  }

  return db.designFeeCategory.update({
    where: { id: categoryId },
    data,
    select: {
      id: true,
      shopId: true,
      methodId: true,
      name: true,
      feeCents: true,
      displayOrder: true,
    },
  });
}

export async function deleteCategory(
  shopId: string,
  categoryId: string,
): Promise<{ deleted: true }> {
  const existing = await db.designFeeCategory.findFirst({
    where: { id: categoryId, shopId },
    select: { id: true },
  });
  if (!existing) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Design fee category not found", 404);
  }
  // Open charges block deletion via FK RESTRICT. Surface a friendly count.
  const openCharges = await db.cartDesignFeeCharge.count({
    where: { categoryId },
  });
  if (openCharges > 0) {
    throw new AppError(
      ErrorCodes.BAD_REQUEST,
      `Cannot delete: ${openCharges} active cart${openCharges === 1 ? "" : "s"} reference this category. Wait for them to expire or contact support.`,
      409,
    );
  }
  await db.designFeeCategory.delete({ where: { id: categoryId } });
  return { deleted: true };
}

/**
 * Set or clear the design-fee category for a placement.
 * `categoryId === null` clears the mapping.
 */
export async function setPlacementCategory(
  shopId: string,
  placementId: string,
  categoryId: string | null,
): Promise<void> {
  // Validate placement belongs to shop (via productView -> productConfig)
  const placement = await db.placementDefinition.findFirst({
    where: {
      id: placementId,
      productView: { productConfig: { shopId } },
    },
    select: {
      id: true,
      productView: {
        select: {
          productConfig: {
            select: {
              allowedMethods: { select: { decorationMethodId: true } },
            },
          },
        },
      },
    },
  });
  if (!placement) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Placement not found", 404);
  }

  if (categoryId !== null) {
    const category = await db.designFeeCategory.findFirst({
      where: { id: categoryId, shopId },
      select: { id: true, methodId: true },
    });
    if (!category) {
      throw new AppError(ErrorCodes.NOT_FOUND, "Design fee category not found", 404);
    }
    const allowed = placement.productView.productConfig.allowedMethods.some(
      (m) => m.decorationMethodId === category.methodId,
    );
    if (!allowed) {
      throw new AppError(
        ErrorCodes.BAD_REQUEST,
        "Category's method is not enabled on this product configuration",
        400,
      );
    }
  }

  await db.placementDefinition.update({
    where: { id: placementId },
    data: { feeCategoryId: categoryId },
  });
}
