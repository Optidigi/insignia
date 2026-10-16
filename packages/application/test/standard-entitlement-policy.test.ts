import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  type EntitlementPolicyConfig,
  type ProviderSubscriptionSnapshot,
  projectEntitlement,
} from '../src/entitlement/provider-policy.js';

const load = (path: string): EntitlementPolicyConfig =>
  JSON.parse(readFileSync(new URL(`../../../deployment/${path}`, import.meta.url), 'utf8'));
const candidate = load('m8-journey/standard-entitlement-policy-candidate.json');
const runtime = load('m5-runtime/entitlement-policy.json');
const now = new Date('2026-10-15T21:15:35.916Z');
const identity = {
  appId: 'gid://shopify/App/123',
  shopId: 'gid://shopify/Shop/105501393179',
  tenantShopId: 'synthetic-tenant',
  installationGeneration: '1',
};
const context = { ...identity, now };
// Synthetic source shapes, not a claim that the new plan has been selected.
function source(planHandle: string, trial = false): ProviderSubscriptionSnapshot {
  return {
    ...identity,
    schemaVersion: 'm4-active-subscription-v1',
    sourceApiVersion: '2026-07',
    observedAt: now.toISOString(),
    active: true,
    billingPeriod: 'EVERY_30_DAYS',
    cancelAtEndOfCycle: false,
    trialEndsAt: trial ? '2026-10-29T21:15:35.916Z' : null,
    currentBillingCycle: trial ? null : { startTime: '2026-09-28T16:53:01.000Z', endTime: '2026-10-28T16:53:01.000Z' },
    items: [{ handle: planHandle, price: { kind: 'flat', active: false }, usage: null }],
    pendingUpdate: null,
  };
}

test('current runtime policy equals the one recurring-only Standard candidate and rejects the selected old contract', () => {
  expect(runtime).toEqual(candidate);
  expect(candidate.plans).toHaveLength(1);
  expect(projectEntitlement(source('insignia-dev-zero-20260928'), candidate, context)).toMatchObject({
    recognizedPolicyId: null,
    features: [],
    qualifyingUsageDisposition: 'DENY',
    billableUsageAllowed: false,
  });
});

test('exact private Standard plan enables all released features without metered obligations in trial and paid cycles', () => {
  expect(projectEntitlement(source('insignia-standard-20261015', true), candidate, context)).toMatchObject({
    recognizedPolicyId: 'lean-v1-standard-all-features',
    trial: true,
    features: ['m5.configure', 'm5.required', 'm5.logo-later', 'm5.production-options', 'm5.pricing'],
    includedUsage: null,
    billableUsageAllowed: false,
    qualifyingUsageDisposition: 'NOT_METERED',
  });
  // A paid cycle is also flat-only; neither period creates a usage obligation.
  expect(projectEntitlement(source('insignia-standard-20261015'), candidate, context)).toMatchObject({
    recognizedPolicyId: 'lean-v1-standard-all-features',
    trial: false,
    qualifyingUsageDisposition: 'NOT_METERED',
  });
});

test('candidate keeps shop, generation, freshness and complete subscription membership fences', () => {
  const valid = source('insignia-standard-20261015', true);
  const foreignShop = 'gid://shopify/Shop/999';
  const cases: [ProviderSubscriptionSnapshot, typeof context][] = [
    [
      { ...valid, shopId: foreignShop },
      { ...context, shopId: foreignShop },
    ],
    [valid, { ...context, installationGeneration: '2' }],
    [valid, { ...context, now: new Date(now.getTime() + 30_001) }],
    [source('unrecognized-plan', true), context],
    [{ ...valid, items: [] }, context],
    [
      { ...valid, items: [...valid.items, { handle: 'extra', price: { kind: 'flat', active: true }, usage: null }] },
      context,
    ],
    [{ ...valid, trialEndsAt: '2026-10-15T21:15:35.000Z' }, context],
  ];
  for (const [input, scope] of cases)
    expect(projectEntitlement(input, candidate, scope)).toMatchObject({
      recognizedPolicyId: null,
      features: [],
      billableUsageAllowed: false,
      qualifyingUsageDisposition: 'DENY',
    });
});
