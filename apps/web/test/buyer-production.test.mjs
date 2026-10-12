import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { publicKeyFingerprint, publicKeyFromSeed } from '@insignia/application';
import { createProductionBuyerServices } from '../src/server/buyer/production.ts';

const secret = 'synthetic-m7-private-capability';
function signed() {
  const values = {
    shop: 'buyer.myshopify.com',
    timestamp: String(Math.floor(Date.now() / 1000)),
    path_prefix: '/apps/insignia',
    productId: '111',
  };
  const query = new URLSearchParams(values);
  const message = Object.entries(values)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('');
  query.set('signature', createHmac('sha256', secret).update(message).digest('hex'));
  return `https://app.invalid/v1/sessions?${query}`;
}
function fixture() {
  let clock = Date.now(),
    generation = '1';
  const scope = {
    shopId: 'tenant',
    installationGeneration: '1',
    authorizationGeneration: '11111111-1111-4111-8111-111111111111',
    authorizationEpoch: 1,
    shopifyShopId: '9',
    shopDomain: 'buyer.myshopify.com',
  };
  const core = {
    buyers: {},
    artwork: {},
    tenants: {
      getShopByDomain: async () => ({ shopId: 'tenant', shopDomain: scope.shopDomain, currentGeneration: generation }),
      getCurrentAdminInstallation: async () => ({ active: true, generation }),
      getActiveAuthorizationScope: async (input) =>
        input.shopId === scope.shopId && input.installationGeneration === generation
          ? { ...scope, installationGeneration: generation }
          : null,
    },
    acceptedQuotes: {
      getEffective: async (_shop, product) => (product === '111' ? { config: { revisionId: 'revision' } } : null),
    },
    signingKeys: { list: async () => [] },
  };
  const input = {
    core,
    env: {
      SHOPIFY_CLIENT_ID: 'synthetic-app-key',
      SHOPIFY_CLIENT_SECRET: secret,
      APP_URL: 'https://app.invalid',
      ARTWORK_PROXY_PATH_PREFIX: '/apps/insignia',
      INSIGNIA_SHOPIFY_APP_ID: '7',
    },
    ring: { currentKeyId: 'synthetic', keys: { synthetic: Buffer.alloc(32, 1) } },
    entitlementPolicy: { policyVersion: 'synthetic', maxAgeMs: 300000, plans: [] },
    credentials: { acquire: async () => ({ kind: 'missing' }) },
    readSubscription: async () => {
      throw new Error('provider unavailable');
    },
    artifactPorts: { expectedBuild: { read: async () => null }, trustedEvidence: { read: async () => null } },
    expectedFunctions: {
      appKey: 'synthetic-app-key',
      transformInputQuerySha256: 'a'.repeat(64),
      validationInputQuerySha256: 'b'.repeat(64),
    },
    configurationReady: async () => {
      throw new Error('configuration unavailable');
    },
    readVariantAvailability: async () => {
      throw new Error('inventory unavailable');
    },
    clock: () => new Date(clock),
    maxObservationAgeMs: 30000,
  };
  return {
    input,
    advance: (ms) => {
      clock += ms;
    },
    changeGeneration: () => {
      generation = '2';
    },
  };
}

test('production factory requires server-owned resource, commercial and readiness ports', () => {
  const { input } = fixture();
  assert.throws(() => createProductionBuyerServices({ ...input, credentials: undefined }), /configuration/i);
  assert.throws(() => createProductionBuyerServices({ ...input, artifactPorts: undefined }), /configuration/i);
  assert.throws(() => createProductionBuyerServices({ ...input, readVariantAvailability: true }), /configuration/i);
});

test('real SDK proxy and shared HMAC guest authority provide seven days without cookie or synthetic auth fallback', async () => {
  const fixtureValue = fixture(),
    services = createProductionBuyerServices(fixtureValue.input),
    url = signed();
  const grant = await services.guest.issue(new Request(url));
  assert.ok(grant);
  assert.equal(Date.parse(grant.expiresAt) - fixtureValue.input.clock().getTime(), 7 * 86400000);
  const verification = () =>
    services.guest.verify(
      new Request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capability: grant.token }),
      }),
    );
  const original = await verification();
  assert.equal(original.shopId, 'tenant');
  fixtureValue.advance(5 * 86400000);
  assert.equal((await verification()).ownerHash, original.ownerHash);
  fixtureValue.changeGeneration();
  assert.equal(await verification(), null);
  const forged = new URL(url);
  forged.searchParams.set('shop', 'attacker.myshopify.com');
  assert.equal(await services.guest.issue(new Request(forged)), null);
});

