/**
 * Image Manager Service
 *
 * Handles batch image operations for the Image Manager screen:
 * - Color group derivation from Shopify variant options
 * - Batch presigned URL generation
 * - Batch VariantViewConfiguration upsert
 * - Shopify variant image import
 * - View default image management
 */

import db from "../../db.server";
import { getPresignedPutUrl } from "../storage.server";

// ---------- Types ----------

export type ColorGroup = {
  colorValue: string;
  colorOptionName: string;
  sizeValues: string[];
  variantIds: string[];
  representativeVariantId: string;
};

export type ImageCell = {
  colorValue: string;
  viewId: string;
  variantIds: string[];
  imageUrl: string | null;
  isDefault: boolean; // true = inherited from ProductView.defaultImageKey
};

export type BatchUploadUrlItem = {
  viewId: string;
  variantId: string;
  contentType: string;
  fileName: string;
};

export type BatchUploadUrlResult = {
  viewId: string;
  variantId: string;
  uploadUrl: string;
  storageKey: string;
};

export type BatchSaveImageItem = {
  viewId: string;
  variantIds: string[];
  storageKey: string;
};

// ---------- Color Grouping ----------

const COLOR_KEYWORDS = ["color", "colour", "kleur", "farbe", "couleur"];
const SIZE_KEYWORDS = ["size", "taille", "größe", "maat", "talla", "größe"];

/**
 * Group Shopify variants by their color option value.
 * Detects the color option by name ("Color", "Colour", "Kleur") or falls back to
 * the option with the most unique values. Also captures size values per group.
 */
export function groupVariantsByColor(
  variants: Array<{
    id: string;
    selectedOptions: Array<{ name: string; value: string }>;
  }>
): ColorGroup[] {
  // Shopify "Default Title" — product with no real variant options
  if (
    variants.length === 1 &&
    variants[0].selectedOptions.length === 1 &&
    variants[0].selectedOptions[0].name === "Title" &&
    variants[0].selectedOptions[0].value === "Default Title"
  ) {
    return [
      {
        colorValue: "Default",
        colorOptionName: "",
        sizeValues: [],
        variantIds: [variants[0].id],
        representativeVariantId: variants[0].id,
      },
    ];
  }

  // Find the color-like option
  const optionNames = new Set<string>();
  const optionValueCounts: Record<string, Set<string>> = {};

  for (const v of variants) {
    for (const opt of v.selectedOptions) {
      optionNames.add(opt.name);
      if (!optionValueCounts[opt.name]) optionValueCounts[opt.name] = new Set();
      optionValueCounts[opt.name].add(opt.value);
    }
  }

  let colorOptionName = Array.from(optionNames).find((n) =>
    COLOR_KEYWORDS.some((k) => n.toLowerCase().includes(k))
  );

  // Fallback: option with most unique values (excluding "Title")
  if (!colorOptionName) {
    colorOptionName = Object.entries(optionValueCounts)
      .filter(([name]) => name !== "Title")
      .sort((a, b) => b[1].size - a[1].size)[0]?.[0];
  }

  if (!colorOptionName) {
    // No usable option — return one group
    return [
      {
        colorValue: "Default",
        colorOptionName: "",
        sizeValues: [],
        variantIds: variants.map((v) => v.id),
        representativeVariantId: variants[0]?.id ?? "",
      },
    ];
  }

  // Find the size option (if any) for displaying e.g. "S, M, L, XL"
  const sizeOptionName = Array.from(optionNames).find(
    (n) => n !== colorOptionName && SIZE_KEYWORDS.some((k) => n.toLowerCase().includes(k))
  );

  // Group variants by color value
  const groups: Record<string, string[]> = {};
  for (const v of variants) {
    const colorOpt = v.selectedOptions.find((o) => o.name === colorOptionName);
    const value = colorOpt?.value ?? "Default";
    if (!groups[value]) groups[value] = [];
    groups[value].push(v.id);
  }

  return Object.entries(groups).map(([colorValue, variantIds]) => {
    // Collect ordered unique size values for this color group
    const sizeValues: string[] = [];
    if (sizeOptionName) {
      const seen = new Set<string>();
      for (const v of variants) {
        if (variantIds.includes(v.id)) {
          const sizeOpt = v.selectedOptions.find((o) => o.name === sizeOptionName);
          if (sizeOpt && !seen.has(sizeOpt.value)) {
            seen.add(sizeOpt.value);
            sizeValues.push(sizeOpt.value);
          }
        }
      }
    }

    return {
      colorValue,
      colorOptionName: colorOptionName!,
      sizeValues,
      variantIds,
      representativeVariantId: variantIds[0],
    };
  });
}

