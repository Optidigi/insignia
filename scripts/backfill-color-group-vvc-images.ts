/**
 * scripts/backfill-color-group-vvc-images.ts
 *
 * Generalized recovery script for the view-image-orphan-fix.
 *
 * Why this exists
 * ---------------
 * When a merchant deletes Shopify variants (typically a size that's been
 * discontinued), per-variant view images uploaded via the views editor are
 * orphaned: the VariantViewConfiguration row(s) for the deleted variant are
 * gone, but surviving same-color sibling variants may have no VVC of their
 * own — the image was uploaded once for the source variant and never fanned
 * out across the color group.
 *
 * The storefront-config code now does a runtime fallback to a same-color
 * sibling's image (see `// view-image-orphan-fix:` markers in
 * `app/lib/services/storefront-config.server.ts`). This script complements it
 * by **persisting** that fallback into the database, so:
 *   - Admin UIs that read VVC rows directly see the recovered image.
 *   - Future variant churn (the chosen sibling is itself deleted) still has a
 *     valid row to fall back to.
 *
 * Behaviour
 * ---------
 * For every ProductConfig belonging to the target shop:
 *   1. Loops over `linkedProductIds` and queries Shopify for variants
 *      (`id`, `selectedOptions`).
 *   2. Groups variants by color via `groupVariantsByColor` from
 *      `image-manager.server.ts`.
 *   3. For each (productConfig, view, colorGroup) tuple:
 *      - Looks at all VVCs for variants in that colorGroup.
 *      - Picks the earliest-by-`createdAt` VVC that has `imageUrl != null`.
 *      - Upserts a VVC row (with that image key) for every variant in the
 *        color group whose VVC has `imageUrl IS NULL` or whose VVC doesn't
 *        exist yet.
 *
 * Idempotency
 * -----------
 * Writes only happen where `imageUrl IS NULL` (or where no row exists). Re-
 * running the script is a no-op once every color group is uniform.
 *
 * Preconditions
 * -------------
 * - The target shop has installed the app (an offline session row exists,
 *   keyed by `shopifyDomain`). The script will throw if the session is
 *   missing.
 * - Storefront-config code has been deployed first (so even if this script
 *   has a bug, the runtime fallback covers the read path).
 *
 * Usage
 * -----
 *     npm run backfill:vvc-images -- --shop-id=<shopId>
 *
 * Or with shop domain (the script resolves the shopId via shopifyDomain):
 *
 *     npm run backfill:vvc-images -- --shop-domain=stitchs-nl.myshopify.com
 *
 * The script DOES NOT run automatically as part of CI/CD. It must be invoked
 * manually after deploying the runtime fallback.
 */

import db from "../app/db.server";
import { unauthenticated } from "../app/shopify.server";
import { groupVariantsByColor } from "../app/lib/services/image-manager.server";

// ---------- arg parsing ----------

type Args = { shopId?: string; shopDomain?: string; dryRun: boolean };

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: false };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--shop-id=")) {
      out.shopId = arg.slice("--shop-id=".length);
    } else if (arg === "--shop-id") {
      // next arg
    } else if (arg.startsWith("--shop-domain=")) {
      out.shopDomain = arg.slice("--shop-domain=".length);
    } else if (arg === "--dry-run") {
      out.dryRun = true;
    }
  }
  // Support `--shop-id <value>` form
  for (let i = 2; i < argv.length - 1; i++) {
    if (argv[i] === "--shop-id") out.shopId = argv[i + 1];
    if (argv[i] === "--shop-domain") out.shopDomain = argv[i + 1];
  }
  return out;
}

// ---------- types ----------

type ShopifyVariant = {
  id: string;
  selectedOptions: Array<{ name: string; value: string }>;
};

type FetchVariantsResponse = {
  data?: {
    product?: {
      variants?: {
        nodes: ShopifyVariant[];
      };
    };
  };
};

// ---------- main ----------

