// design-fees: independent slot pool for design-fee variants. Mirrors
// variant-pool.server.ts but operates on the DesignFeeSlot table. The two
// pools are fully separate (per §14.A) — no purpose discrimination is added
// to VariantSlot to keep the existing variant-pool code untouched.
//
// Slot lifecycle:
//   FREE → reserveDesignFeeSlot() → RESERVED (price set on Shopify variant)
//   RESERVED → confirmDesignFeeSlotInCart() → IN_CART (line key + charge id stamped)
//   RESERVED|IN_CART → freeDesignFeeSlot() / cleanupExpiredDesignFeeSlots() → FREE
//
// Shopify product attributes (§14.D):
//   requiresShipping: false (not a physical good)
//   taxable: true (charged at shop default rate; covers NL VAT 21% out of the box)
//   productType: "Service"
//   status: UNLISTED (hidden from collections/search/recs; still purchasable)

import { Prisma } from "@prisma/client";
import db from "../../../db.server";
import { AppError, ErrorCodes } from "../../errors.server";

const DEFAULT_SLOT_COUNT = 25;
// Reserved for future elastic growth. Unused at v1: the pool is provisioned at
// DEFAULT_SLOT_COUNT and not yet auto-grown, since design-fee slot churn is
// much lower than customization-slot churn (one row per fee tuple per cart, not
// per garment line). When grow is added, mirror variant-pool.server.ts.
// const MAX_SLOT_COUNT = 2000;
// const MAX_GROW_PER_CALL = 100;
// const MIN_GROW_BATCH = 10;
const RESERVED_TTL_MINUTES = 5;
const IN_CART_TTL_DAYS = 30;

type AdminGraphql = (
  query: string,
  variables?: Record<string, unknown>,
) => Promise<Response>;

/** Internal: publish a design-fee product to Online Store so /cart/add.js works. */
async function publishProductToOnlineStore(
  productId: string,
  adminGraphql: AdminGraphql,
) {
  const pubRes = await adminGraphql(
    `#graphql
      query publications {
        publications(first: 20) { edges { node { id name } } }
      }`,
  );
  const pubJson = await pubRes.json();
  const publications: Array<{ node: { id: string; name: string } }> =
    pubJson?.data?.publications?.edges ?? [];
  if (publications.length === 0) {
    console.warn("[design-fees/slot-pool] No publications found");
    return;
  }
  const onlineStore = publications.find((e) => e.node.name === "Online Store");
  const targetPubs = onlineStore ? [onlineStore] : publications;
  await adminGraphql(
    `#graphql
      mutation publishProduct($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          userErrors { field message }
        }
      }`,
    {
      id: productId,
      input: targetPubs.map((p) => ({ publicationId: p.node.id })),
    },
  );
}

