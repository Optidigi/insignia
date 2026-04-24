/**
 * Storefront pricing helpers (client-safe).
 *
 * Centralised so every consumer (total, review, placement tiles) resolves the
 * same per-method placement fee.
 */

import type { Placement } from "./types";

/** Resolve the placement's base fee for the customer's currently-selected method. */
export function getPlacementCents(
  placement: Placement | undefined | null,
  methodId: string | null,
): number {
  if (!placement) return 0;
  if (
    methodId &&
    placement.pricePerMethod &&
    placement.pricePerMethod[methodId] != null
  ) {
    return placement.pricePerMethod[methodId];
  }
  return placement.basePriceAdjustmentCents;
}
