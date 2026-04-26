// design-fees: orphan detection for the auto-removal-of-fee-line behavior
// (§14.B). Compares persisted CartDesignFeeCharge rows against the live cart
// (passed in by the caller from Shopify Storefront cart.js) and identifies
// charges whose triggering customization lines have been removed.
//
// The actual cart-line removal happens client-side via /cart/change.js so we
// don't need server access to the cart. The server is responsible for:
//  1) reading the persisted charges
//  2) returning which charges are orphaned (so the storefront removes the lines)
//  3) deleting the charge rows + freeing the slots after the storefront confirms

import db from "../../../db.server";
import { freeDesignFeeSlot } from "./slot-pool.server";

/**
 * Cart line shape from Shopify Storefront /cart.js. Only the fields we need.
 */
export type CartLineRef = {
  key: string; // line key (used for /cart/change.js)
  variant_id: number;
  properties: Record<string, string> | null;
};

export type SyncDecision = {
  /** ID of the CartDesignFeeCharge row */
  chargeId: string;
  /** The fee-line cart-line key (for /cart/change.js qty=0 client-side) */
  feeLineKey: string | null;
  /** Slot id to free after the line is gone */
  slotId: string | null;
};

/**
 * Inspect the live cart and return the design-fee charges that are now
 * orphaned (their triggering customization line is gone). Pure read.
 */
export async function detectOrphanCharges(args: {
  shopId: string;
  cartToken: string;
  cartLines: CartLineRef[];
}): Promise<SyncDecision[]> {
  const { shopId, cartToken, cartLines } = args;

  const charges = await db.cartDesignFeeCharge.findMany({
    where: { shopId, cartToken },
    select: {
      id: true,
      logoContentHash: true,
      categoryId: true,
      methodId: true,
      shopifyLineKey: true,
    },
  });
  if (charges.length === 0) return [];

  // Index customization lines by their tagging properties (§14.B):
  //   _insignia_logo_hash + _insignia_fee_categories + _insignia_method_id
  // A customization line "covers" charge C if its hash matches AND its
  // fee_categories list contains C.categoryId AND its method_id matches.
  type CovKey = string;
  const customizationCoverage = new Set<CovKey>();
  for (const line of cartLines) {
    const props = line.properties ?? {};
    const hash = props._insignia_logo_hash;
    const methodId = props._insignia_method_id;
    const categoriesCsv = props._insignia_fee_categories;
    if (!hash || !methodId || !categoriesCsv) continue;
    const categories = categoriesCsv.split(",").map((s) => s.trim()).filter(Boolean);
    for (const categoryId of categories) {
      customizationCoverage.add(`${hash}|${categoryId}|${methodId}`);
    }
  }

  // For each charge, find the live fee-slot line (by _insignia_design_fee_*
  // properties) so we can hand back its line key for client-side removal.
  const feeLineByTuple = new Map<string, string>();
  for (const line of cartLines) {
    const props = line.properties ?? {};
    const hash = props._insignia_design_fee_for_hash;
    const categoryId = props._insignia_design_fee_category_id;
    const methodId = props._insignia_design_fee_method_id;
    if (!hash || !categoryId || !methodId) continue;
    feeLineByTuple.set(`${hash}|${categoryId}|${methodId}`, line.key);
  }

  const orphans: SyncDecision[] = [];
  for (const c of charges) {
    const key = `${c.logoContentHash}|${c.categoryId}|${c.methodId}`;
    if (customizationCoverage.has(key)) continue; // still triggered
    const feeLineKey = feeLineByTuple.get(key) ?? c.shopifyLineKey ?? null;
    // Find slot via currentChargeId
    const slot = await db.designFeeSlot.findFirst({
      where: { currentChargeId: c.id },
      select: { id: true },
    });
    orphans.push({ chargeId: c.id, feeLineKey, slotId: slot?.id ?? null });
  }

  return orphans;
}

/**
 * After the storefront has removed the orphan lines client-side, call this
 * to delete the charge rows and free the corresponding slots.
 */
export async function commitOrphanRemoval(args: {
  decisions: SyncDecision[];
}): Promise<{ removed: number }> {
  const { decisions } = args;
  if (decisions.length === 0) return { removed: 0 };
  const chargeIds = decisions.map((d) => d.chargeId);
  for (const d of decisions) {
    if (d.slotId) await freeDesignFeeSlot(d.slotId);
  }
  const r = await db.cartDesignFeeCharge.deleteMany({
    where: { id: { in: chargeIds } },
  });
  return { removed: r.count };
}
