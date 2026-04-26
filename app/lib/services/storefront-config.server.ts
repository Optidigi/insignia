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
import {
  effectiveMethodPriceCents,
  effectivePlacementAdjustmentCents,
} from "./methods.server";
import type { ProductVariantOption } from "../../components/storefront/types";
// design-fees:
import { designFeesEnabled } from "./design-fees/feature-flag.server";

// Response types per storefront-config.md
export type PlacementGeometry = {
  centerXPercent: number;
  centerYPercent: number;
  maxWidthPercent: number;
  /** Optional — set when the merchant configured the print zone with a
   * specific height. Falls back to maxWidthPercent when null. */
  maxHeightPercent?: number | null;
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
  /**
   * Optional per-method overrides for this placement's base fee. When present,
   * each key is a DecorationMethod id and the value is the effective cents charged
   * for that method. Only emitted when at least one override exists.
   */
  pricePerMethod?: Record<string, number>;
};

export type ConfiguredView = {
  id: string;
  name: string | null;
  perspective: "front" | "back" | "left" | "right" | "side";
  imageUrl: string | null;
  isMissingImage: boolean;
  /** Merchant-set ruler calibration; null when no ruler has been calibrated. */
  calibrationPxPerCm: number | null;
};

export type DecorationMethodRef = {
  id: string;
  name: string;
  basePriceCents: number;
  hidePriceWhenZero: boolean;
  customerName: string | null;
  customerDescription: string | null;
  artworkConstraints: {
    fileTypes: string[];
    maxColors: number | null;
    minDpi: number | null;
  } | null;
};

