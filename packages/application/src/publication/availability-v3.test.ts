import { expect, test } from 'vitest';
import { activationDigest } from './activation.js';
import {
  assertOriginalAvailabilityObserved,
  availabilitySnapshotIdentityDigest,
  validateAvailabilityRecoveryDecision,
} from './availability-recovery.js';
import { availabilityV3HeldSafe, type ProductAvailabilitySnapshotV3, sameAvailabilityV3 } from './availability-v3.js';

const scope = {
  shopId: 'shop',
  installationGeneration: '1',
  shopifyShopId: 'gid://shopify/Shop/1',
  appClientId: 'a'.repeat(32),
};
const at = '2026-10-07T12:00:00.000Z';
const snapshot: ProductAvailabilitySnapshotV3 = {
  version: 'm5-product-availability-snapshot-v3',
  scope,
  productId: 'gid://shopify/Product/42',
  state: 'available',
  providerUpdatedAt: '2026-10-07T11:00:00.000Z',
  effectiveVisibility: {
    publishedPublicationIds: [],
    onlineStore: { publishedAtPresent: false, urlPresent: false },
    publicationEvidence: [],
    publishedAt: null,
    onlineStoreUrl: null,
  },
  effectiveAnchors: [],
  visibleScheduledOrStaged: [],
  anchorDigest: activationDigest([]),
  effectiveDigest: activationDigest({
    publishedPublicationIds: [],
    onlineStore: { publishedAtPresent: false, urlPresent: false },
  }),
  observedAt: at,
  receivedAt: at,
};
test('v3 trusted recovery binds semantic observation and exact v3 decision without timestamp equality', () => {
  const observed = { ...snapshot, providerUpdatedAt: '2026-10-07T11:00:01.000Z' };
  const context = {
    shopId: 'shop',
    configId: 'config',
    operationId: 'op',
    commandKey: 'recover',
    currentScope: scope,
    hold: { version: 'm5-availability-hold-v3' as const, operationId: 'op', before: snapshot, held: null },
    observed,
  };
  expect(() => assertOriginalAvailabilityObserved(context)).not.toThrow();
  expect(availabilitySnapshotIdentityDigest(observed)).toBe(availabilitySnapshotIdentityDigest(snapshot));
  const decision = {
    version: 'm5-availability-recovery-decision-v3',
    shopId: 'shop',
    configId: 'config',
    operationId: 'op',
    commandKey: 'recover',
    decisionRef: 'review',
    actorRef: 'operator',
    currentScopeDigest: activationDigest(scope),
    holdDigest: activationDigest(context.hold),
    observedSnapshotDigest: availabilitySnapshotIdentityDigest(observed),
    outstandingWrites: 'SETTLED_BY_TRUSTED_OPERATOR',
    reviewedAt: at,
    expiresAt: '2026-10-07T12:00:01.000Z',
  };
  expect(validateAvailabilityRecoveryDecision(decision, context, new Date(at), 1000)).toEqual(decision);
  expect(() =>
    validateAvailabilityRecoveryDecision(
      { ...decision, version: 'm5-availability-recovery-decision-v2' },
      context,
      new Date(at),
      1000,
    ),
  ).toThrow();
});
test('v3 semantic equality ignores diagnostic dates and held safety requires original anchors', () => {
  expect(sameAvailabilityV3(snapshot, { ...snapshot, providerUpdatedAt: '2026-10-07T11:00:01.000Z' })).toBe(true);
  expect(availabilityV3HeldSafe({ ...snapshot, state: 'unavailable' }, snapshot)).toBe(true);
});
