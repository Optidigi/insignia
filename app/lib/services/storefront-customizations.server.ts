/**
 * Storefront customizations: create draft + compute price.
 * Canonical: docs/core/api-contracts/storefront.md
 */

import { createHash } from "crypto";
import db from "../../db.server";
import { AppError, ErrorCodes } from "../errors.server";
import { getProductConfig } from "./product-configs.server";
import {
  effectiveMethodPriceCents,
  effectivePlacementAdjustmentCents,
} from "./methods.server";

const PRICING_VERSION = "v1";

export type PlacementSelection = { placementId: string; stepIndex: number };

export type CreateDraftInput = {
  productId: string;
  variantId: string;
  productConfigId: string;
  methodId: string;
  placements: PlacementSelection[];
  logoAssetIdsByPlacementId: Record<string, string | null>;
  artworkStatus: "PROVIDED" | "PENDING_CUSTOMER";
  customerEmail?: string;
};

/**
 * Persist a draft customization. Validates config and method belong to shop.
 */
export async function createCustomizationDraft(
  shopId: string,
  input: CreateDraftInput
): Promise<{ customizationId: string }> {
  const config = await db.productConfig.findFirst({
    where: { id: input.productConfigId, shopId },
    include: {
      allowedMethods: { include: { decorationMethod: true } },
      views: {
        include: {
          placements: { include: { steps: true }, orderBy: { displayOrder: "asc" } },
        },
      },
    },
  });
  if (!config) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Product configuration not found", 404);
  }
  const methodAllowed = config.allowedMethods.some((m) => m.decorationMethod.id === input.methodId);
  if (!methodAllowed) {
    throw new AppError(ErrorCodes.BAD_REQUEST, "Method not allowed for this product configuration", 400);
  }
  if (!config.linkedProductIds.includes(input.productId)) {
    throw new AppError(ErrorCodes.BAD_REQUEST, "Product not linked to this configuration", 400);
  }

  const allPlacements = config.views.flatMap((v) => v.placements);
  const placementIds = new Set(allPlacements.map((p) => p.id));
  for (const { placementId, stepIndex } of input.placements) {
    if (!placementIds.has(placementId)) {
      throw new AppError(ErrorCodes.BAD_REQUEST, `Placement ${placementId} not in configuration`, 400);
    }
    const placement = allPlacements.find((p) => p.id === placementId);
    if (placement) {
      // Placements with 0 configured steps are surfaced to the storefront as a
      // single synthetic "Standard" step (see storefront-config.server.ts
      // DEFAULT_STEP) so they behave as single-size. The client posts
      // stepIndex=0 for them. Mirror that here: treat a 0-step placement as
      // having exactly one valid index (0). Without this, every order for a
      // 0-step placement is rejected with "Invalid stepIndex".
      const maxValidIndex = Math.max(placement.steps.length, 1) - 1;
      if (stepIndex < 0 || stepIndex > maxValidIndex) {
        throw new AppError(ErrorCodes.BAD_REQUEST, `Invalid stepIndex for placement ${placementId}`, 400);
      }
    }
  }

  const draft = await db.customizationDraft.create({
    data: {
      shopId,
      productId: input.productId,
      variantId: input.variantId,
      productConfigId: input.productConfigId,
      methodId: input.methodId,
      placements: input.placements as unknown as object,
      logoAssetIdsByPlacementId: input.logoAssetIdsByPlacementId as unknown as object,
      artworkStatus: input.artworkStatus === "PENDING_CUSTOMER" ? "PENDING_CUSTOMER" : "PROVIDED",
      customerEmail: input.customerEmail ?? null,
    },
  });

  return { customizationId: draft.id };
}

export type PriceResult = {
  unitPriceCents: number;
  feeCents: number;
  breakdown: Array<{ label: string; amountCents: number }>;
  validation: { ok: boolean };
};

type AdminGraphql = (query: string, variables?: Record<string, unknown>) => Promise<Response>;

