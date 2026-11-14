import { expect, test } from 'vitest';
import {
  type AbandonmentCandidate,
  decideAbandonment,
  parseAbandonmentConfig,
  restorationClaimStale,
  settleAbandonmentReceipt,
} from './abandonment.js';
import { activationDigest } from './activation.js';
import type {
  AvailabilityHoldV3,
  AvailabilityRestorationReceiptV3,
  ProductAvailabilitySnapshotV3,
} from './availability-v3.js';

const scope = {
  shopId: 'shop',
  installationGeneration: '1',
  shopifyShopId: 'gid://shopify/Shop/1',
  appClientId: 'a'.repeat(32),
};
const at = '2026-11-14T12:00:00.000Z';
const visibility = {
  publishedPublicationIds: [],
  onlineStore: { publishedAtPresent: false, urlPresent: false },
  publicationEvidence: [],
  publishedAt: null,
  onlineStoreUrl: null,
};
const before: ProductAvailabilitySnapshotV3 = {
  version: 'm5-product-availability-snapshot-v3',
  scope,
  productId: 'gid://shopify/Product/42',
  state: 'available',
  providerUpdatedAt: '2026-11-14T11:00:00.000Z',
  effectiveVisibility: visibility,
  effectiveAnchors: [],
  visibleScheduledOrStaged: [],
  anchorDigest: activationDigest([]),
  effectiveDigest: activationDigest({ publishedPublicationIds: [], onlineStore: visibility.onlineStore }),
  observedAt: at,
  receivedAt: at,
};
const held: ProductAvailabilitySnapshotV3 = { ...before, state: 'unavailable' };
const ack = (state: 'available' | 'unavailable') => ({
  version: 'm5-availability-mutation-ack-v3' as const,
  scope,
  productId: before.productId,
  state,
  providerUpdatedAt: before.providerUpdatedAt,
  effectiveVisibility: visibility,
  observedAt: at,
  receivedAt: at,
});
const hold: AvailabilityHoldV3 = {
  version: 'm5-availability-hold-v3',
  operationId: 'op',
  before,
  held,
  acquisitionAcknowledgement: ack('unavailable'),
};
const claim = {
  version: 'm5-availability-restoration-claim-v3' as const,
  operationId: 'op',
  scope,
  productId: before.productId,
  restoreReserved: true as const,
  compensationReserved: true as const,
};
const now = new Date('2026-11-14T12:20:00.000Z');
const candidate = (patch: Partial<AbandonmentCandidate> = {}): AbandonmentCandidate => ({
  operationId: 'op',
  kind: 'HELD',
  hold,
  evidenceDigest: null,
  resolutionDigest: null,
  phase: 'prepared',
  status: 'requested',
  operationSequence: '3',
  configSequence: '3',
  installationCurrent: true,
  quietSince: new Date('2026-11-14T12:05:00.000Z'),
  now,
  ...patch,
});
const decide = (c: AbandonmentCandidate, observation?: Parameters<typeof decideAbandonment>[0]['observation']) =>
  decideAbandonment({ candidate: c, observation, abandonAfterMs: 600_000, releaseWaitFlagMs: 86_400_000 });

test('a quiet prepared owned HELD hold is observed, then claimed with the standard restoration claim', () => {
  expect(decide(candidate())).toEqual({ kind: 'OBSERVE' });
  expect(decide(candidate(), { kind: 'HELD', hold, current: held })).toEqual({
    kind: 'CLAIM',
    abandonmentClaim: {
      version: 'm5-publication-abandonment-claim-v1',
      operationId: 'op',
      scope,
      productId: before.productId,
      authority: 'PROVED_NOT_DISPATCHED',
      quietSince: '2026-11-14T12:05:00.000Z',
      claimedAt: now.toISOString(),
    },
    restorationClaim: claim,
  });
});

