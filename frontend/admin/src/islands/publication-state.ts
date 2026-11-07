import type { PublicationState } from '../shared/admin-view.ts';

const publicationInProgress = new Set<PublicationState>([
  'PUBLISH_REQUESTED',
  'REMOTE_PENDING',
  'REMOTE_READY_ACTIVATION_PENDING',
  'ACTIVATION_WAITING_RELEASE',
  'ACTIVATION_WAITING_HOLD',
  'HELD_ACTIVATION_PENDING',
  'ACTIVATED_RESTORATION_PENDING',
]);

export const isMerchantPublicationContinuing = (state: PublicationState) => publicationInProgress.has(state);

export const isMerchantPublicationOperatorBlocked = (state: PublicationState) =>
  state === 'OPERATOR_HOLD' || state === 'RESTORATION_CONFLICT' || state === 'CONFLICT';