/**
 * Compute unit price for a draft and optionally store on draft for prepare.
 * When adminGraphql is provided, fetches the real Shopify variant price for base garment.
 */
export async function computeCustomizationPrice(
  shopId: string,
  customizationId: string,
  adminGraphql?: AdminGraphql
): Promise<PriceResult> {
  const draft = await db.customizationDraft.findFirst({
    where: { id: customizationId, shopId },
  });
  if (!draft) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Customization not found", 404);
  }

  const [config, method, pcm, placementOverrides] = await Promise.all([
    getProductConfig(shopId, draft.productConfigId),
    db.decorationMethod.findUnique({
      where: { id: draft.methodId },
      select: { basePriceCents: true },
    }),
    db.productConfigMethod.findUnique({
      where: {
        productConfigId_decorationMethodId: {
          productConfigId: draft.productConfigId,
          decorationMethodId: draft.methodId,
        },
      },
      select: { basePriceCentsOverride: true },
    }),
    db.placementDefinitionMethodPrice.findMany({
      where: {
        decorationMethodId: draft.methodId,
        placementDefinition: {
          productView: { productConfigId: draft.productConfigId },
        },
      },
      select: { placementDefinitionId: true, basePriceAdjustmentCents: true },
    }),
  ]);
  const methodBaseCents = effectiveMethodPriceCents(
    method?.basePriceCents ?? 0,
    pcm?.basePriceCentsOverride ?? null
  );
  const overrideByPlacementId = new Map(
    placementOverrides.map((o) => [o.placementDefinitionId, o.basePriceAdjustmentCents])
  );

  const placementsPayload = draft.placements as unknown as PlacementSelection[];
  let placementsCents = 0;
  const breakdown: Array<{ label: string; amountCents: number }> = [];

  const allConfigPlacements = config.views.flatMap((v) => v.placements);
  for (const { placementId, stepIndex } of placementsPayload) {
    const placement = allConfigPlacements.find((p) => p.id === placementId);
    if (!placement) continue;
    const step = placement.steps[stepIndex];
    const stepCents = step ? step.priceAdjustmentCents : 0;
    const baseCents = effectivePlacementAdjustmentCents(
      placement.basePriceAdjustmentCents ?? 0,
      overrideByPlacementId.get(placement.id) ?? null
    );
    placementsCents += baseCents + stepCents;
  }

  const feeCents = methodBaseCents + placementsCents;

  let baseGarmentCents = 0;
  if (adminGraphql && draft.variantId) {
    try {
      const variantGid = draft.variantId.startsWith("gid://")
        ? draft.variantId
        : `gid://shopify/ProductVariant/${draft.variantId}`;
      const res = await adminGraphql(
        `#graphql
          query getVariantPrice($id: ID!) {
            productVariant(id: $id) { price }
          }`,
        { id: variantGid }
      );
      const json = await res.json();
      const priceStr = json?.data?.productVariant?.price;
      if (priceStr != null) {
        baseGarmentCents = Math.round(parseFloat(priceStr) * 100);
      }
    } catch (e) {
      console.warn("[price] Failed to fetch variant price, using 0:", e);
    }
  }
  const unitPriceCents = baseGarmentCents + feeCents;
  if (methodBaseCents > 0) {
    breakdown.push({ label: "Decoration method", amountCents: methodBaseCents });
  }
  breakdown.push({ label: "Base garment", amountCents: baseGarmentCents });
  breakdown.push({ label: "Placements", amountCents: placementsCents });

  const configHash = hashForDraft(draft);
  await db.customizationDraft.update({
    where: { id: customizationId },
    data: {
      unitPriceCents,
      feeCents,
      configHash,
      pricingVersion: PRICING_VERSION,
    },
  });

  return {
    unitPriceCents,
    feeCents,
    breakdown,
    validation: { ok: true },
  };
}

function hashForDraft(draft: { productConfigId: string; methodId: string; placements: unknown }): string {
  const payload = JSON.stringify({
    productConfigId: draft.productConfigId,
    methodId: draft.methodId,
    placements: draft.placements,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}
