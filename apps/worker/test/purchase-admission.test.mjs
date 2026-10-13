import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionPurchaseAdmission } from '../dist/purchase-admission.js';

const now = new Date('2026-10-13T12:00:00.000Z');
const qualification = {
  origin: {
    shopId: 'synthetic',
    installationGeneration: '1',
    creatorAppId: 'gid://shopify/App/77',
    supportedFrom: '2026-10-13T11:00:00Z',
  },
  appId: '123',
  appClientId: 'synthetic-client',
  activeVersionRef: 'synthetic-reviewed-release',
};
test('qualified server composition uses the existing scoped release reader and refuses missing authority', async () => {
  const reads = [];
  const credentials = {
    acquire: async () => {
      throw new Error('No provider request before release authority');
    },
  };
  const core = {
    tenants: {
      getActiveProviderScope: async () => ({
        shopId: 'synthetic',
        installationGeneration: '1',
        shopDomain: 'synthetic.myshopify.com',
        shopifyShopId: '101',
      }),
    },
    trustedReleaseRecords: {
      read: async (input) => {
        reads.push(input);
        return null;
      },
    },
  };
  const port = createProductionPurchaseAdmission({ core, credentials, qualification, clock: () => now });
  assert.ok(port);
  assert.equal(
    await port.admit({
      order: {
        shopId: 'synthetic',
        installationGeneration: '1',
        createdAt: '2026-10-13T11:30:00Z',
        observedAt: now.toISOString(),
        checkoutOrigin: {
          creatorAppId: 'gid://shopify/App/77',
          sourceName: 'web',
          checkoutTokenDigest: 'a'.repeat(64),
        },
      },
    }),
    null,
  );
  assert.deepEqual(reads, [
    {
      scope: { shopId: 'synthetic', installationGeneration: '1', appClientId: 'synthetic-client' },
      expectedActiveAppVersionRef: 'synthetic-reviewed-release',
      now,
    },
  ]);
});
test('missing native qualification leaves admission absent without touching any capability', () => {
  const core = new Proxy(
    {},
    {
      get() {
        throw new Error('Unqualified capability access');
      },
    },
  );
  assert.equal(createProductionPurchaseAdmission({ core, credentials: {}, qualification: null }), undefined);
  assert.equal(createProductionPurchaseAdmission({ core, credentials: {} }), undefined);
});
