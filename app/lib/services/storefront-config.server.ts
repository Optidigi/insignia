/**
 * Storefront Config Service
 *
 * Builds the canonical storefront config response for GET /apps/insignia/config.
 * Canonical: docs/core/storefront-config.md, docs/core/api-contracts/storefront.md
 */

import db from "../../db.server";
import { AppError, ErrorCodes } from "../errors.server";
import { getMerchantSettings } from "./settings.server";
import { getPresignedGetUrl } from "../storage.server";

// Response types per storefront-config.md
export type PlacementGeometry = {
  centerXPercent: number;
  centerYPercent: number;
  maxWidthPercent: number;
};

export type PlacementStep = {
  label: string;
  priceAdjustmentCents: number;
  scaleFactor: number;
};

export type Placement = {
  id: string;
  name: string;
  basePriceAdjustmentCents: number;
  hidePriceWhenZero: boolean;
  steps: PlacementStep[];
  defaultStepIndex: number;
  geometryByViewId: Record<string, PlacementGeometry | null>;
};

export type ConfiguredView = {
  id: string;
  perspective: "front" | "back" | "left" | "right" | "side";
  imageUrl: string | null;
  isMissingImage: boolean;
};

export type DecorationMethodRef = {
  id: string;
  name: string;
  basePriceCents: number;
  customerName: string | null;
  customerDescription: string | null;
  artworkConstraints: {
    fileTypes: string[];
    maxColors: number | null;
    minDpi: number | null;
  } | null;
};

export type StorefrontConfig = {
  productConfigId: string;
  shop: string;
  productId: string;
  variantId: string;
  currency: string;
  baseProductPriceCents: number;
  productTitle: string;
  placeholderLogo: {
    mode: "merchant_asset" | "bold_text";
    text: string | null;
    imageUrl: string | null;
  };
  views: ConfiguredView[];
  methods: DecorationMethodRef[];
  placements: Placement[];
};

const SIGNED_URL_EXPIRES_SEC = 600;

/**
 * Resolve product config by shop and product GID (config must link this product).
 */
async function getProductConfigByProductId(shopId: string, productId: string) {
  const config = await db.productConfig.findFirst({
    where: {
      shopId,
      linkedProductIds: { has: productId },
    },
    include: {
      views: {
        orderBy: { displayOrder: "asc" },
        include: {
          placements: {
            include: {
              steps: { orderBy: { displayOrder: "asc" } },
            },
            orderBy: { displayOrder: "asc" },
          },
        },
      },
      allowedMethods: {
        include: { decorationMethod: true },
      },
    },
  });
  return config;
}

type RunGraphql = (query: string, variables?: Record<string, unknown>) => Promise<Response>;

/**
 * Get storefront config for the given product/variant.
 * Returns 404 if no config links this product.
 */
