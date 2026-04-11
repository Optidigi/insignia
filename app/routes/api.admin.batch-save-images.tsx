/**
 * Admin API: Batch save image assignments to VariantViewConfiguration
 *
 * POST /api/admin/batch-save-images
 * Body: { productConfigId, images: [{ viewId, variantIds, storageKey }] }
 * Response: { saved: number }
 */

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import { z } from "zod";
import {
  batchSaveImages,
  type BatchSaveImageItem,
} from "../lib/services/image-manager.server";
import db from "../db.server";
import { handleError, Errors } from "../lib/errors.server";

const batchSaveImagesSchema = z.object({
  productConfigId: z.string().uuid(),
  images: z
    .array(
      z.object({
        viewId: z.string().uuid(),
        variantIds: z.array(z.string().min(1)).min(1),
        storageKey: z.string().min(1).max(500),
      })
    )
    .min(1)
    .max(100),
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
    const parsed = batchSaveImagesSchema.safeParse(body);
    if (!parsed.success) {
      return Errors.badRequest("Invalid input", {
        details: parsed.error.flatten(),
      });
    }

    const { productConfigId, images } = parsed.data;

    // Verify ownership: productConfig must belong to this shop
    const config = await db.productConfig.findFirst({
      where: { id: productConfigId, shopId: shop.id },
      select: { id: true },
    });
    if (!config) {
      return Errors.notFound("Product config");
    }

    const typedImages: BatchSaveImageItem[] = images;
    const count = await batchSaveImages(productConfigId, typedImages);
    return data({ saved: count });
  } catch (error) {
    return handleError(error);
  }
};