test('the not-eligible table: flags need no observation; skips change nothing', () => {
  const rows: [Partial<AbandonmentCandidate>, unknown][] = [
    [{ quietSince: new Date(now.getTime() - 599_999) }, { kind: 'SKIP', reason: 'not_quiet' }],
    [{ phase: 'shop-config-written' }, { kind: 'FLAG', reasons: ['fields_written'] }],
    [{ phase: 'activation-pending' }, { kind: 'FLAG', reasons: ['fields_written'] }],
    [{ kind: 'ACQUISITION_PENDING' }, { kind: 'FLAG', reasons: ['acquisition_unsettled'] }],
    [{ kind: 'WAITING_RELEASE' }, { kind: 'SKIP', reason: 'not_quiet' }],
    [
      { kind: 'WAITING_RELEASE', quietSince: new Date(now.getTime() - 86_400_000) },
      { kind: 'FLAG', reasons: ['release_wait_after_writes'] },
    ],
    [{ hold: { ...hold, acquisitionAcknowledgement: undefined } }, { kind: 'FLAG', reasons: ['hold_not_owned'] }],
    [{ hold: { ...hold, restorationClaim: claim } }, { kind: 'FLAG', reasons: ['hold_not_owned'] }],
    [{ status: 'superseded' }, { kind: 'SKIP', reason: 'superseded' }],
    [{ operationSequence: '2' }, { kind: 'SKIP', reason: 'superseded' }],
    [{ installationCurrent: false }, { kind: 'SKIP', reason: 'superseded' }],
    [{ kind: 'OPERATOR_HOLD' }, { kind: 'SKIP', reason: 'not_candidate' }],
    [{ kind: 'HOLD_INTENT' }, { kind: 'SKIP', reason: 'not_candidate' }],
    [
      { kind: 'WAITING_HOLD', hold: null },
      { kind: 'SKIP', reason: 'not_candidate' },
    ],
    [{ kind: 'ABANDON_CLAIMED' }, { kind: 'SKIP', reason: 'not_candidate' }],
    [{ kind: 'RESTORATION_CLAIMED' }, { kind: 'SKIP', reason: 'not_candidate' }],
  ];
  for (const [patch, expected] of rows) expect([patch, decide(candidate(patch))]).toEqual([patch, expected]);
});

test('E8: a throttled or empty observation skips; an observed different product flags', () => {
  expect(decide(candidate(), { kind: 'UNAVAILABLE' })).toEqual({ kind: 'SKIP', reason: 'observation_unavailable' });
  expect(decide(candidate(), { kind: 'CONFLICT', current: null })).toEqual({
    kind: 'SKIP',
    reason: 'observation_empty',
  });
  expect(decide(candidate(), { kind: 'CONFLICT', current: before })).toEqual({
    kind: 'FLAG',
    reasons: ['product_changed'],
  });
  expect(decide(candidate(), { kind: 'NOT_HELD', current: before })).toEqual({
    kind: 'FLAG',
    reasons: ['product_changed'],
  });
});

const receipt = (patch: Partial<AvailabilityRestorationReceiptV3>): AvailabilityRestorationReceiptV3 => ({
  version: 'm5-availability-restoration-receipt-v3',
  kind: 'RESTORED',
  acknowledgement: ack('available'),
  current: { ...before, providerUpdatedAt: '2026-11-14T11:30:00.000Z' },
  ...patch,
});
const claimed = { ...hold, restorationClaim: claim };
const settle = (r: AvailabilityRestorationReceiptV3 | undefined, ageMs = 0, h: AvailabilityHoldV3 = claimed) =>
  settleAbandonmentReceipt({
    hold: h,
    receipt: r,
    claimUpdatedAt: new Date(now.getTime() - ageMs),
    now,
    staleMs: 120_000,
  });

