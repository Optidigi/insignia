import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { materialHash, publicKeyFingerprint, publicKeyFromSeed } from '@insignia/application';
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

test('published editor variant geometry reaches the buyer renderer with the selected image, fallback and placement', async () => {
  const { buildBuyerScene } = await import('../../storefront/src/buyer.ts');
  for (const imageCase of ['variant', 'fallback', 'missing']) {
    const { input } = catalogFixture();
    const publishedGeometry = {
      version: 'm5-geometry-v1',
      views: [
        {
          id: 'front',
          image: { revisionId: 'product_111', width: 100, height: 100 },
          variantImages: [{ variantId: 'variant_222', image: { revisionId: 'variant_222', width: 100, height: 200 } }],
          placements: [
            {
              id: 'chest',
              rect: { centerX: 0.5, centerY: 0.5, width: 0.4, height: 0.4 },
              variantOverrides: [
                { variantId: 'variant_222', rect: { centerX: 0.75, centerY: 0.5, width: 0.2, height: 0.2 } },
              ],
            },
          ],
        },
      ],
      steps: [{ id: 'small', widthFraction: 1, heightFraction: 1 }],
    };
    const original = structuredClone(publishedGeometry);
    input.core.configs.getRevisionGeometry = async () => ({ value: publishedGeometry });
    const read = input.fetchImpl;
    input.fetchImpl = async (...args) => {
      const data = await (await read(...args)).json();
      data.data.product.variants.nodes[0].image =
        imageCase === 'variant' ? { url: 'https://cdn.shopify.com/synthetic/blue.png', altText: null } : null;
      if (imageCase === 'missing') data.data.product.featuredMedia = null;
      return new Response(JSON.stringify(data), { status: 200 });
    };
    const config = await createProductionBuyerServices(input).config(new Request(signed()));
    const scene = buildBuyerScene({
      geometry: config.geometry,
      viewId: 'front',
      variantId: config.variants[0].id,
      selectedPlacementId: 'chest',
      placements: [{ placementId: 'chest', stepId: 'small', artwork: { kind: 'deferred', intentId: 'later' } }],
      previews: {},
      imageUrls: config.imageUrls,
    });
    assert.equal(
      scene.image.revisionId,
      'variant_222',
      'the actual selected variant uses its configured image revision',
    );
    assert.equal(
      scene.image.url,
      imageCase === 'variant'
        ? 'https://cdn.shopify.com/synthetic/blue.png'
        : imageCase === 'fallback'
          ? 'https://cdn.shopify.com/synthetic/product.png'
          : undefined,
    );
    assert.deepEqual(scene.placements[0].bounds, { x: 251.25, y: 140, width: 35, height: 70 });
    assert.deepEqual(scene.artworks[0].bounds, scene.placements[0].bounds);
    assert.equal(config.contentHash, 'a'.repeat(64));
    assert.equal(config.revisionId, 'revision');
    assert.deepEqual(config.variants, [{ id: '222', label: 'Blue M', available: false }]);
    assert.deepEqual(
      publishedGeometry,
      original,
      'stored geometry, image references and placement coordinates are never rewritten',
    );
  }
});

test('buyer geometry preserves numeric and non-editor selectors and rejects ambiguous canonical aliases', async () => {
  for (const selector of ['222', 'legacy_blue', 'variant_0222']) {
    const { input } = catalogFixture();
    const original = {
      version: 'm5-geometry-v1',
      views: [
        {
          id: 'front',
          image: null,
          variantImages: [{ variantId: selector, image: { revisionId: 'retained-image', width: 100, height: 200 } }],
          placements: [
            {
              id: 'chest',
              rect: { centerX: 0.5, centerY: 0.5, width: 0.4, height: 0.4 },
              variantOverrides: [
                { variantId: selector, rect: { centerX: 0.75, centerY: 0.5, width: 0.2, height: 0.2 } },
              ],
            },
          ],
        },
      ],
      steps: [],
    };
    input.core.configs.getRevisionGeometry = async () => ({ value: original });
    const config = await createProductionBuyerServices(input).config(new Request(signed()));
    assert.deepEqual(config.geometry, original);
  }
  for (const collision of ['image', 'placement']) {
    const { input } = catalogFixture();
    const original = {
      version: 'm5-geometry-v1',
      views: [
        {
          id: 'front',
          image: null,
          variantImages:
            collision === 'image'
              ? ['222', 'variant_222'].map((variantId) => ({
                  variantId,
                  image: { revisionId: variantId, width: 100, height: 100 },
                }))
              : [],
          placements: [
            {
              id: 'chest',
              rect: { centerX: 0.5, centerY: 0.5, width: 0.4, height: 0.4 },
              variantOverrides:
                collision === 'placement'
                  ? ['222', 'variant_222'].map((variantId) => ({
                      variantId,
                      rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 },
                    }))
                  : [],
            },
          ],
        },
      ],
      steps: [],
    };
    const before = structuredClone(original);
    input.core.configs.getRevisionGeometry = async () => ({ value: original });
    await assert.rejects(createProductionBuyerServices(input).config(new Request(signed())), /variant ID/);
    assert.deepEqual(original, before, 'ambiguous projection never mutates historical geometry');
  }
});

