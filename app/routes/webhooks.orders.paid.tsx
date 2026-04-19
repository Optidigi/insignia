/**
 * orders/paid Webhook Handler
 * 
 * Finalizes customization configs and recycles variant slots.
 * Uses transactions and row locking to prevent race conditions.
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import db from "../db.server";
import {
  processWebhookIdempotently,
  getOrCreateShopByDomain,
} from "../lib/services/webhook-idempotency.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const eventId = request.headers.get("X-Shopify-Event-Id");
  if (!eventId) {
    console.error("[orders/paid] Missing X-Shopify-Event-Id header");
    return new Response(null, { status: 400 });
  }

  console.log(`[orders/paid] Received webhook for ${shop}, event: ${eventId}`);

  // Get or create shop record
  const shopRecord = await getOrCreateShopByDomain(shop);

  try {
    await processWebhookIdempotently(shopRecord.id, eventId, topic, async () => {
      await handleOrdersPaid(shopRecord.id, shop, payload);
    });
  } catch (error) {
    console.error(`[orders/paid] Error processing webhook:`, error);
    // Still return 200 to prevent infinite retries
  }

  return new Response(null, { status: 200 });
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleOrdersPaid(shopId: string, shopDomain: string, payload: any) {
  const orderId = payload.admin_graphql_api_id || `gid://shopify/Order/${payload.id}`;

  console.log(`[orders/paid] Processing payment for order ${orderId}`);

  // Find all order line customizations for this order. We DON'T traverse to
  // `customizationConfig.variantSlot` here — that link was being dropped from
  // the schema. Instead, the fee variant snapshot captured at orders/create
  // (feeShopifyVariantId / feeShopifyProductId) is the canonical reference.
  const orderLineCustomizations = await db.orderLineCustomization.findMany({
    where: { shopifyOrderId: orderId },
    include: {
      customizationConfig: { select: { id: true } },
    },
  });

  if (orderLineCustomizations.length === 0) {
    console.log(`[orders/paid] No customizations found for order ${orderId}`);
    return;
  }

  console.log(`[orders/paid] Found ${orderLineCustomizations.length} customizations to finalize`);

  // Get admin graphql client once for price resets
  const { admin } = await unauthenticated.admin(shopDomain);
  const adminGraphql = async (query: string, variables?: Record<string, unknown>) => {
    const response = await admin.graphql(query, { variables } as Record<string, unknown>);
    return response as Response;
  };

  // Process each customization
  for (const olc of orderLineCustomizations) {
    if (!olc.customizationConfig) {
      continue;
    }

    const result = await recycleSlotAfterPurchase(
      olc.customizationConfig.id,
      olc.feeShopifyVariantId,
      olc.feeShopifyProductId,
    );

    // Reset slot variant price to 0 outside the transaction to avoid holding locks during API calls
    if (!result.skipped && result.productId && result.variantId) {
      let lastError: unknown;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await resetSlotVariantPrice(adminGraphql, result.productId, result.variantId);
          lastError = null;
          break;
        } catch (e) {
          lastError = e;
          console.warn(`[orders/paid] Price reset attempt ${attempt}/3 failed for ${result.variantId}:`, e);
          if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
      if (lastError) {
        console.error(`[orders/paid] Price reset failed after 3 attempts for ${result.variantId} — slot needs manual cleanup`);
      }
    }
  }
}

async function resetSlotVariantPrice(
  adminGraphql: (query: string, variables?: Record<string, unknown>) => Promise<Response>,
  productId: string,
  variantId: string
) {
  const productGid = productId.startsWith("gid://") ? productId : `gid://shopify/Product/${productId}`;
  const variantGid = variantId.startsWith("gid://") ? variantId : `gid://shopify/ProductVariant/${variantId}`;

  try {
    const response = await adminGraphql(
      `#graphql
        mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants { id price }
            userErrors { field message }
          }
        }`,
      {
        productId: productGid,
        variants: [{ id: variantGid, price: "0.00" }],
      }
    );
    const json = await response.json();
    const errors = json?.data?.productVariantsBulkUpdate?.userErrors;
    if (errors?.length) {
      console.error(`[orders/paid] Failed to reset slot price for ${variantGid}:`, errors);
    } else {
      console.log(`[orders/paid] Reset slot variant price to 0 for ${variantGid}`);
    }
  } catch (error) {
    console.error(`[orders/paid] Error resetting slot price for ${variantGid}:`, error);
  }
}

type RecycleResult =
  | { skipped: true; reason: string }
  | { skipped: false; slotId: null; productId?: never; variantId?: never }
  | { skipped: false; slotId: string; productId: string; variantId: string };

/**
 * Recycle a variant slot after purchase.
 *
 * Slot identification priority:
 *   1. The shopifyVariantId snapshot captured by orders/create (feeShopifyVariantId).
 *      This is preferred because it can't be lost to a cron-cleanup race that
 *      nulled the slot's currentConfigId.
 *   2. Live lookup via VariantSlot.currentConfigId. Only used for legacy orders
 *      created before the snapshot column existed.
 *
 * Returns slot productId + variantId so the caller can reset the price outside
 * the transaction.
 */
