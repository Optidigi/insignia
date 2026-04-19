/**
 * orders/create Webhook Handler
 * 
 * Binds Shopify line items to OrderLineCustomization records.
 * Captures immutable geometry snapshot for fulfillment accuracy.
 */

import type { ActionFunctionArgs } from "react-router";
import { Prisma, ProductionStatus } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  processWebhookIdempotently,
  getOrCreateShopByDomain,
} from "../lib/services/webhook-idempotency.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const eventId = request.headers.get("X-Shopify-Event-Id");
  if (!eventId) {
    console.error("[orders/create] Missing X-Shopify-Event-Id header");
    return new Response(null, { status: 400 });
  }

  console.log(`[orders/create] Received webhook for ${shop}, event: ${eventId}`);

  // Get or create shop record
  const shopRecord = await getOrCreateShopByDomain(shop);

  try {
    await processWebhookIdempotently(shopRecord.id, eventId, topic, async () => {
      await handleOrdersCreate(shopRecord.id, payload);
    });
  } catch (error) {
    console.error(`[orders/create] Error processing webhook:`, error);
    // Still return 200 to prevent infinite retries
    // The error is logged and can be investigated
  }

  return new Response(null, { status: 200 });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleOrdersCreate(shopId: string, payload: any) {
  const orderId = payload.admin_graphql_api_id || `gid://shopify/Order/${payload.id}`;
  const orderStatusUrl = payload.order_status_url ?? null;
  const lineItems = payload.line_items || [];

  console.log(`[orders/create] Processing order ${orderId} with ${lineItems.length} line items`);

  // Find line items with Insignia customization properties
  for (const lineItem of lineItems) {
    const properties = lineItem.properties || [];
    const customizationId = getProperty(properties, "_insignia_customization_id");

    if (!customizationId) {
      // Not an Insignia-customized item
      continue;
    }

    const lineItemId = `gid://shopify/LineItem/${lineItem.id}`;
    const variantId = `gid://shopify/ProductVariant/${lineItem.variant_id}`;
    const configHash = getProperty(properties, "_insignia_config_hash");
    const methodId = getProperty(properties, "_insignia_method");

    console.log(`[orders/create] Found customized line item: ${lineItemId}`, {
      customizationId,
      configHash,
      methodId,
    });

    // Check if already processed (order-independence)
    const existing = await db.orderLineCustomization.findUnique({
      where: {
        shopifyOrderId_shopifyLineId: {
          shopifyOrderId: orderId,
          shopifyLineId: lineItemId,
        },
      },
    });

    if (existing) {
      console.log(`[orders/create] Line item ${lineItemId} already bound, skipping`);
      continue;
    }

    // Find the customization config and its currently-claimed slot.
    // Capture shopifyVariantId/ProductId now so orders/paid can recycle even
    // if the slot's currentConfigId is nulled later by a cron race.
    const customizationConfig = await db.customizationConfig.findUnique({
      where: { id: customizationId },
    });

    if (!customizationConfig) {
      console.warn(`[orders/create] CustomizationConfig ${customizationId} not found`);
      continue;
    }

    const claimedSlot = await db.variantSlot.findUnique({
      where: { currentConfigId: customizationConfig.id },
      select: { shopifyVariantId: true, shopifyProductId: true },
    });

    // Resolve draft to get productConfigId, artworkStatus, and logoAssetIdsByPlacementId
    let productConfigId = customizationConfig.id; // fallback (will likely fail FK)
    let artworkStatus: "PROVIDED" | "PENDING_CUSTOMER" = "PROVIDED";
    let logoAssetIdsByPlacementId: Record<string, string | null> | null = null;
    let garmentVariantId = variantId;

    if (customizationConfig.customizationDraftId) {
      const draft = await db.customizationDraft.findUnique({
        where: { id: customizationConfig.customizationDraftId },
      });
      if (draft) {
        productConfigId = draft.productConfigId;
        artworkStatus = draft.artworkStatus === "PENDING_CUSTOMER" ? "PENDING_CUSTOMER" : "PROVIDED";
        logoAssetIdsByPlacementId = draft.logoAssetIdsByPlacementId as Record<string, string | null> | null;
        garmentVariantId = draft.variantId;
      } else {
        console.warn(`[orders/create] CustomizationDraft ${customizationConfig.customizationDraftId} not found`);
      }
    }

    // Capture geometry snapshot using garment variant + productConfigId
    const geometrySnapshot = await captureGeometrySnapshot(productConfigId, garmentVariantId);

    // Derive initial production status from artwork status
    const productionStatus: ProductionStatus =
      artworkStatus === "PROVIDED"
        ? ProductionStatus.ARTWORK_PROVIDED
        : ProductionStatus.ARTWORK_PENDING;

    // Create the order line customization record
    await db.orderLineCustomization.create({
      data: {
        shopifyOrderId: orderId,
        shopifyLineId: lineItemId,
        productConfigId,
        variantId,
        customizationConfigId: customizationConfig.id,
        artworkStatus,
        productionStatus,
        logoAssetIdsByPlacementId: logoAssetIdsByPlacementId ?? Prisma.DbNull,
        placementGeometrySnapshotByViewId: geometrySnapshot
          ? (geometrySnapshot as Prisma.InputJsonValue)
          : Prisma.DbNull,
        useLiveConfigFallback: geometrySnapshot === null,
        orderStatusUrl,
        feeShopifyVariantId: claimedSlot?.shopifyVariantId ?? null,
        feeShopifyProductId: claimedSlot?.shopifyProductId ?? null,
      },
    });

    // Transition customization config to ORDERED
    if (customizationConfig.state !== "ORDERED" && customizationConfig.state !== "PURCHASED") {
      await db.customizationConfig.update({
        where: { id: customizationConfig.id },
        data: {
          state: "ORDERED",
          orderedAt: new Date(),
        },
      });
    }

    console.log(`[orders/create] Bound line item ${lineItemId} to order ${orderId}`);
  }
}

