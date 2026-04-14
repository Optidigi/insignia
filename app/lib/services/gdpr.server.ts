/**
 * GDPR compliance handlers.
 *
 * Extracted from webhooks.gdpr.tsx for testability.
 * Canonical: Shopify GDPR requirements for app certification.
 */

import db from "../../db.server";

export type GdprPayload = {
  customer?: { email?: string };
  [key: string]: unknown;
};

/**
 * Extract and validate customer email from GDPR payload.
 * Returns null if missing or empty (safe default — do nothing).
 */
function extractCustomerEmail(payload: GdprPayload): string | null {
  const email = payload?.customer?.email;
  const trimmed = typeof email === "string" ? email.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Handle customers/redact: delete only drafts belonging to the requesting customer.
 */
export async function handleCustomerRedact(
  shopDomain: string,
  payload: GdprPayload,
): Promise<{ deletedCount: number }> {
  const customerEmail = extractCustomerEmail(payload);
  if (!customerEmail) {
    console.log(`[GDPR] customers/redact: no customer email in payload for ${shopDomain}, skipping`);
    return { deletedCount: 0 };
  }

  const shop = await db.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { id: true },
  });
  if (!shop) {
    console.log(`[GDPR] customers/redact: shop ${shopDomain} not found, skipping`);
    return { deletedCount: 0 };
  }

  const deleted = await db.customizationDraft.deleteMany({
    where: { shopId: shop.id, customerEmail },
  });

  console.log(
    `[GDPR] customers/redact: deleted ${deleted.count} drafts for ${shopDomain} (customer filtered)`,
  );
  return { deletedCount: deleted.count };
}

/**
 * Handle customers/data_request: compile customer-specific data.
 */
export async function handleCustomerDataRequest(
  shopDomain: string,
  payload: GdprPayload,
): Promise<{
  drafts: Array<{ id: string; productId: string; variantId: string; createdAt: Date }>;
  orderLineCount: number;
}> {
  const customerEmail = extractCustomerEmail(payload);
  if (!customerEmail) {
    console.log(
      `[GDPR] customers/data_request: no customer email in payload for ${shopDomain}, returning empty`,
    );
    return { drafts: [], orderLineCount: 0 };
  }

  const shop = await db.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { id: true },
  });
  if (!shop) {
    console.log(`[GDPR] customers/data_request: shop ${shopDomain} not found, returning empty`);
    return { drafts: [], orderLineCount: 0 };
  }

  const drafts = await db.customizationDraft.findMany({
    where: { shopId: shop.id, customerEmail },
    select: {
      id: true,
      productId: true,
      variantId: true,
      createdAt: true,
    },
  });

  // OrderLineCustomization has no customerEmail field so we cannot filter by
  // individual customer. Returning 0 until that association is added to the
  // schema. This is a known compliance gap — order-level customization data
  // cannot currently be scoped per customer.
  // TODO: Add customerEmail to OrderLineCustomization and query it here.
  const orderLineCount = 0;
  console.warn(
    `[GDPR] customers/data_request for ${shopDomain}: orderLineCustomization cannot be filtered by customer (gap — no customerEmail field). Returning 0.`,
  );

  console.log(
    `[GDPR] customers/data_request for ${shopDomain}: ${drafts.length} drafts, ${orderLineCount} order lines`,
  );

  return { drafts, orderLineCount };
}