/** Internal: ensure all variants of the design-fee product are purchasable. */
async function ensureVariantsAlwaysPurchasable(
  productId: string,
  adminGraphql: AdminGraphql,
) {
  const productGid = productId.startsWith("gid://")
    ? productId
    : `gid://shopify/Product/${productId}`;
  const variantsRes = await adminGraphql(
    `#graphql
      query productVariants($id: ID!) {
        location { id }
        product(id: $id) {
          variants(first: 250) {
            edges {
              node {
                id
                inventoryPolicy
                inventoryItem {
                  id
                  tracked
                  inventoryLevels(first: 1) { edges { node { id } } }
                }
              }
            }
          }
        }
      }`,
    { id: productGid },
  );
  const variantsJson = await variantsRes.json();
  type Edge = {
    node: {
      id: string;
      inventoryPolicy: string;
      inventoryItem: {
        id: string;
        tracked: boolean;
        inventoryLevels?: { edges?: Array<{ node: { id: string } }> };
      };
    };
  };
  const data = variantsJson as {
    data?: {
      location?: { id?: string };
      product?: { variants?: { edges?: Edge[] } };
    };
  };
  const variants: Edge[] = data?.data?.product?.variants?.edges ?? [];
  const primaryLocationId = data?.data?.location?.id;

  const variantsNeedingPolicyUpdate = variants.filter(
    (v) => v.node.inventoryPolicy !== "CONTINUE",
  );
  if (variantsNeedingPolicyUpdate.length > 0) {
    await adminGraphql(
      `#graphql
        mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants { id }
            userErrors { field message }
          }
        }`,
      {
        productId: productGid,
        variants: variantsNeedingPolicyUpdate.map((v) => ({
          id: v.node.id,
          inventoryPolicy: "CONTINUE",
        })),
      },
    );
  }

  for (const { node } of variants) {
    if (node.inventoryItem?.tracked) {
      await adminGraphql(
        `#graphql
          mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
            inventoryItemUpdate(id: $id, input: $input) {
              inventoryItem { tracked }
              userErrors { field message }
            }
          }`,
        { id: node.inventoryItem.id, input: { tracked: false } },
      );
    }
    const hasLevel = (node.inventoryItem?.inventoryLevels?.edges?.length ?? 0) > 0;
    if (!hasLevel && primaryLocationId && node.inventoryItem?.id) {
      await adminGraphql(
        `#graphql
          mutation inventoryActivate($inventoryItemId: ID!, $locationId: ID!) {
            inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId) {
              inventoryLevel { id }
              userErrors { field message }
            }
          }`,
        { inventoryItemId: node.inventoryItem.id, locationId: primaryLocationId },
      );
    }
  }
}

/**
 * Provision the design-fee variant pool for a shop. Idempotent — bails when slots already exist.
 */
async function provisionDesignFeePool(
  shopId: string,
  methodName: string,
  adminGraphql: AdminGraphql,
): Promise<{ productId: string; slotCount: number }> {
  const existing = await db.designFeeSlot.count({ where: { shopId } });
  if (existing > 0) {
    const slot = await db.designFeeSlot.findFirst({
      where: { shopId },
      select: { shopifyProductId: true },
    });
    return { productId: slot!.shopifyProductId, slotCount: existing };
  }

  const productTitle = `Insignia Design Fee – ${methodName}`;
  const createRes = await adminGraphql(
    `#graphql
      mutation productCreate($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product {
            id
            variants(first: 1) { edges { node { id } } }
          }
          userErrors { field message }
        }
      }`,
    {
      product: {
        title: productTitle,
        status: "UNLISTED",
        productType: "Service",
        tags: ["insignia-design-fee", "insignia-internal"],
        seo: { title: " ", description: " " },
      },
    },
  );
  const createJson = await createRes.json();
  const createErrors = createJson?.data?.productCreate?.userErrors;
  if (createErrors?.length) {
    console.error("[design-fees/slot-pool] productCreate errors:", createErrors);
    throw new AppError(
      ErrorCodes.INTERNAL_ERROR,
      `Failed to create design-fee product: ${createErrors[0].message}`,
      500,
    );
  }
  const product = createJson?.data?.productCreate?.product;
  if (!product?.id) {
    throw new AppError(
      ErrorCodes.INTERNAL_ERROR,
      "Failed to create design-fee product",
      500,
    );
  }
  const shopifyProductId = product.id as string;
  const firstVariantId = product.variants.edges[0]?.node?.id as string;

  await publishProductToOnlineStore(shopifyProductId, adminGraphql);

  // Set first variant: zero price, requiresShipping: false
  await adminGraphql(
    `#graphql
      mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id }
          userErrors { field message }
        }
      }`,
    {
      productId: shopifyProductId,
      variants: [
        {
          id: firstVariantId,
          price: "0.00",
          inventoryPolicy: "CONTINUE",
          inventoryItem: { tracked: false, requiresShipping: false },
          taxable: true,
        },
      ],
    },
  );

  // Bulk-create remaining slots
  const additionalCount = DEFAULT_SLOT_COUNT - 1;
  let createdVariantIds: string[] = [];
  if (additionalCount > 0) {
    const additionalVariants = Array.from({ length: additionalCount }, (_, i) => ({
      price: "0.00",
      inventoryPolicy: "CONTINUE",
      inventoryItem: { tracked: false, requiresShipping: false },
      taxable: true,
      optionValues: [{ optionName: "Title", name: `Design Fee ${i + 2}` }],
    }));
    const bulkRes = await adminGraphql(
      `#graphql
        mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkCreate(productId: $productId, variants: $variants) {
            productVariants { id }
            userErrors { field message }
          }
        }`,
      { productId: shopifyProductId, variants: additionalVariants },
    );
    const bulkJson = await bulkRes.json();
    const bulkErrors = bulkJson?.data?.productVariantsBulkCreate?.userErrors;
    if (bulkErrors?.length) {
      console.error(
        "[design-fees/slot-pool] productVariantsBulkCreate errors:",
        bulkErrors,
      );
      throw new AppError(
        ErrorCodes.INTERNAL_ERROR,
        `Failed to create design-fee slot variants: ${bulkErrors[0].message}`,
        500,
      );
    }
    createdVariantIds = (
      bulkJson?.data?.productVariantsBulkCreate?.productVariants ?? []
    ).map((v: { id: string }) => v.id);
  }

  await ensureVariantsAlwaysPurchasable(shopifyProductId, adminGraphql);

  const allVariantIds = [firstVariantId, ...createdVariantIds];
  await db.$transaction(
    allVariantIds.map((variantId) =>
      db.designFeeSlot.create({
        data: {
          shopId,
          shopifyProductId,
          shopifyVariantId: variantId,
          state: "FREE",
        },
      }),
    ),
  );

  console.log(
    `[design-fees/slot-pool] Provisioned ${allVariantIds.length} design-fee slots (product ${shopifyProductId})`,
  );

  return { productId: shopifyProductId, slotCount: allVariantIds.length };
}

