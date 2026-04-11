/**
 * GDPR Compliance Webhooks
 * 
 * MANDATORY for Shopify App Store approval.
 * Handles customer data requests, customer deletion, and shop deletion.
 * 
 * MVP implementation: Log and acknowledge.
 * Full compliance required before App Store submission.
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`[GDPR] Received ${topic} webhook for ${shop}`, {
    topic,
    shop,
    timestamp: new Date().toISOString(),
    // Log minimal payload info for debugging (don't log PII)
    payloadKeys: payload ? Object.keys(payload) : [],
  });

  switch (topic) {
    case "customers/data_request": {
      // Customer has requested their data
      const dataReqShop = await db.shop.findUnique({ where: { shopifyDomain: shop }, select: { id: true } });
      if (dataReqShop) {
        const draftCount = await db.customizationDraft.count({ where: { shopId: dataReqShop.id } });
        const orderCount = await db.orderLineCustomization.count({ where: { productConfig: { shopId: dataReqShop.id } } });
        console.log(`[GDPR] Customer data request for ${shop}: ${draftCount} drafts, ${orderCount} order lines`);
      }
      return new Response(null, { status: 200 });
    }

    case "customers/redact": {
      // Customer has requested deletion of their data
      const redactShop = await db.shop.findUnique({ where: { shopifyDomain: shop }, select: { id: true } });
      if (redactShop) {
        const deleted = await db.customizationDraft.deleteMany({ where: { shopId: redactShop.id } });
        console.log(`[GDPR] Customer data deleted for ${shop}: ${deleted.count} drafts removed`);
      }
      return new Response(null, { status: 200 });
    }

    case "shop/redact": {
      // Shop has been uninstalled and requests data deletion
      // Cascading delete removes all related data (configs, methods, views, placements, etc.)
      const shopRecord = await db.shop.findUnique({ where: { shopifyDomain: shop } });
      if (shopRecord) {
        await db.shop.delete({ where: { id: shopRecord.id } });
        console.log(`[GDPR] Shop data deleted for ${shop}`);
      } else {
        console.log(`[GDPR] Shop ${shop} not found (already deleted)`);
      }
      return new Response(null, { status: 200 });
    }

    default:
      console.warn(`[GDPR] Unknown GDPR topic: ${topic}`);
  }

  // Always return 200 to acknowledge receipt
  return new Response(null, { status: 200 });
};