// design-fees: per-shop summary surfaced to the storefront. Null when feature
// is disabled OR when no categories are configured (dead-quiet UX).
export type StorefrontDesignFees = {
  categories: Array<{
    id: string;
    methodId: string;
    name: string;
    feeCents: number;
  }>;
  /** placementId -> categoryId map, only for placements with a mapping */
  placementCategoryByPlacementId: Record<string, string>;
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
  variants: ProductVariantOption[];
  /** Which product axis drives the quantity grid cards. */
  variantAxis: "size" | "color" | "option";
  // design-fees: null when feature off or no categories configured
  designFees: StorefrontDesignFees | null;
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
              methodPriceOverrides: true,
              steps: {
                orderBy: { displayOrder: "asc" },
              },
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

  if (config.views.every((v) => v.placements.length === 0)) {
    throw new AppError(
      ErrorCodes.INVALID_CONFIG,
      "This product has no print areas configured. Please contact the store.",
      400
    );
  }

  // Fetch variant price, product title, and sibling variants from Shopify Admin API
  let baseProductPriceCents = 0;
  let productTitle = "Product";
  let variants: ProductVariantOption[] = [];
  let variantAxis: "size" | "color" | "option" = "option";
  // view-image-orphan-fix: capture color-group siblings outside the try-block so we can
  // view-image-orphan-fix: query VVCs for them in the Promise.all below.
  let siblingVariantIdsBySameColor: string[] = [];
  if (runGraphql) {
    try {
      const variantRes = await runGraphql(
        `#graphql
        query getVariantDetails($id: ID!) {
          productVariant(id: $id) {
            price
            product {
              title
              variants(first: 250) {
                nodes {
                  id
                  title
                  price
                  availableForSale
                  selectedOptions {
                    name
                    value
                  }
                }
              }
            }
          }
        }`,
        { id: variantId }
      );
      const variantData = await variantRes.json() as {
        data?: {
          productVariant?: {
            price: string;
            product?: {
              title: string;
              variants?: {
                nodes: Array<{
                  id: string;
                  title: string;
                  price: string;
                  availableForSale: boolean;
                  selectedOptions: Array<{ name: string; value: string }>;
                }>;
              };
            };
          };
        };
      };
      const variant = variantData?.data?.productVariant;
      if (variant) {
        baseProductPriceCents = Math.round(parseFloat(variant.price) * 100);
        productTitle = variant.product?.title ?? "Product";
      }
      const variantNodes = variantData?.data?.productVariant?.product?.variants?.nodes ?? [];

      // Detect which option is the "size" option using multi-strategy heuristic:
      // 1. Match common size option names across languages
      // 2. Fall back to checking if option values look like sizes (S, M, L, XL, etc.)
      const SIZE_NAME_RE = /^(size|sizes|maat|größe|groesse|taille|taglia|tamanho|rozmiar|storlek|koko|サイズ)$/i;
      const SIZE_VALUE_RE = /^(xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl|5xl|small|medium|large|x-?large|xx-?large)$/i;
      // Detect color axis by option name only (v1 heuristic — name-only, not values)
      const COLOR_NAME_RE = /^(color|colour|kleur|farbe|couleur|colore|cor|kolor|färg|väri)$/i;

      let sizeOptionName: string | null = null;
      let colorOptionName: string | null = null;
      if (variantNodes.length > 0) {
        const firstOptions = variantNodes[0].selectedOptions ?? [];
        // Strategy 1: match by name
        sizeOptionName = firstOptions.find((o) => SIZE_NAME_RE.test(o.name))?.name ?? null;
        // Strategy 2: match by values that look like sizes
        if (!sizeOptionName) {
          for (const opt of firstOptions) {
            const allValues = variantNodes.map((v) =>
              v.selectedOptions?.find((o) => o.name === opt.name)?.value ?? ""
            );
            if (allValues.some((val) => SIZE_VALUE_RE.test(val))) {
              sizeOptionName = opt.name;
              break;
            }
          }
        }
        // view-image-orphan-fix: detect color axis INDEPENDENTLY of size axis.
        // view-image-orphan-fix: previously this was gated behind `!sizeOptionName`, which
        // view-image-orphan-fix: meant products with BOTH size and color (e.g. Stitchs's
        // view-image-orphan-fix: shirts) never got `colorOptionName` set — so the color-group
        // view-image-orphan-fix: image fallback would be a no-op for the merchants who
        // view-image-orphan-fix: actually need it. Both axes can coexist on the same product.
        colorOptionName = firstOptions.find((o) => COLOR_NAME_RE.test(o.name))?.name ?? null;
      }

      // Map all variants
      const allMappedVariants = variantNodes.map((v) => {
        const sizeOption = sizeOptionName
          ? v.selectedOptions?.find((o) => o.name === sizeOptionName)
          : null;
        return {
          id: v.id,
          title: v.title,
          sizeLabel: sizeOption?.value ?? v.title,
          priceCents: Math.round(parseFloat(v.price) * 100),
          available: v.availableForSale ?? true,
          selectedOptions: v.selectedOptions ?? [],
        };
      });

      // Compute variantAxis for this product
      variantAxis = sizeOptionName ? "size" : colorOptionName ? "color" : "option";

      // view-image-orphan-fix: identify all sibling variants in the same color group as the
      // view-image-orphan-fix: selected variant. Used to recover view images when this
      // view-image-orphan-fix: variant's per-view image was orphaned by Shopify variant churn
      // view-image-orphan-fix: (the source size variant of the upload was deleted but other
      // view-image-orphan-fix: same-color variants survive and have their own VVC rows).
      if (colorOptionName) {
        const selectedForColor = allMappedVariants.find((v) => v.id === variantId);
        const colorOpt = selectedForColor?.selectedOptions.find(
          (o) => o.name === colorOptionName
        );
        const selectedColorValue = colorOpt?.value ?? null;
        if (selectedColorValue) {
          siblingVariantIdsBySameColor = allMappedVariants
            .filter(
              (v) =>
                v.id !== variantId &&
                v.selectedOptions.some(
                  (o) => o.name === colorOptionName && o.value === selectedColorValue
                )
            )
            .map((v) => v.id);
        }
      }

      // Filter to only variants matching the selected variant's non-size options
      const selectedVariant = allMappedVariants.find((v) => v.id === variantId);
      if (selectedVariant && sizeOptionName) {
        const nonSizeOpts = selectedVariant.selectedOptions.filter(
          (o) => o.name !== sizeOptionName
        );
        variants = allMappedVariants.filter((v) =>
          nonSizeOpts.every((nso) =>
            v.selectedOptions.some((vo) => vo.name === nso.name && vo.value === nso.value)
          )
        );
      } else {
        // No size option detected or no selected variant — return all
        variants = allMappedVariants;
      }

      // Strip selectedOptions from client response — only needed for server-side filtering
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      variants = variants.map(({ selectedOptions, ...rest }) => ({ ...rest, selectedOptions: [] }));
    } catch {
      // Non-fatal: fall back to defaults
    }
  }

  const [settings, variantViewConfigs, colorGroupVVCs, shopRecord] = await Promise.all([
    getMerchantSettings(shopId),
    db.variantViewConfiguration.findMany({
      where: { productConfigId: config.id, variantId },
      include: { productView: true },
    }),
    // view-image-orphan-fix: query VVCs for sibling variants in the same color group
    // view-image-orphan-fix: that have a non-null imageUrl. This is the read-time fallback
    // view-image-orphan-fix: that recovers view images when the selected variant's own VVC
    // view-image-orphan-fix: row is missing or has imageUrl=null because the source upload
    // view-image-orphan-fix: lived on a now-deleted variant.
    // view-image-orphan-fix: Determinism caveat: if the chosen earliest sibling is later
    // view-image-orphan-fix: deleted, the displayed image flips to the next-earliest.
    // view-image-orphan-fix: Acceptable — better than showing a broken image — but worth
    // view-image-orphan-fix: knowing for support diagnostics.
    siblingVariantIdsBySameColor.length > 0
      ? db.variantViewConfiguration.findMany({
          where: {
            productConfigId: config.id,
            variantId: { in: siblingVariantIdsBySameColor },
            imageUrl: { not: null },
          },
          select: { viewId: true, imageUrl: true, createdAt: true, id: true },
          // view-image-orphan-fix: secondary sort on id breaks ties when
          // multiple siblings share createdAt to the millisecond (rare but
          // possible in batch inserts). Matches the SQL recovery script's
          // determinism (vvc."createdAt" ASC, vvc.id ASC).
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        })
      : Promise.resolve(
          [] as Array<{ viewId: string; imageUrl: string | null; createdAt: Date; id: string }>
        ),
    db.shop.findUnique({
      where: { id: shopId },
      select: { currencyCode: true },
    }),
  ]);

  // view-image-orphan-fix: build a viewId -> first-available-sibling-imageKey map.
  // view-image-orphan-fix: First-occurrence wins (orderBy createdAt asc above ensures the
  // view-image-orphan-fix: earliest-uploaded sibling is selected, giving a consistent image
  // view-image-orphan-fix: across page loads for the same color).
  const colorGroupImageByViewId = new Map<string, string>();
  for (const vvc of colorGroupVVCs) {
    if (vvc.imageUrl && !colorGroupImageByViewId.has(vvc.viewId)) {
      colorGroupImageByViewId.set(vvc.viewId, vvc.imageUrl);
    }
  }

  const currency = shopRecord?.currencyCode ?? "";

  const viewConfigByViewId = new Map(variantViewConfigs.map((vc) => [vc.viewId, vc]));

  const views: ConfiguredView[] = await Promise.all(
    config.views.map(async (view) => {
      const vc = viewConfigByViewId.get(view.id);
      // view-image-orphan-fix: resolution order is now:
      // view-image-orphan-fix:   1. this variant's own VVC imageUrl (existing)
      // view-image-orphan-fix:   2. NEW: any same-color sibling's VVC imageUrl
      // view-image-orphan-fix:   3. ProductView.defaultImageKey (existing)
      // view-image-orphan-fix:   4. null -> isMissingImage: true
      const rawImageKey =
        vc?.imageUrl
        ?? colorGroupImageByViewId.get(view.id)
        ?? view.defaultImageKey
        ?? null;
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
        name: view.name ?? null,
        perspective: view.perspective as ConfiguredView["perspective"],
        imageUrl,
        isMissingImage: imageUrl == null,
        calibrationPxPerCm: view.calibrationPxPerCm ?? null,
      };
    })
  );

  // Build a lookup: placementId → viewId (the view that owns this placement)
  const placementOwnerViewId = new Map<string, string>();
  for (const view of config.views) {
    for (const p of view.placements) {
      placementOwnerViewId.set(p.id, view.id);
    }
  }

  const geometryByViewIdForPlacement = (placementId: string): Record<string, PlacementGeometry | null> => {
    const out: Record<string, PlacementGeometry | null> = {};
    const ownerViewId = placementOwnerViewId.get(placementId);

    for (const view of config.views) {
      // Only look up geometry on the view that owns this placement.
      // Before per-view placements, geometry JSON on other views may
      // contain stale entries for placements that were migrated away.
      if (ownerViewId && view.id !== ownerViewId) {
        out[view.id] = null;
        continue;
      }

      type RawGeom = {
        centerXPercent: number;
        centerYPercent: number;
        maxWidthPercent: number;
        maxHeightPercent?: number | null;
      };
      const vc = viewConfigByViewId.get(view.id);
      const variantGeom = (vc?.placementGeometry as Record<string, RawGeom | null> | null) ?? {};
      const viewGeom = (view.placementGeometry as Record<string, RawGeom | null> | null) ?? {};

      const isShared = view.sharedZones ?? true;
      const effectiveGeom = isShared
        ? { ...variantGeom, ...viewGeom }
        : { ...viewGeom, ...variantGeom };

      const g = effectiveGeom[placementId];
      if (g && typeof g === "object" && "centerXPercent" in g) {
        out[view.id] = {
          centerXPercent: Number(g.centerXPercent),
          centerYPercent: Number(g.centerYPercent),
          maxWidthPercent: Number(g.maxWidthPercent),
          maxHeightPercent:
            g.maxHeightPercent != null ? Number(g.maxHeightPercent) : null,
        };
      } else {
        out[view.id] = null;
      }
    }
    return out;
  };

  // Include all placements from all views. Placements with 0 steps get a
  // synthetic default step so they behave as single-size in the storefront.
  const DEFAULT_STEP: PlacementStep = { label: "Standard", priceAdjustmentCents: 0, scaleFactor: 1.0 };
  const allPlacements = config.views.flatMap((v) => v.placements);
  const placements: Placement[] = allPlacements.map((p) => {
    const steps: PlacementStep[] = p.steps.length > 0
      ? p.steps.map((s) => ({
          label: s.label,
          priceAdjustmentCents: s.priceAdjustmentCents,
          scaleFactor: s.scaleFactor ?? 1.0,
        }))
      : [DEFAULT_STEP];
    const placement: Placement = {
      id: p.id,
      name: p.name,
      basePriceAdjustmentCents: p.basePriceAdjustmentCents,
      hidePriceWhenZero: p.hidePriceWhenZero,
      steps,
      defaultStepIndex: Math.min(p.defaultStepIndex, steps.length - 1),
      geometryByViewId: geometryByViewIdForPlacement(p.id),
    };
    if (p.methodPriceOverrides.length > 0) {
      placement.pricePerMethod = Object.fromEntries(
        p.methodPriceOverrides.map((o) => [
          o.decorationMethodId,
          effectivePlacementAdjustmentCents(
            p.basePriceAdjustmentCents,
            o.basePriceAdjustmentCents
          ),
        ])
      );
    }
    return placement;
  });

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
    // Resolve per-product-config override; falls back to method-level price when override is null
    basePriceCents: effectiveMethodPriceCents(
      m.decorationMethod.basePriceCents,
      m.basePriceCentsOverride
    ),
    hidePriceWhenZero: m.decorationMethod.hidePriceWhenZero,
    customerName: m.decorationMethod.customerName,
    customerDescription: m.decorationMethod.customerDescription ?? m.decorationMethod.description ?? null,
    artworkConstraints: m.decorationMethod.artworkConstraints as { fileTypes: string[]; maxColors: number | null; minDpi: number | null } | null,
  }));

  // design-fees: build the per-shop summary if feature is enabled and any
  // category exists. Returns null in all other cases (dead-quiet UX).
  let designFees: StorefrontDesignFees | null = null;
  if (designFeesEnabled()) {
    const allowedMethodIds = config.allowedMethods.map((m) => m.decorationMethod.id);
    if (allowedMethodIds.length > 0) {
      const dfCategories = await db.designFeeCategory.findMany({
        where: { shopId, methodId: { in: allowedMethodIds } },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          methodId: true,
          name: true,
          feeCents: true,
        },
      });
      if (dfCategories.length > 0) {
        const placementCategoryByPlacementId: Record<string, string> = {};
        for (const v of config.views) {
          for (const p of v.placements) {
            if (p.feeCategoryId) {
              placementCategoryByPlacementId[p.id] = p.feeCategoryId;
            }
          }
        }
        designFees = {
          categories: dfCategories,
          placementCategoryByPlacementId,
        };
      }
    }
  }

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
    variants,
    variantAxis,
    designFees,
  };
}
