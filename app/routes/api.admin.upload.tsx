/**
 * Admin API: Server-side file upload to R2
 *
 * POST /api/admin/upload
 * Accepts the file directly via FormData, uploads server-side to R2,
 * avoiding browser CORS issues with R2.
 */

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { putObject, StorageKeys, getPublicUrl } from "../lib/storage.server";
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
    if (!shop) return Errors.notFound("Shop");

    const formData = await request.formData();
    const intent = formData.get("intent") as string;
    const file = formData.get("file") as File | null;

    if (!file || !(file instanceof File)) {
      return Errors.badRequest("No file provided");
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    if (intent === "view-image") {
      const productConfigId = formData.get("productConfigId") as string;
      const viewId = formData.get("viewId") as string;
      const variantId = formData.get("variantId") as string;

      if (!productConfigId || !viewId || !variantId) {
        return Errors.badRequest("Missing required fields");
      }

      await getProductConfig(shop.id, productConfigId);

      const ext = file.type.split("/")[1] || "bin";
      const key = StorageKeys.viewImage(shop.id, viewId, variantId, `view-image.${ext}`);

      await putObject(key, buffer, file.type);

      const publicUrl = getPublicUrl(key);

      return data({ key, publicUrl, success: true });
    }

    if (intent === "placeholder-logo") {
      const ext = file.type === "image/svg+xml" ? "svg" : file.type.split("/")[1] || "bin";
      const key = StorageKeys.placeholder(shop.id, `placeholder.${ext}`);

      await putObject(key, buffer, file.type);

      const publicUrl = getPublicUrl(key);

      return data({ key, publicUrl, success: true });
    }

    if (intent === "artwork") {
      const lineId = formData.get("lineId") as string;
      if (!lineId) return Errors.badRequest("Missing lineId");

      const line = await db.orderLineCustomization.findFirst({
        where: { id: lineId, productConfig: { shopId: shop.id } },
      });
      if (!line) return Errors.notFound("Order line");

      const logoAsset = await db.logoAsset.create({
        data: {
          shopId: shop.id,
          kind: "buyer_upload",
          previewPngUrl: "",
          originalFileName: file.name,
        },
      });

      const ext = file.name.includes(".") ? file.name.split(".").pop()! : "bin";
      const key = StorageKeys.logo(shop.id, logoAsset.id, `artwork.${ext}`);

      await putObject(key, buffer, file.type);

      const publicUrl = getPublicUrl(key);
      await db.logoAsset.update({
        where: { id: logoAsset.id },
        data: { previewPngUrl: publicUrl || key },
      });

      const existingMap = (line.logoAssetIdsByPlacementId as Record<string, string | null>) ?? {};
      const updatedMap = { ...existingMap };
      for (const k of Object.keys(updatedMap)) {
        if (!updatedMap[k]) updatedMap[k] = logoAsset.id;
      }
      const allFilled = Object.values(updatedMap).every((v) => v != null);

      await db.orderLineCustomization.update({
        where: { id: lineId },
        data: {
          artworkStatus: allFilled ? "PROVIDED" : "PENDING_CUSTOMER",
          ...(allFilled ? { productionStatus: "ARTWORK_PROVIDED" } : {}),
          logoAssetIdsByPlacementId: updatedMap,
        },
      });

      return data({ logoAssetId: logoAsset.id, success: true });
    }

    return Errors.badRequest("Invalid intent");
  } catch (error) {
    return handleError(error);
  }
};
