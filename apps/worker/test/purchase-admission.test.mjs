import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionPurchaseAdmission, resolveNativePurchaseQualification } from '../dist/purchase-admission.js';

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
  activeVersionRef: '1163229200385',
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
      expectedActiveAppVersionRef: '1163229200385',
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

test('M8 admission release target must match native qualification and still independently read evidence', async () => {
  const reads = [];
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
      read: async (request) => {
        reads.push(request);
        return null;
      },
    },
  };
  const credentials = {
    acquire: async () => {
      throw new Error('No provider authority');
    },
  };
  assert.equal(
    createProductionPurchaseAdmission({
      core,
      credentials,
      qualification,
      releaseProfile: 'm8-read-orders-617057f',
      clock: () => now,
    }),
    undefined,
  );
  const port = createProductionPurchaseAdmission({
    core,
    credentials,
    qualification: { ...qualification, activeVersionRef: '1165513097217' },
    releaseProfile: 'm8-read-orders-617057f',
    clock: () => now,
  });
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
  assert.equal(reads.length, 1);
  assert.equal(reads[0].expectedActiveAppVersionRef, '1165513097217');
});

test('Lean scope-only profile preserves bounded native origin while independently requiring its release evidence', async () => {
  const qualified = resolveNativePurchaseQualification({
    appId: '123',
    appClientId: 'synthetic-client',
    releaseProfile: 'lean-markets-7b17cd9',
  });
  assert.equal(qualified.activeVersionRef, '1169137696769');
  assert.equal(qualified.origin.creatorAppId, 'gid://shopify/App/580111');
  assert.equal(qualified.origin.supportedFrom, '2026-10-14T20:03:04Z');
  const reads = [];
  const port = createProductionPurchaseAdmission({
    core: {
      tenants: {
        getActiveProviderScope: async () => ({
          shopId: qualified.origin.shopId,
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
    },
    credentials: {
      acquire: async () => {
        throw new Error('No provider request without trusted release');
      },
    },
    qualification: qualified,
    releaseProfile: 'lean-markets-7b17cd9',
    clock: () => new Date('2026-10-15T12:30:00Z'),
  });
  assert.ok(port);
  assert.equal(
    await port.admit({
      order: {
        shopId: qualified.origin.shopId,
        installationGeneration: '1',
        createdAt: '2026-10-15T12:00:00Z',
        observedAt: '2026-10-15T12:30:00Z',
        checkoutOrigin: {
          creatorAppId: qualified.origin.creatorAppId,
          sourceName: 'web',
          checkoutTokenDigest: 'a'.repeat(64),
        },
      },
    }),
    null,
  );
  assert.equal(reads.length, 1);
  assert.equal(reads[0].expectedActiveAppVersionRef, '1169137696769');
});
