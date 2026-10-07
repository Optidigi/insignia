import { expect, test } from 'vitest';
import { activationDigest } from './activation.js';
import {
  assertOriginalAvailabilityObserved,
  availabilitySnapshotIdentityDigest,
  validateAvailabilityRecoveryDecision,
} from './availability-recovery.js';
import {
  availabilityV3HeldSafe,
  availabilityV3OwnedHeld,
  type ProductAvailabilitySnapshotV3,
  sameAvailabilityV3,
  validAvailabilityV3,
} from './availability-v3.js';

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

test('structurally valid scheduled original before cannot establish successful held authority', () => {
  const staged = {
    publicationId: 'gid://shopify/Publication/999',
    isPublished: false,
    publishDate: '2099-01-01T00:00:00.000Z',
  };
  const before = {
    ...snapshot,
    effectiveVisibility: { ...snapshot.effectiveVisibility, publicationEvidence: [staged] },
    visibleScheduledOrStaged: [staged],
  };
  const held = { ...snapshot, state: 'unavailable' as const };
  const ack = {
    version: 'm5-availability-mutation-ack-v3' as const,
    scope,
    productId: snapshot.productId,
    state: 'unavailable' as const,
    providerUpdatedAt: snapshot.providerUpdatedAt,
    effectiveVisibility: held.effectiveVisibility,
    observedAt: at,
    receivedAt: at,
  };
  expect(validAvailabilityV3(before)).toBe(true);
  expect(availabilityV3HeldSafe(held, before)).toBe(false);
  expect(
    availabilityV3OwnedHeld({
      version: 'm5-availability-hold-v3',
      operationId: 'scheduled-before',
      before,
      held,
      acquisitionAcknowledgement: ack,
    }),
  ).toBe(false);
});

test('original DRAFT with effective visibility cannot own a clean held snapshot without acquisition', () => {
  const id = 'gid://shopify/Publication/99';
  const anchors = [
    {
      publicationId: id,
      resolved: true as const,
      productIncluded: true as const,
      autoPublish: true,
      supportsFuturePublishing: false,
    },
  ];
  const before = {
    ...snapshot,
    state: 'unavailable' as const,
    effectiveVisibility: {
      ...snapshot.effectiveVisibility,
      publishedPublicationIds: [id],
      publicationEvidence: [{ publicationId: id, isPublished: true, publishDate: '2026-10-07T11:00:00.000Z' }],
    },
    effectiveAnchors: anchors,
    anchorDigest: activationDigest(anchors),
    effectiveDigest: activationDigest({
      publishedPublicationIds: [id],
      onlineStore: snapshot.effectiveVisibility.onlineStore,
    }),
  };
  const held = {
    ...snapshot,
    state: 'unavailable' as const,
    effectiveAnchors: anchors,
    anchorDigest: activationDigest(anchors),
  };
  expect(validAvailabilityV3(before)).toBe(true);
  expect(
    availabilityV3OwnedHeld({ version: 'm5-availability-hold-v3', operationId: 'bad-original-draft', before, held }),
  ).toBe(false);
});

test('even original held-safe DRAFT cannot ignore an explicitly retained scheduled acquisition ACK', () => {
  const before = { ...snapshot, state: 'unavailable' as const };
  const ack = {
    version: 'm5-availability-mutation-ack-v3' as const,
    scope,
    productId: snapshot.productId,
    state: 'unavailable' as const,
    providerUpdatedAt: snapshot.providerUpdatedAt,
    effectiveVisibility: {
      ...snapshot.effectiveVisibility,
      publicationEvidence: [
        { publicationId: 'gid://shopify/Publication/999', isPublished: false, publishDate: '2099-01-01T00:00:00.000Z' },
      ],
    },
    observedAt: at,
    receivedAt: at,
  };
  expect(
    availabilityV3OwnedHeld({
      version: 'm5-availability-hold-v3',
      operationId: 'scheduled-draft-ack',
      before,
      held: before,
      acquisitionAcknowledgement: ack,
    }),
  ).toBe(false);
});
