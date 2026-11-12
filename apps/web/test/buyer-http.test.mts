import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BuyerAcceptanceDeclinedError,
  BuyerRejectedError,
  CatalogContextUnavailable,
  EntitlementObservationUnavailableError,
  ShopDayChangedError,
} from '@insignia/application';
import type { BuyerFailureDiagnostic } from '@insignia/observability';
import {
  ContextualPricingError,
  PrimaryMarketError,
  ShopContextError,
  ShopifyAdminUnavailableError,
  VariantAvailabilityError,
} from '@insignia/shopify';
import { handleBuyerRequest } from '../src/server/buyer/http.ts';
import { buyerFixture, coreFixture, record } from './http-fixtures.mts';

const post = (body: unknown, path = '/v1/quote-proposals') =>
  new Request(`https://app.invalid${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
test('buyer authority has no fallback when production composition is absent', async () => {
  const result = await handleBuyerRequest(post({}), undefined, 'quote-proposals');
  assert.equal(result.status, 503);
  const error = record(await result.json());
  assert.equal(error.code, 'UNAVAILABLE');
  assert.ok(error.requestId);
  assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
});
test('eligibility is a no-store public presentation hint with no session or quote authority', async () => {
  const result = await handleBuyerRequest(
    new Request('https://app.invalid/v1/eligibility?productId=123'),
    buyerFixture({ eligibility: async () => ({ productId: '123', configured: true }) }),
    'eligibility',
  );
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { productId: '123', configured: true });
  assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
});
test('buyer rejects oversized bodies before authentication and never copies an unlimited stream', async () => {
  let verified = 0;
  const result = await handleBuyerRequest(
    post({ capability: 'x', padding: 'x'.repeat(130000) }),
    buyerFixture({
      guest: {
        verify: async () => {
          verified++;
          return null;
        },
      },
    }),
    'quote-proposals',
  );
  assert.equal(result.status, 400);
  assert.equal(verified, 0);
});
test('buyer refuses unsigned tenant fields and capability-less private requests', async () => {
  const services = buyerFixture({ guest: { verify: async () => null } });
  assert.equal((await handleBuyerRequest(post({ shopId: 'attacker' }), services, 'quote-proposals')).status, 401);
});
test('buyer failure diagnostics correlate safely without request or exception payloads', async () => {
  const seen: BuyerFailureDiagnostic[] = [];
  const secret = 'private-provider-token-and-artwork';
  const result = await handleBuyerRequest(
    new Request(`https://app.invalid/v1/config?signature=${secret}`),
    buyerFixture({
      config: async () => {
        const error = Object.assign(new Error(secret), { code: '55P03' });
        throw error;
      },
    }),
    'config',
    (value) => seen.push(value),
  );
  const body = record(await result.json());
  assert.equal(result.status, 409);
  assert.deepEqual(seen, [{ correlationId: body.requestId, buyerStage: 'config', errorClass: 'DatabaseLockTimeout' }]);
  assert.equal(JSON.stringify(seen).includes(secret), false);
});

test('a stale or missing entitlement observation is a retryable 503 with its own class, not a denial', async () => {
  const seen: BuyerFailureDiagnostic[] = [];
  const result = await handleBuyerRequest(
    new Request('https://app.invalid/v1/config'),
    buyerFixture({
      config: async () => {
        throw new EntitlementObservationUnavailableError();
      },
    }),
    'config',
    (value) => seen.push(value),
  );
  const body = record(await result.json());
  assert.equal(result.status, 503);
  assert.equal(body.code, 'UNAVAILABLE');
  assert.deepEqual(seen, [
    { correlationId: body.requestId, buyerStage: 'config', errorClass: 'EntitlementObservationUnavailable' },
  ]);
});
test('required cart review is diagnosed as a finite expected class without leaking exception details', async () => {
  const seen: BuyerFailureDiagnostic[] = [];
  const secret = 'private-cart-carrier-and-capability-SECRET';
  const result = await handleBuyerRequest(
    post(
      {
        capability: `${secret}.signature`,
        lines: [
          {
            key: 'line1',
            variantId: '222',
            quantity: 1,
            properties: { _insignia_quote_v2: secret },
            sellingPlan: null,
          },
        ],
      },
      '/v1/cart-state',
    ),
    buyerFixture({
      guest: {
        verify: async () => ({
          kind: 'guest',
          shopId: 'tenant',
          installationGeneration: '1',
          ownerHash: 'f'.repeat(64),
        }),
      },
      store: coreFixture({
        buyers: {
          getSession: async () => ({ sessionId: 'synthetic', expiresAt: new Date('2099-01-01T00:00:00Z') }),
          admitRequest: async () => {},
        },
      }).buyers,
      cartState: async () => {
        throw Object.assign(new BuyerRejectedError('REVIEW_REQUIRED'), { cause: new Error(secret), payload: secret });
      },
    }),
    'cart-state',
    (value) => seen.push(value),
  );
  const body = record(await result.json());
  assert.equal(result.status, 409);
  assert.equal(body.code, 'REVIEW_REQUIRED');
  assert.equal(body.acceptanceOutcome, undefined);
  assert.deepEqual(seen, [{ correlationId: body.requestId, buyerStage: 'cart-state', errorClass: 'ReviewRequired' }]);
  assert.doesNotMatch(JSON.stringify({ body, seen }), /SECRET|private-cart|payload|cause/);
});

