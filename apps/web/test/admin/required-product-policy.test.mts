import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMerchantConfigService } from '../../src/server/merchant-config.ts';
import { fixtureCore } from './support/durable-core.mts';
import { adminActor, unexpected } from './support/fixtures.mts';

test('new optional authoring is rejected server-side even when a caller omits the selected frontend payload', async () => {
  const actor = adminActor();
  const core = fixtureCore({
    tenants: {
      getActiveAuthorizationScope: async () => ({
        shopId: actor.tenantShopId,
        shopDomain: actor.shop,
        shopifyShopId: '1',
        installationGeneration: '1',
        authorizationGeneration: '11111111-1111-4111-8111-111111111111',
        authorizationEpoch: 0,
      }),
    },
  });
  const service = createMerchantConfigService({
    core,
    catalog: {
      get: async () => ({
        id: 'gid://shopify/Product/111',
        title: 'T-shirt',
        status: 'ACTIVE',
        imageUrl: null,
        variants: [],
      }),
      shopCurrency: async () => 'USD',
    },
    eligibility: async () => ({ allowed: true, reason: null }),
    publication: unexpected,
  });
  const result = await service.save(actor, 'gid://shopify/Product/111', {
    configId: 'config-1',
    draftVersion: '1',
    idempotencyKey: 'required-policy-test',
    draft: {
      version: 'm5-merchant-draft-v1',
      mode: 'optional',
      shopCurrency: 'USD',
      methods: [],
      placements: [],
      productionOptions: [],
      pricingRules: [],
      geometry: { version: 'm5-geometry-v1', views: [{ id: 'front', variantImages: [], placements: [] }], steps: [] },
    },
  });
  assert.equal(result.kind, 'invalid');
  if (result.kind === 'invalid') assert.match(result.message, /required|require/i);
});