async function recycleSlotAfterPurchase(
  customizationConfigId: string,
  feeShopifyVariantId: string | null,
  feeShopifyProductId: string | null,
): Promise<RecycleResult> {
  const result = await db.$transaction(
    async (tx) => {
      // 1. Fetch the customization config
      const config = await tx.customizationConfig.findUnique({
        where: { id: customizationConfigId },
        select: { id: true, state: true, shopId: true },
      });

      if (!config) {
        console.warn(`[orders/paid] CustomizationConfig ${customizationConfigId} not found`);
        return { skipped: true as const, reason: "not_found" };
      }

      // Order-independence: Check current state
      if (config.state === "PURCHASED") {
        console.log(`[orders/paid] Config ${customizationConfigId} already PURCHASED, skipping`);
        return { skipped: true as const, reason: "already_purchased" };
      }

      // 2. Transition config to PURCHASED
      await tx.customizationConfig.update({
        where: { id: customizationConfigId },
        data: {
          state: "PURCHASED",
          purchasedAt: new Date(),
        },
      });

      // 3. Resolve which slot to recycle. Prefer the snapshot; fall back to a
      //    live lookup for legacy orders that predate the snapshot column.
      let slot:
        | { id: string; shopifyVariantId: string; shopifyProductId: string }
        | null = null;

      if (feeShopifyVariantId) {
        slot = await tx.variantSlot.findFirst({
          where: { shopId: config.shopId, shopifyVariantId: feeShopifyVariantId },
          select: { id: true, shopifyVariantId: true, shopifyProductId: true },
        });
      }
      if (!slot) {
        slot = await tx.variantSlot.findUnique({
          where: { currentConfigId: config.id },
          select: { id: true, shopifyVariantId: true, shopifyProductId: true },
        });
      }

      if (!slot) {
        // Slot couldn't be located by either path — already recycled or never claimed.
        console.warn(
          `[orders/paid] No slot found to recycle for config ${customizationConfigId}` +
            (feeShopifyVariantId ? ` (snapshot=${feeShopifyVariantId})` : ""),
        );
        return { skipped: false as const, slotId: null as null };
      }

      // Use raw query for row-level locking
      await tx.$executeRaw`
        SELECT * FROM "VariantSlot"
        WHERE id = ${slot.id}
        FOR UPDATE
      `;

      await tx.variantSlot.update({
        where: { id: slot.id },
        data: {
          state: "FREE",
          currentConfigId: null,
          reservedAt: null,
          reservedUntil: null,
          inCartUntil: null,
        },
      });

      console.log(`[orders/paid] Recycled slot ${slot.id}`);

      return {
        skipped: false as const,
        slotId: slot.id,
        variantId: feeShopifyVariantId ?? slot.shopifyVariantId,
        productId: feeShopifyProductId ?? slot.shopifyProductId,
      };
    },
    {
      isolationLevel: "Serializable", // Strongest isolation for slot operations
      timeout: 10000, // 10 second timeout
    }
  );

  if (!result.skipped && result.slotId) {
    console.log(`[orders/paid] Config ${customizationConfigId} finalized, slot recycled`);
  }

  return result;
}
