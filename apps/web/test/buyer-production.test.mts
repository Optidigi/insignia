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
import { buildPublicConfig, materialHash, publicKeyFingerprint, publicKeyFromSeed } from '@insignia/application';
import { decodeLineCarrierV3, issueLineSetV3 } from '@insignia/cart-authorization';
import { createProductionBuyerServices, type ProductionBuyerInputs } from '../src/server/buyer/production.ts';
import { fixtureTransaction } from './admin/support/fixtures.mts';
import { coreFixture, effectiveRevision, type MutableCore, record, required, text } from './http-fixtures.mts';

const secret = 'synthetic-m7-private-capability';
/** Stands in for the signer process: signs the exact bytes with a fixed synthetic seed. */
const signerSeed = Buffer.alloc(32, 2);
function testSigner(): ProductionBuyerInputs['signer'] {
  const key = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), signerSeed]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = publicKeyFromSeed(signerSeed);
  return {
    sign: async () => {
      throw new Error('unused');
    },
    provision: async () => {
      throw new Error('unused');
    },
    authorizationSigner: (_scope, beforeSign) => ({
      async signWholeQuote(input) {
        await beforeSign?.(input);
        return {
          keyId: input.keyId,
          publicKeyFingerprint: publicKeyFingerprint(publicKey),
          firstValidDay: 20000,
          lastValidDay: 23000,
          signature: sign(null, input.message, key),
        };
      },
    }),
  };
}
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
    signer: testSigner(),
    entitlementPolicy: { policyVersion: 'synthetic', maxAgeMs: 300000, plans: [] },
    credentials: { acquire: async () => ({ kind: 'missing' }) },
    readSubscription: async () => {
      throw new Error('provider unavailable');
    },
    artifactPorts: { expectedBuild: { read: async () => null }, trustedEvidence: { read: async () => null } },
    expectedFunctions: { appKey: 'synthetic-app-key' },
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

const ACTIVE_ACQUISITIONS = 4;

