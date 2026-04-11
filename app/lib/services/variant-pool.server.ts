/**
 * Variant Pool auto-provisioning.
 *
 * When a DecorationMethod is created, this service automatically:
 * 1. Creates an unlisted "fee" product in Shopify
 * 2. Creates N slot variants at $0.00
 * 3. Inserts corresponding VariantSlot rows
 *
 * Canonical: docs/core/variant-pool/overview.md, implementation.md
 */

import db from "../../db.server";
import { AppError, ErrorCodes } from "../errors.server";

const DEFAULT_SLOT_COUNT = 10;

type AdminGraphql = (query: string, variables?: Record<string, unknown>) => Promise<Response>;

/**
 * Publish a product to ALL available publications so that /cart/add.js can find its variants.
 * Without this, ACTIVE products are not purchasable via the storefront AJAX Cart API.
 *
 * Uses Publication.name (deprecated but still functional) to find "Online Store".
 * Falls back to publishing to every publication if name matching fails.
 */
async function publishProductToOnlineStore(productId: string, adminGraphql: AdminGraphql) {
  const pubRes = await adminGraphql(
    `#graphql
      query publications {
        publications(first: 20) {
          edges { node { id name } }
        }
      }`
  );
  const pubJson = await pubRes.json();
  const publications: Array<{ node: { id: string; name: string } }> =
    pubJson?.data?.publications?.edges ?? [];

  if (publications.length === 0) {
    console.warn("[variant-pool] No publications found; product may not be purchasable via cart API");
    return;
  }

  const onlineStore = publications.find((e) => e.node.name === "Online Store");
  const targetPubs = onlineStore ? [onlineStore] : publications;

  const publishRes = await adminGraphql(
    `#graphql
      mutation publishProduct($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          userErrors { field message }
        }
      }`,
    {
      id: productId,
      input: targetPubs.map((p) => ({ publicationId: p.node.id })),
    }
  );
  const publishJson = await publishRes.json();
  const publishErrors = publishJson?.data?.publishablePublish?.userErrors;
  if (publishErrors?.length) {
    console.warn("[variant-pool] publishablePublish errors:", publishErrors);
  } else {
    console.log(`[variant-pool] Published product ${productId} to ${targetPubs.length} publication(s)`);
  }
}

/**
 * Ensure all variants of a fee product are always purchasable by:
 * 1. Setting inventoryPolicy: CONTINUE (sell even when out of stock)
 * 2. Disabling inventory tracking (tracked: false)
 *
 * Shopify's /cart/add.js returns "sold out" for variants with tracked inventory and 0 stock.
 */
async function ensureVariantsAlwaysPurchasable(productId: string, adminGraphql: AdminGraphql) {
  const productGid = productId.startsWith("gid://") ? productId : `gid://shopify/Product/${productId}`;

  const variantsRes = await adminGraphql(
    `#graphql
      query productVariants($id: ID!) {
        product(id: $id) {
          variants(first: 100) {
            edges { node { id inventoryPolicy inventoryItem { id tracked } } }
          }
        }
      }`,
    { id: productGid }
  );
  const variantsJson = await variantsRes.json();
  const variants: Array<{ node: { id: string; inventoryPolicy: string; inventoryItem: { id: string; tracked: boolean } } }> =
    variantsJson?.data?.product?.variants?.edges ?? [];

  // Bulk-update inventoryPolicy on all variants that need it
  const variantsNeedingPolicyUpdate = variants.filter((v) => v.node.inventoryPolicy !== "CONTINUE");
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
      }
    );
  }

  // Disable inventory tracking on each variant's inventory item
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
        { id: node.inventoryItem.id, input: { tracked: false } }
      );
    }
  }

  console.log(`[variant-pool] Ensured ${variants.length} variant(s) are always purchasable for ${productGid}`);
}

/**
 * Ensure an existing fee product is UNLISTED, published, and has purchasable variants.
 * UNLISTED products are hidden from collections/search/recommendations but still
 * purchasable via /cart/add.js when published to Online Store.
 */