export async function getStorefrontConfig(
  shopId: string,
  shopDomain: string,
  productId: string,
  variantId: string,
  runGraphql?: RunGraphql
): Promise<StorefrontConfig> {
  const config = await getProductConfigByProductId(shopId, productId);
  if (!config) {
    throw new AppError(ErrorCodes.NOT_FOUND, "No product configuration found for this product", 404);
  }

  if (config.allowedMethods.length === 0) {
    throw new AppError(
      ErrorCodes.INVALID_CONFIG,
      "This product has no decoration methods configured. Please contact the store.",
      400
    );
  }

  // Check for placements with at least one step (complete configuration)
  const hasCompletePlacements = config.views.some((v) => v.placements.some((p) => p.steps.length > 0));
  if (!hasCompletePlacements) {
    throw new AppError(
      ErrorCodes.INVALID_CONFIG,
      "This product has no print areas configured. Please contact the store.",
      400
    );
  }

  // Fetch variant price and product title from Shopify Admin API
  let baseProductPriceCents = 0;
  let productTitle = "Product";
  if (runGraphql) {
    try {
      const variantRes = await runGraphql(
        `#graphql
        query getVariantDetails($id: ID!) {
          productVariant(id: $id) {
            price
            product {
              title
            }
          }
        }`,
        { id: variantId }
      );
      const variantData = await variantRes.json() as {
        data?: {
          productVariant?: {
            price: string;
            product?: { title: string };
          };
        };
      };
      const variant = variantData?.data?.productVariant;
      if (variant) {
        baseProductPriceCents = Math.round(parseFloat(variant.price) * 100);
        productTitle = variant.product?.title ?? "Product";
      }
    } catch {
      // Non-fatal: fall back to defaults
    }
  }

  const [settings, variantViewConfigs, shopRecord] = await Promise.all([
    getMerchantSettings(shopId),
    db.variantViewConfiguration.findMany({
      where: { productConfigId: config.id, variantId },
      include: { productView: true },
    }),
    db.shop.findUnique({
      where: { id: shopId },
      select: { currencyCode: true },
    }),
  ]);

  const currency = shopRecord?.currencyCode ?? "";

  const viewConfigByViewId = new Map(variantViewConfigs.map((vc) => [vc.viewId, vc]));

  const views: ConfiguredView[] = await Promise.all(
    config.views.map(async (view) => {
      const vc = viewConfigByViewId.get(view.id);
      const rawImageKey = vc?.imageUrl ?? view.defaultImageKey ?? null;
      let imageUrl: string | null = null;
      if (rawImageKey) {
        try {
          imageUrl = await getPresignedGetUrl(rawImageKey, SIGNED_URL_EXPIRES_SEC);
        } catch {
          imageUrl = null;
        }
      }
      return {
        id: view.id,
        perspective: view.perspective as ConfiguredView["perspective"],
        imageUrl,
        isMissingImage: imageUrl == null,
      };
    })
  );

  const geometryByViewIdForPlacement = (placementId: string): Record<string, PlacementGeometry | null> => {
    const out: Record<string, PlacementGeometry | null> = {};
    for (const view of config.views) {
      const vc = viewConfigByViewId.get(view.id);
      const variantGeom = (vc?.placementGeometry as Record<string, { centerXPercent: number; centerYPercent: number; maxWidthPercent: number } | null> | null) ?? {};
      const viewGeom = (view.placementGeometry as Record<string, { centerXPercent: number; centerYPercent: number; maxWidthPercent: number } | null> | null) ?? {};

      // Prefer view-level geometry when sharedZones is ON; otherwise prefer per-variant
      const isShared = view.sharedZones ?? true;
      const effectiveGeom = isShared
        ? { ...variantGeom, ...viewGeom }  // view-level wins over variant-level
        : { ...viewGeom, ...variantGeom }; // variant-level wins over view-level

      const g = effectiveGeom[placementId];
      if (g && typeof g === "object" && "centerXPercent" in g) {
        out[view.id] = {
          centerXPercent: Number(g.centerXPercent),
          centerYPercent: Number(g.centerYPercent),
          maxWidthPercent: Number(g.maxWidthPercent),
        };
      } else {
        out[view.id] = null;
      }
    }
    return out;
  };

  // Only include placements that have at least one step (complete configuration)
  // and geometry on at least one view with an image (visible to customers)
  const allPlacements = config.views.flatMap((v) => v.placements).filter((p) => p.steps.length > 0);
  const placements: Placement[] = allPlacements.map((p) => ({
    id: p.id,
    name: p.name,
    basePriceAdjustmentCents: p.basePriceAdjustmentCents,
    hidePriceWhenZero: p.hidePriceWhenZero,
    steps: p.steps.map((s) => ({
      label: s.label,
      priceAdjustmentCents: s.priceAdjustmentCents,
      scaleFactor: s.scaleFactor ?? 1.0,
    })),
    defaultStepIndex: p.defaultStepIndex,
    geometryByViewId: geometryByViewIdForPlacement(p.id),
  }));

  let placeholderMode: "merchant_asset" | "bold_text" = "bold_text";
  let placeholderImageUrl: string | null = null;
  const placeholderKey = settings.placeholderLogoImageUrl;
  if (placeholderKey) {
    try {
      placeholderImageUrl = await getPresignedGetUrl(
        placeholderKey.startsWith("shops/") ? placeholderKey : placeholderKey.split("/").slice(-4).join("/"),
        SIGNED_URL_EXPIRES_SEC
      );
      placeholderMode = "merchant_asset";
    } catch {
      placeholderMode = "bold_text";
    }
  }

  const methods: DecorationMethodRef[] = config.allowedMethods.map((m) => ({
    id: m.decorationMethod.id,
    name: m.decorationMethod.name,
    basePriceCents: m.decorationMethod.basePriceCents,
    customerName: m.decorationMethod.customerName,
    customerDescription: m.decorationMethod.customerDescription ?? m.decorationMethod.description ?? null,
    artworkConstraints: m.decorationMethod.artworkConstraints as { fileTypes: string[]; maxColors: number | null; minDpi: number | null } | null,
  }));

  return {
    productConfigId: config.id,
    shop: shopDomain,
    productId,
    variantId,
    currency,
    baseProductPriceCents,
    productTitle,
    placeholderLogo: {
      mode: placeholderMode,
      text: placeholderMode === "bold_text" ? "LOGO" : null,
      imageUrl: placeholderMode === "merchant_asset" ? placeholderImageUrl : null,
    },
    views,
    methods,
    placements,
  };
}
