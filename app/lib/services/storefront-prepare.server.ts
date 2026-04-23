/**
 * Storefront prepare: reserve slot variant and set price.
 * Canonical: docs/core/variant-pool/implementation.md, docs/core/api-contracts/storefront.md
 */

import { Prisma } from "@prisma/client";
import db from "../../db.server";
const PRICING_VERSION = "v1";
import { AppError, ErrorCodes } from "../errors.server";
import { computeCustomizationPrice } from "./storefront-customizations.server";
import { ensureVariantPoolExists } from "./variant-pool.server";

const RESERVED_TTL_MINUTES = 15;

export type PrepareResult = {
  slotVariantId: string;
  configHash: string;
  pricingVersion: string;
  unitPriceCents: number;
  feeCents: number;
};

/**
 * Reserve a slot for the draft and set its price in Shopify. Requires at least one FREE VariantSlot for the method.
 */
export async function prepareCustomization(
  shopId: string,
  customizationId: string,
  adminGraphql: (query: string, variables?: Record<string, unknown>) => Promise<Response>
): Promise<PrepareResult> {
  const draft = await db.customizationDraft.findFirst({
    where: { id: customizationId, shopId },
  });
  if (!draft) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Customization not found", 404);
  }

  // Idempotency: if a RESERVED config still owns its slot, return the existing
  // result — but only if the fee product still exists in Shopify. Slot ownership
  // is the source of truth (VariantSlot.currentConfigId), so we only consider
  // RESERVED configs here. Configs in IN_CART/ORDERED/PURCHASED states have
  // already moved past the prepare step and shouldn't be replayed.
  const existingConfig = await db.customizationConfig.findFirst({
    where: {
      customizationDraftId: customizationId,
      state: "RESERVED",
    },
    select: { id: true, configHash: true, pricingVersion: true, unitPriceCents: true, feeCents: true },
  });
  const existingSlot = existingConfig
    ? await db.variantSlot.findUnique({
        where: { currentConfigId: existingConfig.id },
        select: { shopifyVariantId: true, shopifyProductId: true },
      })
    : null;
  if (existingConfig && existingSlot) {
    // Verify the fee product still exists before returning stale data
    const productGid = existingSlot.shopifyProductId;
    let productExists = true;
    try {
      const checkRes = await adminGraphql(
        `#graphql
          query product($id: ID!) { product(id: $id) { id } }`,
        { id: productGid }
      );
      const checkJson = await checkRes.json();
      productExists = !!checkJson?.data?.product?.id;
    } catch {
      productExists = false;
    }

    if (productExists) {
      return {
        slotVariantId: existingSlot.shopifyVariantId,
        configHash: existingConfig.configHash,
        pricingVersion: existingConfig.pricingVersion,
        unitPriceCents: existingConfig.unitPriceCents,
        feeCents: existingConfig.feeCents,
      };
    }

    // Fee product was deleted — expire this config so we fall through to re-provision
    console.warn(`[prepare] Fee product ${productGid} deleted — expiring config ${existingConfig.id}`);
    await db.customizationConfig.update({
      where: { id: existingConfig.id },
      data: { state: "EXPIRED" },
    });
  }

  let unitPriceCents = draft.unitPriceCents ?? null;
  let feeCents = draft.feeCents ?? null;
  let configHash = draft.configHash ?? null;
  let pricingVersion = draft.pricingVersion ?? null;
  if (unitPriceCents == null || feeCents == null || !configHash || !pricingVersion) {
    const priceResult = await computeCustomizationPrice(shopId, customizationId);
    unitPriceCents = priceResult.unitPriceCents;
    feeCents = priceResult.feeCents;
    const updated = await db.customizationDraft.findFirst({
      where: { id: customizationId, shopId },
    });
    configHash = updated?.configHash ?? "";
    pricingVersion = updated?.pricingVersion ?? PRICING_VERSION;
  }

  const methodId = draft.methodId;

  // Lazy-provision and elastic-grow: ensure at least one FREE slot exists
  // for this method. /prepare consumes exactly one slot per call; the modal
  // serializes multi-size submissions one at a time so neededNow=1 is correct
  // here. Bulk burst protection comes from MIN_GROW_BATCH inside the grower.
  await ensureVariantPoolExists(shopId, methodId, adminGraphql, 1);

  const now = new Date();
  const reservedUntil = new Date(now.getTime() + RESERVED_TTL_MINUTES * 60 * 1000);

  // Free expired RESERVED slots for this method and expire the configs they
  // were linked to. Order matters: read the soon-to-be-freed slots' configIds
  // BEFORE the updateMany clears `currentConfigId` (otherwise the link is gone
  // and we can't expire those configs).
  const expiredSlots = await db.variantSlot.findMany({
    where: {
      shopId,
      methodId,
      state: "RESERVED",
      reservedUntil: { lt: now },
    },
    select: { currentConfigId: true },
  });
  const expiredConfigIds = expiredSlots
    .map((s) => s.currentConfigId)
    .filter((id): id is string => id !== null);

  await db.variantSlot.updateMany({
    where: {
      shopId,
      methodId,
      state: "RESERVED",
      reservedUntil: { lt: now },
    },
    data: {
      state: "FREE",
      reservedAt: null,
      reservedUntil: null,
      currentConfigId: null,
    },
  });

  if (expiredConfigIds.length > 0) {
    await db.customizationConfig.updateMany({
      where: { id: { in: expiredConfigIds }, state: "RESERVED" },
      data: { state: "EXPIRED", expiredAt: now },
    });
  }

  // Discriminated union for the transaction result — avoids "as" casts and
  // lets TypeScript narrow the caller path after the "already-reserved" check.
  type AcquireResult =
    | {
        kind: "acquired";
        config: { id: string };
        slot: { id: string; shopifyProductId: string; shopifyVariantId: string };
      }
    | {
        kind: "already-reserved";
        config: {
          id: string;
          configHash: string;
          pricingVersion: string;
          unitPriceCents: number;
          feeCents: number;
        };
        slot: { id: string; shopifyProductId: string; shopifyVariantId: string };
      };

  // Acquire a slot. Under parallel /prepare bursts, multiple callers race
  // SELECT FOR UPDATE SKIP LOCKED for the same FREE rows; losers see no row.
  // We retry up to MAX_ACQUIRE_ATTEMPTS times — each retry calls
  // ensureVariantPoolExists again, which (with the BLOCKING advisory lock in
  // growVariantPoolToTarget) will grow the pool if needed before the next
  // SELECT. This makes parallel multi-size submissions self-healing without
  // bouncing the failure all the way to the customer's UI.
  const MAX_ACQUIRE_ATTEMPTS = 3;
  let acquired: AcquireResult | null = null;
  for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS && !acquired; attempt++) {
    if (attempt > 0) {
      // Lost the FOR UPDATE SKIP LOCKED race; trigger another grow cycle and retry.
      await ensureVariantPoolExists(shopId, methodId, adminGraphql, 1);
    }
    acquired = await db.$transaction(async (tx) => {
      // Advisory lock scoped to this customization — serializes concurrent
      // /prepare calls for the same draft. Same pattern as variant-pool.server.ts:435.
      // One-arg hashtext() maps the 36-char UUID to an int8 lock key.
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${customizationId}))
      `;

      const freeSlots: Array<{ id: string; shopifyProductId: string; shopifyVariantId: string }> =
        await tx.$queryRaw`
          SELECT id, "shopifyProductId", "shopifyVariantId"
          FROM "VariantSlot"
          WHERE "shopId" = ${shopId}
            AND "methodId" = ${methodId}
            AND state = 'FREE'
          ORDER BY "createdAt" ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `;
      const freeSlot = freeSlots[0];
      if (!freeSlot) return null;

      let config: { id: string };
      try {
        config = await tx.customizationConfig.create({
          data: {
            shopId,
            methodId,
            configHash: configHash!,
            pricingVersion: pricingVersion!,
            unitPriceCents: unitPriceCents!,
            feeCents: feeCents ?? 0,
            state: "RESERVED",
            customizationDraftId: customizationId,
          },
        });
      } catch (err) {
        // P2002: the partial unique index on (customizationDraftId) WHERE state='RESERVED'
        // was violated — a concurrent /prepare call won the race and already
        // created a RESERVED config for this draft. Read the winner's config and
        // slot, then return them so the caller can skip the Shopify price update.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          const winnerConfig = await tx.customizationConfig.findFirst({
            where: { customizationDraftId: customizationId, state: "RESERVED" },
            select: { id: true, configHash: true, pricingVersion: true, unitPriceCents: true, feeCents: true },
          });
          const winnerSlot = winnerConfig
            ? await tx.variantSlot.findUnique({
                where: { currentConfigId: winnerConfig.id },
                select: { id: true, shopifyProductId: true, shopifyVariantId: true },
              })
            : null;
          if (winnerConfig && winnerSlot) {
            // Concurrent winner already reserved — return via discriminated union.
            // Caller checks result.kind === "already-reserved" and skips Shopify price update.
            return {
              kind: "already-reserved" as const,
              config: {
                ...winnerConfig,
                feeCents: winnerConfig.feeCents ?? 0,
              },
              slot: winnerSlot,
            };
          }
          // Partial index race with no readable winner — treat as if no slot was acquired.
          return null;
        }
        throw err;
      }

      await tx.variantSlot.update({
        where: { id: freeSlot.id },
        data: {
          state: "RESERVED",
          reservedAt: now,
          reservedUntil,
          currentConfigId: config.id,
        },
      });

      return { kind: "acquired" as const, config, slot: freeSlot };
    });
  }
  if (!acquired) {
    throw new AppError(
      ErrorCodes.SERVICE_UNAVAILABLE,
      "All customization slots are in use. Please try again shortly.",
      503
    );
  }
  const result = acquired;

  // Discriminated union — switch on kind, no type casts needed.
  if (result.kind === "already-reserved") {
    // A concurrent /prepare call won the race and already set the Shopify
    // variant price. Return the winner's data directly — no Shopify call needed.
    return {
      slotVariantId: result.slot.shopifyVariantId,
      configHash: result.config.configHash,
      pricingVersion: result.config.pricingVersion,
      unitPriceCents: result.config.unitPriceCents,
      feeCents: result.config.feeCents,
    };
  }

  const priceStr = ((feeCents ?? 0) / 100).toFixed(2);
  const variantId = result.slot.shopifyVariantId;
  const productId = result.slot.shopifyProductId;

  const variantGid = variantId.startsWith("gid://") ? variantId : `gid://shopify/ProductVariant/${variantId}`;
  const productGid = productId.startsWith("gid://") ? productId : `gid://shopify/Product/${productId}`;

  const updateMutation = `#graphql
    mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id price }
        userErrors { field message }
      }
    }`;

  // Default rollback: return slot to FREE so a retry can reclaim it.
  const rollbackSlot = async () => {
    await db.$transaction([
      db.variantSlot.update({
        where: { id: result.slot.id },
        data: { state: "FREE", currentConfigId: null, reservedAt: null, reservedUntil: null },
      }),
      db.customizationConfig.update({
        where: { id: result.config.id },
        data: { state: "EXPIRED", expiredAt: new Date() },
      }),
    ]);
  };

  // Permanent failure: the Shopify variant has been deleted out from under us.
  // Rolling back to FREE would just hand the same broken slot to the next
  // /prepare call, looping forever. Delete the slot row instead so the pool
  // shrinks. EXPIRE the config too. The pool will be re-grown on next deplete.
  const deleteBrokenSlot = async () => {
    await db.$transaction([
      db.customizationConfig.update({
        where: { id: result.config.id },
        data: { state: "EXPIRED", expiredAt: new Date() },
      }),
      db.variantSlot.delete({ where: { id: result.slot.id } }),
    ]);
    console.warn(
      `[prepare] Deleted orphan slot ${result.slot.id} — Shopify variant ${variantGid} no longer exists`,
    );
  };

  let json: unknown;
  try {
    const response = await adminGraphql(updateMutation, {
      productId: productGid,
      variants: [{ id: variantGid, price: priceStr }],
    });
    json = await response.json();
  } catch (networkError) {
    console.error("[prepare] Shopify variant update network error:", networkError);
    await rollbackSlot();
    throw new AppError(
      ErrorCodes.SERVICE_UNAVAILABLE,
      "Failed to set variant price — please retry",
      503
    );
  }

  const errors = (json as {
    data?: { productVariantsBulkUpdate?: { userErrors?: Array<{ message?: string }> } };
  })?.data?.productVariantsBulkUpdate?.userErrors;
  if (errors?.length) {
    console.error("[prepare] Shopify variant update errors:", errors);
    // "Product variant does not exist" means the slot's Shopify variant was
    // deleted out-of-band. The slot row is permanently broken — never hand it
    // out again. Other errors are treated as transient.
    const variantMissing = errors.some((e) =>
      typeof e?.message === "string" && /variant does not exist/i.test(e.message),
    );
    if (variantMissing) {
      await deleteBrokenSlot();
    } else {
      await rollbackSlot();
    }
    throw new AppError(
      ErrorCodes.SERVICE_UNAVAILABLE,
      "Failed to set variant price — please retry",
      503
    );
  }

  return {
    slotVariantId: result.slot.shopifyVariantId,
    configHash: configHash!,
    pricingVersion: pricingVersion!,
    unitPriceCents: unitPriceCents!,
    feeCents: feeCents ?? 0,
  };
}
