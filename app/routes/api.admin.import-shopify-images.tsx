/**
 * Admin API: Import variant images from a Shopify product into R2
 *
 * POST /api/admin/import-shopify-images
 * Body: { productConfigId, shopifyProductId }
 * Response: { imported: [{ variantId, colorOption, originalUrl, storageKey }] }
 *
 * Downloads each unique variant media image from the Shopify CDN and stores it
 * in R2 under shops/{shopId}/imports/{productConfigId}/. Deduplicates by URL
 * so shared images are only downloaded once.
 *
 * Note: This endpoint is intentionally slow for one-time import use — it fetches
 * images from the Shopify CDN sequentially and uploads to R2.
 */

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import { z } from "zod";
import { putObject, getPresignedGetUrl } from "../lib/storage.server";
import db from "../db.server";
import { handleError, Errors } from "../lib/errors.server";

const importSchema = z.object({
  productConfigId: z.string().uuid(),
  shopifyProductId: z.string().min(1),
});

type ImportedImage = {
  variantId: string;
  colorOption: string;
  originalUrl: string;
  storageKey: string;
  previewUrl: string;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Errors.badRequest("Method not allowed");
  }

  try {
    const { session, admin } = await authenticate.admin(request);

    const shop = await db.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { id: true },
    });
    if (!shop) {
      return Errors.notFound("Shop");
    }

    const body = await request.json();
    const parsed = importSchema.safeParse(body);
    if (!parsed.success) {
      return Errors.badRequest("Invalid input", {
        details: parsed.error.flatten(),
      });
    }

    const { productConfigId, shopifyProductId } = parsed.data;

    // Verify ownership: productConfig must belong to this shop
    const config = await db.productConfig.findFirst({
      where: { id: productConfigId, shopId: shop.id },
      select: { id: true },
    });
    if (!config) {
      return Errors.notFound("Product config");
    }

    // Query Shopify for variant featuredImages and product-level media.
    // Most merchants assign images to color variants via the product admin, which
    // sets variant.featuredImage (NOT variant.media — that's the Media API and is
    // rarely populated). Product-level media serves as the fallback for products
    // where no variant images are assigned (single-variant or unassigned images).
    const response = await admin.graphql(
      `#graphql
      query GetProductImages($productId: ID!) {
        product(id: $productId) {
          media(first: 250, query: "media_type:IMAGE") {
            nodes {
              ... on MediaImage {
                id
                image { url }
              }
            }
          }
          variants(first: 100) {
            pageInfo { hasNextPage }
            nodes {
              id
              selectedOptions { name value }
              featuredImage { url }
            }
          }
        }
      }`,
      { variables: { productId: shopifyProductId } }
    );

    const responseData = await response.json();
    const productMedia: Array<{ id?: string; image?: { url: string } }> =
      responseData.data?.product?.media?.nodes ?? [];
    const variants: Array<{
      id: string;
      selectedOptions: Array<{ name: string; value: string }>;
      featuredImage: { url: string } | null;
    }> = responseData.data?.product?.variants?.nodes ?? [];
    const hasMore =
      responseData.data?.product?.variants?.pageInfo?.hasNextPage ?? false;

    // Detect the color option name using the same keywords and fallback as
    // groupVariantsByColor() so colorOption values align with colorGroups[].colorValue.
    const COLOR_KEYWORDS = ["color", "colour", "kleur", "farbe", "couleur"];
    const optionNames = new Set<string>();
    const optionValueCounts: Record<string, Set<string>> = {};
    for (const v of variants) {
      for (const opt of v.selectedOptions ?? []) {
        optionNames.add(opt.name);
        if (!optionValueCounts[opt.name]) optionValueCounts[opt.name] = new Set();
        optionValueCounts[opt.name].add(opt.value);
      }
    }
    let colorOptionName = Array.from(optionNames).find((n) =>
      COLOR_KEYWORDS.some((k) => n.toLowerCase().includes(k))
    );
    if (!colorOptionName) {
      // Same fallback as groupVariantsByColor: option with most unique values
      colorOptionName = Object.entries(optionValueCounts)
        .filter(([name]) => name !== "Title")
        .sort((a, b) => b[1].size - a[1].size)[0]?.[0];
    }

    // Build a map of colorValue → URL from variant.featuredImage.
    // Iterate all variants; first encountered featuredImage per color wins.
    // (Multiple size variants share the same color image — dedup handles the rest.)
    const colorImageMap: Record<string, { url: string; variantId: string }> = {};
    for (const variant of variants) {
      const colorOpt = colorOptionName
        ? variant.selectedOptions.find((o) => o.name === colorOptionName)
        : null;
      const colorValue = colorOpt?.value ?? "Default";
      if (!colorImageMap[colorValue] && variant.featuredImage?.url) {
        colorImageMap[colorValue] = { url: variant.featuredImage.url, variantId: variant.id };
      }
    }

    const seenUrls = new Set<string>();
    const importedImages: ImportedImage[] = [];

    const downloadAndStore = async (
      url: string,
      variantId: string,
      colorOption: string
    ) => {
      if (seenUrls.has(url)) return;
      seenUrls.add(url);

      const imageResponse = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!imageResponse.ok) return;

      const contentType =
        imageResponse.headers.get("content-type") || "image/jpeg";
      const mimeType = contentType.split(";")[0] || "image/jpeg";
      const ext = mimeType.includes("png")
        ? "png"
        : mimeType.includes("webp")
          ? "webp"
          : "jpg";

      const buffer = Buffer.from(await imageResponse.arrayBuffer());
      const key = `shops/${shop.id}/imports/${productConfigId}/${Date.now()}-${importedImages.length}.${ext}`;

      await putObject(key, buffer, mimeType);
      const previewUrl = await getPresignedGetUrl(key, 3600);

      importedImages.push({
        variantId,
        colorOption,
        originalUrl: url,
        storageKey: key,
        previewUrl,
      });
    };

    if (Object.keys(colorImageMap).length > 0) {
      // Use per-color variant featuredImages — one image per color group
      for (const [colorValue, { url, variantId }] of Object.entries(colorImageMap)) {
        await downloadAndStore(url, variantId, colorValue);
      }
    } else {
      // Fall back to product-level media — no variant images assigned
      // (single-variant product or images not yet assigned to variants)
      const firstVariantId = variants[0]?.id ?? "";
      for (const media of productMedia) {
        const url: string | undefined = media.image?.url;
        if (!url) continue;
        await downloadAndStore(url, firstVariantId, "Default");
      }
    }

    return data({ imported: importedImages, truncated: hasMore });
  } catch (error) {
    return handleError(error);
  }
};
