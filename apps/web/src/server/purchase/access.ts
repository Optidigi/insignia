import type { AdminActor } from '../admin/contracts.js';
/** Verified online actor grants used by the retained order/privacy read boundary. Product edit rights confer no access. */
export function canReadPurchaseRecords(
  actor: Pick<AdminActor, 'canReadOrders' | 'canReadArtwork' | 'expiresAtMs'>,
  now = Date.now(),
): boolean {
  return actor.canReadOrders === true && actor.canReadArtwork === true && actor.expiresAtMs > now;
}
