/**
 * Admin API: Get presigned upload URL for view images or placeholder logo
 *
 * POST /api/admin/upload-url
 * - intent=get-upload-url: productConfigId, viewId, variantId, contentType, fileName → { uploadUrl, key }
 * - intent=placeholder-logo: contentType, fileName → { uploadUrl, key, publicUrl }
 */

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getPresignedPutUrl, getPublicUrl, StorageKeys } from "../lib/storage.server";
import { getProductConfig } from "../lib/services/product-configs.server";
import { handleError, Errors } from "../lib/errors.server";

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

    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "placeholder-logo") {
      const contentType = formData.get("contentType") as string;
      const fileName = formData.get("fileName") as string;
      if (!contentType || !fileName) {
        return Errors.badRequest("Missing required fields: contentType, fileName");
      }
      const key = StorageKeys.placeholder(shop.id, fileName);
      const uploadUrl = await getPresignedPutUrl(key, contentType, 300);
      const publicUrl = getPublicUrl(key);
      return data({ uploadUrl, key, publicUrl, success: true });
    }

    if (intent !== "get-upload-url") {
      return Errors.badRequest("Invalid intent");
    }

    const productConfigId = formData.get("productConfigId") as string;
    const viewId = formData.get("viewId") as string;
    const variantId = formData.get("variantId") as string;
    const contentType = formData.get("contentType") as string;
    const fileName = formData.get("fileName") as string;

    if (!productConfigId || !viewId || !variantId || !contentType || !fileName) {
      return Errors.badRequest("Missing required fields: productConfigId, viewId, variantId, contentType, fileName");
    }

    await getProductConfig(shop.id, productConfigId);

    const key = StorageKeys.viewImage(shop.id, viewId, variantId, fileName);
    const uploadUrl = await getPresignedPutUrl(key, contentType, 300);

    return data({ uploadUrl, key, success: true });
  } catch (error) {
    return handleError(error);
  }
};
