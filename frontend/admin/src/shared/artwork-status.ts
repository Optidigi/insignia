import type { PurchaseView } from '@insignia/contracts';

export type ArtworkStatus = 'needed' | 'complete';
export type ArtworkFilter = ArtworkStatus | 'all';
export const artworkStatusLabels = { needed: 'Artwork needed', complete: 'Artwork complete' } as const;

/** Accept older list links while keeping current navigation on the two visible states. */
export function parseArtworkFilter(value: string | null): ArtworkFilter {
  if (value === 'complete' || value === 'READY' || value === 'ARTWORK_LOCKED') return 'complete';
  if (value === 'needed' || value === 'PENDING_ARTWORK' || value === 'ERASED') return 'needed';
  return 'all';
}

/** Merchant availability is separate from the immutable artwork lock/audit state. */
export function artworkStatus(purchase: PurchaseView, now = Date.now()): ArtworkStatus {
  return purchase.lines.length > 0 &&
    purchase.groups.length > 0 &&
    purchase.groups.every(
      (group) =>
        Date.parse(group.payloadExpiresAt) > now &&
        group.placements.length > 0 &&
        group.placements.every(
          (placement) =>
            placement.currentAssetId &&
            !placement.expired &&
            placement.currentExpiresAt &&
            Date.parse(placement.currentExpiresAt) > now,
        ),
    )
    ? 'complete'
    : 'needed';
}

export function orderMethods(
  purchase: PurchaseView,
  now = Date.now(),
  unavailableLabel = 'Method unavailable',
): string[] | null {
  const methods = new Set<string>();
  let missing = false;
  for (const group of purchase.groups)
    for (const placement of group.placements) {
      if (!(Date.parse(group.payloadExpiresAt) > now)) {
        missing = true;
        continue;
      }
      const name = group.presentation?.labels.methods?.[placement.methodId]?.trim();
      if (name) methods.add(name);
      else missing = true;
    }
  if (missing) methods.add(unavailableLabel);
  return methods.size ? [...methods] : null;
}