test('valid Lean acceptance reads provider facts once before its lock and rejects acceptance-time drift without a fact', async () => {
  for (const drift of [
    false,
    true,
    'price',
    'stock',
    'overflow',
    'deleted',
    'duplicate',
    'malformed',
    '251',
    'inventory-missing',
    'inventory-extra',
    'inventory-duplicate',
    'inventory-malformed',
    'inventory-nonboolean',
    'inventory-nonarray',
    'inventory-scope',
    'inventory-product',
    'inventory-stale',
  ] as const) {
    const { input } = catalogFixture(),
      now = input.clock();
    const scope = { shopId: 'tenant', installationGeneration: '1', ownerHash: 'f'.repeat(64) };
    const keyScope = {
      shopId: 'tenant',
      installationGeneration: '1',
      authorizationGeneration: '11111111-1111-4111-8111-111111111111',
      authorizationEpoch: 1,
    };
    const publicKey = publicKeyFromSeed(signerSeed);
    const key: Awaited<ReturnType<MutableCore['signingKeys']['list']>>[number] = {
      ...keyScope,
      id: 7,
      keyId: 7,
      state: 'active',
      publicKey,
      publicKeyFingerprint: publicKeyFingerprint(publicKey),
      firstDay: 20000,
      lastDay: 23000,
      privateEnvelope: null,
      wrappingKeyId: 'synthetic-signer-wrap',
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
      accepting = false,
      inventoryDispatches = 0,
      activeAcquisitions = 0,
      passiveAcquisitions = 0,
      facts = 0,
      subscriptionReads = 0,
      artifactCollectionStarted = false,
      passivePrimaryReads = 0,
      refreshReadsInsideLock = 0,
      proposal: Awaited<ReturnType<MutableCore['buyers']['getProposal']>> = null;
    const originalCredential = input.credentials.acquire;
    input.credentials.acquire = async (target) => {
      activeAcquisitions++;
      if (insideLock) refreshReadsInsideLock++;
      assert.equal(insideLock, false, 'refresh-capable credential lifecycle must never run under acceptance locks');
      return originalCredential(target);
    };
    input.passiveCredentials = {
      acquire: async (target) => {
        // Provider reads complete before the signing fence; the SELECT-only source stays a guard.
        passiveAcquisitions++;
        return { ...(await originalCredential(target)), accessToken: 'synthetic-passive-token' };
      },
    };
    input.core.acceptedQuotes = {
      ...input.core.acceptedQuotes,
      getEffective: async () => ({ config, configId: 'config', operationId: 'publication' }),
      findCompleted: async () => null,
      resolveBuyerAcceptance: async () => ({ outcome: 'declined' }),
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
      commandDeclined: async () => false,
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
          artifactCollectionStarted = true;
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
          throw new Error('Release evidence is read once, before the signing fence');
        },
      },
      trustedEvidence: {
        read: async () => {
          throw new Error('Release evidence is read once, before the signing fence');
        },
      },
    };
    const originalAvailability = input.readVariantAvailability;
    input.readVariantAvailability = async (target) => {
      inventoryDispatches++;
      assert.equal(insideLock, false, 'no stock read under the signing fence');
      if (accepting) assert.notEqual(drift, 'overflow');
      if (accepting) assert.ok(!['deleted', 'duplicate', 'malformed', '251'].includes(String(drift)));
      assert.deepEqual(target.variantIds, ['gid://shopify/ProductVariant/222']);
      const result = await originalAvailability(target);
      const snapshot = {
        ...result,
        variants: result.variants.map((variant, index) =>
          index === 0 ? { ...variant, available: !(accepting && drift === 'stock') } : variant,
        ),
      };
      if (accepting) {
        if (drift === 'inventory-missing') snapshot.variants = [];
        if (drift === 'inventory-extra')
          snapshot.variants.push({ id: 'gid://shopify/ProductVariant/333', available: true });
        if (drift === 'inventory-duplicate') snapshot.variants.push({ ...snapshot.variants[0]! });
        if (drift === 'inventory-malformed') Reflect.set(snapshot.variants, 0, null);
        if (drift === 'inventory-nonboolean') Reflect.set(snapshot.variants[0]!, 'available', 'true');
        if (drift === 'inventory-nonarray') Reflect.set(snapshot, 'variants', {});
        if (drift === 'inventory-scope') snapshot.shopId = 'foreign';
        if (drift === 'inventory-product') snapshot.productId = 'gid://shopify/Product/112';
        if (drift === 'inventory-stale') snapshot.freshUntil = now.toISOString();
      }
      return snapshot;
    };
    input.fetchImpl = async (_url, options) => {
      assert(options);
      assert.equal(insideLock, false, 'no provider read under the signing fence');
      assert.equal(new Headers(options.headers).get('x-shopify-access-token'), 'synthetic-offline-token');
      assert(typeof options.body === 'string');
      const query = text(record(JSON.parse(text(required(options).body))).query);
      assert.ok(query.trimStart().startsWith('query'));
      let data: unknown;
      if (query.includes('LeanPrimaryMarket')) {
        if (accepting) passivePrimaryReads++;
        data = {
          shop: { id: 'gid://shopify/Shop/9', currencyCode: 'USD' },
          primaryMarket: {
            id: `gid://shopify/Market/${accepting && drift === true ? '43' : '42'}`,
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
      else if (query.includes('InsigniaReadPublicConfig')) {
        assert.equal(artifactCollectionStarted, true, 'release observation must not wait for public-config HTTP');
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
      } else if (query.includes('InsigniaOwnedFunctions')) {
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
      } else if (query.includes('InsigniaAvailabilityProduct')) {
        assert.doesNotMatch(query, /title|media|options|collections|variantsCount/);
        assert.match(query, /variants\(first: 250\)/);
        data = {
          product: {
            id: 'gid://shopify/Product/111',
            status: 'ACTIVE',
            variants: {
              nodes: [
                ...(accepting && drift === 'deleted' ? [] : [{ id: 'gid://shopify/ProductVariant/222' }]),
                { id: 'gid://shopify/ProductVariant/333' },
                ...(accepting && drift === 'duplicate' ? [{ id: 'gid://shopify/ProductVariant/222' }] : []),
                ...(accepting && drift === 'malformed' ? [{ id: 'bad' }] : []),
                ...Array.from({ length: accepting && drift === '251' ? 249 : 248 }, (_, i) => ({
                  id: `gid://shopify/ProductVariant/${1000 + i}`,
                })),
              ],
              pageInfo: { hasNextPage: accepting && drift === 'overflow' },
            },
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
            // Shopify returns a null node for a deleted variant, before acceptance reads stock.
            accepting && drift === 'deleted'
              ? null
              : {
                  __typename: 'ProductVariant',
                  id: 'gid://shopify/ProductVariant/222',
                  product: { id: 'gid://shopify/Product/111' },
                  contextualPricing: {
                    price: { amount: accepting && drift === 'price' ? '11.00' : '10.00', currencyCode: 'USD' },
                  },
                },
          ],
        };
      else assert.fail(`Unexpected boundary query: ${query}`);
      return new Response(JSON.stringify({ data }), { headers: { 'x-shopify-api-version': '2026-07' } });
    };
    const services = createProductionBuyerServices(input);
    const acceptNow = services.accept;
    services.accept = async (...args) => {
      accepting = true;
      try {
        return await acceptNow(...args);
      } finally {
        accepting = false;
      }
    };
    const desired: Parameters<typeof services.propose>[1] = {
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
    };
    const excessive = structuredClone(desired);
    excessive.groups = [
      {
        ...excessive.groups[0]!,
        variants: Array.from({ length: 17 }, (_, i) => ({ variantId: String(2000 + i), quantity: 1 })),
      },
      {
        ...excessive.groups[0]!,
        productId: '112',
        variants: Array.from({ length: 16 }, (_, i) => ({ variantId: String(3000 + i), quantity: 1 })),
      },
    ];
    await assert.rejects(() => services.propose(scope, excessive), /capacity exceeded before provider reads/);
    assert.equal(activeAcquisitions, 0, '33 TOTAL selections across products fail before credential/provider work');
    if (drift === false) {
      const originalEffective = input.core.acceptedQuotes.getEffective;
      const originalFetch = input.fetchImpl!;
      const originalInventory = input.readVariantAvailability;
      const uniqueSelected = Array.from({ length: 32 }, (_, i) => `gid://shopify/ProductVariant/${1000 + i}`);
      const inventoryTargets: { product: string; variants: readonly string[]; final: boolean }[] = [];
      input.core.acceptedQuotes.getEffective = async (_shop, productId) => ({
        config: { ...config, productId, revisionId: productId === '111' ? 'revision' : 'revision-two' },
        configId: productId === '111' ? 'config' : 'config-two',
        operationId: productId === '111' ? 'publication' : 'publication-two',
      });
      input.fetchImpl = async (url, options) => {
        const body = record(JSON.parse(String(options?.body)));
        const variables = body.variables ? record(body.variables) : {};
        const query = text(body.query);
        const productId = variables.id;
        const ids = Array.isArray(variables.ids) ? variables.ids : [];
        if (
          (query.includes('InsigniaAvailabilityProduct') && productId === 'gid://shopify/Product/112') ||
          (query.includes('contextualPricing') &&
            ids.some((id) => id === 'gid://shopify/ProductVariant/444' || uniqueSelected.includes(String(id))))
        ) {
          assert.equal(insideLock, false);
          assert.equal(new Headers(options?.headers).get('x-shopify-access-token'), 'synthetic-offline-token');
          const data = query.includes('InsigniaAvailabilityProduct')
            ? {
                product: {
                  id: productId,
                  status: 'ACTIVE',
                  variants: {
                    nodes: [{ id: 'gid://shopify/ProductVariant/444' }],
                    pageInfo: { hasNextPage: false },
                  },
                },
              }
            : {
                nodes: ids.map((id) => ({
                  __typename: 'ProductVariant',
                  id,
                  product: {
                    id:
                      id === 'gid://shopify/ProductVariant/444'
                        ? 'gid://shopify/Product/112'
                        : 'gid://shopify/Product/111',
                  },
                  contextualPricing: {
                    price: {
                      amount: id === 'gid://shopify/ProductVariant/444' ? '20.00' : '10.00',
                      currencyCode: 'USD',
                    },
                  },
                })),
              };
          return Response.json({ data }, { headers: { 'x-shopify-api-version': '2026-07' } });
        }
        return originalFetch(url, options);
      };
      input.readVariantAvailability = async (target) => {
        inventoryTargets.push({ product: target.productId, variants: [...target.variantIds], final: accepting });
        if (target.productId === 'gid://shopify/Product/111' && target.variantIds.length === 32) {
          assert.deepEqual(target.variantIds, uniqueSelected);
          return {
            shopId: scope.shopId,
            installationGeneration: scope.installationGeneration,
            productId: target.productId,
            observedAt: input.clock().toISOString(),
            freshUntil: new Date(+input.clock() + 300000).toISOString(),
            variants: target.variantIds.map((id) => ({ id, available: true })),
          };
        }
        if (target.productId === 'gid://shopify/Product/111') return originalInventory(target);
        assert.equal(target.productId, 'gid://shopify/Product/112');
        assert.deepEqual(target.variantIds, ['gid://shopify/ProductVariant/444']);
        return {
          shopId: scope.shopId,
          installationGeneration: scope.installationGeneration,
          productId: target.productId,
          observedAt: input.clock().toISOString(),
          freshUntil: new Date(+input.clock() + 300000).toISOString(),
          variants: [{ id: 'gid://shopify/ProductVariant/444', available: true }],
        };
      };
      try {
        const multiple = structuredClone(desired);
        multiple.groups.push({
          ...structuredClone(multiple.groups[0]!),
          productId: '112',
          configRevisionId: 'revision-two',
          variants: [{ variantId: '444', quantity: 1 }],
        });
        const reviewed = await services.propose(scope, multiple);
        assert.equal(reviewed.totalMinor, '3600');
        const applied = await services.accept(scope, reviewed.proposalId, {
          hash: reviewed.hash,
          idempotencyKey: 'two-products',
        });
        // v3 signs per-line units, not totals; both lines carry one signed set.
        const carriers = applied.buckets.map((bucket) => decodeLineCarrierV3(bucket.properties._insignia_line_v3));
        assert.deepEqual(
          carriers.map((carrier) => carrier.header.count),
          [2, 2],
        );
        assert.equal(new Set(carriers.map((carrier) => carrier.prefix)).size, 1);
        assert.deepEqual(
          applied.buckets.map((bucket) => Object.keys(bucket.properties)),
          [['_insignia_line_v3'], ['_insignia_line_v3']],
        );
        assert.deepEqual(
          applied.buckets
            .map(({ variantId, quantity }) => ({ variantId, quantity }))
            .sort((a, b) => a.variantId.localeCompare(b.variantId)),
          [
            { variantId: '222', quantity: 1 },
            { variantId: '444', quantity: 1 },
          ],
        );
        assert.equal(facts, 1);
        for (const final of [false, true]) {
          assert.deepEqual(
            inventoryTargets.filter((value) => value.final === final),
            [
              { product: 'gid://shopify/Product/111', variants: ['gid://shopify/ProductVariant/222'], final },
              { product: 'gid://shopify/Product/112', variants: ['gid://shopify/ProductVariant/444'], final },
            ],
            'each phase reads only the selected inventory of each product',
          );
        }
        assert.equal(refreshReadsInsideLock, 0);
        inventoryTargets.length = 0;
        const unique = structuredClone(desired);
        unique.groups[0]!.variants = uniqueSelected.map((id) => ({ variantId: id.split('/').at(-1)!, quantity: 1 }));
        const uniqueReview = await services.propose(scope, unique);
        assert.equal(uniqueReview.totalMinor, '41600');
        const uniqueAcceptance = await services.accept(scope, uniqueReview.proposalId, {
          hash: uniqueReview.hash,
          idempotencyKey: '32-unique-selected',
        });
        assert.deepEqual(
          uniqueAcceptance.buckets.map((bucket) => bucket.variantId).sort(),
          unique.groups[0]!.variants.map((variant) => variant.variantId).sort(),
        );
        assert.equal(facts, 2, 'each explicitly accepted reviewed quote creates one result');
        for (const final of [false, true])
          assert.deepEqual(
            inventoryTargets.filter((value) => value.final === final),
            [{ product: 'gid://shopify/Product/111', variants: uniqueSelected, final }],
          );
        assert.equal(refreshReadsInsideLock, 0);
      } finally {
        input.core.acceptedQuotes.getEffective = originalEffective;
        input.fetchImpl = originalFetch;
        input.readVariantAvailability = originalInventory;
        facts = 0;
        inventoryDispatches = 0;
        activeAcquisitions = 0;
        passiveAcquisitions = 0;
        subscriptionReads = 0;
      }
      const atLimit = structuredClone(desired);
      atLimit.groups = Array.from({ length: 32 }, () => structuredClone(desired.groups[0]!));
      const atLimitResult = await services.propose(scope, atLimit);
      assert.equal(atLimitResult.totalMinor, '41600');
      assert.equal(
        inventoryDispatches,
        1,
        '32 groups deduplicate the selected ID into one per-product inventory dispatch',
      );
      activeAcquisitions = 0;
      subscriptionReads = 0;
    }
    const result = await services.propose(scope, desired);
    assert.equal(result.totalMinor, '1300');
    const accept = () => services.accept(scope, result.proposalId, { hash: result.hash, idempotencyKey: 'accept' });
    if (drift === true) {
      await assert.rejects(accept, /Lean primary-Market context unavailable/);
      assert.equal(facts, 0);
    } else if (drift === 'price') {
      await assert.rejects(accept, /REVIEW_REQUIRED/);
      assert.equal(facts, 0);
    } else if (
      String(drift).startsWith('inventory-') ||
      drift === 'duplicate' ||
      drift === 'malformed' ||
      drift === '251'
    ) {
      await assert.rejects(accept);
      assert.equal(facts, 0);
    } else if (drift === 'stock' || drift === 'overflow' || drift === 'deleted') {
      await assert.rejects(
        accept,
        // Pricing runs first and finds no node; the buyer API answers it with 410 PRODUCT_UNAVAILABLE.
        drift === 'deleted'
          ? { name: 'ContextualPricingError', kind: 'missing_variant' }
          : drift === 'stock'
            ? /REVIEW_REQUIRED/
            : /incomplete/,
      );
      assert.equal(facts, 0);
    } else {
      const accepted = await accept();
      assert.equal(facts, 1);
      assert.ok(subscriptionReads <= 3, 'proposal and acceptance must not prepare the full quote a third time');
      const carrier = decodeLineCarrierV3(required(accepted.buckets[0]).properties._insignia_line_v3);
      assert.equal(BigInt(carrier.record.unitMinor) * BigInt(required(accepted.buckets[0]).quantity), 1300n);
    }
    // The acceptance's single fresh pass re-reads the primary Market before its lock.
    assert.ok(passivePrimaryReads >= 1);
    // One reused credential per request source (quote ports and stock) for proposal and acceptance;
    // failures before the acceptance stock read need one fewer. Previously ten per journey.
    if (drift === false) assert.equal(activeAcquisitions, ACTIVE_ACQUISITIONS);
    else assert.ok(activeAcquisitions <= ACTIVE_ACQUISITIONS, String(drift));
    assert.equal(passiveAcquisitions, 0, String(drift));
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

function catalogFixture(
  selectedOptions: { name: string; value: string; optionValue?: { swatch: { color: string } | null } }[] = [],
) {
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
              nodes: [{ id: 'gid://shopify/ProductVariant/222', title: 'Blue M', selectedOptions, image: null }],
              pageInfo: { hasNextPage: false },
            },
          },
        },
      }),
      { status: 200 },
    );
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
  assert.deepEqual(config.variants, [{ id: '222', label: 'Blue M', available: false, selectedOptions: [] }]);
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

test('published editor variant geometry retains its image, fallback and placement at the canonical renderer boundary', async () => {
  const { projectScene } = await import('@insignia/visualizer/geometry');
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
    const scene = projectScene(
      {
        version: 0,
        geometry: config.geometry,
        viewId: 'front',
        variantId: required(config.variants[0]).id,
        selectedPlacementId: 'chest',
        selectedStepId: 'small',
        artwork: { kind: 'logo-later' },
      },
      { width: 450, height: 350, pixelRatio: 1 },
      config.imageUrls,
    );
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
    assert.deepEqual(required(scene.artwork).bounds, required(scene.placements[0]).bounds);
    assert.equal(config.contentHash, 'a'.repeat(64));
    assert.equal(config.revisionId, 'revision');
    assert.deepEqual(config.variants, [{ id: '222', label: 'Blue M', available: false, selectedOptions: [] }]);
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
      commandDeclined: async () => false,
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
      const issued = await issueLineSetV3(
        {
          keyId: 7,
          generationHex: original.authorizationGeneration.replaceAll('-', ''),
          epoch: 1,
          quoteHex: original.quoteId.replaceAll('-', ''),
          setHex: setId.replaceAll('-', ''),
          currency: 'USD',
          exponent: 2,
          country: 'US',
          marketId: '42',
          validThroughDay: acceptedDay + 2,
        },
        original.economics.lines.map((line, index) => ({
          index,
          variantId: line.variantId,
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
          envelopeCarrier: issued.prefix,
          members: issued.carriers.map((carrier, lineIndex) => ({ lineIndex, carrier })),
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
          properties: { _insignia_line_v3: required(issued.carriers[0]) },
        },
      ]);
      assert.equal(required(original.economics.groups[0]).setupMinor, '300');
      assert.equal(quoteWrites, 0);
      assert.equal(proposalWrites, 0);
      assert.equal(artworkReads, 0);
      continue;
    }
    // Renewal re-prices the stored accepted request, never the client's groups.
    input.core.buyers.getOwnedRequest = async () => ({ quote: original, request });
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
    let primaryReads = 0,
      stockReads = 0;
    input.readVariantAvailability = async (target) => ({
      ...target,
      observedAt: input.clock().toISOString(),
      freshUntil: new Date(+input.clock() + 300000).toISOString(),
      variants: target.variantIds.map((id) => ({ id, available: true })),
    });
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
      // A proposal's stock read overlaps pricing; it is not a pricing (catalog) read. Stock wins over a
      // pricing failure (#336), so it reports the variant in stock to expose the context failure under test.
      if (text(body.query).includes('InsigniaAvailabilityProduct')) {
        stockReads++;
        return Response.json({
          data: {
            product: {
              id: 'gid://shopify/Product/111',
              status: 'ACTIVE',
              variants: { nodes: [{ id: 'gid://shopify/ProductVariant/222' }], pageInfo: { hasNextPage: false } },
            },
          },
        });
      }
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
          ? /Primary Market unavailable: provider_unavailable/
          : contextCase === 'reauthorized'
            ? /Buyer Lean context authority changed/
            : /Lean primary-Market context unavailable/;
    await assert.rejects(act, expected, scenario);
    // The primary-Market read overlaps the catalog read, so it also runs when the catalog currency later fails.
    assert.equal(primaryReads, 1, scenario);
    assert.equal(subscriptionReads, 1, operation);
    assert.equal(catalogReads, 1, operation);
    assert.ok(stockReads <= (operation === 'propose' ? 1 : 0), operation);
    assert.equal(quoteWrites, 0, operation);
    assert.equal(proposalWrites, 0, operation);
    assert.equal(artworkReads, 0, operation);
    assert.equal(required(config.pricingRules[0]).role, 'setup', 'historical advanced revision remains untouched');
  }
});

