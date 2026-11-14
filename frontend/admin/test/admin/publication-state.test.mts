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
    ['ABANDONMENT_RESTORING', 'continuing', { key: 'publicationAbandonmentRestoring', tone: 'info' }],
    ['ABANDONED_RESTORED', 'settled', { key: 'publicationAbandonedRestored', tone: 'warning' }],
    ['HOLD_NEEDS_SUPPORT', 'blocked', { key: 'publicationHoldNeedsSupport', tone: 'critical' }],
    // The existing review states stay in the write-state banner.
    ['OPERATOR_HOLD', 'blocked', null],
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
    assert.deepEqual(publicationNotice(state), notice, state);
  }
});