async function activateExistingProduct(productId: string, adminGraphql: AdminGraphql) {
  const productGid = productId.startsWith("gid://") ? productId : `gid://shopify/Product/${productId}`;

  await adminGraphql(
    `#graphql
      mutation productUpdate($product: ProductUpdateInput!) {
        productUpdate(product: $product) {
          userErrors { field message }
        }
      }`,
    {
      product: {
        id: productGid,
        status: "UNLISTED",
        seo: { title: " ", description: " " },
      },
    }
  );

  await publishProductToOnlineStore(productGid, adminGraphql);
  await ensureVariantsAlwaysPurchasable(productGid, adminGraphql);
}

/**
 * Provision variant pool slots for a decoration method.
 * Idempotent — skips if slots already exist for this method.
 */
export async function provisionVariantPool(
  shopId: string,
  methodId: string,
  methodName: string,
  adminGraphql: (query: string, variables?: Record<string, unknown>) => Promise<Response>
): Promise<{ productId: string; slotCount: number }> {
  const existingSlots = await db.variantSlot.count({
    where: { shopId, methodId },
  });
  if (existingSlots > 0) {
    const slot = await db.variantSlot.findFirst({
      where: { shopId, methodId },
      select: { shopifyProductId: true },
    });
    return { productId: slot!.shopifyProductId, slotCount: existingSlots };
  }

  const productTitle = `Customization – ${methodName}`;
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
        productType: "Customization Fee",
        tags: ["insignia-fee", "insignia-internal"],
        seo: { title: " ", description: " " },
      },
    }
  );
  const createJson = await createRes.json();
  const createErrors = createJson?.data?.productCreate?.userErrors;
  if (createErrors?.length) {
    console.error("[variant-pool] productCreate errors:", createErrors);
    throw new AppError(ErrorCodes.INTERNAL_ERROR, `Failed to create fee product: ${createErrors[0].message}`, 500);
  }
  const product = createJson?.data?.productCreate?.product;
  if (!product?.id) {
    throw new AppError(ErrorCodes.INTERNAL_ERROR, "Failed to create fee product", 500);
  }

  const shopifyProductId = product.id as string;
  const firstVariantId = product.variants.edges[0]?.node?.id as string;

  // Publish to Online Store so cart/add.js can find the variants
  await publishProductToOnlineStore(shopifyProductId, adminGraphql);

  const updateFirstRes = await adminGraphql(
    `#graphql
      mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id }
          userErrors { field message }
        }
      }`,
    {
      productId: shopifyProductId,
      variants: [{ id: firstVariantId, price: "0.00", inventoryPolicy: "CONTINUE" }],
    }
  );
  const updateFirstJson = await updateFirstRes.json();
  if (updateFirstJson?.data?.productVariantsBulkUpdate?.userErrors?.length) {
    console.warn("[variant-pool] Failed to zero-price first variant:", updateFirstJson.data.productVariantsBulkUpdate.userErrors);
  }

  const additionalCount = DEFAULT_SLOT_COUNT - 1;
  const additionalVariants: Array<{ price: string; inventoryPolicy: string; optionValues: Array<{ optionName: string; name: string }> }> = [];
  for (let i = 2; i <= DEFAULT_SLOT_COUNT; i++) {
    additionalVariants.push({
      price: "0.00",
      inventoryPolicy: "CONTINUE",
      optionValues: [{ optionName: "Title", name: `Customization ${i}` }],
    });
  }

  let createdVariantIds: string[] = [];
  if (additionalCount > 0) {
    const bulkRes = await adminGraphql(
      `#graphql
        mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkCreate(productId: $productId, variants: $variants) {
            productVariants { id }
            userErrors { field message }
          }
        }`,
      { productId: shopifyProductId, variants: additionalVariants }
    );
    const bulkJson = await bulkRes.json();
    const bulkErrors = bulkJson?.data?.productVariantsBulkCreate?.userErrors;
    if (bulkErrors?.length) {
      console.error("[variant-pool] productVariantsBulkCreate errors:", bulkErrors);
      throw new AppError(ErrorCodes.INTERNAL_ERROR, `Failed to create slot variants: ${bulkErrors[0].message}`, 500);
    }
    createdVariantIds = (bulkJson?.data?.productVariantsBulkCreate?.productVariants ?? []).map(
      (v: { id: string }) => v.id
    );
  }

  const allVariantIds = [firstVariantId, ...createdVariantIds];

  // Ensure variants are always purchasable (disable tracking + CONTINUE policy)
  await ensureVariantsAlwaysPurchasable(shopifyProductId, adminGraphql);

  await db.$transaction(
    allVariantIds.map((variantId) =>
      db.variantSlot.create({
        data: {
          shopId,
          methodId,
          shopifyProductId,
          shopifyVariantId: variantId,
          state: "FREE",
        },
      })
    )
  );

  console.log(
    `[variant-pool] Provisioned ${allVariantIds.length} slots for method "${methodName}" (product ${shopifyProductId})`
  );

  return { productId: shopifyProductId, slotCount: allVariantIds.length };
}

