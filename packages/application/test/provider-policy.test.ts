import { expect, test } from 'vitest';
import {
  bindProviderSubscription,
  type EntitlementPolicyConfig,
  projectEntitlement,
} from '../src/entitlement/provider-policy.js';

const observedAt = '2026-09-29T12:00:00.000Z';
const flat = (handle: string, active = true) => ({
  handle,
  price: { kind: 'flat' as const, active, currency: 'USD', amount: '0.00' },
  discount: null,
  usage: null,
});
const meter = (handle = 'meter.orders') => ({
  handle,
  price: {
    kind: 'tiered' as const,
    active: true,
    currency: 'USD',
    tiersMode: 'GRADUATED' as const,
    tiers: [
      { upTo: 10, amountPerUnit: '0.00', amount: '0.00' },
      { upTo: null, amountPerUnit: '0.25', amount: '0.00' },
    ],
  },
  discount: null,
  usage: { quantity: '4', cost: { amount: '0.00', currencyCode: 'USD' } },
});
const snapshot = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 'm4-active-subscription-v1' as const,
  sourceApiVersion: '2026-07' as const,
  appId: 'gid://shopify/App/123',
  shopId: 'gid://shopify/Shop/456',
  tenantShopId: 'tenant-shop-1',
  installationGeneration: '7',
  observedAt,
  active: true,
  billingPeriod: 'EVERY_30_DAYS' as const,
  cancelAtEndOfCycle: false,
  trialEndsAt: null,
  currentBillingCycle: { startTime: '2026-09-01T00:00:00.000Z', endTime: '2026-10-01T00:00:00.000Z' },
  items: [flat('plan.flat-only')],
  pendingUpdate: null,
  ...overrides,
});
const at = new Date('2026-09-29T12:00:30Z');
const context = (now: Date) => ({
  appId: 'gid://shopify/App/123',
  shopId: 'gid://shopify/Shop/456',
  tenantShopId: 'tenant-shop-1',
  installationGeneration: '7',
  now,
});

const recurring: EntitlementPolicyConfig = {
  policyVersion: 'synthetic-recurring-v1',
  maxAgeMs: 60000,
  plans: [
    {
      billing: 'recurring-only',
      planHandle: 'plan.flat-only',
      policyId: 'flat-only',
      features: ['quote', 'advanced-art'],
      shopId: 'gid://shopify/Shop/456',
    },
  ],
};

test('explicit recurring-only current paid contract grants features without a usage obligation', () => {
  expect(projectEntitlement(snapshot({ items: [flat('plan.flat-only')] }), recurring, context(at))).toMatchObject({
    active: true,
    recognizedPolicyId: 'flat-only',
    trial: false,
    features: ['quote', 'advanced-art'],
    includedUsage: null,
    observedUsageQuantity: null,
    billableUsageAllowed: false,
    qualifyingUsageDisposition: 'NOT_METERED',
    freshness: 'fresh',
  });
});

test('recurring-only live trial uses the provider boundary without an allowance or later usage charge', () => {
  const result = projectEntitlement(
    snapshot({
      items: [flat('plan.flat-only', false)],
      trialEndsAt: '2026-09-29T12:01:00.000Z',
      currentBillingCycle: null,
      cancelAtEndOfCycle: true,
    }),
    recurring,
    context(at),
  );
  expect(result).toMatchObject({
    recognizedPolicyId: 'flat-only',
    trial: true,
    features: ['quote', 'advanced-art'],
    includedUsage: null,
    observedUsageQuantity: null,
    billableUsageAllowed: false,
    qualifyingUsageDisposition: 'NOT_METERED',
    scheduledCancellation: true,
  });
  expect(
    projectEntitlement(snapshot({ items: [flat('plan.flat-only')] }), recurring, context(at))
      .qualifyingUsageDisposition,
  ).toBe('NOT_METERED');
});

test('recurring-only admission rejects extra or missing provider items, usage, foreign identity and unsupported time windows', () => {
  for (const overrides of [
    { items: [] },
    { items: [flat('plan.flat-only'), meter()] },
    { items: [flat('plan.flat-only'), flat('extra')] },
    { items: [flat('plan.flat-only'), flat('plan.flat-only')] },
    { items: [{ ...meter('plan.flat-only'), usage: null }] },
    { items: [{ ...flat('plan.flat-only'), usage: { quantity: '1' } }] },
    { items: [flat('other-plan')] },
    { appId: 'gid://shopify/App/999' },
    { shopId: 'gid://shopify/Shop/999' },
    { tenantShopId: 'foreign' },
    { installationGeneration: '8' },
    { observedAt: '2026-09-29T11:59:00Z' },
    { observedAt: '2026-09-29T12:01:00Z' },
    { active: false },
    { billingPeriod: 'ANNUAL' },
    { trialEndsAt: '2026-09-29T12:00:30Z', currentBillingCycle: null },
    { trialEndsAt: '2026-09-30T00:00:00Z' },
    { currentBillingCycle: { startTime: '2026-09-30T00:00:00Z', endTime: '2026-10-01T00:00:00Z' } },
    { currentBillingCycle: { startTime: '2026-09-01T00:00:00Z', endTime: '2026-09-29T12:00:30Z' } },
  ]) {
    expect(
      projectEntitlement(snapshot({ items: [flat('plan.flat-only')], ...overrides }), recurring, context(at)),
    ).toMatchObject({
      recognizedPolicyId: null,
      features: [],
      includedUsage: null,
      observedUsageQuantity: null,
      billableUsageAllowed: false,
      qualifyingUsageDisposition: 'DENY',
    });
  }
});