// ---------- Batch Presigned URL Generation ----------

/**
 * Generate presigned PUT URLs for multiple image uploads in one call.
 */
export async function batchGetUploadUrls(
  shopId: string,
  items: BatchUploadUrlItem[]
): Promise<BatchUploadUrlResult[]> {
  return Promise.all(
    items.map(async (item) => {
      // Strip Shopify GID to numeric ID for safe path usage (avoids :// in R2 keys)
      const numericVariantId = item.variantId.split("/").pop() || item.variantId;
      const ext = item.fileName.split(".").pop()?.toLowerCase() || "jpg";
      const storageKey = `shops/${shopId}/views/${item.viewId}/variants/${numericVariantId}/view-image.${ext}`;
      const uploadUrl = await getPresignedPutUrl(storageKey, item.contentType, 300);
      return { viewId: item.viewId, variantId: item.variantId, uploadUrl, storageKey };
    })
  );
}

// ---------- Batch Save Images ----------

/**
 * Upsert multiple VariantViewConfigurations in a single transaction.
 * Each item can target multiple variantIds (color group → all size variants).
 *
 * Concurrent edits use last-write-wins. This is acceptable because:
 * - Typically one merchant edits at a time
 * - No data corruption risk (upsert serializes at DB level)
 * - Optimistic locking is deferred to V3 if multi-user editing becomes common
 */
export async function batchSaveImages(
  productConfigId: string,
  images: BatchSaveImageItem[]
): Promise<number> {
  if (images.length === 0) return 0;

  // Compute count before transaction — avoids mutating outer-scoped variable inside transaction
  const count = images.reduce((sum, img) => sum + img.variantIds.length, 0);

  await db.$transaction(async (tx) => {
    await Promise.all(
      images.flatMap((img) =>
        img.variantIds.map((variantId) =>
          tx.variantViewConfiguration.upsert({
            where: {
              productConfigId_variantId_viewId: {
                productConfigId,
                variantId,
                viewId: img.viewId,
              },
            },
            create: {
              productConfigId,
              variantId,
              viewId: img.viewId,
              imageUrl: img.storageKey,
            },
            update: {
              imageUrl: img.storageKey,
            },
          })
        )
      )
    );
  });

  return count;
}

// ---------- View Default & Image Matrix ----------

/**
 * Set the default image for a ProductView.
 * Variants without explicit images will fall back to this.
 */
export async function setViewDefault(
  viewId: string,
  storageKey: string
): Promise<void> {
  await db.productView.update({
    where: { id: viewId },
    data: { defaultImageKey: storageKey },
  });
}

/**
 * Get the complete image matrix for a product config.
 * Returns cells with resolved image URLs (explicit or default fallback).
 */
export async function getImageMatrix(
  productConfigId: string,
  views: Array<{ id: string; perspective: string; defaultImageKey: string | null }>,
  colorGroups: ColorGroup[]
): Promise<ImageCell[]> {
  const configs = await db.variantViewConfiguration.findMany({
    where: { productConfigId },
    select: { variantId: true, viewId: true, imageUrl: true },
  });

  const configMap = new Map<string, string | null>();
  for (const c of configs) {
    configMap.set(`${c.variantId}:${c.viewId}`, c.imageUrl);
  }

  const cells: ImageCell[] = [];

  for (const group of colorGroups) {
    for (const view of views) {
      const repVarId = group.representativeVariantId;
      const explicit = configMap.get(`${repVarId}:${view.id}`);
      const isDefault = !explicit && !!view.defaultImageKey;
      const imageUrl = explicit || view.defaultImageKey;

      cells.push({
        colorValue: group.colorValue,
        viewId: view.id,
        variantIds: group.variantIds,
        imageUrl: imageUrl ?? null,
        isDefault,
      });
    }
  }

  return cells;
}