test('production config reads real country-contextual base amounts and selected options even without selected authoring state', async (t) => {
  for (const selectedOptions of [
    [
      { name: 'Color', value: 'Blue' },
      { name: 'Size', value: 'M' },
    ],
    [],
  ])
    await t.test(
      selectedOptions.length ? 'actual option facts remain editable' : 'missing option facts remain unavailable',
      async () => {
        const { input } = catalogFixture(selectedOptions);
        const original = input.fetchImpl;
        let contextReads = 0;
        input.fetchImpl = async (url, options) => {
          const body = record(JSON.parse(text(required(options).body)));
          if (text(body.query).includes('InsigniaVariantContext')) {
            contextReads++;
            assert.deepEqual(body.variables, { ids: ['gid://shopify/ProductVariant/222'], country: 'US' });
            return new Response(
              JSON.stringify({
                data: {
                  nodes: [
                    {
                      __typename: 'ProductVariant',
                      id: 'gid://shopify/ProductVariant/222',
                      product: { id: 'gid://shopify/Product/111' },
                      contextualPricing: { price: { amount: '10.99', currencyCode: 'USD' } },
                    },
                  ],
                },
              }),
            );
          }
          return required(original)(url, options);
        };
        input.core.transactions.run = async (work) => work(fixtureTransaction);
        input.core.preferences.readWording = async () => ({
          wordingVersion: '0',
          overlays: { en: { locale: 'en', messages: {} } },
        });
        const url = new URL(signed());
        url.searchParams.delete('signature');
        url.searchParams.set('country', 'US');
        const message = [...url.searchParams.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => `${key}=${value}`)
          .join('');
        url.searchParams.set('signature', createHmac('sha256', secret).update(message).digest('hex'));
        const result = await createProductionBuyerServices(input).config(new Request(url));
        assert.equal(result.selectedSetup, undefined);
        assert.equal(result.title, 'Owned');
        if (selectedOptions.length) {
          assert.equal(result.shopCurrency, 'USD');
          assert.deepEqual(result.decorationPrices, []);
        } else {
          assert.equal(result.shopCurrency, undefined);
          assert.equal(result.decorationPrices, undefined);
          assert.equal(result.ready, false);
        }
        assert.deepEqual(result.variants, [
          { id: '222', label: 'Blue M', available: false, selectedOptions, baseUnitMinor: '1099' },
        ]);
        assert.equal(contextReads, 1);
      },
    );
});

