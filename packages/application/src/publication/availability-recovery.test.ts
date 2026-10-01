import { describe, expect, it } from 'vitest';
import { activationDigest } from './activation.js';
import {
  type AvailabilityRecoveryContext,
  assertOriginalAvailabilityObserved,
  availabilitySnapshotIdentityDigest,
  validateAvailabilityRecoveryDecision,
} from './availability-recovery.js';

const now = new Date('2026-10-01T12:00:00.000Z');
const scope = {
  shopId: 'shop',
  installationGeneration: '2',
  shopifyShopId: 'gid://shopify/Shop/1',
  appClientId: 'synthetic-app',
};
const before = {
  scope: { ...scope, installationGeneration: '1' },
  productId: 'gid://shopify/Product/42',
  state: 'available' as const,
  providerVersion: 'before',
  visibilityDigest: 'a'.repeat(64),
  observedAt: now.toISOString(),
};
const context: AvailabilityRecoveryContext = {
  shopId: 'shop',
  configId: 'config',
  operationId: 'op',
  commandKey: 'recover',
  currentScope: scope,
  hold: { version: 'm5-availability-hold-v1', operationId: 'op', before, held: null },
  observed: { ...before, scope, providerVersion: 'observed' },
};
const decision = {
  version: 'm5-availability-recovery-decision-v1',
  shopId: 'shop',
  configId: 'config',
  operationId: 'op',
  commandKey: 'recover',
  decisionRef: 'synthetic-review',
  actorRef: 'synthetic-owner',
  currentScopeDigest: activationDigest(scope),
  holdDigest: activationDigest(context.hold),
  observedSnapshotDigest: availabilitySnapshotIdentityDigest(context.observed),
  outstandingWrites: 'SETTLED_BY_TRUSTED_OPERATOR',
  reviewedAt: now.toISOString(),
  expiresAt: '2026-10-01T12:00:01.000Z',
};
describe('trusted observation-only availability recovery', () => {
  it('permits separately reviewed exact original prestate after reinstall without inferring causal restoration', () => {
    expect(() => assertOriginalAvailabilityObserved(context)).not.toThrow();
    expect(validateAvailabilityRecoveryDecision(decision, context, now, 1000)).toEqual(decision);
  });
  it.each([
    'currentScopeDigest',
    'holdDigest',
    'observedSnapshotDigest',
    'shopId',
    'configId',
    'operationId',
    'commandKey',
    'outstandingWrites',
  ])('rejects altered authority binding %s', (field) =>
    expect(() =>
      validateAvailabilityRecoveryDecision({ ...decision, [field]: 'changed' }, context, now, 1000),
    ).toThrow(),
  );
  it.each([
    null,
    {},
    { ...decision, expiresAt: now.toISOString() },
    { ...decision, reviewedAt: '2026-09-30T12:00:00.000Z' },
  ])('rejects missing/malformed/expired authority %j', (value) =>
    expect(() => validateAvailabilityRecoveryDecision(value, context, now, 1000)).toThrow(),
  );
  it.each([
    { state: 'unavailable' },
    { visibilityDigest: 'b'.repeat(64) },
    { productId: 'gid://shopify/Product/43' },
    { scope: { ...scope, shopId: 'other' } },
  ])('never closes observed drift %j', (change) =>
    expect(() =>
      assertOriginalAvailabilityObserved({
        ...context,
        observed: { ...context.observed, ...change } as typeof context.observed,
      }),
    ).toThrow(),
  );
});
