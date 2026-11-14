import type { PublicationState } from '../shared/admin-view.ts';

const publicationInProgress = new Set<PublicationState>([
  'PUBLISH_REQUESTED',
  'REMOTE_PENDING',
  'REMOTE_READY_ACTIVATION_PENDING',
  'ACTIVATION_WAITING_RELEASE',
  'ACTIVATION_WAITING_HOLD',
  'HELD_ACTIVATION_PENDING',
  'ACTIVATED_RESTORATION_PENDING',
  // #466: blocks Publish and keeps polling until the product is back as it was.
  'ABANDONMENT_RESTORING',
]);

export const isMerchantPublicationContinuing = (state: PublicationState) => publicationInProgress.has(state);

export const isMerchantPublicationOperatorBlocked = (state: PublicationState) =>
  state === 'OPERATOR_HOLD' ||
  state === 'RESTORATION_CONFLICT' ||
  state === 'CONFLICT' ||
  state === 'HOLD_NEEDS_SUPPORT';

/** A request that ended without taking effect: a journaled publish request for it settles (is cleared).
 * #466: an abandoned request whose product was restored is settled too, and Publish stays allowed. */
export const isMerchantPublicationSettledFailure = (state: PublicationState) =>
  state === 'FAILED' || state === 'ABANDONED_RESTORED';

export type PublicationNoticeKey =
  | 'publicationAbandonedRestored'
  | 'publicationAbandonmentRestoring'
  | 'publicationHoldNeedsSupport';
export type PublicationNotice = Readonly<{ key: PublicationNoticeKey; tone: 'info' | 'warning' | 'critical' }>;

/** #466: the editor's own banner for a server-projected abandoned-hold or support state. It is
 * separate from the write-state banner (save/publish failures, rejections, retry, reload), which
 * keeps every other state, including the existing review states. Null for every other state. */
export function publicationNotice(state: PublicationState): PublicationNotice | null {
  switch (state) {
    case 'ABANDONMENT_RESTORING':
      return { key: 'publicationAbandonmentRestoring', tone: 'info' };
    case 'ABANDONED_RESTORED':
      return { key: 'publicationAbandonedRestored', tone: 'warning' };
    case 'HOLD_NEEDS_SUPPORT':
      return { key: 'publicationHoldNeedsSupport', tone: 'critical' };
    default:
      return null;
  }
}