/**
 * Check whether a fee product still exists in Shopify.
 * Returns false if the product was deleted from the admin.
 */
async function feeProductExistsInShopify(productId: string, adminGraphql: AdminGraphql): Promise<boolean> {
  const productGid = productId.startsWith("gid://") ? productId : `gid://shopify/Product/${productId}`;
  try {
    const res = await adminGraphql(
      `#graphql
        query product($id: ID!) {
          product(id: $id) { id }
        }`,
      { id: productGid }
    );
    const json = await res.json();
    return !!json?.data?.product?.id;
  } catch {
    return false;
  }
}

/**
 * Ensure a method has variant pool slots and the fee product is UNLISTED + published.
 * Called lazily from /prepare. Handles:
 * - Methods created before auto-provisioning (no slots yet)
 * - Slots whose products need status correction
 * - Slots whose fee product was deleted from Shopify admin (re-provisions)
 */
export async function ensureVariantPoolExists(
  shopId: string,
  methodId: string,
  adminGraphql: AdminGraphql
): Promise<void> {
  const existingSlot = await db.variantSlot.findFirst({
    where: { shopId, methodId },
    select: { shopifyProductId: true },
  });

  if (!existingSlot) {
    const method = await db.decorationMethod.findFirst({
      where: { id: methodId, shopId },
    });
    if (!method) {
      throw new AppError(ErrorCodes.NOT_FOUND, "Method not found", 404);
    }
    await provisionVariantPool(shopId, methodId, method.name, adminGraphql);
    return;
  }

  // Check if the fee product still exists in Shopify
  const exists = await feeProductExistsInShopify(existingSlot.shopifyProductId, adminGraphql);
  if (!exists) {
    console.warn(`[variant-pool] Fee product ${existingSlot.shopifyProductId} was deleted — cleaning up and re-provisioning`);

    // Clean up stale DB rows: unlink configs, then delete slots
    const staleSlots = await db.variantSlot.findMany({
      where: { shopId, methodId },
      select: { id: true, currentConfigId: true },
    });
    for (const slot of staleSlots) {
      if (slot.currentConfigId) {
        await db.customizationConfig.updateMany({
          where: { variantSlotId: slot.id },
          data: { variantSlotId: null, state: "EXPIRED" },
        });
      }
    }
    await db.variantSlot.deleteMany({ where: { shopId, methodId } });

    // Re-provision a fresh fee product
    const method = await db.decorationMethod.findFirst({
      where: { id: methodId, shopId },
    });
    if (!method) {
      throw new AppError(ErrorCodes.NOT_FOUND, "Method not found", 404);
    }
    await provisionVariantPool(shopId, methodId, method.name, adminGraphql);
    return;
  }

  // Fee product exists — ensure it's UNLISTED and published
  try {
    await activateExistingProduct(existingSlot.shopifyProductId, adminGraphql);
  } catch (e) {
    console.warn("[variant-pool] Failed to activate existing product:", e);
  }
}
