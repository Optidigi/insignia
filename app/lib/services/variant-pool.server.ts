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

/**
 * Initial pool size per (shop × method). New pools are provisioned at this size.
 * Existing pools grow elastically beyond this on demand — see `growVariantPoolToTarget`.
 *
 * Sized to comfortably absorb a single multi-size B2B order (typical garment
 * has 7–12 sizes) plus concurrent customers without immediately depleting.
 */
const DEFAULT_SLOT_COUNT = 25;

/**
 * Hard ceiling per (shop × method). Shopify's default product variant cap is
 * 2048; we leave headroom. When a pool would exceed this AND has zero FREE
 * slots, /prepare throws `POOL_CEILING_REACHED` so the merchant is notified
 * rather than the customer hitting an opaque retry loop.
 */
const MAX_SLOT_COUNT = 2000;

/**
 * Safety belt on a single bulk-create call. Far below Shopify's documented
 * MAX_COST_EXCEEDED for `productVariantsBulkCreate`, but bounds blast radius
 * if a single demand spike asks for hundreds of slots at once.
 */
const MAX_GROW_PER_CALL = 100;

/**
 * Minimum batch when the pool is depleted. Avoids tiny grows that immediately
 * re-deplete; trades one Shopify roundtrip for ~10 slots of headroom.
 */
const MIN_GROW_BATCH = 10;

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

  // Pull each variant's inventoryItem state PLUS whether it has any
  // InventoryLevel. A new variant from productVariantsBulkCreate without
  // `inventoryQuantities` has no level anywhere → /cart/add.js returns 422
  // even with `tracked: false`. We detect and self-heal that case via
  // inventoryActivate at the shop's primary location.
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
    { id: productGid }
  );
  const variantsJson = await variantsRes.json();
  type Edge = { node: { id: string; inventoryPolicy: string; inventoryItem: { id: string; tracked: boolean; inventoryLevels?: { edges?: Array<{ node: { id: string } }> } } } };
  const data = variantsJson as { data?: { location?: { id?: string }; product?: { variants?: { edges?: Edge[] } } } };
  const variants: Edge[] = data?.data?.product?.variants?.edges ?? [];
  const primaryLocationId = data?.data?.location?.id;

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

  let activated = 0;
  for (const { node } of variants) {
    // Disable inventory tracking on each variant's inventory item
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
    // Activate an InventoryLevel at the primary location for any variant
    // with zero existing levels — required for /cart/add.js to consider the
    // variant purchasable.
    const hasLevel = (node.inventoryItem?.inventoryLevels?.edges?.length ?? 0) > 0;
    if (!hasLevel && primaryLocationId && node.inventoryItem?.id) {
      const actRes = await adminGraphql(
        `#graphql
          mutation inventoryActivate($inventoryItemId: ID!, $locationId: ID!) {
            inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId) {
              inventoryLevel { id }
              userErrors { field message }
            }
          }`,
        { inventoryItemId: node.inventoryItem.id, locationId: primaryLocationId }
      );
      const actJson = await actRes.json();
      const actErr = (actJson as { data?: { inventoryActivate?: { userErrors?: Array<{ message?: string }> } } })
        ?.data?.inventoryActivate?.userErrors;
      if (actErr?.length) {
        console.warn(
          `[variant-pool] inventoryActivate failed for ${node.inventoryItem.id}:`,
          actErr,
        );
      } else {
        activated++;
      }
    }
  }

  console.log(
    `[variant-pool] Ensured ${variants.length} variant(s) are always purchasable for ${productGid}` +
      (activated > 0 ? ` (activated ${activated} inventory level(s))` : ""),
  );
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
 * Elastically grow a pool on demand, capped at `MAX_SLOT_COUNT`.
 *
 * Triggered by /prepare when the caller needs at least `neededNow` FREE slots
 * but the pool can't satisfy that. Grows by `max(neededNow - free, MIN_GROW_BATCH)`
 * up to the per-call safety cap and the hard ceiling.
 *
 * Concurrency: Postgres advisory transaction lock keyed by (shopId, methodId)
 * ensures only one grow runs per method at a time. Other concurrent callers
 * see the lock held and return — the modal's 503/retry path covers the gap
 * because the next /prepare will see the freshly grown FREE slots.
 *
 * Failure modes:
 * - Throttled / temporary Shopify error → swallowed by caller; retry on next /prepare.
 * - Pool already at MAX_SLOT_COUNT and 0 FREE → throws `POOL_CEILING_REACHED`
 *   so the merchant is alerted (the cron-cleanup is the prevention mechanism).
 * - Bulk-create userErrors → rolls back the DB transaction (lock releases).
 */