test('production frozen-preview mode never fills an uncaptured revision from the current Shopify photo', async () => {
  const { input } = catalogFixture();
  input.env.INSIGNIA_M8_MERCHANT_PREVIEWS_ENABLED = '1';
  const bindings = [];
  input.core.merchantPreviews = {
    async getForRevision(scope, target) {
      bindings.push({ scope, target });
      return [];
    },
  };
  const config = await createProductionBuyerServices(input).config(new Request(signed()));
  assert.deepEqual(config.imageUrls, {});
  assert.deepEqual(bindings, [
    {
      scope: { shopId: 'tenant', installationGeneration: '1', productId: '111' },
      target: { productId: '111', revisionId: 'revision' },
    },
  ]);
});

// Exercise production composition through the same public proposal/acceptance boundary used by HTTP.
// Only the external provider and durable repositories are synthetic; no quote ports are replaced.
test('production buyer refuses new offers without independent Lean qualification, including saved advanced proposals', async () => {
  for (const operation of ['propose', 'accept', 'renew', 'completed-replay']) {
    const { input } = catalogFixture();
    const now = input.clock();
    const scope = { shopId: 'tenant', installationGeneration: '1', ownerHash: 'f'.repeat(64) };
    const hash = 'a'.repeat(64);
    const config = {
      version: 'm2-published-config-v1',
      shopId: 'tenant',
      productId: '111',
      revisionId: 'revision',
      revisionContentHash: hash,
      shopCurrency: 'USD',
      methods: [{ id: 'print' }],
      placements: [{ id: 'front', allowedMethodIds: ['print'], allowedStepIds: ['small'], logoLaterAllowed: false }],
      productionOptions: [],
      pricingRules: [
        {
          id: 'advanced-setup',
          scope: { kind: 'general' },
          role: 'setup',
          rate: { kind: 'fixed', amount: { shopDecimal: '3.00', presentmentOverrides: [] } },
        },
      ],
    };
    const group = {
      productId: '111',
      configRevisionId: 'revision',
      revisionContentHash: hash,
      design: {
        placements: [
          {
            placementId: 'front',
            methodId: 'print',
            stepId: 'small',
            artwork: { kind: 'revision', revisionId: 'original-art' },
          },
        ],
        options: [],
      },
      variants: [{ variantId: '222', quantity: 1 }],
    };
    const desired = {
      country: 'US',
      marketId: '42',
      capacity: { ordinaryLineCount: 0, inputBytes: 100 },
      groups: [group],
    };
    const request = {
      ...desired,
      ...scope,
      idempotencyKey: 'saved',
      groups: [{ group: { ...group, shopId: 'tenant', version: 'm2-customization-group-v1' } }],
    };
    let catalogReads = 0,
      subscriptionReads = 0,
      quoteWrites = 0,
      proposalWrites = 0,
      artworkReads = 0;
    input.core.tenants.getActiveProviderScope = async () => ({ ...scope, shopifyShopId: '9' });
    input.core.acceptedQuotes.getEffective = async () => ({ config, configId: 'config', operationId: 'publication' });
    input.core.acceptedQuotes.findCompleted = async () => null;
    input.core.acceptedQuotes.accept = async () => {
      quoteWrites++;
      throw new Error('Unexpected acceptance write');
    };
    input.core.buyers = {
      getProposal: async () => ({ materialHash: hash, request, expiresAt: new Date(+now + 300000) }),
      reserveCommand: async () => {},
      putProposal: async () => {
        proposalWrites++;
        throw new Error('Unexpected proposal write');
      },
    };
    const original = {
      quoteId: '22222222-2222-4222-8222-222222222222',
      ...scope,
      authorizationGeneration: '11111111-1111-4111-8111-111111111111',
      authorizationEpoch: 1,
      economics: { groups: [{ setupMinor: '300', variants: [] }], lines: [{ variantId: '222', quantity: 1 }] },
      artworkChecks: [],
      effectiveRevisions: [],
      catalogSnapshots: [],
    };
    if (operation === 'completed-replay') {
      const completed = {
        quote: original,
        authorization: {
          setId: 'old-set',
          validThroughDay: 23000,
          envelopeCarrier: 'old-signed-envelope',
          members: [{ lineIndex: 0, carrier: 'old-signed-member' }],
        },
      };
      input.core.acceptedQuotes.findCompleted = async () => completed;
      input.core.buyers.getProposal = async () => ({
        materialHash: materialHash(original),
        request,
        expiresAt: new Date(+now - 1000),
      });
      input.core.buyers.linkQuote = async () => {};
      input.core.buyers.finishApplication = async () => ({ applicationId: 'old-application' });
      const result = await createProductionBuyerServices(input).accept(scope, 'proposal', {
        hash: materialHash(original),
        idempotencyKey: 'accept',
      });
      assert.equal(result.quoteId, original.quoteId);
      assert.deepEqual(result.buckets, [
        {
          variantId: '222',
          quantity: 1,
          properties: { _insignia_quote_v2: 'old-signed-envelope', _insignia_member_v2: 'old-signed-member' },
        },
      ]);
      assert.equal(original.economics.groups[0].setupMinor, '300');
      assert.equal(quoteWrites, 0);
      assert.equal(proposalWrites, 0);
      assert.equal(artworkReads, 0);
      continue;
    }
    input.core.renewalQuotes = {
      getOwned: async () => original,
      findCompleted: async () => null,
      renew: async () => {
        quoteWrites++;
        throw new Error('Unexpected renewal write');
      },
    };
    input.core.artwork.readUsability = async () => {
      artworkReads++;
      throw new Error('New advanced pricing reached artwork acceptance');
    };
    input.entitlementPolicy = {
      policyVersion: 'synthetic-flat',
      maxAgeMs: 300000,
      plans: [{ planHandle: 'flat', billing: 'recurring-only', policyId: 'lean', features: [] }],
    };
    input.readSubscription = async () => {
      subscriptionReads++;
      return {
        schemaVersion: 'm4-active-subscription-v1',
        sourceApiVersion: '2026-07',
        appId: 'gid://shopify/App/7',
        shopId: 'gid://shopify/Shop/9',
        observedAt: now.toISOString(),
        active: true,
        billingPeriod: 'EVERY_30_DAYS',
        cancelAtEndOfCycle: false,
        trialEndsAt: new Date(+now + 86400000).toISOString(),
        currentBillingCycle: null,
        pendingUpdate: null,
        items: [{ handle: 'flat', price: { kind: 'flat', active: false }, usage: null }],
      };
    };
    input.fetchImpl = async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.ok(body.query.trimStart().startsWith('query'), 'the production probe performs reads only');
      if (body.query.includes('InsigniaShopContext'))
        return new Response(
          JSON.stringify({
            data: {
              shop: { id: 'gid://shopify/Shop/9', currencyCode: 'USD', ianaTimezone: 'UTC' },
            },
          }),
        );
      catalogReads++;
      assert.deepEqual(body.variables, { ids: ['gid://shopify/ProductVariant/222'], country: 'US' });
      return new Response(
        JSON.stringify({
          data: {
            nodes: [
              {
                __typename: 'ProductVariant',
                id: 'gid://shopify/ProductVariant/222',
                product: { id: 'gid://shopify/Product/111' },
                contextualPricing: { price: { amount: '10.00', currencyCode: 'USD' } },
              },
            ],
          },
        }),
      );
    };
    const services = createProductionBuyerServices(input);
    const act =
      operation === 'propose'
        ? () => services.propose(scope, desired)
        : operation === 'accept'
          ? () => services.accept(scope, 'proposal', { hash, idempotencyKey: 'accept' })
          : () => services.renew(scope, original.quoteId, { ...desired, idempotencyKey: 'renew' });
    await assert.rejects(act, /Lean primary-Market and currency qualification unavailable/, operation);
    assert.equal(subscriptionReads, 1, operation);
    assert.equal(catalogReads, 1, operation);
    assert.equal(quoteWrites, 0, operation);
    assert.equal(proposalWrites, 0, operation);
    assert.equal(artworkReads, 0, operation);
    assert.equal(config.pricingRules[0].role, 'setup', 'historical advanced revision remains untouched');
  }
});