function catalogFixture() {
  const value = fixture(),
    { input } = value;
  const scope = { shopId: 'tenant', installationGeneration: '1' };
  input.core.acceptedQuotes.getEffective = async () => ({
    config: {
      revisionId: 'revision',
      revisionContentHash: 'a'.repeat(64),
      methods: [{ id: 'print' }],
      placements: [],
      productionOptions: [],
    },
  });
  input.core.configs = {
    getRevisionGeometry: async () => ({
      value: {
        version: 'm5-geometry-v1',
        views: [
          {
            id: 'front',
            image: { revisionId: 'product_111', width: 100, height: 100 },
            variantImages: [],
            placements: [],
          },
        ],
        steps: [],
      },
    }),
    getRevisionPresentation: async () => ({
      labels: { methods: {}, placements: {}, steps: {}, options: {}, values: {} },
    }),
  };
  input.core.signingKeys.list = async () => [
    { ...scope, authorizationGeneration: '11111111-1111-4111-8111-111111111111', state: 'active', keyId: 7, id: 7 },
  ];
  input.credentials.acquire = async (target) => {
    assert.deepEqual(target, scope);
    return {
      kind: 'usable',
      shopDomain: 'buyer.myshopify.com',
      accessToken: 'synthetic-offline-token',
      accessExpiresAt: new Date(+input.clock() + 300000),
    };
  };
  input.fetchImpl = async (url, options) => {
    assert.equal(url, 'https://buyer.myshopify.com/admin/api/2026-07/graphql.json');
    assert.equal(options.headers['X-Shopify-Access-Token'], 'synthetic-offline-token');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.equal(body.variables.id, 'gid://shopify/Product/111');
    return new Response(
      JSON.stringify({
        data: {
          product: {
            id: body.variables.id,
            title: 'Owned',
            status: 'ACTIVE',
            featuredMedia: {
              preview: { image: { url: 'https://cdn.shopify.com/synthetic/product.png', altText: null } },
            },
            variants: {
              nodes: [{ id: 'gid://shopify/ProductVariant/222', title: 'Blue M', selectedOptions: [], image: null }],
              pageInfo: { hasNextPage: false },
            },
          },
        },
      }),
      { status: 200 },
    );
  };
  input.configurationReady = async (target) => {
    assert.deepEqual(target, { ...scope, productId: '111', selectedKeyId: 7 });
  };
  input.readVariantAvailability = async (target) => {
    assert.deepEqual(target, {
      ...scope,
      productId: 'gid://shopify/Product/111',
      variantIds: ['gid://shopify/ProductVariant/222'],
    });
    return {
      ...scope,
      productId: target.productId,
      observedAt: input.clock().toISOString(),
      freshUntil: new Date(+input.clock() + 300000).toISOString(),
      variants: [{ id: 'gid://shopify/ProductVariant/222', available: false }],
    };
  };
  return value;
}

test('catalog is actual credential-scoped provider data with explicit unavailable inventory and safe image mapping', async () => {
  const { input } = catalogFixture();
  const services = createProductionBuyerServices(input);
  const config = await services.config(new Request(signed()));
  assert.deepEqual(config.variants, [{ id: '222', label: 'Blue M', available: false }]);
  assert.equal(config.imageUrls.product_111, 'https://cdn.shopify.com/synthetic/product.png');
  assert.equal(config.ready, true);
});

test('catalog rejects missing credentials, foreign credential tenant and foreign inventory snapshots without synthetic results', async () => {
  const { input } = catalogFixture();
  let calls = 0;
  const originalFetch = input.fetchImpl;
  input.fetchImpl = async (...args) => {
    calls++;
    return originalFetch(...args);
  };
  input.credentials.acquire = async () => ({ kind: 'missing' });
  const services = createProductionBuyerServices(input);
  await assert.rejects(services.config(new Request(signed())), /credential unavailable/);
  assert.equal(calls, 0);
  input.credentials.acquire = async () => ({
    kind: 'usable',
    shopDomain: 'attacker.myshopify.com',
    accessToken: 'synthetic',
    accessExpiresAt: new Date(+input.clock() + 300000),
  });
  await assert.rejects(services.config(new Request(signed())), /credential unavailable/);
  assert.equal(calls, 0);
  input.credentials.acquire = async () => ({
    kind: 'usable',
    shopDomain: 'buyer.myshopify.com',
    accessToken: 'synthetic-offline-token',
    accessExpiresAt: new Date(+input.clock() + 300000),
  });
  input.readVariantAvailability = async (target) => ({
    ...target,
    installationGeneration: '2',
    observedAt: input.clock().toISOString(),
    freshUntil: new Date(+input.clock() + 300000).toISOString(),
    variants: [{ id: 'gid://shopify/ProductVariant/222', available: true }],
  });
  await assert.rejects(services.config(new Request(signed())), /inventory authority unavailable/);
  input.fetchImpl = async () => {
    throw new Error('synthetic provider outage');
  };
  await assert.rejects(services.config(new Request(signed())), /synthetic provider outage/);
});

