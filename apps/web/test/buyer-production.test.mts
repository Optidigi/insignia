import type {
  AcceptedQuote,
  ExpectedFunctionBuild,
  FunctionArtifactAttestation,
  QuoteRequest,
} from '@insignia/application';
import { type PublishedConfig, priceProposal } from '@insignia/domain';

type Input = Omit<ProductionBuyerInputs, 'core' | 'clock' | 'readVariantAvailability'> & {
  core: MutableCore;
  clock(): Date;
  readVariantAvailability: NonNullable<ProductionBuyerInputs['readVariantAvailability']>;
};

import assert from 'node:assert/strict';
import { createHash, createHmac, createPrivateKey, sign } from 'node:crypto';
import { test } from 'node:test';
import {
  buildPublicConfig,
  materialHash,
  publicKeyFingerprint,
  publicKeyFromSeed,
  sealSigningSeed,
} from '@insignia/application';
import { decodeEnvelope, issueWholeQuote } from '@insignia/cart-authorization';
import { createProductionBuyerServices, type ProductionBuyerInputs } from '../src/server/buyer/production.ts';
import { coreFixture, effectiveRevision, type MutableCore, record, required, text } from './http-fixtures.mts';

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
  const core = coreFixture({
    buyers: {},
    artwork: {},
    tenants: {
      getShopByDomain: async () => ({
        shopId: 'tenant',
        shopDomain: scope.shopDomain,
        shopifyShopId: '9',
        currentGeneration: generation,
      }),
      getCurrentAdminInstallation: async () => ({ active: true, generation, externalInstallationId: null }),
      getActiveAuthorizationScope: async (input) =>
        input.shopId === scope.shopId && input.installationGeneration === generation
          ? { ...scope, installationGeneration: generation }
          : null,
    },
    acceptedQuotes: {
      getEffective: async (_shop, product) => (product === '111' ? effectiveRevision() : null),
    },
    signingKeys: { list: async () => [] },
  });
  const input: Input = {
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
    advance: (ms: number) => {
      clock += ms;
    },
    changeGeneration: () => {
      generation = '2';
    },
  };
}

test('production factory requires server-owned resource, commercial and readiness ports', () => {
  const { input } = fixture();
  // @ts-expect-error Deliberately omit the required server credential authority.
  assert.throws(() => createProductionBuyerServices({ ...input, credentials: undefined }), /configuration/i);
  // @ts-expect-error Deliberately omit independent release evidence.
  assert.throws(() => createProductionBuyerServices({ ...input, artifactPorts: undefined }), /configuration/i);
  // @ts-expect-error A boolean cannot supply independent inventory authority.
  assert.throws(() => createProductionBuyerServices({ ...input, readVariantAvailability: true }), /configuration/i);
});