test('only committed acceptance decline adds the finite outcome to compatible review response', async () => {
  const result = await handleBuyerRequest(
    post({ capability: 'synthetic.signature', lines: [] }, '/v1/cart-state'),
    buyerFixture({
      guest: {
        verify: async () => ({
          kind: 'guest',
          shopId: 'tenant',
          installationGeneration: '1',
          ownerHash: 'f'.repeat(64),
        }),
      },
      store: coreFixture({
        buyers: {
          getSession: async () => ({ sessionId: 'synthetic', expiresAt: new Date('2099-01-01T00:00:00Z') }),
          admitRequest: async () => {},
        },
      }).buyers,
      cartState: async () => {
        throw new BuyerAcceptanceDeclinedError();
      },
    }),
    'cart-state',
    () => {},
  );
  assert.equal(result.status, 409);
  const body = record(await result.json());
  assert.equal(body.code, 'REVIEW_REQUIRED');
  assert.equal(body.acceptanceOutcome, 'declined');
});

test('proposal response validation preserves a completed write and reports only its finite stage', async () => {
  const seen: BuyerFailureDiagnostic[] = [];
  let writes = 0;
  const services = buyerFixture({
    guest: {
      verify: async () => ({ kind: 'guest', shopId: 'tenant', installationGeneration: '1', ownerHash: 'f'.repeat(64) }),
    },
    store: coreFixture({
      buyers: {
        getSession: async () => ({ sessionId: 'synthetic', expiresAt: new Date('2099-01-01T00:00:00Z') }),
        admitRequest: async () => {},
      },
    }).buyers,
    propose: async () => {
      writes++;
      // A completed proposal can still fail response schema validation.
      return { proposalId: 'persisted-identity', secret: 'SECRET-private-carrier' } as never;
    },
  });
  const response = await handleBuyerRequest(
    post({
      capability: 'synthetic.signature',
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
    }),
    services,
    'quote-proposals',
    (value) => seen.push(value),
  );
  const body = record(await response.json());
  assert.equal(writes, 1);
  assert.equal(response.status, 503);
  assert.equal(body.acceptanceOutcome, undefined);
  assert.deepEqual(seen, [
    {
      correlationId: body.requestId,
      buyerStage: 'quote-proposals',
      errorClass: 'UnexpectedFailure',
      proposalStage: 'response-validation',
    },
  ]);
  assert.doesNotMatch(JSON.stringify({ body, seen }), /SECRET|private-carrier|persisted-identity/);
});

