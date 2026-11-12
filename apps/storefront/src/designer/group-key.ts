import type { DesiredGroup } from '../buyer.ts';

const ordered = (entries: readonly (readonly unknown[])[]) =>
  [...entries].sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0));
/** Browser comparison only, never a replacement for server canonical identity or signed authority. */
export function desiredGroupKey(group: DesiredGroup, variants = true, revision = true): string {
  return JSON.stringify([
    group.productId,
    ...(revision ? [group.configRevisionId, group.revisionContentHash] : []),
    ordered(
      group.design.placements.map((placement) => [
        placement.placementId,
        placement.methodId,
        placement.stepId,
        placement.artwork.kind,
        placement.artwork.kind === 'revision' ? placement.artwork.revisionId : placement.artwork.intentId,
        placement.position?.xMicros ?? null,
        placement.position?.yMicros ?? null,
      ]),
    ),
    ordered(group.design.options.map((option) => [option.optionId, option.valueId])),
    ...(variants ? [ordered(group.variants.map((variant) => [variant.variantId, variant.quantity]))] : []),
  ]);
}

/**
 * Chooses the design to reopen for a cart line. A saved draft owns artwork, placement and
 * production choices; after a native cart edit since the draft's base, the cart's quantities
 * are the customer's latest decision.
 */
export function restorableDesign(
  cart: DesiredGroup,
  draft: DesiredGroup | undefined,
  cartQuantitiesChanged: boolean,
): DesiredGroup {
  if (!draft) return cart;
  return cartQuantitiesChanged ? { ...draft, variants: structuredClone(cart.variants) } : draft;
}
