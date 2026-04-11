/**
 * One-time fix: update existing fee products to UNLISTED status.
 * UNLISTED products are purchasable via /cart/add.js but hidden from
 * collections, search, and recommendations on all themes automatically.
 */

import db from "../../db.server";

type AdminGraphql = (query: string, variables?: Record<string, unknown>) => Promise<Response>;

export async function fixExistingFeeProducts(shopId: string, adminGraphql: AdminGraphql) {
  // Find all unique fee product IDs from variant slots
  const slots = await db.variantSlot.findMany({
    where: { shopId },
    select: { shopifyProductId: true },
    distinct: ["shopifyProductId"],
  });

  if (slots.length === 0) {
    console.log("[fix-fee-products] No variant slots found, nothing to fix");
    return { fixed: 0 };
  }

  let fixed = 0;
  for (const slot of slots) {
    const productGid = slot.shopifyProductId.startsWith("gid://")
      ? slot.shopifyProductId
      : `gid://shopify/Product/${slot.shopifyProductId}`;

    try {
      const res = await adminGraphql(
        `#graphql
          mutation productUpdate($product: ProductUpdateInput!) {
            productUpdate(product: $product) {
              product { id status }
              userErrors { field message }
            }
          }`,
        {
          product: {
            id: productGid,
            status: "UNLISTED",
            productType: "Customization Fee",
            tags: ["insignia-fee", "insignia-internal"],
            seo: { title: " ", description: " " },
          },
        }
      );
      const json = await res.json();
      const errors = json?.data?.productUpdate?.userErrors;
      if (errors?.length) {
        console.warn(`[fix-fee-products] Errors updating ${productGid}:`, errors);
      } else {
        console.log(`[fix-fee-products] Fixed ${productGid} -> UNLISTED`);
        fixed++;
      }
    } catch (e) {
      console.error(`[fix-fee-products] Failed to update ${productGid}:`, e);
    }
  }

  return { fixed, total: slots.length };
}
