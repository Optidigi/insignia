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
  | 'realPublicationBlocked'
  | 'publicationAbandonedRestored'
  | 'publicationAbandonmentRestoring'
  | 'publicationHoldNeedsSupport';
export type PublicationNotice = Readonly<{
  key: PublicationNoticeKey;
  tone: 'info' | 'warning' | 'critical';
  /** Reload is offered only where reviewing a fresh copy can help. */
  actions: readonly 'reload'[];
  /** The server's English reason is shown only for the existing review states. */
  showReason: boolean;
}>;

/** The editor's notice for a server-projected publication state, independent of the local write
 * state; null when the state needs no standing notice. */
export function publicationNotice(state: PublicationState): PublicationNotice | null {
  switch (state) {
    case 'ABANDONMENT_RESTORING':
      return { key: 'publicationAbandonmentRestoring', tone: 'info', actions: [], showReason: false };
    case 'ABANDONED_RESTORED':
      return { key: 'publicationAbandonedRestored', tone: 'warning', actions: [], showReason: false };
    case 'HOLD_NEEDS_SUPPORT':
      return { key: 'publicationHoldNeedsSupport', tone: 'critical', actions: [], showReason: false };
    case 'OPERATOR_HOLD':
    case 'RESTORATION_CONFLICT':
    case 'CONFLICT':
      return { key: 'realPublicationBlocked', tone: 'critical', actions: ['reload'], showReason: true };
    default:
      return null;
  }
}
