// design-fees: persists CartDesignFeeCharge rows ON CONFLICT DO NOTHING after
// /cart/add.js succeeds. Returns persisted rows + tempIds whose tuple was
// already taken by another tab/race. Loser tab uses the conflicts list to
// remove its now-duplicate cart lines + free its now-orphan slots.

import { Prisma } from "@prisma/client";
import db from "../../../db.server";
import { confirmDesignFeeSlotInCart, freeDesignFeeSlot } from "./slot-pool.server";

export type ConfirmInput = {
  tempId: string;
  slotId: string;
  shopifyVariantId: string;
  shopifyLineKey: string | null;
  feeCentsCharged: number;
  categoryId: string;
  methodId: string;
  logoContentHash: string;
};

export type ConfirmResult = {
  persisted: Array<{ tempId: string; chargeId: string }>;
  conflicts: Array<{ tempId: string; slotId: string }>;
};

/**
 * For each input, attempt to insert the CartDesignFeeCharge row and stamp
 * IN_CART on the slot. Conflicts mean another tab already won the same tuple
 * — caller is expected to remove the duplicate line from the cart and free
 * the slot.
 */
export async function confirmDesignFeeCharges(args: {
  shopId: string;
  cartToken: string;
  inputs: ConfirmInput[];
}): Promise<ConfirmResult> {
  const { shopId, cartToken, inputs } = args;
  const persisted: Array<{ tempId: string; chargeId: string }> = [];
  const conflicts: Array<{ tempId: string; slotId: string }> = [];

  for (const input of inputs) {
    try {
      const created = await db.cartDesignFeeCharge.create({
        data: {
          shopId,
          cartToken,
          logoContentHash: input.logoContentHash,
          categoryId: input.categoryId,
          methodId: input.methodId,
          feeCentsCharged: input.feeCentsCharged,
          shopifyVariantId: input.shopifyVariantId,
          shopifyLineKey: input.shopifyLineKey,
        },
        select: { id: true },
      });
      await confirmDesignFeeSlotInCart(input.slotId, created.id);
      persisted.push({ tempId: input.tempId, chargeId: created.id });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        // Unique constraint on (cartToken, hash, category, method) lost the race.
        // Caller will remove the duplicate cart line and free the slot.
        await freeDesignFeeSlot(input.slotId);
        conflicts.push({ tempId: input.tempId, slotId: input.slotId });
        continue;
      }
      throw err;
    }
  }

  return { persisted, conflicts };
}

/**
 * Abort path: /cart/add.js failed. Free all reserved slots; persist nothing.
 */
export async function abortDesignFeeCharges(args: {
  slotIds: string[];
}): Promise<{ freed: number }> {
  let freed = 0;
  for (const slotId of args.slotIds) {
    await freeDesignFeeSlot(slotId);
    freed++;
  }
  return { freed };
}