test('recurring-only policy cannot mix historical meter or allowance fields or silently infer billing mode', () => {
  for (const fields of [
    { usageHandle: 'meter.orders' },
    { includedUsage: 100 },
    { usageHandle: undefined },
    { includedUsage: undefined },
    { billing: 'unknown' },
    { billing: undefined },
  ]) {
    // Invalid external policy data intentionally crosses the typed boundary to verify runtime rejection.
    const malformed = {
      ...recurring,
      plans: recurring.plans.map((plan) => ({ ...plan, ...fields })),
    } as unknown as EntitlementPolicyConfig;
    expect(() => projectEntitlement(snapshot({ items: [flat('plan.flat-only')] }), malformed, context(at))).toThrow(
      'Invalid entitlement policy configuration',
    );
  }
  const unmarked = { planHandle: 'plan.flat-only', policyId: 'flat-only', features: ['quote', 'advanced-art'] };
  expect(() =>
    projectEntitlement(
      snapshot({ items: [flat('plan.flat-only')] }),
      // Missing billing mode is deliberate malformed external configuration.
      { ...recurring, plans: [unmarked] } as unknown as EntitlementPolicyConfig,
      context(at),
    ),
  ).toThrow('Invalid entitlement policy configuration');
});

test('binds provider read only after M3 verifies exact active tenant, provider Shop ID and generation', async () => {
  const { tenantShopId: _tenant, installationGeneration: _generation, ...raw } = snapshot();
  const tenants = {
    getActiveProviderScope: async () => ({
      shopId: 'tenant-shop-1',
      shopDomain: 'fixture.myshopify.com',
      shopifyShopId: '456',
      installationGeneration: '7',
    }),
  };
  await expect(bindProviderSubscription(raw, context(at), tenants)).resolves.toMatchObject({
    tenantShopId: 'tenant-shop-1',
    installationGeneration: '7',
  });
  await expect(
    bindProviderSubscription(raw, { ...context(at), shopId: 'gid://shopify/Shop/999' }, tenants),
  ).rejects.toThrow(/identity/);
  await expect(bindProviderSubscription(raw, { ...context(at), tenantShopId: 'other' }, tenants)).rejects.toThrow(
    /identity/,
  );
  await expect(
    bindProviderSubscription(raw, context(at), { getActiveProviderScope: async () => null }),
  ).rejects.toThrow(/identity/);
});
test('explicit malformed provider shop restrictions reject configuration rather than becoming unscoped', () => {
  for (const shopId of [
    undefined,
    null,
    456,
    true,
    {},
    [],
    '',
    '456',
    'fixture.myshopify.com',
    'gid://shopify/App/456',
    'gid://shopify/Shop/0',
    'gid://shopify/Shop/0456',
    'gid://shopify/Shop/-456',
    'gid://shopify/shop/456',
    'gid://shopify/Shop/456 ',
    'gid://shopify/Shop/456?extra',
    'gid://shopify/Shop/456\n',
    'gid://shopify/Shop/456\r',
    'gid://shopify/Shop/456\r\n',
  ]) {
    // Invalid external policy data intentionally crosses the typed boundary to verify runtime rejection.
    const malformed = {
      ...recurring,
      plans: recurring.plans.map((plan) => ({ ...plan, shopId })),
    } as unknown as EntitlementPolicyConfig;
    expect(() => projectEntitlement(snapshot(), malformed, context(at))).toThrow(
      'Invalid entitlement policy configuration',
    );
  }
});

test('scheduled cancellation retains current access until its actual provider boundary; pending changes grant nothing', () => {
  const source = snapshot({
    cancelAtEndOfCycle: true,
    pendingUpdate: { billingPeriod: 'ANNUAL', itemHandles: ['unknown'] },
  });
  expect(projectEntitlement(source, recurring, context(at))).toMatchObject({
    recognizedPolicyId: 'flat-only',
    features: ['quote', 'advanced-art'],
    scheduledCancellation: true,
    pendingProviderUpdate: { itemHandles: ['unknown'] },
    qualifyingUsageDisposition: 'NOT_METERED',
  });
  expect(projectEntitlement({ ...source, active: false }, recurring, context(at)).features).toEqual([]);
  expect(projectEntitlement(source, recurring, context(new Date('2026-09-29T12:02:00Z'))).freshness).toBe('stale');
  expect(projectEntitlement(null, recurring, context(at))).toMatchObject({ freshness: 'missing', features: [] });
});

test('a different verified shop cannot borrow the plan and reauthorization requires a fresh bound read', () => {
  const other = { ...context(at), shopId: 'gid://shopify/Shop/999', tenantShopId: 'tenant-2' };
  expect(
    projectEntitlement(snapshot({ shopId: other.shopId, tenantShopId: other.tenantShopId }), recurring, other),
  ).toMatchObject({
    freshness: 'fresh',
    recognizedPolicyId: null,
    features: [],
    qualifyingUsageDisposition: 'DENY',
  });
  expect(projectEntitlement(snapshot(), recurring, { ...context(at), installationGeneration: '8' }).features).toEqual(
    [],
  );
  expect(
    projectEntitlement(snapshot({ installationGeneration: '8' }), recurring, {
      ...context(at),
      installationGeneration: '8',
    }).features,
  ).toEqual(['quote', 'advanced-art']);
});

test('Lean V1 rejects a configured hybrid plan instead of preserving a metered compatibility branch', () => {
  // Excluded historical hybrid configuration must fail runtime admission.
  const hybrid = {
    ...recurring,
    plans: [
      { planHandle: 'plan.flat-only', policyId: 'old', features: [], usageHandle: 'meter.orders', includedUsage: 100 },
    ],
  } as unknown as EntitlementPolicyConfig;
  expect(() => projectEntitlement(snapshot(), hybrid, context(at))).toThrow('Invalid entitlement policy configuration');
});