test('valid Lean acceptance uses passive primary reads under its lock and rejects final context drift without a fact', async () => {
  for (const drift of [false, true]) {
    const { input } = catalogFixture(),
      now = input.clock();
    const scope = { shopId: 'tenant', installationGeneration: '1', ownerHash: 'f'.repeat(64) };
    const keyScope = {
      shopId: 'tenant',
      installationGeneration: '1',
      authorizationGeneration: '11111111-1111-4111-8111-111111111111',
      authorizationEpoch: 1,
    };
    const seed = Buffer.alloc(32, 2),
      publicKey = publicKeyFromSeed(seed);
    const key: Awaited<ReturnType<MutableCore['signingKeys']['list']>>[number] = {
      ...keyScope,
      id: 7,
      keyId: 7,
      state: 'active',
      publicKey,
      publicKeyFingerprint: publicKeyFingerprint(publicKey),
      firstDay: 20000,
      lastDay: 23000,
      privateEnvelope: sealSigningSeed(input.ring, keyScope, 7, seed),
      wrappingKeyId: input.ring.currentKeyId,
    };
    input.core.signingKeys.getActiveScope = async () => keyScope;
    input.core.signingKeys.list = async () => [key];
    const publicConfig = buildPublicConfig({ scope: keyScope, keys: [key] });
    const config: PublishedConfig = {
      version: 'm2-published-config-v1',
      shopId: 'tenant',
      productId: '111',
      revisionId: 'revision',
      revisionContentHash: 'a'.repeat(64),
      shopCurrency: 'USD',
      methods: [{ id: 'print' }],
      placements: [{ id: 'front', allowedMethodIds: ['print'], allowedStepIds: ['small'], logoLaterAllowed: true }],
      productionOptions: [],
      pricingRules: [
        {
          id: 'unit',
          scope: { kind: 'step', placementId: 'front', methodId: 'print', stepId: 'small' },
          role: 'unit',
          rate: { kind: 'fixed', amount: { shopDecimal: '3.00', presentmentOverrides: [] } },
        },
      ],
    };
    let insideLock = false,
      facts = 0,
      passivePrimaryReads = 0,
      refreshReadsInsideLock = 0,
      proposal: Awaited<ReturnType<MutableCore['buyers']['getProposal']>> = null;
    const originalCredential = input.credentials.acquire;
    input.credentials.acquire = async (target) => {
      if (insideLock) refreshReadsInsideLock++;
      assert.equal(insideLock, false, 'refresh-capable credential lifecycle must never run under acceptance locks');
      return originalCredential(target);
    };
    input.passiveCredentials = {
      acquire: async (target) => {
        assert.equal(insideLock, true);
        return { ...(await originalCredential(target)), accessToken: 'synthetic-passive-token' };
      },
    };
    input.core.acceptedQuotes = {
      ...input.core.acceptedQuotes,
      getEffective: async () => ({ config, configId: 'config', operationId: 'publication' }),
      findCompleted: async () => null,
      accept: async (_target, commit) => {
        insideLock = true;
        try {
          const result = await commit();
          facts++;
          return result;
        } finally {
          insideLock = false;
        }
      },
    };
    input.core.tenants.getActiveProviderScope = async () => ({
      shopId: 'tenant',
      installationGeneration: '1',
      shopifyShopId: '9',
      shopDomain: 'buyer.myshopify.com',
    });
    input.core.artwork.readUsability = async (_scope, ids) => {
      assert.deepEqual(ids, []);
      return [];
    };
    input.core.buyers = {
      ...input.core.buyers,
      getSession: async () => ({ sessionId: 'session', expiresAt: new Date(+now + 7 * 86400000) }),
      putProposal: async (_scope, value) => {
        proposal = value;
        return value;
      },
      getLatestOwnedQuote: async () => null,
      getProposal: async () => proposal,
      reserveCommand: async () => ({ applicationId: null }),
      linkQuote: async () => {},
      finishApplication: async () => ({ applicationId: 'application' }),
    };
    input.entitlementPolicy = {
      policyVersion: 'synthetic-flat',
      maxAgeMs: 300000,
      plans: [{ billing: 'recurring-only', planHandle: 'flat', policyId: 'lean', features: [] }],
    };
    input.readSubscription = async () => ({
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
      items: [
        {
          handle: 'flat',
          price: { kind: 'flat', providerTypename: 'FlatRatePrice', active: false, currency: 'USD', amount: '49.99' },
          discount: null,
          usage: null,
        },
      ],
    });
    const build: Extract<ExpectedFunctionBuild, { schemaVersion: 2 }> = {
      schemaVersion: 2,
      shopId: 'tenant',
      installationGeneration: '1',
      appClientId: 'synthetic-app-key',
      sourceCommit: 'a'.repeat(40),
      appVersionRef: '100',
      devPreviewRef: null,
      transform: {
        functionId: 'transform',
        handle: 'insignia-experimental-v2-transform',
        apiType: 'cart_transform',
        apiVersion: '2026-07',
        inputQuerySha256: 'a'.repeat(64),
        wasmSha256: 'c'.repeat(64),
      },
      validation: {
        functionId: 'validation',
        handle: 'insignia-experimental-v2-validation',
        apiType: 'cart_checkout_validation',
        apiVersion: '2026-07',
        inputQuerySha256: 'b'.repeat(64),
        wasmSha256: 'd'.repeat(64),
      },
      targetModules: {
        transform: { moduleId: 'module-t', target: 'cart.transform.run', export: 'cart_transform_run' },
        validation: {
          moduleId: 'module-v',
          target: 'cart.validations.generate.run',
          export: 'cart_validations_generate_run',
        },
      },
    };
    const attestation: FunctionArtifactAttestation = {
      ...build,
      appVersionRef: '100',
      devPreviewRef: null,
      evidenceKind: 'RELEASE_BOUND',
      observedAt: now.toISOString(),
      targetObservedAt: now.toISOString(),
      expiresAt: new Date(+now + 30000).toISOString(),
    };
    input.artifactPorts = {
      expectedBuild: {
        read: async () => {
          assert.equal(insideLock, false);
          return build;
        },
      },
      trustedEvidence: {
        read: async () => {
          assert.equal(insideLock, false);
          return attestation;
        },
      },
    };
    input.passiveArtifactPorts = {
      expectedBuild: {
        read: async () => {
          assert.equal(insideLock, true);
          return build;
        },
      },
      trustedEvidence: {
        read: async () => {
          assert.equal(insideLock, true);
          return attestation;
        },
      },
    };
    const originalAvailability = input.readVariantAvailability;
    input.readVariantAvailability = async (target) => {
      const result = await originalAvailability(target);
      return {
        ...result,
        variants: result.variants.map((variant, index) => (index === 0 ? { ...variant, available: true } : variant)),
      };
    };
    input.fetchImpl = async (_url, options) => {
      assert(options);
      assert.equal(
        new Headers(options.headers).get('x-shopify-access-token'),
        insideLock ? 'synthetic-passive-token' : 'synthetic-offline-token',
      );
      assert(typeof options.body === 'string');
      const query = text(record(JSON.parse(text(required(options).body))).query);
      assert.ok(query.trimStart().startsWith('query'));
      let data: unknown;
      if (query.includes('LeanPrimaryMarket')) {
        if (insideLock) passivePrimaryReads++;
        data = {
          shop: { id: 'gid://shopify/Shop/9', currencyCode: 'USD' },
          primaryMarket: {
            id: `gid://shopify/Market/${insideLock && drift ? '43' : '42'}`,
            status: 'ACTIVE',
            conditions: {
              regionsCondition: {
                regions: {
                  nodes: [{ __typename: 'MarketRegionCountry', code: 'US' }],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        };
      } else if (query.includes('InsigniaShopContext'))
        data = { shop: { id: 'gid://shopify/Shop/9', currencyCode: 'USD', ianaTimezone: 'UTC' } };
      else if (query.includes('InsigniaReadPublicConfig'))
        data = {
          shop: {
            id: 'gid://shopify/Shop/9',
            field: {
              owner: { id: 'gid://shopify/Shop/9' },
              namespace: 'app--7',
              key: 'insignia_public_config_v2',
              type: 'json',
              value: publicConfig.value,
              compareDigest: '1'.repeat(64),
            },
          },
        };
      else if (query.includes('InsigniaOwnedFunctions')) {
        const functions = [build.transform, build.validation].map(
          ({ functionId: id, inputQuerySha256: _q, wasmSha256: _w, ...value }) => ({
            ...value,
            id,
            appKey: 'synthetic-app-key',
            inputQuery: null,
          }),
        );
        data = {
          shop: { id: 'gid://shopify/Shop/9' },
          shopifyFunctions: { nodes: functions, pageInfo: { hasNextPage: false } },
          cartTransforms: {
            nodes: [{ id: 'transform-deployment', functionId: 'transform', blockOnFailure: true }],
            pageInfo: { hasNextPage: false },
          },
          validations: {
            nodes: [
              { id: 'validation-deployment', enabled: true, blockOnFailure: true, shopifyFunction: functions[1] },
            ],
            pageInfo: { hasNextPage: false },
          },
        };
      } else if (query.includes('M5001Product'))
        data = {
          product: {
            id: 'gid://shopify/Product/111',
            title: 'Owned',
            status: 'ACTIVE',
            featuredMedia: null,
            variants: {
              nodes: [{ id: 'gid://shopify/ProductVariant/222', title: 'Blue M', selectedOptions: [], image: null }],
              pageInfo: { hasNextPage: false },
            },
          },
        };
      else if (query.includes('contextualPricing'))
        data = {
          nodes: [
            {
              __typename: 'ProductVariant',
              id: 'gid://shopify/ProductVariant/222',
              product: { id: 'gid://shopify/Product/111' },
              contextualPricing: { price: { amount: '10.00', currencyCode: 'USD' } },
            },
          ],
        };
      else assert.fail(`Unexpected boundary query: ${query}`);
      return new Response(JSON.stringify({ data }), { headers: { 'x-shopify-api-version': '2026-07' } });
    };
    const services = createProductionBuyerServices(input);
    const result = await services.propose(scope, {
      country: 'US',
      marketId: '42',
      capacity: { ordinaryLineCount: 0, inputBytes: 100 },
      groups: [
        {
          productId: '111',
          configRevisionId: 'revision',
          revisionContentHash: 'a'.repeat(64),
          design: {
            placements: [
              {
                placementId: 'front',
                methodId: 'print',
                stepId: 'small',
                artwork: { kind: 'deferred', intentId: 'later' },
              },
            ],
            options: [],
          },
          variants: [{ variantId: '222', quantity: 1 }],
        },
      ],
    });
    assert.equal(result.totalMinor, '1300');
    const accept = () => services.accept(scope, result.proposalId, { hash: result.hash, idempotencyKey: 'accept' });
    if (drift) {
      await assert.rejects(accept, /Lean primary-Market context unavailable/);
      assert.equal(facts, 0);
    } else {
      const accepted = await accept();
      assert.equal(facts, 1);
      assert.equal(
        decodeEnvelope(required(required(accepted.buckets[0]).properties._insignia_quote_v2)).header.totalMinor,
        '1300',
      );
    }
    assert.ok(passivePrimaryReads >= 1);
    assert.equal(refreshReadsInsideLock, 0);
  }
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
  const original = required(await verification());
  assert.equal(original.shopId, 'tenant');
  fixtureValue.advance(5 * 86400000);
  assert.equal(required(await verification()).ownerHash, original.ownerHash);
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
    ...effectiveRevision(),
    config: {
      ...effectiveRevision().config,
      revisionId: 'revision',
      revisionContentHash: 'a'.repeat(64),
      methods: [{ id: 'print' }],
      placements: [],
      productionOptions: [],
    },
  });
  input.core.configs = {
    ...input.core.configs,
    getRevisionGeometry: async () => ({
      version: 'm5-geometry-v1',
      contentHash: 'a'.repeat(64),
      mode: 'optional',
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
      version: 'm5-presentation-v1',
      labels: { methods: {}, placements: {}, steps: {}, options: {}, values: {} },
    }),
  };
  input.core.signingKeys.list = async () => [
    {
      ...scope,
      authorizationGeneration: '11111111-1111-4111-8111-111111111111',
      state: 'active',
      keyId: 7,
      id: 7,
      publicKey: new Uint8Array(32),
      publicKeyFingerprint: 'a'.repeat(64),
      firstDay: 0,
      lastDay: 30000,
      privateEnvelope: null,
      wrappingKeyId: null,
    },
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
    assert.equal(new Headers(required(options).headers).get('X-Shopify-Access-Token'), 'synthetic-offline-token');
    assert.equal(required(options).redirect, 'error');
    const body = record(JSON.parse(text(required(options).body)));
    assert.equal(record(body.variables).id, 'gid://shopify/Product/111');
    return new Response(
      JSON.stringify({
        data: {
          product: {
            id: record(body.variables).id,
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
    return required(originalFetch)(...args);
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
    return required(originalFetch)(...args);
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
  const defaultInput: ProductionBuyerInputs = { ...input };
  delete defaultInput.readVariantAvailability;
  let availabilityReads = 0;
  input.fetchImpl = async (url, options) => {
    const body = record(JSON.parse(text(required(options).body)));
    if (text(body.query).includes('InsigniaVariantAvailability')) {
      availabilityReads++;
      assert.equal(url, 'https://buyer.myshopify.com/admin/api/2026-07/graphql.json');
      assert.deepEqual(body.variables, { ids: ['gid://shopify/ProductVariant/222'] });
      assert.equal(required(options).redirect, 'error');
      return new Response(
        JSON.stringify({
          data: {
            nodes: [
              {
                id: 'gid://shopify/ProductVariant/222',
                availableForSale: false,
                product: { id: 'gid://shopify/Product/111', status: 'ACTIVE' },
              },
            ],
          },
        }),
      );
    }
    return required(originalFetch)(url, options);
  };
  defaultInput.fetchImpl = input.fetchImpl;
  const config = await createProductionBuyerServices(defaultInput).config(new Request(signed()));
  assert.equal(availabilityReads, 1);
  assert.equal(required(config.variants[0]).available, false);
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
      privateEnvelope: null,
      wrappingKeyId: null,
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
      ...effectiveRevision().config,
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
    const query = text(record(JSON.parse(text(required(options).body))).query);
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
    return required(originalFetch)(url, options);
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
    input.core.configs.getRevisionGeometry = async () => ({
      version: 'm5-geometry-v1',
      contentHash: 'a'.repeat(64),
      mode: 'optional',
      value: publishedGeometry,
    });
    const read = input.fetchImpl;
    input.fetchImpl = async (...args) => {
      const data = record(await (await required(read)(...args)).json());
      const product = record(record(data.data).product);
      const nodes = record(product.variants).nodes;
      assert.ok(Array.isArray(nodes));
      nodes[0] = {
        ...record(nodes[0]),
        image: imageCase === 'variant' ? { url: 'https://cdn.shopify.com/synthetic/blue.png', altText: null } : null,
      };
      if (imageCase === 'missing') product.featuredMedia = null;
      data.data = { ...record(data.data), product };
      return new Response(JSON.stringify(data), { status: 200 });
    };
    const config = await createProductionBuyerServices(input).config(new Request(signed()));
    const scene = buildBuyerScene({
      geometry: config.geometry,
      viewId: 'front',
      variantId: required(config.variants[0]).id,
      selectedPlacementId: 'chest',
      placements: [{ placementId: 'chest', stepId: 'small', artwork: { kind: 'deferred', intentId: 'later' } }],
      previews: {},
      imageUrls: config.imageUrls,
    });
    assert.equal(
      required(scene.image).revisionId,
      'variant_222',
      'the actual selected variant uses its configured image revision',
    );
    assert.equal(
      required(scene.image).url,
      imageCase === 'variant'
        ? 'https://cdn.shopify.com/synthetic/blue.png'
        : imageCase === 'fallback'
          ? 'https://cdn.shopify.com/synthetic/product.png'
          : undefined,
    );
    assert.deepEqual(required(scene.placements[0]).bounds, { x: 251.25, y: 140, width: 35, height: 70 });
    assert.deepEqual(required(scene.artworks[0]).bounds, required(scene.placements[0]).bounds);
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
    input.core.configs.getRevisionGeometry = async () => ({
      version: 'm5-geometry-v1',
      contentHash: 'a'.repeat(64),
      mode: 'optional',
      value: original,
    });
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
    input.core.configs.getRevisionGeometry = async () => ({
      version: 'm5-geometry-v1',
      contentHash: 'a'.repeat(64),
      mode: 'optional',
      value: original,
    });
    await assert.rejects(createProductionBuyerServices(input).config(new Request(signed())), /variant ID/);
    assert.deepEqual(original, before, 'ambiguous projection never mutates historical geometry');
  }
});

test('production frozen-preview mode never fills an uncaptured revision from the current Shopify photo', async () => {
  const { input } = catalogFixture();
  input.env.INSIGNIA_M8_MERCHANT_PREVIEWS_ENABLED = '1';
  const bindings: unknown[] = [];
  input.core.merchantPreviews = {
    ...input.core.merchantPreviews,
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
test('production buyer reads actual primary context before Lean pricing on propose, accept and renew', async () => {
  for (const scenario of [
    'propose',
    'accept',
    'renew',
    'completed-replay',
    'propose:other-market',
    'propose:other-country',
    'propose:currency',
    'propose:provider-error',
    'propose:reauthorized',
  ]) {
    const [operation, contextCase = 'primary'] = scenario.split(':');
    const { input } = catalogFixture();
    const now = input.clock();
    const scope = { shopId: 'tenant', installationGeneration: '1', ownerHash: 'f'.repeat(64) };
    const hash = 'a'.repeat(64);
    const config: PublishedConfig = {
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
    const group: Parameters<ReturnType<typeof createProductionBuyerServices>['propose']>[1]['groups'][number] = {
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
    const request: QuoteRequest = {
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
    input.core.tenants.getActiveProviderScope = async () => ({
      ...scope,
      shopifyShopId: '9',
      shopDomain: 'buyer.myshopify.com',
    });
    input.core.acceptedQuotes.getEffective = async () => ({ config, configId: 'config', operationId: 'publication' });
    input.core.acceptedQuotes.findCompleted = async () => null;
    input.core.acceptedQuotes.accept = async () => {
      quoteWrites++;
      throw new Error('Unexpected acceptance write');
    };
    input.core.buyers = {
      ...input.core.buyers,
      getProposal: async () => ({
        id: 'proposal',
        requestDigest: hash,
        candidate: null,
        materialHash: hash,
        request,
        expiresAt: new Date(+now + 300000),
      }),
      reserveCommand: async () => ({ applicationId: null }),
      putProposal: async () => {
        proposalWrites++;
        throw new Error('Unexpected proposal write');
      },
    };
    // Price the retained historical revision with the actual domain engine; the new Lean admission remains excluded below.
    const priced = priceProposal({
      shopId: scope.shopId,
      groups: request.groups.map((item) => item.group),
      configs: [config],
      bases: [
        {
          shopId: scope.shopId,
          productId: '111',
          variantId: '222',
          currency: 'USD',
          minor: '0',
          contextId: 'retained',
        },
      ],
      currency: { version: 'm2-currency-resolution-v1', presentmentCurrency: 'USD', exponents: { USD: 2 } },
      effectiveAt: now.toISOString(),
      marketContext: '42',
      roundingPolicy: 'm2-half-even-v1',
    });
    const identityHash = (value: string) => createHash('sha256').update(value).digest('hex');
    const acceptedDay = Math.floor(+now / 86400000);
    const original: AcceptedQuote = {
      schemaVersion: 'm4-accepted-quote-v1',
      quoteId: '22222222-2222-4222-8222-222222222222',
      shopId: scope.shopId,
      installationGeneration: scope.installationGeneration,
      authorizationGeneration: '11111111-1111-4111-8111-111111111111',
      authorizationEpoch: 1,
      acceptedAt: now.toISOString(),
      acceptedDate: now.toISOString().slice(0, 10),
      acceptedDay,
      validThroughDay: acceptedDay + 2,
      country: 'US',
      marketId: '42',
      shopCurrency: 'USD',
      shopTimezone: 'UTC',
      presentmentCurrency: 'USD',
      presentmentExponent: 2,
      policyVersion: 'retained',
      recognizedPolicyId: 'lean',
      trial: false,
      qualifyingUsageDisposition: 'NOT_METERED',
      physicalGroups: request.groups.map(({ group }) => ({
        productId: group.productId,
        configRevisionId: group.configRevisionId,
        revisionContentHash: group.revisionContentHash,
        canonicalIdentitySha256: identityHash(required(priced.groups[0]).canonicalIdentity),
        variants: group.variants,
      })),
      economics: {
        ...priced,
        version: 'm4-quote-economics-v1',
        groups: priced.groups.map(({ canonicalIdentity, ...value }) => ({
          ...value,
          canonicalIdentitySha256: identityHash(canonicalIdentity),
        })),
        lines: priced.lines.map(({ canonicalIdentity, ...value }) => ({
          ...value,
          canonicalIdentitySha256: identityHash(canonicalIdentity),
        })),
      },
      artworkChecks: [],
      effectiveRevisions: [],
      catalogSnapshots: [],
      fxSnapshot: null,
    };
    if (operation === 'completed-replay') {
      const key = createPrivateKey({
        key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, 7)]),
        format: 'der',
        type: 'pkcs8',
      });
      const setId = '33333333-3333-4333-8333-333333333333';
      const issued = await issueWholeQuote(
        {
          keyId: 7,
          generationHex: original.authorizationGeneration.replaceAll('-', ''),
          epoch: 1,
          quoteHex: original.quoteId.replaceAll('-', ''),
          setHex: setId.replaceAll('-', ''),
          count: original.economics.lines.length,
          currency: 'USD',
          exponent: 2,
          country: 'US',
          marketId: '42',
          validThroughDay: acceptedDay + 2,
          totalQuantity: original.economics.customizedQuantity,
          totalMinor: original.economics.totalMinor,
        },
        original.economics.lines.map((line, index) => ({
          index,
          variantId: line.variantId,
          quantity: line.quantity,
          unitMinor: line.unitPriceMinor,
        })),
        acceptedDay,
        {
          signWholeQuote: async (input) => ({
            keyId: input.keyId,
            publicKeyFingerprint: publicKeyFingerprint(publicKeyFromSeed(Buffer.alloc(32, 7))),
            firstValidDay: acceptedDay,
            lastValidDay: acceptedDay + 2,
            signature: sign(null, input.message, key),
          }),
        },
      );
      const completed = {
        quote: original,
        authorization: {
          ...issued,
          setId,
          validThroughDay: acceptedDay + 2,
          envelopeCarrier: issued.envelope,
          members: issued.members.map((carrier, lineIndex) => ({ lineIndex, carrier })),
        },
      };
      input.core.acceptedQuotes.findCompleted = async () => completed;
      input.core.buyers.getProposal = async () => ({
        id: 'proposal',
        requestDigest: hash,
        candidate: null,
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
          properties: { _insignia_quote_v2: issued.envelope, _insignia_member_v2: required(issued.members[0]) },
        },
      ]);
      assert.equal(required(original.economics.groups[0]).setupMinor, '300');
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
        items: [
          {
            handle: 'flat',
            price: { kind: 'flat', providerTypename: 'FlatRatePrice', active: false, currency: 'USD', amount: '49.99' },
            discount: null,
            usage: null,
          },
        ],
      };
    };
    if (contextCase === 'other-market') desired.marketId = request.marketId = '43';
    if (contextCase === 'other-country') desired.country = request.country = 'GB';
    let reauthorized = false;
    const getActive = input.core.tenants.getActiveAuthorizationScope;
    input.core.tenants.getActiveAuthorizationScope = async (target) => {
      const current = await getActive(target);
      return current ? { ...current, authorizationEpoch: reauthorized ? 2 : 1 } : null;
    };
    let primaryReads = 0;
    input.fetchImpl = async (_url, options) => {
      const body = record(JSON.parse(text(required(options).body)));
      assert.ok(text(body.query).trimStart().startsWith('query'), 'the production probe performs reads only');
      if (text(body.query).includes('InsigniaShopContext'))
        return new Response(
          JSON.stringify({
            data: {
              shop: { id: 'gid://shopify/Shop/9', currencyCode: 'USD', ianaTimezone: 'UTC' },
            },
          }),
        );
      if (text(body.query).includes('LeanPrimaryMarket')) {
        primaryReads++;
        if (contextCase === 'provider-error') return new Response('{}', { status: 503 });
        if (contextCase === 'reauthorized') reauthorized = true;
        return new Response(
          JSON.stringify({
            data: {
              shop: { id: 'gid://shopify/Shop/9', currencyCode: 'USD' },
              primaryMarket: {
                id: 'gid://shopify/Market/42',
                status: 'ACTIVE',
                conditions: {
                  regionsCondition: {
                    regions: {
                      nodes: [{ __typename: 'MarketRegionCountry', code: 'US' }],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                },
              },
            },
          }),
          { headers: { 'x-shopify-api-version': '2026-07' } },
        );
      }
      catalogReads++;
      assert.deepEqual(body.variables, { ids: ['gid://shopify/ProductVariant/222'], country: desired.country });
      return new Response(
        JSON.stringify({
          data: {
            nodes: [
              {
                __typename: 'ProductVariant',
                id: 'gid://shopify/ProductVariant/222',
                product: { id: 'gid://shopify/Product/111' },
                contextualPricing: {
                  price: { amount: '10.00', currencyCode: contextCase === 'currency' ? 'EUR' : 'USD' },
                },
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
    const expected =
      contextCase === 'primary'
        ? /Lean prices require one final nonnegative/
        : contextCase === 'provider-error'
          ? /Primary Market unavailable: provider_error/
          : contextCase === 'reauthorized'
            ? /Buyer Lean context authority changed/
            : /Lean primary-Market context unavailable/;
    await assert.rejects(act, expected, scenario);
    assert.equal(primaryReads, contextCase === 'currency' ? 0 : 1, scenario);
    assert.equal(subscriptionReads, 1, operation);
    assert.equal(catalogReads, 1, operation);
    assert.equal(quoteWrites, 0, operation);
    assert.equal(proposalWrites, 0, operation);
    assert.equal(artworkReads, 0, operation);
    assert.equal(required(config.pricingRules[0]).role, 'setup', 'historical advanced revision remains untouched');
  }
});
