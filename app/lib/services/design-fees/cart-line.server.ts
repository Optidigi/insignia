// design-fees: orchestration for /prepare. Reserves a slot per to-charge
// decision, returns line-item descriptors with the property tags the
// storefront will send to /cart/add.js.
//
// Per §14.B: persistence of CartDesignFeeCharge happens in confirm-charges,
// AFTER /cart/add.js succeeds — not here. This avoids orphan rows when
// /cart/add.js fails.

import { reserveDesignFeeSlot, ensureDesignFeePool } from "./slot-pool.server";
import db from "../../../db.server";
import type { FeeDecision } from "./compute.server";

type AdminGraphql = (
  query: string,
  variables?: Record<string, unknown>,
) => Promise<Response>;

export type PendingDesignFeeLine = {
  /** Ephemeral id generated server-side. The storefront echoes it back in confirm-charges. */
  tempId: string;
  /** Slot id the server will need on confirm/abort to mark IN_CART or free. */
  slotId: string;
  /** Shopify variant id the storefront sends to /cart/add.js. */
  slotVariantId: string;
  feeCentsCharged: number;
  categoryId: string;
  categoryName: string;
  methodId: string;
  logoContentHash: string;
  /** Line item properties tagged onto the design-fee cart line. */
  lineProperties: Record<string, string>;
};

/**
 * For each "to-charge" decision in the input list, reserve a design-fee slot
 * and produce a pending line. Already-charged decisions are skipped (the
 * storefront still renders them in the breakdown but no cart line is added).
 */
export async function buildPendingDesignFeeLines(args: {
  shopId: string;
  methodName: string;
  cartToken: string | null;
  decisions: FeeDecision[];
  adminGraphql: AdminGraphql;
}): Promise<PendingDesignFeeLine[]> {
  const { shopId, methodName, cartToken, decisions, adminGraphql } = args;
  const toCharge = decisions.filter((d) => !d.alreadyCharged && d.feeCentsToCharge > 0);
  if (toCharge.length === 0 || !cartToken) return [];

  await ensureDesignFeePool(shopId, methodName, adminGraphql);

  const lines: PendingDesignFeeLine[] = [];
  for (const d of toCharge) {
    const reserved = await reserveDesignFeeSlot({
      shopId,
      feeCents: d.feeCentsToCharge,
      adminGraphql,
    });
    const tempId = `tmp_${reserved.slotId}`;
    lines.push({
      tempId,
      slotId: reserved.slotId,
      slotVariantId: reserved.shopifyVariantId,
      feeCentsCharged: d.feeCentsToCharge,
      categoryId: d.categoryId,
      categoryName: d.categoryName,
      methodId: d.methodId,
      logoContentHash: d.logoContentHash,
      lineProperties: {
        _insignia_design_fee_for_hash: d.logoContentHash,
        _insignia_design_fee_category_id: d.categoryId,
        _insignia_design_fee_method_id: d.methodId,
      },
    });
  }
  return lines;
}

/** Internal helper: shop existence ping (used by routes for dedup). */
export async function lookupShopId(shopDomain: string): Promise<string | null> {
  const shop = await db.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { id: true },
  });
  return shop?.id ?? null;
}
