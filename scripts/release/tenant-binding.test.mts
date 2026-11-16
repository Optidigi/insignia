import assert from 'node:assert/strict';
import test from 'node:test';
import { currentTenantBinding } from './tenant-binding.mts';

const scope = {
  shopId: 'tenant-second-store',
  shopDomain: 'synthetic-second-store.myshopify.com',
  shopifyShopId: '70928236603',
  installationGeneration: '1',
  authorizationGeneration: '33333333-3333-4333-8333-333333333333',
  authorizationEpoch: 2,
};
const managed = {
  shopId: 'tenant-second-store',
  shopDomain: 'synthetic-second-store.myshopify.com',
  shopifyShopId: '70928236603',
  currentGeneration: '1',
  externalInstallationId: 'gid://shopify/AppInstallation/987',
  active: true,
};
function tenants(overrides: { scope?: unknown; managed?: unknown } = {}) {
  const reads: unknown[] = [];
  return {
    reads,
    port: {
      async getActiveAuthorizationScope(input: unknown) {
        reads.push(input);
        return ('scope' in overrides ? overrides.scope : scope) as never;
      },
      async getManagedInstallationState(shop: string) {
        reads.push(shop);
        return ('managed' in overrides ? overrides.managed : managed) as never;
      },
    },
  };
}

test('any store with an active installation gets its binding from the database, not the request', async () => {
  const fake = tenants();
  const result = await currentTenantBinding(fake.port as never, {
    shopId: 'tenant-second-store',
    installationGeneration: '1',
  });
  assert.deepEqual(result, {
    shop: 'synthetic-second-store.myshopify.com',
    shopifyShopId: '70928236603',
    binding: {
      shopId: 'tenant-second-store',
      installationGeneration: '1',
      appClientId: '1443cf6d03d39edae7c101a943c5c684',
      authorizationGeneration: '33333333-3333-4333-8333-333333333333',
      authorizationEpoch: 2,
      externalInstallationId: 'gid://shopify/AppInstallation/987',
    },
  });
  assert.deepEqual(fake.reads, [
    { shopId: 'tenant-second-store', installationGeneration: '1' },
    'synthetic-second-store.myshopify.com',
  ]);
});

test('an unknown, inactive, replaced or inconsistent installation has no binding', async () => {
  const requested = { shopId: 'tenant-second-store', installationGeneration: '1' };
  for (const overrides of [
    { scope: null },
    { scope: { ...scope, shopId: 'another-tenant' } },
    { scope: { ...scope, shopDomain: 'evil.example.com' } },
    { managed: null },
    { managed: { ...managed, active: false } },
    { managed: { ...managed, shopId: 'another-tenant' } },
    { managed: { ...managed, currentGeneration: '2' } },
    { managed: { ...managed, shopifyShopId: '1' } },
    { managed: { ...managed, externalInstallationId: null } },
  ])
    await assert.rejects(currentTenantBinding(tenants(overrides).port as never, requested));
});
