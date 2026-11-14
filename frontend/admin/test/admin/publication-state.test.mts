import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isMerchantPublicationContinuing,
  isMerchantPublicationOperatorBlocked,
  isMerchantPublicationSettledFailure,
  publicationNotice,
} from '../../src/islands/publication-state.ts';
import type { PublicationState } from '../../src/shared/admin-view.ts';

test('#466: each abandoned-hold state has one classification and one notice', () => {
  const rows: [PublicationState, string, unknown][] = [
    ['ABANDONMENT_RESTORING', 'continuing', { key: 'publicationAbandonmentRestoring', tone: 'info', actions: [] }],
    ['ABANDONED_RESTORED', 'settled', { key: 'publicationAbandonedRestored', tone: 'warning', actions: [] }],
    ['HOLD_NEEDS_SUPPORT', 'blocked', { key: 'publicationHoldNeedsSupport', tone: 'critical', actions: [] }],
    ['OPERATOR_HOLD', 'blocked', { key: 'realPublicationBlocked', tone: 'critical', actions: ['reload'] }],
    ['FAILED', 'settled', null],
    ['ACTIVE', 'none', null],
  ];
  for (const [state, kind, notice] of rows) {
    const classified = isMerchantPublicationContinuing(state)
      ? 'continuing'
      : isMerchantPublicationOperatorBlocked(state)
        ? 'blocked'
        : isMerchantPublicationSettledFailure(state)
          ? 'settled'
          : 'none';
    assert.equal(classified, kind, state);
    const actual = publicationNotice(state);
    assert.deepEqual(actual && { key: actual.key, tone: actual.tone, actions: actual.actions }, notice, state);
  }
  // The English server reason is never shown for the new states.
  for (const state of ['ABANDONMENT_RESTORING', 'ABANDONED_RESTORED', 'HOLD_NEEDS_SUPPORT'] as const)
    assert.equal(publicationNotice(state)?.showReason, false);
});
