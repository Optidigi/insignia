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
import type { GdprPayload } from "../lib/services/gdpr.server";
import { handleCustomerRedact, handleCustomerDataRequest } from "../lib/services/gdpr.server";

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
      // Customer has requested their data — compile customer-specific records
      // TODO: Persist compiled data or send notification to merchant for GDPR fulfillment. Currently logged only.
      const dataSummary = await handleCustomerDataRequest(shop, payload as GdprPayload);
      console.log(`[GDPR] customers/data_request compiled for ${shop}:`, {
        draftsCount: dataSummary.drafts.length,
        orderLineCount: dataSummary.orderLineCount,
      });
      return new Response(null, { status: 200 });
    }

    case "customers/redact": {
      // Customer has requested deletion of their data — filter by customer email
      await handleCustomerRedact(shop, payload as GdprPayload);
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