test('settleAbandonmentReceipt matches the trigger table and the one-retry rule', () => {
  expect(settle(receipt({}))).toBe('ABANDON_RESTORED');
  // An unqualified ACK or a different readback is not a settled restore.
  expect(settle(receipt({ acknowledgement: null }))).toBe('OPERATOR_HOLD');
  expect(settle(receipt({ current: held }))).toBe('OPERATOR_HOLD');
  for (const kind of ['RESTORATION_PENDING', 'CONFLICT', 'REHELD_CONFLICT'] as const)
    expect(settle(receipt({ kind, acknowledgement: null, current: null }))).toBe('OPERATOR_HOLD');
  const notDispatched = receipt({ kind: 'NOT_DISPATCHED', acknowledgement: null, current: null });
  // Unconsumed: stays claimed for the one rearm, even when old.
  expect(settle(notDispatched, 10 * 120_000)).toBe('ABANDON_CLAIMED');
  // Consumed with nothing newer: a crash may have dispatched; stale -> operator.
  const consumed = {
    ...claimed,
    restorationClaim: { ...claim, settledNoDispatchReceiptDigest: activationDigest(notDispatched) },
  };
  expect(settle(notDispatched, 0, consumed)).toBe('ABANDON_CLAIMED');
  expect(settle(notDispatched, 120_000, consumed)).toBe('OPERATOR_HOLD');
  // No receipt: wait for the stale bound, then operator.
  expect(settle(undefined, 119_999)).toBe('ABANDON_CLAIMED');
  expect(settle(undefined, 120_000)).toBe('OPERATOR_HOLD');
});

test('an original Draft restores without a write or ACK', () => {
  const draft: AvailabilityHoldV3 = {
    version: 'm5-availability-hold-v3',
    operationId: 'op',
    before: held,
    held,
    restorationClaim: claim,
  };
  expect(settle(receipt({ acknowledgement: null, current: held }), 0, draft)).toBe('ABANDON_RESTORED');
});

test('the activated path shares the stale-claim rule', () => {
  const stale = (h: AvailabilityHoldV3, ageMs: number) =>
    restorationClaimStale({ hold: h, claimUpdatedAt: new Date(now.getTime() - ageMs), now, staleMs: 120_000 });
  expect(stale(claimed, 119_999)).toBe(false);
  expect(stale(claimed, 120_000)).toBe(true);
  const nd = receipt({ kind: 'NOT_DISPATCHED', acknowledgement: null, current: null });
  expect(stale({ ...claimed, restorationReceipt: nd }, 600_000)).toBe(false);
  expect(
    stale(
      {
        ...claimed,
        restorationClaim: { ...claim, settledNoDispatchReceiptDigest: activationDigest(nd) },
        restorationReceipt: nd,
      },
      600_000,
    ),
  ).toBe(true);
  expect(stale({ ...claimed, restorationReceipt: receipt({ kind: 'RESTORATION_PENDING' }) }, 600_000)).toBe(false);
});

test('worker bounds: default off and 10 minutes, accepted range 5 minutes to 24 hours', () => {
  expect(parseAbandonmentConfig({})).toEqual({
    mode: 'off',
    abandonAfterMs: 600_000,
    releaseWaitFlagMs: 86_400_000,
    claimStaleMs: 120_000,
  });
  expect(parseAbandonmentConfig({ INSIGNIA_PUBLICATION_ABANDON_AFTER_MS: '300000' }).abandonAfterMs).toBe(300_000);
  expect(parseAbandonmentConfig({ INSIGNIA_PUBLICATION_ABANDON_AFTER_MS: '86400000' }).abandonAfterMs).toBe(86_400_000);
  for (const value of ['299999', '86400001', '10m', '-1'])
    expect(() => parseAbandonmentConfig({ INSIGNIA_PUBLICATION_ABANDON_AFTER_MS: value })).toThrow();
  expect(() => parseAbandonmentConfig({ INSIGNIA_PUBLICATION_ABANDONMENT: 'on' })).toThrow();
  expect(parseAbandonmentConfig({ INSIGNIA_PUBLICATION_ABANDONMENT: 'restore' }).mode).toBe('restore');
});
