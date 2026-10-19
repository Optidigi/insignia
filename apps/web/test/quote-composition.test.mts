import assert from 'node:assert/strict';
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { test } from 'node:test';
import type { AcceptedQuoteResult, EntitlementPolicyConfig, QuoteRequest } from '@insignia/application';
import { acceptQuote } from '@insignia/application';
import { decodeEnvelope, decodeMemberCarrier, wholeQuoteSignBytes } from '@insignia/cart-authorization';
import type { CustomizationGroup, PublishedConfig } from '@insignia/domain';
import { createQuoteAuthorityPorts } from '../src/server/quote-composition.ts';
import { artworkManifest, artworkRow, coreFixture, required } from './http-fixtures.mts';

test('production quote composition rejects unsupported prices and signs complete Lean offers', async () => {
  const now = new Date('2026-11-01T05:30:00.000Z');
  const hash = 'a'.repeat(64);
  const productId = '42';
  const variantId = '700';
  const syntheticSeed = createHash('sha256').update('m4-002-accepted-negative-adjustment-test-v1').digest();
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), syntheticSeed]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = createPublicKey(privateKey);
  const config: PublishedConfig = {
    version: 'm2-published-config-v1',
    shopId: 'shop',
    productId,
    revisionId: 'revision',
    revisionContentHash: hash,
    shopCurrency: 'USD',
    methods: [{ id: 'method' }],
    placements: [{ id: 'front', allowedMethodIds: ['method'], allowedStepIds: ['step'], logoLaterAllowed: false }],
    productionOptions: [],
    pricingRules: [
      {
        id: 'negative-placement',
        scope: { kind: 'placement', placementId: 'front' },
        role: 'unit',
        rate: { kind: 'fixed', amount: { shopDecimal: '-0.01', presentmentOverrides: [] } },
      },
      {
        id: 'setup',
        scope: { kind: 'general' },
        role: 'setup',
        rate: { kind: 'fixed', amount: { shopDecimal: '0.03', presentmentOverrides: [] } },
      },
    ],
  };
  const group: CustomizationGroup = {
    version: 'm2-customization-group-v1',
    shopId: 'shop',
    productId,
    configRevisionId: 'revision',
    revisionContentHash: hash,
    design: {
      placements: [
        { placementId: 'front', methodId: 'method', stepId: 'step', artwork: { kind: 'revision', revisionId: 'art' } },
      ],
      options: [],
    },
    variants: [{ variantId, quantity: 2 }],
  };
  let saved: AcceptedQuoteResult | null = null;
  let contextReads = 0;
  let catalogReads = 0;
  let subscriptionReads = 0;
  let artworkReads = 0;
  let signatures = 0;
  const core = coreFixture({
    tenants: {
      getActiveAuthorizationScope: async () => ({
        shopId: 'shop',
        installationGeneration: '1',
        shopifyShopId: '7',
        shopDomain: 'synthetic.myshopify.com',
        authorizationGeneration: '11111111-1111-4111-8111-111111111111',
        authorizationEpoch: 4,
      }),
      getActiveProviderScope: async () => ({
        shopId: 'shop',
        installationGeneration: '1',
        shopifyShopId: '7',
        shopDomain: 'synthetic.myshopify.com',
      }),
    },
    acceptedQuotes: {
      getEffective: async () => ({ config, configId: 'cfg', operationId: 'op' }),
      findCompleted: async () => saved,
      accept: async (_input, commit) => {
        saved = await commit();
        return saved;
      },
    },
  });
  const entitlementPolicy: EntitlementPolicyConfig = {
    policyVersion: 'synthetic-v1',
    maxAgeMs: 300000,
    plans: [{ planHandle: 'synthetic-plan', billing: 'recurring-only', policyId: 'synthetic', features: [] }],
  };
  const ports = createQuoteAuthorityPorts({
    core,
    appId: 'gid://shopify/App/1',
    clock: () => now,
    ids: { quoteId: () => '22222222-2222-4222-8222-222222222222', setId: () => '33333333-3333-4333-8333-333333333333' },
    entitlementPolicy,
    readSubscription: async () => {
      subscriptionReads++;
      return {
        schemaVersion: 'm4-active-subscription-v1',
        sourceApiVersion: '2026-07',
        appId: 'gid://shopify/App/1',
        shopId: 'gid://shopify/Shop/7',
        observedAt: now.toISOString(),
        active: true,
        billingPeriod: 'EVERY_30_DAYS',
        cancelAtEndOfCycle: false,
        trialEndsAt: '2026-11-05T00:00:00.000Z',
        currentBillingCycle: null,
        pendingUpdate: null,
        items: [
          {
            handle: 'synthetic-plan',
            price: { kind: 'flat', providerTypename: 'FlatRatePrice', active: false, currency: 'USD', amount: '49.99' },
            discount: null,
            usage: null,
          },
        ],
      };
    },
    credentials: {
      acquire: async () => ({
        kind: 'usable',
        shopDomain: 'synthetic.myshopify.com',
        accessToken: 'synthetic-test-token',
        accessExpiresAt: new Date(now.getTime() + 3600000),
      }),
    },
    fetchImpl: async (_url, init) => {
      contextReads++;
      assert.equal(required(init).redirect, 'error');
      return new Response(
        JSON.stringify({
          data: { shop: { id: 'gid://shopify/Shop/7', currencyCode: 'USD', ianaTimezone: 'America/New_York' } },
        }),
      );
    },
    catalogTransport: {
      execute: async (request) => {
        catalogReads++;
        assert.deepEqual(request.variables, { ids: [`gid://shopify/ProductVariant/${variantId}`], country: 'US' });
        return {
          status: 200,
          body: {
            data: {
              nodes: [
                {
                  __typename: 'ProductVariant',
                  id: `gid://shopify/ProductVariant/${variantId}`,
                  product: { id: `gid://shopify/Product/${productId}` },
                  contextualPricing: { price: { amount: '0.00', currencyCode: 'USD' } },
                },
              ],
            },
          },
        };
      },
    },
    artwork: {
      replayBinding: () => 'f'.repeat(64),
      readUsability: async (input) => {
        artworkReads++;
        assert.equal(input.shopId, 'shop');
        assert.equal(input.installationGeneration, '1');
        assert.equal(input.shopTimezone, 'America/New_York');
        assert.deepEqual(input.choices, [{ kind: 'revision', id: 'art' }]);
        return input.choices.map((choice) => ({
          ...choice,
          shopId: input.shopId,
          installationGeneration: input.installationGeneration,
          status: 'usable',
          lastFullyUsableLocalDay: 20760,
          observedAt: now.toISOString(),
        }));
      },
    },
    signing: {
      keyId: 7,
      signer: {
        signWholeQuote: async (input) => {
          signatures++;
          return {
            keyId: input.keyId,
            publicKeyFingerprint: 'synthetic',
            firstValidDay: input.issuanceDay,
            lastValidDay: input.validThroughDay,
            signature: sign(null, input.message, privateKey),
          };
        },
      },
    },
    // This isolated composition fixture explicitly supplies synthetic readiness.
    readiness: { assertReady: async () => {} },
  });
  const request: QuoteRequest = {
    shopId: 'shop',
    installationGeneration: '1',
    idempotencyKey: 'synthetic-command',
    country: 'US',
    marketId: 'gid://shopify/Market/42',
    groups: [{ group, sellingPlanId: null }],
    capacity: { ordinaryLineCount: 0, inputBytes: 1000 },
  };
  await assert.rejects(acceptQuote(request, ports), /Lean primary-Market and currency qualification unavailable/);
  assert.equal(signatures, 0);
  // Synthetic qualification isolates the separate advanced-price exclusion boundary.
  ports.leanContext = { assertSupported: async () => {} };
  await assert.rejects(acceptQuote(request, ports), /Lean prices require/);
  assert.equal(signatures, 0);
  // The only supported issuance shape is one nonnegative final unit surcharge.
  config.pricingRules = [
    {
      id: 'decoration-unit',
      scope: { kind: 'step', placementId: 'front', methodId: 'method', stepId: 'step' },
      role: 'unit',
      rate: { kind: 'fixed', amount: { shopDecimal: '0.01', presentmentOverrides: [] } },
    },
  ];
  contextReads = catalogReads = subscriptionReads = artworkReads = 0;
  const unitRate = required(config.pricingRules[0]).rate;
  assert.equal(unitRate.kind, 'fixed');
  if (unitRate.kind !== 'fixed') throw Error('Expected fixed test rate');
  unitRate.amount.shopDecimal = '-0.01';
  await assert.rejects(acceptQuote(request, ports), /nonnegative/);
  assert.equal(signatures, 0);
  assert.equal(saved, null);
  unitRate.amount.shopDecimal = '0.01';
  contextReads = catalogReads = subscriptionReads = artworkReads = 0;
  const result = await acceptQuote(request, ports);
  assert.equal(result.quote.economics.totalMinor, '2');
  assert.equal(required(result.quote.economics.groups[0]).canonicalIdentitySha256.length, 64);
  assert.ok(!JSON.stringify(result.quote).includes('"art"'));
  assert.equal(required(result.quote.economics.groups[0]).customizationUnitMinor, '1');
  assert.deepEqual(
    result.quote.economics.lines.map((line) => line.unitPriceMinor),
    ['1'],
  );
  assert.equal(result.quote.acceptedDate, '2026-11-01');
  assert.equal(result.quote.validThroughDay - result.quote.acceptedDay, 2);
  const envelope = decodeEnvelope(result.authorization.envelopeCarrier);
  const members = result.authorization.members.map((item) => decodeMemberCarrier(item.carrier));
  assert.equal(envelope.header.marketId, '42');
  assert.equal(envelope.header.generationHex, '11111111111141118111111111111111');
  assert.ok(verify(null, wholeQuoteSignBytes(envelope.header, members), publicKey, envelope.signature));
  assert.equal(envelope.header.totalMinor, '2');
  assert.equal(envelope.header.totalQuantity, 2);
  assert.deepEqual(
    members.map(({ variantId, quantity, unitMinor }) => ({ variantId, quantity, unitMinor })),
    [{ variantId, quantity: 2, unitMinor: '1' }],
  );
  assert.equal(signatures, 1);
  assert.deepEqual(await acceptQuote(request, ports), result);
  assert.deepEqual([contextReads, catalogReads, subscriptionReads, artworkReads, signatures], [1, 1, 2, 2, 1]);
});

