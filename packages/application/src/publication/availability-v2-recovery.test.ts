import { expect, test } from 'vitest';
import { activationDigest } from './activation.js';
import {
  type AvailabilityRecoveryContext,
  assertOriginalAvailabilityObserved,
  availabilitySnapshotIdentityDigest,
  validateAvailabilityRecoveryDecision,
} from './availability-recovery.js';
import type { ProductAvailabilitySnapshotV2 } from './availability-v2.js';

const scope = {
  shopId: 'shop',
  installationGeneration: '2',
  shopifyShopId: 'gid://shopify/Shop/1',
  appClientId: 'a'.repeat(32),
};
const configuredIntent = { includedPublicationIds: [], publicationSettings: [], scheduled: [] };
const effectiveVisibility = {
  publishedPublicationIds: [],
  onlineStore: { publishedAtPresent: false, urlPresent: false },
  publicationEvidence: [],
  publishedAt: null,
  onlineStoreUrl: null,
};
const before: ProductAvailabilitySnapshotV2 = {
  version: 'm5-product-availability-snapshot-v2',
  scope: { ...scope, installationGeneration: '1' },
  productId: 'gid://shopify/Product/42',
  state: 'available',
  providerUpdatedAt: '2026-10-01T11:00:00.000Z',
  configuredIntent,
  effectiveVisibility,
  intentDigest: activationDigest(configuredIntent),
  effectiveDigest: activationDigest({ publishedPublicationIds: [], onlineStore: effectiveVisibility.onlineStore }),
  observedAt: '2026-10-01T12:00:00.000Z',
  receivedAt: '2026-10-01T12:00:00.000Z',
};
const observed = { ...before, scope, providerUpdatedAt: '2026-10-01T11:01:00.000Z' };
const context = {
  shopId: 'shop',
  configId: 'config',
  operationId: 'op',
  commandKey: 'recover',
  currentScope: scope,
  hold: { version: 'm5-availability-hold-v2', operationId: 'op', before, held: null },
  observed,
} as unknown as AvailabilityRecoveryContext;
test('trusted v2 recovery binds exact observed metadata while original closure uses semantic state after reinstall', () => {
  expect(() => assertOriginalAvailabilityObserved(context)).not.toThrow();
  const digest = availabilitySnapshotIdentityDigest(context.observed);
  const changed = { ...observed, providerUpdatedAt: '2026-10-01T11:02:00.000Z' };
  expect(availabilitySnapshotIdentityDigest(changed as unknown as typeof context.observed)).not.toBe(digest);
  const decision = {
    version: 'm5-availability-recovery-decision-v2',
    shopId: 'shop',
    configId: 'config',
    operationId: 'op',
    commandKey: 'recover',
    decisionRef: 'review',
    actorRef: 'operator',
    currentScopeDigest: activationDigest(scope),
    holdDigest: activationDigest(context.hold),
    observedSnapshotDigest: digest,
    outstandingWrites: 'SETTLED_BY_TRUSTED_OPERATOR',
    reviewedAt: before.observedAt,
    expiresAt: '2026-10-01T12:00:01.000Z',
  };
  expect(validateAvailabilityRecoveryDecision(decision, context, new Date(before.observedAt), 1000)).toEqual(decision);
  expect(() =>
    validateAvailabilityRecoveryDecision(
      decision,
      { ...context, observed: changed as unknown as typeof context.observed },
      new Date(before.observedAt),
      1000,
    ),
  ).toThrow();
  expect(() =>
    assertOriginalAvailabilityObserved({ ...context, observed: changed as unknown as typeof context.observed }),
  ).not.toThrow();
});

test('v2 original-state recovery rejects semantic drift even with identical updatedAt', () => {
  const configuredIntent = {
    includedPublicationIds: ['gid://shopify/Publication/303'],
    publicationSettings: [
      { publicationId: 'gid://shopify/Publication/303', autoPublish: true, supportsFuturePublishing: false },
    ],
    scheduled: [],
  };
  const drift = { ...observed, configuredIntent, intentDigest: activationDigest(configuredIntent) };
  expect(() => assertOriginalAvailabilityObserved({ ...context, observed: drift })).toThrow(
    /Original (v2 )?availability not observed/,
  );
});
test('v2 exact decision binding includes observation timestamps, rather than only provider metadata', () => {
  expect(
    availabilitySnapshotIdentityDigest({
      ...observed,
      observedAt: '2026-10-01T12:00:00.001Z',
      receivedAt: '2026-10-01T12:00:00.001Z',
    }),
  ).not.toBe(availabilitySnapshotIdentityDigest(observed));
});