/**
 * Ensure the design-fee variant pool exists for a shop. Lazy-creates on first call.
 * `methodName` is used only to title the Shopify product on first provision.
 */
export async function ensureDesignFeePool(
  shopId: string,
  methodName: string,
  adminGraphql: AdminGraphql,
): Promise<void> {
  const slot = await db.designFeeSlot.findFirst({
    where: { shopId },
    select: { id: true },
  });
  if (slot) return;
  await provisionDesignFeePool(shopId, methodName, adminGraphql);
}

/**
 * Reserve a FREE slot, set its variant price to feeCents, mark RESERVED with TTL.
 * Returns slot id + Shopify variant id (caller passes the variant id to /cart/add.js).
 */
export async function reserveDesignFeeSlot(args: {
  shopId: string;
  feeCents: number;
  adminGraphql: AdminGraphql;
}): Promise<{ slotId: string; shopifyVariantId: string }> {
  const { shopId, feeCents, adminGraphql } = args;
  const now = new Date();
  const reservedUntil = new Date(now.getTime() + RESERVED_TTL_MINUTES * 60 * 1000);

  // Free expired RESERVED slots first (cheap maintenance)
  await db.designFeeSlot.updateMany({
    where: { shopId, state: "RESERVED", reservedUntil: { lt: now } },
    data: {
      state: "FREE",
      reservedAt: null,
      reservedUntil: null,
      currentChargeId: null,
    },
  });

  // Acquire a FREE slot via SELECT FOR UPDATE SKIP LOCKED (race-safe)
  const acquired = await db.$transaction(async (tx) => {
    const rows: Array<{ id: string; shopifyProductId: string; shopifyVariantId: string }> =
      await tx.$queryRaw`
        SELECT id, "shopifyProductId", "shopifyVariantId"
        FROM "DesignFeeSlot"
        WHERE "shopId" = ${shopId}
          AND state = 'FREE'
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
    const row = rows[0];
    if (!row) return null;
    await tx.designFeeSlot.update({
      where: { id: row.id },
      data: {
        state: "RESERVED",
        reservedAt: now,
        reservedUntil,
      },
    });
    return row;
  });

  if (!acquired) {
    throw new AppError(
      ErrorCodes.SERVICE_UNAVAILABLE,
      "All design-fee slots are in use. Please try again shortly.",
      503,
    );
  }

  // Set the variant price on Shopify
  const variantGid = acquired.shopifyVariantId.startsWith("gid://")
    ? acquired.shopifyVariantId
    : `gid://shopify/ProductVariant/${acquired.shopifyVariantId}`;
  const productGid = acquired.shopifyProductId.startsWith("gid://")
    ? acquired.shopifyProductId
    : `gid://shopify/Product/${acquired.shopifyProductId}`;
  const priceStr = (feeCents / 100).toFixed(2);

  try {
    const updRes = await adminGraphql(
      `#graphql
        mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants { id price }
            userErrors { field message }
          }
        }`,
      { productId: productGid, variants: [{ id: variantGid, price: priceStr }] },
    );
    const updJson = await updRes.json();
    const errs = (updJson as {
      data?: { productVariantsBulkUpdate?: { userErrors?: Array<{ message?: string }> } };
    })?.data?.productVariantsBulkUpdate?.userErrors;
    if (errs?.length) {
      throw new Error(errs[0]?.message ?? "Variant price update failed");
    }
  } catch (e) {
    // Roll back to FREE so the slot can be retried
    await db.designFeeSlot.update({
      where: { id: acquired.id },
      data: {
        state: "FREE",
        reservedAt: null,
        reservedUntil: null,
        currentChargeId: null,
      },
    });
    console.error("[design-fees/slot-pool] Failed to set fee price:", e);
    throw new AppError(
      ErrorCodes.SERVICE_UNAVAILABLE,
      "Failed to set design-fee variant price",
      503,
    );
  }

  return { slotId: acquired.id, shopifyVariantId: acquired.shopifyVariantId };
}

/**
 * Promote a RESERVED slot to IN_CART, stamping line key + charge id.
 * Idempotent — safe to call repeatedly.
 */
export async function confirmDesignFeeSlotInCart(
  slotId: string,
  chargeId: string,
): Promise<void> {
  const inCartUntil = new Date(Date.now() + IN_CART_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.designFeeSlot.updateMany({
    where: { id: slotId, state: { in: ["RESERVED", "IN_CART"] } },
    data: {
      state: "IN_CART",
      reservedAt: null,
      reservedUntil: null,
      inCartUntil,
      currentChargeId: chargeId,
    },
  });
}

/**
 * Free a slot (back to FREE). Used by abort-charges and sync orphan removal.
 */
export async function freeDesignFeeSlot(slotId: string): Promise<void> {
  await db.designFeeSlot.update({
    where: { id: slotId },
    data: {
      state: "FREE",
      reservedAt: null,
      reservedUntil: null,
      inCartUntil: null,
      currentChargeId: null,
    },
  }).catch(() => {
    // Slot may already be deleted; non-fatal.
  });
}

/**
 * Free expired RESERVED + IN_CART slots. Used by GC cron.
 */
export async function cleanupExpiredDesignFeeSlots(
  prisma: typeof db = db,
): Promise<{ freed: number }> {
  const now = new Date();
  const r = await prisma.designFeeSlot.updateMany({
    where: {
      OR: [
        { state: "RESERVED", reservedUntil: { lt: now } },
        { state: "IN_CART", inCartUntil: { lt: now } },
      ],
    },
    data: {
      state: "FREE",
      reservedAt: null,
      reservedUntil: null,
      inCartUntil: null,
      currentChargeId: null,
    },
  });
  return { freed: r.count };
}

// Suppress unused-import lint for Prisma type; kept available for future use.
export type _PrismaTypeMarker = Prisma.DesignFeeSlotWhereInput;
