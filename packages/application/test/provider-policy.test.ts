import { describe, expect, test } from 'vitest';
import { bindProviderSubscription, projectEntitlement } from '../src/entitlement/provider-policy.js';

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
  items: [flat('plan.alpha'), meter()],
  pendingUpdate: null,
  ...overrides,
});
const config = {
  policyVersion: 'synthetic-policy-v1',
  maxAgeMs: 60_000,
  plans: [
    {
      planHandle: 'plan.alpha',
      usageHandle: 'meter.orders',
      policyId: 'alpha',
      features: ['quote', 'advanced-art'],
      includedUsage: 10,
    },
    {
      planHandle: 'plan.beta',
      usageHandle: 'meter.orders',
      policyId: 'beta',
      features: ['quote', 'advanced-art', 'priority'],
      includedUsage: 30,
    },
  ],
};
const at = new Date('2026-09-29T12:00:30Z');
const context = (now: Date) => ({
  appId: 'gid://shopify/App/123',
  shopId: 'gid://shopify/Shop/456',
  tenantShopId: 'tenant-shop-1',
  installationGeneration: '7',
  now,
});

describe('provider entitlement policy', () => {
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
  test('current configured plan grants features and reports Shopify usage separately from included allowance', () => {
    expect(projectEntitlement(snapshot(), config, context(at))).toMatchObject({
      active: true,
      recognizedPolicyId: 'alpha',
      features: ['quote', 'advanced-art'],
      includedUsage: 10,
      observedUsageQuantity: '4',
      billableUsageAllowed: true,
      qualifyingUsageDisposition: 'REQUIRES_EVENT_TIME',
      scheduledCancellation: false,
      freshness: 'fresh',
    });
  });
  test('live trial grants chosen plan but suppresses billing with no retrocharge instruction', () => {
    const result = projectEntitlement(
      snapshot({ trialEndsAt: '2026-10-04T00:00:00.000Z', currentBillingCycle: null }),
      config,
      context(at),
    );
    expect(result).toMatchObject({
      recognizedPolicyId: 'alpha',
      trial: true,
      features: ['quote', 'advanced-art'],
      billableUsageAllowed: false,
      qualifyingUsageDisposition: 'WAIVE_TRIAL',
    });
    expect(JSON.stringify(result)).not.toMatch(/retrocharge|backfill|queuedUsage/i);
    // A later paid-state refresh must not turn the earlier paid-order fact into a billable event.
    expect(projectEntitlement(snapshot(), config, context(at)).qualifyingUsageDisposition).toBe('REQUIRES_EVENT_TIME');
  });
  test('scheduled cancellation retains current grants; pending update never grants future features', () => {
    const result = projectEntitlement(
      snapshot({
        cancelAtEndOfCycle: true,
        pendingUpdate: { billingPeriod: 'EVERY_30_DAYS', itemHandles: ['plan.beta', 'meter.orders'] },
      }),
      config,
      context(at),
    );
    expect(result).toMatchObject({
      recognizedPolicyId: 'alpha',
      features: ['quote', 'advanced-art'],
      scheduledCancellation: true,
      pendingProviderUpdate: { itemHandles: ['plan.beta', 'meter.orders'] },
    });
    expect(result.features).not.toContain('priority');
  });
  test('no contract, stale observation, unknown or case-different handle fail closed', () => {
    const none = projectEntitlement(
      snapshot({ active: false, billingPeriod: null, currentBillingCycle: null, items: [] }),
      config,
      context(at),
    );
    expect(none).toMatchObject({
      active: false,
      recognizedPolicyId: null,
      features: [],
      billableUsageAllowed: false,
      qualifyingUsageDisposition: 'DENY',
    });
    expect(projectEntitlement(snapshot(), config, context(new Date('2026-09-29T12:02:00Z')))).toMatchObject({
      freshness: 'stale',
      features: [],
      billableUsageAllowed: false,
    });
    for (const items of [
      [flat('plan.Alpha'), meter()],
      [flat('plan.alpha'), meter('meter.unknown')],
      [flat('plan.alpha'), flat('plan.other'), meter()],
    ]) {
      expect(projectEntitlement(snapshot({ items }), config, context(at))).toMatchObject({
        recognizedPolicyId: null,
        features: [],
        billableUsageAllowed: false,
      });
    }
  });
  test('array order and inactive effective-zero price records do not override the current contract', () => {
    const a = projectEntitlement(snapshot(), config, context(at));
    const b = projectEntitlement(
      snapshot({ items: [{ ...meter(), price: { ...meter().price, active: false } }, flat('plan.alpha', false)] }),
      config,
      context(at),
    );
    expect(a).toEqual(b);
    expect(a.includedUsage).toBe(10);
  });
  test('foreign shop projection fails closed', () => {
    expect(projectEntitlement(snapshot({ shopId: 'gid://shopify/Shop/999' }), config, context(at))).toMatchObject({
      freshness: 'stale',
      features: [],
      billableUsageAllowed: false,
    });
    for (const change of [{ tenantShopId: 'other-tenant' }, { installationGeneration: '8' }]) {
      expect(projectEntitlement(snapshot(change), config, context(at))).toMatchObject({
        freshness: 'stale',
        features: [],
        billableUsageAllowed: false,
      });
    }
  });
  test('missing usage meter and future observation fail closed', () => {
    for (const [source, time] of [
      [snapshot({ items: [flat('plan.alpha')] }), at],
      [snapshot(), new Date('2026-09-29T11:59:59Z')],
    ] as const) {
      expect(projectEntitlement(source, config, context(time))).toMatchObject({
        features: [],
        billableUsageAllowed: false,
      });
    }
  });
});