test('default artwork composition binds verified guest authority and denies unscoped or other-session UUID use', async () => {
  const now = new Date('2026-10-12T12:00:00Z');
  const row = artworkRow({
    assetId: 'asset',
    manifest: artworkManifest,
    ownerHash: 'a'.repeat(64),
    expiresAt: new Date(+now + 7 * 86400000),
  });
  const unexpected = async (): Promise<never> => {
    throw Error('Unexpected quote authority fixture boundary');
  };
  const input: Parameters<typeof createQuoteAuthorityPorts>[0] = {
    core: coreFixture({ artwork: { readUsability: async () => [row] } }),
    clock: () => now,
    appId: 'gid://shopify/App/1',
    entitlementPolicy: { policyVersion: 'test', maxAgeMs: 1000, plans: [] },
    readSubscription: unexpected,
    credentials: { acquire: unexpected },
    catalogTransport: { execute: unexpected },
    signing: { keyId: 1, signer: { signWholeQuote: unexpected } },
    readiness: { assertReady: unexpected },
  };
  const request = {
    shopId: 'tenant',
    installationGeneration: '1',
    shopTimezone: 'UTC',
    choices: [{ kind: 'revision' as const, id: 'asset' }],
  };
  const authority = {
    shopId: 'tenant',
    installationGeneration: '1',
    kind: 'guest' as const,
    ownerHash: 'a'.repeat(64),
  };
  assert.throws(
    () => createQuoteAuthorityPorts({ ...input, artwork: { readUsability: async () => [] } }),
    /Quote resource replay authority required/,
  );
  assert.equal(
    required((await createQuoteAuthorityPorts(input).artwork.readUsability(request))[0]).status,
    'unavailable',
  );
  assert.equal(
    required(
      (
        await createQuoteAuthorityPorts({
          ...input,
          artworkAuthority: { ...authority, ownerHash: 'b'.repeat(64) },
        }).artwork.readUsability(request)
      )[0],
    ).status,
    'unavailable',
  );
  assert.equal(
    required(
      (await createQuoteAuthorityPorts({ ...input, artworkAuthority: authority }).artwork.readUsability(request))[0],
    ).status,
    'usable',
  );
  assert.equal(
    required(
      (
        await createQuoteAuthorityPorts({ ...input, artworkAuthority: authority }).artwork.readUsability({
          ...request,
          installationGeneration: '2',
        })
      )[0],
    ).status,
    'unavailable',
  );
});
