import db from "../../db.server";

/**
 * Syncs insignia: order tags in Shopify based on current production status.
 * Preserves all non-insignia tags already on the order.
 * Call fire-and-forget (wrap in try/catch at call site).
 */
export async function syncOrderTags(
  shopifyOrderId: string,
  shopId: string,
  admin: { graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response> }
): Promise<void> {
  // Fetch current tags from Shopify so we don't clobber merchant tags
  const currentTagsResp = await admin.graphql(
    `#graphql
    query GetOrderTags($id: ID!) {
      order(id: $id) {
        tags
      }
    }`,
    { variables: { id: shopifyOrderId } }
  );
  const tagsData = await currentTagsResp.json() as { data?: { order?: { tags?: string[] } } };
  const currentTags: string[] = tagsData.data?.order?.tags ?? [];
  // Strip both colon-namespaced (current) and legacy flat-format tags
  const nonInsigniaTags = currentTags.filter(
    t => !t.startsWith("insignia:") && !t.startsWith("insignia-")
  );

  // Determine target insignia: tags from DB, scoped by shopId to prevent cross-tenant reads
  const lines = await db.orderLineCustomization.findMany({
    where: { shopifyOrderId, productConfig: { shopId } },
    select: { productionStatus: true, artworkStatus: true },
  });

  if (lines.length === 0) return;

  const insigniaTags: string[] = ["insignia:customized"];

  if (lines.some(l => l.artworkStatus === "PENDING_CUSTOMER")) {
    insigniaTags.push("insignia:artwork-pending");
  } else {
    insigniaTags.push("insignia:artwork-ready");
  }

  if (lines.every(l => l.productionStatus === "SHIPPED")) {
    insigniaTags.push("insignia:shipped");
  } else if (lines.some(l => l.productionStatus === "IN_PRODUCTION" || l.productionStatus === "QUALITY_CHECK")) {
    insigniaTags.push("insignia:in-production");
  }

  // Update tags on Shopify order
  const finalTags = [...nonInsigniaTags, ...insigniaTags];
  await admin.graphql(
    `#graphql
    mutation orderUpdate($input: OrderInput!) {
      orderUpdate(input: $input) {
        order { id }
        userErrors { field message }
      }
    }`,
    { variables: { input: { id: shopifyOrderId, tags: finalTags } } }
  );
}
