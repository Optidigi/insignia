import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { acceptQuote } from '@insignia/application';
import { decodeEnvelope, decodeMemberCarrier, wholeQuoteSignBytes } from '@insignia/cart-authorization';
import { createQuoteAuthorityPorts } from '../src/server/quote-composition.ts';

test('server composition binds trusted provider reads to one signed immutable quote candidate', async () => {
  const now = new Date('2026-11-01T05:30:00.000Z');
  const hash = 'a'.repeat(64);
  const productId = '42';
  const variantId = '700';
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const config = {
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
        id: 'setup',
        scope: { kind: 'general' },
        role: 'setup',
        rate: { kind: 'fixed', amount: { shopDecimal: '0.01', presentmentOverrides: [] } },
      },
    ],
  };
  const group = {
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
  let saved = null;
  let contextReads = 0;
  let catalogReads = 0;
  let subscriptionReads = 0;
  let signatures = 0;
  const core = {
    tenants: {
      getActiveAuthorizationScope: async () => ({
        shopId: 'shop',
        installationGeneration: '1',
        shopifyShopId: '7',
        authorizationGeneration: '11111111-1111-4111-8111-111111111111',
        authorizationEpoch: 4,
      }),
      getActiveProviderScope: async () => ({ shopId: 'shop', installationGeneration: '1', shopifyShopId: '7' }),
    },
    acceptedQuotes: {
      getEffective: async () => ({ config, configId: 'cfg', operationId: 'op' }),
      findCompleted: async () => saved,
      accept: async (_input, commit) => {
        saved = await commit();
        return saved;
      },
    },
  };
  const ports = createQuoteAuthorityPorts({
    core,
    appId: 'gid://shopify/App/1',
    clock: () => now,
    ids: { quoteId: () => '22222222-2222-4222-8222-222222222222', setId: () => '33333333-3333-4333-8333-333333333333' },
    entitlementPolicy: {
      policyVersion: 'synthetic-v1',
      maxAgeMs: 300000,
      plans: [
        {
          planHandle: 'synthetic-plan',
          usageHandle: 'synthetic-usage',
          policyId: 'synthetic',
          features: [],
          includedUsage: 3,
        },
      ],
    },
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
          { handle: 'synthetic-plan', price: { kind: 'flat', active: false }, usage: null },
          { handle: 'synthetic-usage', price: { kind: 'tiered', active: false }, usage: { quantity: '0' } },
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
      assert.equal(init.redirect, 'error');
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
                  contextualPricing: { price: { amount: '10.00', currencyCode: 'USD' } },
                },
              ],
            },
          },
        };
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
  });
  const request = {
    shopId: 'shop',
    installationGeneration: '1',
    idempotencyKey: 'synthetic-command',
    country: 'US',
    marketId: 'gid://shopify/Market/42',
    groups: [{ group, sellingPlanId: null }],
    capacity: { ordinaryLineCount: 0, inputBytes: 1000 },
  };
  const result = await acceptQuote(request, ports);
  assert.equal(result.quote.economics.totalMinor, '2001');
  assert.equal(result.quote.acceptedDate, '2026-11-01');
  assert.equal(result.quote.validThroughDay - result.quote.acceptedDay, 2);
  const envelope = decodeEnvelope(result.authorization.envelopeCarrier);
  const members = result.authorization.members.map((item) => decodeMemberCarrier(item.carrier));
  assert.equal(envelope.header.marketId, '42');
  assert.equal(envelope.header.generationHex, '11111111111141118111111111111111');
  assert.ok(verify(null, wholeQuoteSignBytes(envelope.header, members), publicKey, envelope.signature));
  if (process.env.M4_QUOTE_EVIDENCE_OUTPUT) {
    writeFileSync(
      process.env.M4_QUOTE_EVIDENCE_OUTPUT,
      `${JSON.stringify(
        {
          schemaVersion: 'm4-002-synthetic-quote-example-v1',
          context: 'synthetic provider, synthetic plan, ephemeral test key; no live quote or Shopify write',
          publicKeyHex: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex'),
          quote: result.quote,
          authorization: result.authorization,
        },
        null,
        2,
      )}\n`,
    );
  }
  assert.equal(signatures, 1);
  assert.deepEqual(await acceptQuote(request, ports), result);
  assert.deepEqual([contextReads, catalogReads, subscriptionReads, signatures], [1, 1, 2, 1]);
});
