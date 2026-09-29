import { describe, expect, test } from 'vitest';
import { createActiveSubscriptionClient, resolveVariantContext } from '../../shopify/src/index.js';
import { bindProviderSubscription, projectEntitlement } from '../src/entitlement/provider-policy.js';
import { resolveFreshCatalogContext } from '../src/pricing/catalog-context.js';

const now = new Date('2026-09-29T12:00:30Z');
const tenantShopId = 'tenant-1';
const installationGeneration = '7';
const appId = 'gid://shopify/App/123';
const shopId = 'gid://shopify/Shop/456';

describe('cross-package provider composition', () => {
  test('normalizes a Partner response, binds the active M3 scope, then projects only configured current features', async () => {
    const body = JSON.stringify({
      data: {
        activeSubscription: {
          app: { id: appId },
          shop: { id: shopId },
          billingPeriod: 'EVERY_30_DAYS',
          cancelAtEndOfCycle: false,
          trialEndsAt: null,
          currentBillingCycle: { startTime: '2026-09-01T00:00:00Z', endTime: '2026-10-01T00:00:00Z' },
          items: [
            {
              handle: 'plan.alpha',
              price: { __typename: 'FlatRatePrice', active: false, currency: 'USD', amount: '0.0' },
              discount: null,
              usage: null,
            },
            {
              handle: 'meter.orders',
              price: {
                __typename: 'TieredPrice',
                active: false,
                currency: 'USD',
                tiersMode: 'VOLUME',
                tiers: [{ upTo: null, amountPerUnit: '0.0', amount: '0.0' }],
              },
              discount: null,
              usage: { quantity: 3.0, cost: { amount: '0.0', currencyCode: 'USD' } },
            },
          ],
          pendingUpdate: null,
        },
      },
    });
    const client = createActiveSubscriptionClient({ transport: { query: async () => body }, now: () => now });
    const raw = await client.read({ appId, shopId });
    const tenants = {
      getActiveProviderScope: async () => ({
        shopId: tenantShopId,
        installationGeneration,
        shopifyShopId: '456',
        shopDomain: 'fixture.myshopify.com',
      }),
    };
    const bound = await bindProviderSubscription(raw, { appId, shopId, tenantShopId, installationGeneration }, tenants);
    const result = projectEntitlement(
      bound,
      {
        policyVersion: 'synthetic-v1',
        maxAgeMs: 60_000,
        plans: [
          {
            planHandle: 'plan.alpha',
            usageHandle: 'meter.orders',
            policyId: 'alpha',
            features: ['quote'],
            includedUsage: 10,
          },
        ],
      },
      { appId, shopId, tenantShopId, installationGeneration, now },
    );
    expect(result).toMatchObject({
      features: ['quote'],
      observedUsageQuantity: '3',
      billableUsageAllowed: true,
      qualifyingUsageDisposition: 'REQUIRES_EVENT_TIME',
    });
    await expect(
      bindProviderSubscription(raw, { appId, shopId, tenantShopId, installationGeneration: '8' }, tenants),
    ).rejects.toThrow(/identity/);
  });

  test('Shopify Admin reader structurally supplies the application catalog port with exact context and ownership', async () => {
    const input = {
      shopId: tenantShopId,
      installationGeneration,
      productId: 'gid://shopify/Product/111',
      variantIds: ['gid://shopify/ProductVariant/222'],
      context: { country: 'NL' },
    };
    const port = {
      resolveVariantContext: (request: typeof input) =>
        resolveVariantContext(request, {
          now: () => now,
          transport: {
            execute: async () => ({
              status: 200,
              body: {
                data: {
                  nodes: [
                    {
                      __typename: 'ProductVariant',
                      id: input.variantIds[0],
                      product: { id: input.productId },
                      contextualPricing: { price: { amount: '20.000', currencyCode: 'USD' } },
                    },
                  ],
                },
              },
            }),
          },
        }),
    };
    const [result] = await resolveFreshCatalogContext(port, input, () => now);
    expect(result).toMatchObject({
      amount: '20.000',
      currencyCode: 'USD',
      productIdVerified: true,
      shopId: tenantShopId,
      installationGeneration,
    });
  });
});
