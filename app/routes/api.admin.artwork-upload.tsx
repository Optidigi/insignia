/**
 * Admin API: Upload artwork for an order line (Logo Later flow)
 *
 * POST /api/admin/artwork-upload
 * - Step 1 (intent=get-upload-url): lineId, contentType, fileName → { uploadUrl, logoAssetId }
 * - Step 2 (intent=complete-upload): lineId, logoAssetId → { success }
 *
 * Canonical: docs/admin/orders-workflow.md
 */

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getPresignedPutUrl, getPublicUrl, StorageKeys } from "../lib/storage.server";
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

    if (intent === "get-upload-url") {
      const lineId = formData.get("lineId") as string;
      const contentType = formData.get("contentType") as string;
      const fileName = formData.get("fileName") as string;

      if (!lineId || !contentType || !fileName) {
        return Errors.badRequest("Missing required fields");
      }

      const line = await db.orderLineCustomization.findFirst({
        where: { id: lineId, productConfig: { shopId: shop.id } },
      });
      if (!line) return Errors.notFound("Order line");

      const logoAsset = await db.logoAsset.create({
        data: {
          shopId: shop.id,
          kind: "buyer_upload",
          previewPngUrl: "",
          originalFileName: fileName,
        },
      });

      const ext = fileName.includes(".") ? fileName.split(".").pop()! : "bin";
      const key = StorageKeys.logo(shop.id, logoAsset.id, `artwork.${ext}`);
      const uploadUrl = await getPresignedPutUrl(key, contentType, 300);
      const publicUrl = getPublicUrl(key);

      await db.logoAsset.update({
        where: { id: logoAsset.id },
        data: { previewPngUrl: publicUrl || key },
      });

      return data({ uploadUrl, logoAssetId: logoAsset.id, success: true });
    }

    if (intent === "complete-upload") {
      const lineId = formData.get("lineId") as string;
      const logoAssetId = formData.get("logoAssetId") as string;
      const placementId = formData.get("placementId") as string | null;

      if (!lineId || !logoAssetId) {
        return Errors.badRequest("Missing required fields");
      }

      const line = await db.orderLineCustomization.findFirst({
        where: { id: lineId, productConfig: { shopId: shop.id } },
      });
      if (!line) return Errors.notFound("Order line");

      const existingMap = (line.logoAssetIdsByPlacementId as Record<string, string | null>) ?? {};
      const updatedMap = { ...existingMap };

      if (placementId) {
        // Per-placement: only update the specified placement slot
        if (placementId in updatedMap) {
          updatedMap[placementId] = logoAssetId;
        }
      } else {
        // Legacy: fill all null slots
        for (const key of Object.keys(updatedMap)) {
          if (!updatedMap[key]) updatedMap[key] = logoAssetId;
        }
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

      return data({ success: true });
    }

    return Errors.badRequest("Invalid intent");
  } catch (error) {
    return handleError(error);
  }
};