test('generation drift during credential acquisition and readiness failures remain explicit unavailable states', async () => {
  const value = catalogFixture(),
    { input } = value;
  let requests = 0;
  const originalFetch = input.fetchImpl;
  input.fetchImpl = async (...args) => {
    requests++;
    return originalFetch(...args);
  };
  input.credentials.acquire = async () => {
    value.changeGeneration();
    return {
      kind: 'usable',
      shopDomain: 'buyer.myshopify.com',
      accessToken: 'synthetic',
      accessExpiresAt: new Date(+input.clock() + 300000),
    };
  };
  await assert.rejects(
    createProductionBuyerServices(input).config(new Request(signed())),
    /installation authority unavailable/,
  );
  assert.equal(requests, 0);
  const fresh = catalogFixture();
  fresh.input.configurationReady = async () => {
    throw new Error('trusted release evidence unavailable');
  };
  await assert.rejects(
    createProductionBuyerServices(fresh.input).config(new Request(signed())),
    /trusted release evidence unavailable/,
  );
  fresh.input.core.signingKeys.list = async () => [];
  await assert.rejects(
    createProductionBuyerServices(fresh.input).config(new Request(signed())),
    /signing key selection unavailable/,
  );
});

test('production defaults read Admin availability instead of requiring an injected boolean source', async () => {
  const { input } = catalogFixture(),
    originalFetch = input.fetchImpl;
  delete input.readVariantAvailability;
  let availabilityReads = 0;
  input.fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.query.includes('InsigniaVariantAvailability')) {
      availabilityReads++;
      assert.equal(url, 'https://buyer.myshopify.com/admin/api/2026-07/graphql.json');
      assert.deepEqual(body.variables, { ids: ['gid://shopify/ProductVariant/222'] });
      assert.equal(options.redirect, 'error');
      return new Response(
        JSON.stringify({
          data: {
            nodes: [
              {
                id: body.variables.ids[0],
                availableForSale: false,
                product: { id: 'gid://shopify/Product/111', status: 'ACTIVE' },
              },
            ],
          },
        }),
      );
    }
    return originalFetch(url, options);
  };
  const config = await createProductionBuyerServices(input).config(new Request(signed()));
  assert.equal(availabilityReads, 1);
  assert.equal(config.variants[0].available, false);
});

test('production default readiness derives actual shop context and refuses missing native public configuration', async () => {
  const { input } = catalogFixture(),
    originalFetch = input.fetchImpl;
  delete input.configurationReady;
  const scope = {
    shopId: 'tenant',
    installationGeneration: '1',
    authorizationGeneration: '11111111-1111-4111-8111-111111111111',
    authorizationEpoch: 1,
  };
  const publicKey = publicKeyFromSeed(Buffer.alloc(32, 2));
  input.core.signingKeys.getActiveScope = async () => scope;
  input.core.signingKeys.list = async () => [
    {
      ...scope,
      id: 7,
      keyId: 7,
      state: 'active',
      publicKey,
      publicKeyFingerprint: publicKeyFingerprint(publicKey),
      firstDay: 20000,
      lastDay: 23000,
    },
  ];
  input.core.acceptedQuotes.getEffective = async () => ({
    configId: 'config',
    operationId: 'operation',
    config: {
      shopId: 'tenant',
      productId: '111',
      revisionId: 'revision',
      revisionContentHash: 'a'.repeat(64),
      methods: [],
      placements: [],
      productionOptions: [],
    },
  });
  let contextReads = 0,
    publicReads = 0;
  input.fetchImpl = async (url, options) => {
    const query = JSON.parse(options.body).query;
    if (query.includes('InsigniaShopContext')) {
      contextReads++;
      return new Response(
        JSON.stringify({ data: { shop: { id: 'gid://shopify/Shop/9', currencyCode: 'USD', ianaTimezone: 'UTC' } } }),
      );
    }
    if (query.includes('InsigniaReadPublicConfig')) {
      publicReads++;
      return new Response(JSON.stringify({ data: { shop: { id: 'gid://shopify/Shop/9', field: null } } }));
    }
    return originalFetch(url, options);
  };
  await assert.rejects(
    createProductionBuyerServices(input).config(new Request(signed())),
    /Public Function config missing/,
  );
  assert.equal(contextReads, 1);
  assert.equal(publicReads, 1);
});