test('empty or malformed quote selections stop before proposal credential/provider work', async () => {
  let proposals = 0;
  const services = buyerFixture({
    guest: {
      verify: async () => ({ kind: 'guest', shopId: 'tenant', installationGeneration: '1', ownerHash: 'f'.repeat(64) }),
    },
    store: coreFixture({
      buyers: {
        getSession: async () => ({ sessionId: 'synthetic', expiresAt: new Date('2099-01-01T00:00:00Z') }),
        admitRequest: async () => {},
      },
    }).buyers,
    propose: async () => {
      proposals++;
      throw new Error('synthetic reached proposal');
    },
  });
  const base = {
    capability: 'synthetic.signature',
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
  const control = await handleBuyerRequest(post(base), services, 'quote-proposals', () => {});
  assert.equal(control.status, 503);
  assert.equal(proposals, 1, 'the valid control reaches proposal composition');
  proposals = 0;
  for (const variants of [
    [],
    [null],
    [{ quantity: 1 }],
    [{ variantId: 222, quantity: 1 }],
    [{ variantId: '', quantity: 1 }],
    [{ variantId: '222', quantity: 0 }],
  ]) {
    const response = await handleBuyerRequest(
      post({ ...base, groups: [{ ...base.groups[0], variants }] }),
      services,
      'quote-proposals',
      () => {},
    );
    assert.equal(response.status, 400);
    assert.equal(proposals, 0, 'rejected selections never enter the provider/credential composition');
  }
});

/** Shopify's app proxy turns every app 5xx into a bare 500, so only 4xx carry `code` and `Retry-After` (#336). */
const failure = async (error: unknown) => {
  const seen: { value: BuyerFailureDiagnostic; expected: boolean }[] = [];
  const response = await handleBuyerRequest(
    new Request('https://app.invalid/v1/config?productId=1'),
    buyerFixture({
      config: async () => {
        throw error;
      },
    }),
    'config',
    (value, expected) => seen.push({ value, expected }),
  );
  const body = record(await response.json());
  assert.equal(typeof body.message, 'string');
  assert.ok(body.requestId);
  return {
    status: response.status,
    code: body.code,
    retryable: body.retryable,
    retryAfter: response.headers.get('Retry-After'),
    logged: seen.map(({ value, expected }) => ({ errorClass: value.errorClass, expected })),
  };
};

test('buyer-actionable conditions are specific 4xx responses logged as expected outcomes', async () => {
  const cases = [
    ['REVIEW_REQUIRED', 409, 'ReviewRequired'],
    ['UNSUPPORTED_MARKET', 422, 'UnsupportedMarket'],
    ['ARTWORK_EXPIRED', 409, 'ArtworkExpired'],
    ['POSITION_INVALID', 422, 'PositionInvalid'],
    ['PRODUCT_UNAVAILABLE', 410, 'ProductUnavailable'],
    ['COUNTRY_REQUIRED', 400, 'CountryRequired'],
    ['ENTITLEMENT_DENIED', 403, 'EntitlementDenied'],
  ] as const;
  for (const [code, status, errorClass] of cases)
    assert.deepEqual(await failure(new BuyerRejectedError(code)), {
      status,
      code,
      retryable: undefined,
      retryAfter: null,
      logged: [{ errorClass, expected: true }],
    });
});

test('transient conditions are 409 BUSY with a retryable flag and Retry-After, keeping their class', async () => {
  const cases = [
    [Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' }), 'DatabaseLockTimeout'],
    [new ShopDayChangedError(), 'ShopDayChanged'],
    [new ContextualPricingError('throttled'), 'ProviderReadUnavailable'],
    [new ContextualPricingError('network_or_timeout'), 'ProviderReadUnavailable'],
    [new ContextualPricingError('provider_unavailable'), 'ProviderReadUnavailable'],
    [new PrimaryMarketError('network'), 'ProviderReadUnavailable'],
    [new PrimaryMarketError('provider_error'), 'ProviderReadUnavailable'],
    [new VariantAvailabilityError('provider_unavailable'), 'ProviderReadUnavailable'],
    [new ShopContextError('provider_error'), 'ProviderReadUnavailable'],
    [new CatalogContextUnavailable('stale'), 'ProviderReadUnavailable'],
    [new ShopifyAdminUnavailableError('Catalog read failed'), 'ProviderReadUnavailable'],
  ] as const;
  for (const [error, errorClass] of cases) {
    const result = await failure(error);
    assert.deepEqual(
      result,
      {
        status: 409,
        code: 'BUSY',
        retryable: true,
        retryAfter: result.retryAfter && /^[1-9]$/.test(result.retryAfter) ? result.retryAfter : 'a small integer',
        logged: [{ errorClass, expected: true }],
      },
      error.message,
    );
  }
});

test('non-transient provider and unexpected failures stay 503 UNAVAILABLE and are logged as failures', async () => {
  const cases = [
    [new ContextualPricingError('credential_missing'), 'ProviderReadUnavailable'],
    [new PrimaryMarketError('invalid_shape'), 'ProviderReadUnavailable'],
    [new CatalogContextUnavailable('wrong_identity'), 'ProviderReadUnavailable'],
    [new Error('Catalog read failed'), 'UnexpectedFailure'],
    [new Error('REVIEW_REQUIRED'), 'UnexpectedFailure'],
  ] as const;
  for (const [error, errorClass] of cases)
    assert.deepEqual(
      await failure(error),
      {
        status: 503,
        code: 'UNAVAILABLE',
        retryable: undefined,
        retryAfter: null,
        logged: [{ errorClass, expected: false }],
      },
      error.message,
    );
});
