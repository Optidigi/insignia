/**
 * Storefront prepare: reserve slot variant and set price.
 * Canonical: docs/core/variant-pool/implementation.md, docs/core/api-contracts/storefront.md
 */

import db from "../../db.server";
const PRICING_VERSION = "v1";
import { AppError, ErrorCodes } from "../errors.server";
import { computeCustomizationPrice } from "./storefront-customizations.server";
import { ensureVariantPoolExists } from "./variant-pool.server";

const RESERVED_TTL_MINUTES = 15;

export type PrepareResult = {
  slotVariantId: string;
  configHash: string;
  pricingVersion: string;
  unitPriceCents: number;
  feeCents: number;
};

/**
 * Reserve a slot for the draft and set its price in Shopify. Requires at least one FREE VariantSlot for the method.
 */
export async function prepareCustomization(
  shopId: string,
  customizationId: string,
  adminGraphql: (query: string, variables?: Record<string, unknown>) => Promise<Response>
): Promise<PrepareResult> {
  const draft = await db.customizationDraft.findFirst({
    where: { id: customizationId, shopId },
  });
  if (!draft) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Customization not found", 404);
  }

  // Idempotency: if already prepared, return the existing result —
  // but only if the fee product still exists in Shopify (it may have been deleted).
  const existingConfig = await db.customizationConfig.findFirst({
    where: {
      customizationDraftId: customizationId,
      state: { in: ["RESERVED", "IN_CART", "ORDERED", "PURCHASED"] },
    },
    include: { variantSlot: { select: { shopifyVariantId: true, shopifyProductId: true } } },
  });
  if (existingConfig?.variantSlot) {
    // Verify the fee product still exists before returning stale data
    const productGid = existingConfig.variantSlot.shopifyProductId;
    let productExists = true;
    try {
      const checkRes = await adminGraphql(
        `#graphql
          query product($id: ID!) { product(id: $id) { id } }`,
        { id: productGid }
      );
      const checkJson = await checkRes.json();
      productExists = !!checkJson?.data?.product?.id;
    } catch {
      productExists = false;
    }

    if (productExists) {
      return {
        slotVariantId: existingConfig.variantSlot.shopifyVariantId,
        configHash: existingConfig.configHash,
        pricingVersion: existingConfig.pricingVersion,
        unitPriceCents: existingConfig.unitPriceCents,
        feeCents: existingConfig.feeCents,
      };
    }

    // Fee product was deleted — expire this config so we fall through to re-provision
    console.warn(`[prepare] Fee product ${productGid} deleted — expiring config ${existingConfig.id}`);
    await db.customizationConfig.update({
      where: { id: existingConfig.id },
      data: { state: "EXPIRED", variantSlotId: null },
    });
  }

  let unitPriceCents = draft.unitPriceCents ?? null;
  let feeCents = draft.feeCents ?? null;
  let configHash = draft.configHash ?? null;
  let pricingVersion = draft.pricingVersion ?? null;
  if (unitPriceCents == null || feeCents == null || !configHash || !pricingVersion) {
    const priceResult = await computeCustomizationPrice(shopId, customizationId);
    unitPriceCents = priceResult.unitPriceCents;
    feeCents = priceResult.feeCents;
    const updated = await db.customizationDraft.findFirst({
      where: { id: customizationId, shopId },
    });
    configHash = updated?.configHash ?? "";
    pricingVersion = updated?.pricingVersion ?? PRICING_VERSION;
  }

  const methodId = draft.methodId;

  // Lazy-provision: if no slots exist for this method, create them now
  await ensureVariantPoolExists(shopId, methodId, adminGraphql);

  const now = new Date();
  const reservedUntil = new Date(now.getTime() + RESERVED_TTL_MINUTES * 60 * 1000);

  // Recycle expired reservations before looking for a free slot
  const expiredSlots = await db.variantSlot.findMany({
    where: { shopId, methodId, state: "RESERVED", reservedUntil: { lt: now } },
    select: { id: true, currentConfigId: true },
  });
  for (const slot of expiredSlots) {
    if (slot.currentConfigId) {
      await db.customizationConfig.update({
        where: { id: slot.currentConfigId },
        data: { state: "EXPIRED", expiredAt: now, variantSlotId: null },
      });
    }
    await db.variantSlot.update({
      where: { id: slot.id },
      data: { state: "FREE", reservedAt: null, reservedUntil: null, currentConfigId: null },
    });
  }

  const result = await db.$transaction(async (tx) => {
    // Use raw SQL with FOR UPDATE SKIP LOCKED to prevent race conditions
    const freeSlots: Array<{ id: string; shopifyProductId: string; shopifyVariantId: string }> =
      await tx.$queryRaw`
        SELECT id, "shopifyProductId", "shopifyVariantId"
        FROM "VariantSlot"
        WHERE "shopId" = ${shopId}
          AND "methodId" = ${methodId}
          AND state = 'FREE'
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
    const freeSlot = freeSlots[0];
    if (!freeSlot) {
      throw new AppError(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "All customization slots are in use. Please try again shortly.",
        503
      );
    }

    const config = await tx.customizationConfig.create({
      data: {
        shopId,
        methodId,
        configHash: configHash!,
        pricingVersion: pricingVersion!,
        unitPriceCents: unitPriceCents!,
        feeCents: feeCents ?? 0,
        state: "RESERVED",
        customizationDraftId: customizationId,
      },
    });

    await tx.variantSlot.update({
      where: { id: freeSlot.id },
      data: {
        state: "RESERVED",
        reservedAt: now,
        reservedUntil,
        currentConfigId: config.id,
      },
    });

    await tx.customizationConfig.update({
      where: { id: config.id },
      data: { variantSlotId: freeSlot.id },
    });

    return { config, slot: freeSlot };
  });

  const priceStr = ((feeCents ?? 0) / 100).toFixed(2);
  const variantId = result.slot.shopifyVariantId;
  const productId = result.slot.shopifyProductId;

  const variantGid = variantId.startsWith("gid://") ? variantId : `gid://shopify/ProductVariant/${variantId}`;
  const productGid = productId.startsWith("gid://") ? productId : `gid://shopify/Product/${productId}`;

  const updateMutation = `#graphql
    mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id price }
        userErrors { field message }
      }
    }`;
  const response = await adminGraphql(updateMutation, {
    productId: productGid,
    variants: [{ id: variantGid, price: priceStr }],
  });
  const json = await response.json();
  const errors = json?.data?.productVariantsBulkUpdate?.userErrors;
  if (errors?.length) {
    console.error("[prepare] Shopify variant update errors:", errors);
    throw new AppError(
      ErrorCodes.INTERNAL_ERROR,
      "Failed to set slot price in Shopify",
      500
    );
  }

  return {
    slotVariantId: result.slot.shopifyVariantId,
    configHash: configHash!,
    pricingVersion: pricingVersion!,
    unitPriceCents: unitPriceCents!,
    feeCents: feeCents ?? 0,
  };
}
