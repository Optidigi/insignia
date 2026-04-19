/**
 * Storefront cart-confirm: transition config/slot to IN_CART.
 * Canonical: docs/core/variant-pool/implementation.md
 */

import db from "../../db.server";
import { AppError, ErrorCodes } from "../errors.server";

const IN_CART_TTL_DAYS = 7;

/**
 * Mark the customization (and its slot) as in cart so we don't recycle prematurely.
 */
export async function cartConfirm(shopId: string, customizationId: string): Promise<{ ok: true }> {
  const config = await db.customizationConfig.findFirst({
    where: { shopId, customizationDraftId: customizationId, state: "RESERVED" },
    select: { id: true },
  });
  if (!config) {
    throw new AppError(
      ErrorCodes.NOT_FOUND,
      "Customization not found or not in RESERVED state. Call prepare first.",
      404
    );
  }

  const inCartUntil = new Date();
  inCartUntil.setDate(inCartUntil.getDate() + IN_CART_TTL_DAYS);

  await db.$transaction(async (tx) => {
    await tx.customizationConfig.update({
      where: { id: config.id },
      data: { state: "IN_CART", inCartAt: new Date() },
    });
    // Look up the slot via the canonical slot-side pointer. The lookup runs
    // inside the transaction so a concurrent recycler can't null `currentConfigId`
    // between read and write.
    const slot = await tx.variantSlot.findUnique({
      where: { currentConfigId: config.id },
      select: { id: true },
    });
    if (slot) {
      await tx.variantSlot.update({
        where: { id: slot.id },
        data: { state: "IN_CART", inCartUntil },
      });
    }
  });

  return { ok: true };
}