test('selection configuration does not wait for signing or release authority; purchase readiness remains separate', async () => {
  const { input } = catalogFixture();
  let releaseReads = 0;
  input.core.signingKeys.list = async () => [];
  input.artifactPorts = {
    ...input.artifactPorts,
    expectedBuild: {
      read: async () => {
        releaseReads++;
        throw Error('release unavailable');
      },
    },
    trustedEvidence: {
      read: async () => {
        releaseReads++;
        throw Error('release unavailable');
      },
    },
  };
  const config = await createProductionBuyerServices(input).config(new Request(signed()));
  assert.equal(config.productId, '111');
  assert.equal(config.variants[0]?.id, '222');
  assert.equal(releaseReads, 0);
});

test('catalog swatches survive production buyer config parsing without changing variant identity or inventory', async () => {
  const { BuyerConfigSchema } = await import('@insignia/contracts');
  const { input } = catalogFixture([
    { name: 'Colour', value: 'Ocean', optionValue: { swatch: { color: '#123456' } } },
    { name: 'Size', value: 'M', optionValue: { swatch: null } },
  ]);
  const result = BuyerConfigSchema.parse(await createProductionBuyerServices(input).config(new Request(signed())));
  assert.deepEqual(result.variants, [
    {
      id: '222',
      label: 'Blue M',
      available: false,
      selectedOptions: [
        { name: 'Colour', value: 'Ocean', swatch: { color: '#123456' } },
        { name: 'Size', value: 'M' },
      ],
    },
  ]);
});

test('an archived or deleted product is unavailable and a throttled catalog read is retryable, not an outage (#336)', async () => {
  for (const product of [{ status: 'ARCHIVED' }, null]) {
    const { input } = catalogFixture();
    const originalFetch = input.fetchImpl;
    input.fetchImpl = async (url, options) => {
      const response = await required(originalFetch)(url, options);
      const payload = record(await response.json());
      const data = record(payload.data);
      return Response.json({ data: { product: product && { ...record(data.product), ...product } } });
    };
    await assert.rejects(createProductionBuyerServices(input).config(new Request(signed())), {
      name: 'BuyerRejectedError',
      code: 'PRODUCT_UNAVAILABLE',
    });
  }
  for (const response of [
    () => new Response('{}', { status: 429 }),
    () => new Response('{}', { status: 503 }),
    () => Response.json({ errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] }),
  ]) {
    const { input } = catalogFixture();
    input.fetchImpl = async () => response();
    await assert.rejects(createProductionBuyerServices(input).config(new Request(signed())), {
      name: 'ShopifyAdminUnavailableError',
    });
  }
});
