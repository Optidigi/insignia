import assert from 'node:assert/strict';
import test from 'node:test';
import * as admission from '../dist/purchase-admission.js';
import { createPurchaseReleasePreparation } from '../dist/purchase-release.js';

const input = { appId: '123', appClientId: 'synthetic-client', releaseProfile: 'm8-cookie-91b35ab' };
const resolve = (changes = {}) => admission.resolveNativePurchaseQualification({ ...input, ...changes });
const now = new Date('2026-10-14T20:20:00Z');
const untouched = new Proxy(
  {},
  {
    get() {
      throw new Error('Unqualified authority access');
    },
  },
);

test('observed native origin binds only the closed release profile and validated server identity', () => {
  const qualified = resolve();
  assert.equal(qualified.activeVersionRef, '1166710865921');
  assert.deepEqual(qualified.origin, {
    shopId: 'db771bea-c585-4954-9f88-70771c9a0c89',
    installationGeneration: '1',
    creatorAppId: 'gid://shopify/App/580111',
    supportedFrom: '2026-10-14T20:03:04Z',
  });
  assert.equal(qualified.appId, '123');
  assert.equal(qualified.appClientId, 'synthetic-client');
  assert.ok(Object.isFrozen(qualified));
  assert.ok(Object.isFrozen(qualified.origin));
  for (const releaseProfile of [
    'm5-functions-9c2e56b42fbf',
    'm8-read-orders-617057f',
    'm8-app-proxy-3d2a02e',
    'm8-theme-c8d8713',
  ])
    assert.equal(resolve({ releaseProfile }), null);
  for (const appId of ['', '0', 'gid://shopify/App/123']) assert.equal(resolve({ appId }), null);
  for (const appClientId of ['', 'bad client', 'x'.repeat(129)]) assert.equal(resolve({ appClientId }), null);
});

test('preview-only version transition keeps qualified origin but still requires independent release evidence', async () => {
  const releaseProfile = 'm8-preview-28443bd';
  const qualification = resolve({ releaseProfile });
  assert.equal(qualification.activeVersionRef, '1168157736961');
  assert.deepEqual(qualification.origin, resolve().origin);
  const port = admission.createProductionPurchaseAdmission({
    core: {
      tenants: {
        getActiveProviderScope: async (scope) => ({
          ...scope,
          shopDomain: 'synthetic.myshopify.com',
          shopifyShopId: '101',
        }),
      },
      trustedReleaseRecords: { read: async () => null },
    },
    credentials: untouched,
    qualification,
    releaseProfile,
    clock: () => now,
  });
  assert.ok(port);
  const order = {
    ...qualification.origin,
    createdAt: qualification.origin.supportedFrom,
    observedAt: now.toISOString(),
    checkoutOrigin: {
      creatorAppId: qualification.origin.creatorAppId,
      sourceName: 'web',
      checkoutTokenDigest: 'a'.repeat(64),
    },
  };
  assert.equal(await port.admit({ order }), null);
});

test('native origin qualification never supplies missing independent release authority', async () => {
  const qualification = resolve();
  const reads = [];
  const core = {
    tenants: {
      getActiveProviderScope: async (scope) => ({
        ...scope,
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
  const port = admission.createProductionPurchaseAdmission({
    core,
    credentials: untouched,
    qualification,
    releaseProfile: input.releaseProfile,
    clock: () => now,
  });
  assert.ok(port);
  assert.ok(
    createPurchaseReleasePreparation({
      core,
      collector: untouched,
      qualification,
      releaseProfile: input.releaseProfile,
    }),
  );
  const order = {
    ...qualification.origin,
    createdAt: '2026-10-14T20:03:04Z',
    observedAt: now.toISOString(),
    checkoutOrigin: {
      creatorAppId: qualification.origin.creatorAppId,
      sourceName: 'web',
      checkoutTokenDigest: 'a'.repeat(64),
    },
  };
  assert.equal(await port.admit({ order }), null);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].expectedActiveAppVersionRef, qualification.activeVersionRef);
  assert.equal(reads[0].scope.appClientId, input.appClientId);
});

test('other installations, creator, ingress and pre-qualification history cannot use the observed origin', async () => {
  const qualification = resolve();
  const port = admission.createProductionPurchaseAdmission({
    core: { tenants: untouched, trustedReleaseRecords: untouched },
    credentials: untouched,
    qualification,
    releaseProfile: input.releaseProfile,
    clock: () => now,
  });
  const order = {
    ...qualification.origin,
    createdAt: qualification.origin.supportedFrom,
    observedAt: now.toISOString(),
    checkoutOrigin: {
      creatorAppId: qualification.origin.creatorAppId,
      sourceName: 'web',
      checkoutTokenDigest: 'a'.repeat(64),
    },
  };
  for (const change of [
    { shopId: 'another-tenant' },
    { installationGeneration: '2' },
    { createdAt: '2026-10-14T20:03:03Z' },
    { checkoutOrigin: { ...order.checkoutOrigin, creatorAppId: 'gid://shopify/App/580112' } },
    { checkoutOrigin: { ...order.checkoutOrigin, sourceName: 'api' } },
    { checkoutOrigin: { ...order.checkoutOrigin, checkoutTokenDigest: null } },
  ])
    assert.equal(await port.admit({ order: { ...order, ...change } }), null);
});
