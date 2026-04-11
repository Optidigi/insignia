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
    include: { variantSlot: true },
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
    if (config.variantSlotId) {
      await tx.variantSlot.update({
        where: { id: config.variantSlotId },
        data: { state: "IN_CART", inCartUntil },
      });
    }
  });

  return { ok: true };
}