/**
 * Capture geometry snapshot applying the same precedence logic as storefront-config:
 * - When view.sharedZones=true: use ProductView.placementGeometry (authoritative)
 * - When view.sharedZones=false: use VariantViewConfiguration.placementGeometry
 *
 * Returns { [viewId]: placementGeometry } or null (triggers live-config fallback).
 */
async function captureGeometrySnapshot(
  productConfigId: string,
  garmentVariantId: string
): Promise<Prisma.InputJsonValue | null> {
  // Fetch all views for this config with their shared-zone settings and view-level geometry
  const views = await db.productView.findMany({
    where: { productConfigId },
    select: { id: true, sharedZones: true, placementGeometry: true },
  });

  if (views.length === 0) {
    console.warn(
      `[orders/create] No ProductViews found for productConfig=${productConfigId}`
    );
    return null;
  }

  // Fetch per-variant overrides for views that use per-variant geometry
  const perVariantConfigs = await db.variantViewConfiguration.findMany({
    where: { productConfigId, variantId: garmentVariantId },
    select: { viewId: true, placementGeometry: true },
  });
  const perVariantByViewId = new Map(
    perVariantConfigs.map((vc) => [vc.viewId, vc.placementGeometry])
  );

  const snapshot: Record<string, Prisma.InputJsonValue | null> = {};
  for (const view of views) {
    if (view.sharedZones) {
      // Shared zones: view-level geometry is authoritative
      snapshot[view.id] = (view.placementGeometry as Prisma.InputJsonValue | null) ?? null;
    } else {
      // Per-variant: use variant-specific geometry (may be null if not configured)
      const variantGeo = perVariantByViewId.get(view.id) ?? null;
      snapshot[view.id] = (variantGeo as Prisma.InputJsonValue | null) ?? null;
    }
  }

  console.log(
    `[orders/create] Captured geometry snapshot for variant=${garmentVariantId}: ${views.length} views`
  );
  return snapshot as Prisma.InputJsonValue;
}

/**
 * Get property value from line item properties array
 */
function getProperty(properties: Array<{ name: string; value: string }>, name: string): string | null {
  const prop = properties.find((p) => p.name === name);
  return prop?.value || null;
}
