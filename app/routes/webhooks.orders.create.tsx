/**
 * orders/create Webhook Handler
 * 
 * Binds Shopify line items to OrderLineCustomization records.
 * Captures immutable geometry snapshot for fulfillment accuracy.
 */

import type { ActionFunctionArgs } from "react-router";
import { Prisma, ProductionStatus } from "@prisma/client";
import { authenticate, unauthenticated } from "../shopify.server";
import db from "../db.server";
import {
  processWebhookIdempotently,
  getShopByDomain,
} from "../lib/services/webhook-idempotency.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const eventId = request.headers.get("X-Shopify-Event-Id");
  if (!eventId) {
    console.error("[orders/create] Missing X-Shopify-Event-Id header");
    return new Response(null, { status: 400 });
  }

  console.log(`[orders/create] Received webhook for ${shop}, event: ${eventId}`);

  // Get shop record — return 200 (discard) if shop is not installed
  let shopRecord: { id: string };
  try {
    shopRecord = await getShopByDomain(shop);
  } catch {
    console.log(`[orders/create] Shop not installed: ${shop} — discarding`);
    return new Response(null, { status: 200 });
  }

  let webhookError: unknown;
  try {
    await processWebhookIdempotently(shopRecord.id, eventId, topic, async () => {
      await handleOrdersCreate(shopRecord.id, payload, shop);
    });
  } catch (error) {
    console.error(`[orders/create] Error processing webhook:`, error);
    webhookError = error;
  }

  return new Response(null, { status: webhookError ? 500 : 200 });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleOrdersCreate(shopId: string, payload: any, shop: string) {
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

    console.log(`[orders/create] Found customized line item: ${lineItemId}`, { customizationId });

    // Fast-path: skip heavy work if this line item was already bound
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
    // The storefront stores the CustomizationDraft ID as _insignia_customization_id.
    // Try direct config ID first (legacy), then fall back to lookup by draft ID.
    let customizationConfig = await db.customizationConfig.findUnique({
      where: { id: customizationId },
    });
    if (!customizationConfig) {
      customizationConfig = await db.customizationConfig.findFirst({
        where: {
          customizationDraftId: customizationId,
          state: { in: ["RESERVED", "IN_CART", "ORDERED", "PURCHASED"] },
        },
        orderBy: { reservedAt: "desc" },
      });
    }

    if (!customizationConfig) {
      console.warn(`[orders/create] CustomizationConfig not found for id/draftId=${customizationId}`);
      continue;
    }

    // Snapshot to const so TypeScript narrowing holds inside async $transaction callback
    const config = customizationConfig;

    const claimedSlot = await db.variantSlot.findUnique({
      where: { currentConfigId: config.id },
      select: { shopifyVariantId: true, shopifyProductId: true },
    });

    // H2: no draftId means we cannot resolve a valid productConfigId — skip OLC creation
    // to avoid a broken FK. Still advance config to ORDERED so orders/paid can recycle
    // the slot via the live currentConfigId lookup instead of waiting on an OLC row.
    if (!config.customizationDraftId) {
      console.error(
        `[orders/create] CustomizationConfig ${config.id} has no customizationDraftId — skipping OLC for ${lineItemId}`
      );
      if (config.state !== "ORDERED" && config.state !== "PURCHASED") {
        await db.customizationConfig.update({
          where: { id: config.id },
          data: { state: "ORDERED", orderedAt: new Date() },
        });
      }
      continue;
    }

    const draft = await db.customizationDraft.findUnique({
      where: { id: config.customizationDraftId },
    });

    if (!draft) {
      console.error(
        `[orders/create] CustomizationDraft ${customizationConfig.customizationDraftId} not found — skipping ${lineItemId}`
      );
      continue;
    }

    const productConfigId = draft.productConfigId;
    const artworkStatus: "PROVIDED" | "PENDING_CUSTOMER" =
      draft.artworkStatus === "PENDING_CUSTOMER" ? "PENDING_CUSTOMER" : "PROVIDED";
    const logoAssetIdsByPlacementId = draft.logoAssetIdsByPlacementId as Record<string, string | null> | null;
    const garmentVariantId = draft.variantId;

    // Capture geometry snapshot using garment variant + productConfigId
    const geometrySnapshot = await captureGeometrySnapshot(productConfigId, garmentVariantId);

    // Derive initial production status from artwork status
    const productionStatus: ProductionStatus =
      artworkStatus === "PROVIDED"
        ? ProductionStatus.ARTWORK_PROVIDED
        : ProductionStatus.ARTWORK_PENDING;

    // Atomic: create OLC + transition config in a single transaction.
    // A crash between the two writes would otherwise leave the config stuck in RESERVED.
    // P2002 on OLC create means a concurrent worker bound this line item — skip gracefully.
    let bound = false;
    await db.$transaction(async (tx) => {
      try {
        await tx.orderLineCustomization.create({
          data: {
            shopifyOrderId: orderId,
            shopifyLineId: lineItemId,
            productConfigId,
            variantId,
            customizationConfigId: config.id,
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
      } catch (e) {
        if ((e as { code?: string }).code === "P2002") {
          console.log(`[orders/create] Line item ${lineItemId} bound by concurrent worker, skipping`);
          return;
        }
        throw e;
      }

      if (config.state !== "ORDERED" && config.state !== "PURCHASED") {
        await tx.customizationConfig.update({
          where: { id: config.id },
          data: {
            state: "ORDERED",
            orderedAt: new Date(),
          },
        });
      }
      bound = true;
    });

    if (bound) {
      console.log(`[orders/create] Bound line item ${lineItemId} to order ${orderId}`);
    }
  }

  // Tag the Shopify order after all lines are processed
  const boundLines = await db.orderLineCustomization.findMany({
    where: { shopifyOrderId: orderId, productConfig: { shopId: shopId } },
    select: { artworkStatus: true },
  });

  if (boundLines.length > 0) {
    const tags = ["insignia:customized"];
    if (boundLines.some((l) => l.artworkStatus === "PENDING_CUSTOMER")) {
      tags.push("insignia:artwork-pending");
    } else {
      tags.push("insignia:artwork-ready");
    }

    try {
      const { admin } = await unauthenticated.admin(shop);
      await admin.graphql(
        `#graphql
        mutation tagsAdd($id: ID!, $tags: [String!]!) {
          tagsAdd(id: $id, tags: $tags) {
            node { id }
            userErrors { field message }
          }
        }`,
        { variables: { id: orderId, tags } }
      );
      console.log(`[orders/create] Tagged order ${orderId} with: ${tags.join(", ")}`);
    } catch (e) {
      console.error(`[orders/create] Failed to tag order ${orderId}:`, e);
    }
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
