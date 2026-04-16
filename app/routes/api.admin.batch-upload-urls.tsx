/**
 * Admin API: Batch generate presigned upload URLs for view images
 *
 * POST /api/admin/batch-upload-urls
 * Body: { productConfigId, items: [{ viewId, variantId, contentType, fileName }] }
 * Response: { items: [{ viewId, variantId, uploadUrl, storageKey }] }
 */

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import { z } from "zod";
import { batchGetUploadUrls } from "../lib/services/image-manager.server";
import db from "../db.server";
import { handleError, Errors } from "../lib/errors.server";

const batchUploadUrlsSchema = z.object({
  productConfigId: z.string().uuid(),
  items: z
    .array(
      z.object({
        viewId: z.string().uuid(),
        variantId: z.string().min(1),
        contentType: z
          .string()
          .regex(/^image\/(jpeg|png|webp|gif|tiff|svg\+xml|heic)$/),
        fileName: z.string().min(1).max(255),
      })
    )
    .min(1)
    .max(50),
});

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Errors.badRequest("Method not allowed");
  }

  try {
    const { session } = await authenticate.admin(request);

    const shop = await db.shop.findUnique({
      where: { shopifyDomain: session.shop },
      select: { id: true },
    });
    if (!shop) {
      return Errors.notFound("Shop");
    }

    const body = await request.json();
    const parsed = batchUploadUrlsSchema.safeParse(body);
    if (!parsed.success) {
      return Errors.badRequest("Invalid input", {
        details: parsed.error.flatten(),
      });
    }

    const { productConfigId, items } = parsed.data;

    // Verify ownership: productConfig must belong to this shop
    const config = await db.productConfig.findFirst({
      where: { id: productConfigId, shopId: shop.id },
      select: { id: true },
    });
    if (!config) {
      return Errors.notFound("Product config");
    }

    // Verify all viewIds belong to this productConfig to prevent cross-tenant
    // viewId references when generating presigned upload URLs.
    const uniqueViewIds = [...new Set(items.map((item) => item.viewId))];
    const validViews = await db.productView.findMany({
      where: { id: { in: uniqueViewIds }, productConfigId },
      select: { id: true },
    });
    if (validViews.length !== uniqueViewIds.length) {
      return Errors.notFound("View");
    }

    const results = await batchGetUploadUrls(shop.id, items);
    return data({ items: results });
  } catch (error) {
    return handleError(error);
  }
};