async function main() {
  const args = parseArgs(process.argv);

  if (!args.shopId && !args.shopDomain) {
    console.error(
      "Usage: backfill-color-group-vvc-images --shop-id=<id> | --shop-domain=<domain> [--dry-run]"
    );
    process.exit(1);
  }

  // Resolve shopId + domain
  const shop = await db.shop.findFirst({
    where: args.shopId
      ? { id: args.shopId }
      : { shopifyDomain: args.shopDomain! },
    select: { id: true, shopifyDomain: true },
  });

  if (!shop) {
    console.error(
      `Shop not found for ${args.shopId ? `id=${args.shopId}` : `domain=${args.shopDomain}`}`
    );
    process.exit(2);
  }

  console.log(
    `[backfill] Target shop: ${shop.shopifyDomain} (id=${shop.id}) ${
      args.dryRun ? "(DRY RUN)" : ""
    }`
  );

  // Authenticate against Shopify Admin via the offline session stored at
  // install time. Throws loudly if missing.
  const { admin } = await unauthenticated.admin(shop.shopifyDomain);

  // Pull every ProductConfig + view list for this shop.
  const configs = await db.productConfig.findMany({
    where: { shopId: shop.id },
    select: {
      id: true,
      name: true,
      linkedProductIds: true,
      views: { select: { id: true, name: true } },
    },
  });

  console.log(`[backfill] Found ${configs.length} ProductConfig(s).`);

  let totalWrites = 0;
  let totalConfigsTouched = 0;

  for (const config of configs) {
    if (config.linkedProductIds.length === 0) continue;
    if (config.views.length === 0) continue;

    // Collect every variant across every linked product (typically 1 product
    // per config, but configs *can* link multiple products — we union them).
    const allVariants: ShopifyVariant[] = [];
    for (const productGid of config.linkedProductIds) {
      const productNumericId = productGid.startsWith("gid://")
        ? productGid
        : `gid://shopify/Product/${productGid}`;

      const res = await admin.graphql(
        `#graphql
        query GetVariantsForBackfill($id: ID!) {
          product(id: $id) {
            variants(first: 250) {
              nodes {
                id
                selectedOptions { name value }
              }
            }
          }
        }`,
        { variables: { id: productNumericId } }
      );

      const data = (await res.json()) as FetchVariantsResponse;
      const variants = data?.data?.product?.variants?.nodes ?? [];
      allVariants.push(...variants);
    }

    if (allVariants.length === 0) {
      console.log(
        `[backfill]   config=${config.name} (id=${config.id}): no live Shopify variants — skipping.`
      );
      continue;
    }

    const groups = groupVariantsByColor(allVariants);

    let writesForConfig = 0;

    // Per-config transaction so a partial failure leaves the DB untouched.
    await db.$transaction(async (tx) => {
      for (const view of config.views) {
        for (const group of groups) {
          if (group.variantIds.length === 0) continue;

          // All VVCs for this (config, view, color group)
          const vvcs = await tx.variantViewConfiguration.findMany({
            where: {
              productConfigId: config.id,
              viewId: view.id,
              variantId: { in: group.variantIds },
            },
            select: {
              variantId: true,
              imageUrl: true,
              createdAt: true,
            },
            orderBy: { createdAt: "asc" },
          });

          // Pick the earliest non-null imageUrl as the source key.
          const source = vvcs.find((v) => v.imageUrl != null);
          if (!source || !source.imageUrl) continue;

          const sourceKey = source.imageUrl;

          // For every variant in the group whose VVC is missing or has
          // imageUrl=null, upsert a row pointing at the source key.
          for (const variantId of group.variantIds) {
            const existing = vvcs.find((v) => v.variantId === variantId);
            if (existing && existing.imageUrl != null) continue; // already good

            if (args.dryRun) {
              writesForConfig++;
              continue;
            }

            if (existing) {
              // imageUrl is null — set it.
              await tx.variantViewConfiguration.updateMany({
                where: {
                  productConfigId: config.id,
                  viewId: view.id,
                  variantId,
                  imageUrl: null, // belt-and-suspenders idempotency guard
                },
                data: { imageUrl: sourceKey },
              });
            } else {
              // No row exists — create one.
              await tx.variantViewConfiguration.create({
                data: {
                  productConfigId: config.id,
                  variantId,
                  viewId: view.id,
                  imageUrl: sourceKey,
                },
              });
            }
            writesForConfig++;
          }
        }
      }
    });

    if (writesForConfig > 0) totalConfigsTouched++;
    totalWrites += writesForConfig;
    console.log(
      `[backfill]   config=${config.name} (id=${config.id}): ${writesForConfig} VVC row(s) ${
        args.dryRun ? "would be" : ""
      } backfilled.`
    );
  }

  console.log(
    `\n[backfill] Done. ${totalWrites} VVC row(s) ${
      args.dryRun ? "would be" : ""
    } written across ${totalConfigsTouched} config(s).`
  );
}

main()
  .then(async () => {
    await db.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[backfill] FAILED:", err);
    await db.$disconnect();
    process.exit(99);
  });