async function growVariantPoolToTarget(
  shopId: string,
  methodId: string,
  adminGraphql: AdminGraphql,
  neededNow = 1
): Promise<void> {
  // Cheap pre-check outside the lock: if the pool already has enough FREE
  // slots to satisfy this caller, skip the Shopify roundtrip entirely.
  const [currentCount, freeCount] = await Promise.all([
    db.variantSlot.count({ where: { shopId, methodId } }),
    db.variantSlot.count({ where: { shopId, methodId, state: "FREE" } }),
  ]);
  if (freeCount >= neededNow) return;

  // Pool is depleted AND already at the hard ceiling — surface this to the
  // merchant via a distinct error code rather than looping forever.
  if (currentCount >= MAX_SLOT_COUNT) {
    throw new AppError(
      ErrorCodes.POOL_CEILING_REACHED,
      `Variant pool at hard ceiling (${MAX_SLOT_COUNT}) and saturated. Increase IN_CART cleanup cadence or contact support.`,
      503
    );
  }

  // Need an existing slot to know which Shopify product to grow into.
  // If no slots exist at all, provisionVariantPool handles it — not our job.
  const anySlot = await db.variantSlot.findFirst({
    where: { shopId, methodId },
    select: { shopifyProductId: true },
  });
  if (!anySlot) return;

  await db.$transaction(
    async (tx) => {
      // Per-(shop,method) lock; BLOCKING. hashtext() is deterministic int4.
      // Blocking (vs try-) is correct here under parallel /prepare bursts: when
      // 12 callers race a depleted pool, we want them to SERIALIZE through the
      // grow gate, not all skip with no-grow. Re-check inside the lock means
      // late arrivals see the just-grown FREE count and exit immediately —
      // each waiter holds the lock for microseconds, not the full Shopify RTT.
      // Use $executeRaw because pg_advisory_xact_lock returns void; $queryRaw
      // would fail with P2010 ("cannot deserialize void").
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${shopId}), hashtext(${methodId}))
      `;

      // Re-check inside the lock (another grower may have just finished)
      const [recount, refree] = await Promise.all([
        tx.variantSlot.count({ where: { shopId, methodId } }),
        tx.variantSlot.count({ where: { shopId, methodId, state: "FREE" } }),
      ]);
      if (refree >= neededNow) return;
      const headroom = MAX_SLOT_COUNT - recount;
      if (headroom <= 0) return; // outer pre-check would have thrown; race
      const desired = Math.max(neededNow - refree, MIN_GROW_BATCH);
      const needed = Math.min(desired, headroom, MAX_GROW_PER_CALL);
      if (needed <= 0) return;

      const productGid = anySlot.shopifyProductId.startsWith("gid://")
        ? anySlot.shopifyProductId
        : `gid://shopify/Product/${anySlot.shopifyProductId}`;

      // Query existing variant titles so we can generate non-colliding new ones.
      // Shopify's "Title" option enforces per-product uniqueness, so naively
      // numbering from `recount + 1` collides whenever the pool has gaps from
      // earlier orphan-cleanup deletions.
      const existingRes = await adminGraphql(
        `#graphql
          query existingVariants($id: ID!) {
            product(id: $id) {
              variants(first: 250) { edges { node { title } } }
            }
          }`,
        { id: productGid }
      );
      const existingJson = await existingRes.json();
      const existingTitles = new Set<string>(
        ((existingJson as { data?: { product?: { variants?: { edges?: Array<{ node: { title: string } }> } } } })
          ?.data?.product?.variants?.edges ?? []
        ).map((e) => e.node.title)
      );

      // Fetch the shop's primary location id. New variants need an
      // InventoryLevel activated at SOME location or /cart/add.js returns 422
      // "already sold out" — even with `tracked: false`. Passing
      // `inventoryQuantities: [{ locationId, availableQuantity: 0 }]` to
      // productVariantsBulkCreate implicitly activates the level. The original
      // pool dodged this because productCreate auto-activates the default
      // location for the first variant; subsequent grows didn't.
      // 2026-04: `Shop.primaryLocation` was removed. The top-level `location`
      // query with no id argument returns the shop's primary location.
      const locRes = await adminGraphql(
        `#graphql
          query primaryLocation { location { id } }`
      );
      const locJson = await locRes.json();
      const primaryLocationId: string | undefined =
        (locJson as { data?: { location?: { id?: string } } })
          ?.data?.location?.id;
      if (!primaryLocationId) {
        throw new AppError(
          ErrorCodes.INTERNAL_ERROR,
          "Failed to resolve primary location for variant pool grow",
          500
        );
      }

      // Generate `needed` titles that don't collide with anything in Shopify.
      // Walk forward from 1, skipping any number already taken.
      const variantsInput: Array<{
        price: string;
        inventoryPolicy: string;
        inventoryItem: { tracked: boolean; requiresShipping: boolean };
        inventoryQuantities: Array<{ locationId: string; availableQuantity: number }>;
        optionValues: Array<{ optionName: string; name: string }>;
      }> = [];
      let candidate = 1;
      while (variantsInput.length < needed) {
        const name = `Customization ${candidate}`;
        if (!existingTitles.has(name)) {
          variantsInput.push({
            price: "0.00",
            inventoryPolicy: "CONTINUE",
            inventoryItem: { tracked: false, requiresShipping: false },
            inventoryQuantities: [{ locationId: primaryLocationId, availableQuantity: 0 }],
            optionValues: [{ optionName: "Title", name }],
          });
          existingTitles.add(name); // prevent duplicates within this batch
        }
        candidate++;
        if (candidate > 10000) {
          throw new AppError(
            ErrorCodes.INTERNAL_ERROR,
            "Could not find available variant titles for grow",
            500
          );
        }
      }

      const bulkRes = await adminGraphql(
        `#graphql
          mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkCreate(productId: $productId, variants: $variants) {
              productVariants { id }
              userErrors { field message }
            }
          }`,
        { productId: productGid, variants: variantsInput }
      );
      const bulkJson = await bulkRes.json();
      const errs = bulkJson?.data?.productVariantsBulkCreate?.userErrors;
      if (errs?.length) {
        // Throw to roll back the transaction (no DB rows inserted, lock released).
        throw new AppError(
          ErrorCodes.INTERNAL_ERROR,
          `Failed to grow variant pool: ${errs[0].message}`,
          500
        );
      }
      const newVariants: Array<{ id: string }> =
        bulkJson?.data?.productVariantsBulkCreate?.productVariants ?? [];

      for (const v of newVariants) {
        await tx.variantSlot.create({
          data: {
            shopId,
            methodId,
            shopifyProductId: anySlot.shopifyProductId,
            shopifyVariantId: v.id,
            state: "FREE",
          },
        });
      }

      console.log(
        `[variant-pool] Grew pool for shop ${shopId} method ${methodId}: ${recount} → ${recount + newVariants.length}`
      );
    },
    { timeout: 30000 } // generous timeout: Shopify bulk create + N inserts
  );

  // Even though productVariantsBulkCreate accepts `inventoryItem.tracked: false`
  // and `inventoryPolicy: "CONTINUE"` at create time, Shopify sometimes still
  // creates the inventoryItem with `tracked: true`, which causes /cart/add.js
  // to return 422 "already sold out". Re-run the post-create normalizer that
  // both untracks every inventory item and forces CONTINUE — the same step
  // applied at provision time. Outside the transaction so a slow Shopify call
  // doesn't widen the lock window.
  try {
    await ensureVariantsAlwaysPurchasable(anySlot.shopifyProductId, adminGraphql);
  } catch (e) {
    console.warn("[variant-pool] Post-grow purchasability normalization failed:", e);
  }
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
  adminGraphql: AdminGraphql,
  neededNow = 1
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

    // Clean up stale DB rows: expire any active configs still pointing at these
    // slots, then delete the slots. Use the slot-side `currentConfigId` (the
    // canonical link) to find affected configs.
    const staleSlots = await db.variantSlot.findMany({
      where: { shopId, methodId },
      select: { currentConfigId: true },
    });
    const staleConfigIds = staleSlots
      .map((s) => s.currentConfigId)
      .filter((id): id is string => id !== null);
    if (staleConfigIds.length > 0) {
      await db.customizationConfig.updateMany({
        where: { id: { in: staleConfigIds }, state: { in: ["RESERVED", "IN_CART"] } },
        data: { state: "EXPIRED", expiredAt: new Date() },
      });
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

  // Elastically grow the pool to satisfy `neededNow` FREE slots. Throttle /
  // transient Shopify errors are non-fatal: better to serve from the existing
  // pool (and let /prepare's own 503 retry path handle a momentarily empty
  // pool) than to fail /prepare entirely. The hard-ceiling error IS fatal —
  // re-throw so the customer sees an unambiguous signal instead of looping.
  try {
    await growVariantPoolToTarget(shopId, methodId, adminGraphql, neededNow);
  } catch (e) {
    if (e instanceof AppError && e.code === ErrorCodes.POOL_CEILING_REACHED) {
      throw e;
    }
    console.warn("[variant-pool] Failed to grow pool to target:", e);
  }
}
