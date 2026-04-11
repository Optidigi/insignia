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

    // Query Shopify for both product-level media and variant-level media.
    // Many products (especially single-variant) have images at the product level
    // only — variant.media is empty in those cases.
    const response = await admin.graphql(
      `#graphql
      query GetProductImages($productId: ID!) {
        product(id: $productId) {
          media(first: 250, query: "media_type:IMAGE") {
            nodes {
              ... on MediaImage {
                id
                image {
                  url
                }
              }
            }
          }
          variants(first: 100) {
            pageInfo {
              hasNextPage
            }
            nodes {
              id
              selectedOptions { name value }
              media(first: 10) {
                nodes {
                  ... on MediaImage {
                    id
                    image {
                      url
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { variables: { productId: shopifyProductId } }
    );

    const responseData = await response.json();
    const productMedia: Array<{ id?: string; image?: { url: string } }> =
      responseData.data?.product?.media?.nodes ?? [];
    const variants = responseData.data?.product?.variants?.nodes ?? [];
    const hasMore =
      responseData.data?.product?.variants?.pageInfo?.hasNextPage ?? false;

    // Check whether any variant has variant-specific media assigned.
    // If yes → prefer variant media (each color has its own image).
    // If no  → fall back to product-level media (images live on the product,
    //           not on individual variants — common for single-variant products).
    const anyVariantHasMedia = variants.some(
      (v: { media: { nodes: unknown[] } }) => v.media?.nodes?.length > 0
    );

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

    if (anyVariantHasMedia) {
      // Use variant-specific media — each variant has its own image(s)
      for (const variant of variants) {
        const colorOpt = variant.selectedOptions?.find(
          (o: { name: string; value: string }) =>
            o.name.toLowerCase().includes("color") ||
            o.name.toLowerCase().includes("colour")
        );
        const colorOption = colorOpt?.value ?? "Default";

        for (const media of variant.media?.nodes ?? []) {
          const url: string | undefined = media.image?.url;
          if (!url) continue;
          await downloadAndStore(url, variant.id, colorOption);
        }
      }
    } else {
      // Fall back to product-level media — images are not variant-specific
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
