import { describe, expect, test, vi } from 'vitest';
import {
  type AdminGraphqlRead,
  assertFreshVariantContext,
  CONTEXTUAL_PRICING_BATCH_SIZE,
  CONTEXTUAL_PRICING_MAX_VARIANTS,
  createShopifyAdminGraphqlReadTransport,
  resolveVariantContext,
} from '../src/contextual-pricing.js';

const target = {
  shopId: 'gid://shopify/Shop/101',
  installationGeneration: '7',
  productId: 'gid://shopify/Product/202',
  variantIds: ['gid://shopify/ProductVariant/303'],
  context: { country: 'NL' },
};

function response(input: { variantId?: string; productId?: string; amount?: unknown; currencyCode?: unknown } = {}) {
  return {
    status: 200,
    body: {
      data: {
        nodes: [
          {
            __typename: 'ProductVariant',
            id: input.variantId ?? target.variantIds[0],
            product: { id: input.productId ?? target.productId },
            contextualPricing: {
              price: { amount: input.amount ?? '19.9900', currencyCode: input.currencyCode ?? 'EUR' },
            },
          },
        ],
      },
    },
  };
}

describe('resolveVariantContext', () => {
  test('returns the exact contextual price only after proving parent product ownership', async () => {
    const execute = vi.fn(async (_request: AdminGraphqlRead) => ({
      status: 200,
      requestId: 'safe-request-1',
      body: {
        data: {
          nodes: [
            {
              __typename: 'ProductVariant',
              id: target.variantIds[0],
              product: { id: target.productId },
              contextualPricing: { price: { amount: '19.9900', currencyCode: 'EUR' } },
            },
          ],
        },
      },
    }));

    const result = await resolveVariantContext(target, {
      transport: { execute },
      now: () => new Date('2026-09-29T12:00:00.000Z'),
    });

    expect(result).toEqual([
      {
        shopId: target.shopId,
        installationGeneration: '7',
        productId: target.productId,
        variantId: target.variantIds[0],
        productIdVerified: true,
        context: { country: 'NL' },
        amount: '19.9900',
        currencyCode: 'EUR',
        sourceApiVersion: '2026-07',
        observedAt: '2026-09-29T12:00:00.000Z',
        freshUntil: '2026-09-29T12:05:00.000Z',
        correlation: { requestId: 'safe-request-1' },
      },
    ]);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      shopId: target.shopId,
      installationGeneration: target.installationGeneration,
      apiVersion: '2026-07',
      variables: { ids: target.variantIds, country: 'NL' },
    });
    expect(execute.mock.calls[0]?.[0]?.query).toContain('product { id }');
    expect(execute.mock.calls[0]?.[0]?.query).toContain('contextualPricing(context: {country: $country})');
  });

  test('keeps each of three countries and a fixed local price distinct', async () => {
    const prices = [
      ['NL', 'EUR', '20.00'],
      ['US', 'USD', '22.50'],
      ['GB', 'GBP', '17.75'],
    ] as const;
    const observed = [];
    for (const [country, currencyCode, amount] of prices) {
      const snapshots = await resolveVariantContext(
        { ...target, context: { country } },
        {
          transport: { execute: async () => response({ amount, currencyCode }) },
          now: () => new Date('2026-09-29T12:00:00Z'),
        },
      );
      observed.push([snapshots[0]?.context.country, snapshots[0]?.currencyCode, snapshots[0]?.amount]);
    }
    // GB is a fixed local price; no garment-price ratio may be reused as customization FX.
    expect(observed).toEqual(prices);
  });

  test('rejects a variant owned by another product', async () => {
    await expect(
      resolveVariantContext(target, {
        transport: { execute: async () => response({ productId: 'gid://shopify/Product/999' }) },
      }),
    ).rejects.toMatchObject({ kind: 'product_mismatch' });
  });

  test('rejects missing and wrong-type nodes', async () => {
    for (const node of [null, { __typename: 'Product', id: target.variantIds[0] }]) {
      await expect(
        resolveVariantContext(target, {
          transport: { execute: async () => ({ status: 200, body: { data: { nodes: [node] } } }) },
        }),
      ).rejects.toMatchObject({ kind: node === null ? 'missing_variant' : 'invalid_provider_shape' });
    }
  });

  test('rejects partial GraphQL data even when its node has a valid price', async () => {
    const complete = response();
    await expect(
      resolveVariantContext(target, {
        transport: {
          execute: async () => ({ ...complete, body: { ...complete.body, errors: [{ message: 'field failed' }] } }),
        },
      }),
    ).rejects.toMatchObject({ kind: 'graphql_error' });
  });

  test('rejects stale and cross-context snapshots at use', async () => {
    const [snapshot] = await resolveVariantContext(target, {
      transport: { execute: async () => response() },
      now: () => new Date('2026-09-29T12:00:00Z'),
    });
    if (!snapshot || !target.variantIds[0]) throw new Error('fixture failure');
    const identity = { ...target, variantId: target.variantIds[0] };
    expect(() => assertFreshVariantContext(snapshot, identity, new Date('2026-09-29T12:04:59Z'))).not.toThrow();
    expect(() => assertFreshVariantContext(snapshot, identity, new Date('2026-09-29T12:05:00Z'))).toThrowError(
      expect.objectContaining({ kind: 'stale_snapshot' }),
    );
    expect(() =>
      assertFreshVariantContext(
        snapshot,
        { ...identity, context: { country: 'US' } },
        new Date('2026-09-29T12:01:00Z'),
      ),
    ).toThrowError(expect.objectContaining({ kind: 'stale_snapshot' }));
  });

  test('does not return a price that became stale before the lookup completed', async () => {
    const times = [new Date('2026-09-29T12:00:00Z'), new Date('2026-09-29T12:06:00Z')];
    await expect(
      resolveVariantContext(target, {
        transport: { execute: async () => response() },
        now: () => times.shift() ?? new Date('2026-09-29T12:06:00Z'),
      }),
    ).rejects.toMatchObject({ kind: 'stale_snapshot' });
  });

  test.each(['1e3', '1.2e-2', '-1.00', '0.', 1.25, '01.00'])(
    'rejects non-exact or malformed money %s',
    async (amount) => {
      await expect(
        resolveVariantContext(target, {
          transport: { execute: async () => response({ amount }) },
        }),
      ).rejects.toMatchObject({ kind: 'invalid_money' });
    },
  );

  test.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [429, 'throttled'],
    [503, 'provider_unavailable'],
  ] as const)('classifies HTTP %i without exposing provider body', async (status, kind) => {
    const error = await resolveVariantContext(target, {
      transport: { execute: async () => ({ status, requestId: 'req-1', body: { secret: 'synthetic-token' } }) },
    }).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ kind, correlation: { requestId: 'req-1' } });
    expect(String(error)).not.toContain('synthetic-token');
  });

  test('classifies GraphQL cost throttle and network failure', async () => {
    await expect(
      resolveVariantContext(target, {
        transport: {
          execute: async () => ({ status: 200, body: { errors: [{ extensions: { code: 'THROTTLED' } }] } }),
        },
      }),
    ).rejects.toMatchObject({ kind: 'throttled' });
    const failure = await resolveVariantContext(target, {
      transport: {
        execute: async () => {
          throw new Error('synthetic-token');
        },
      },
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ kind: 'network_or_timeout' });
    expect(String(failure)).not.toContain('synthetic-token');
  });

  test('batches a bounded size/color vector and rejects unbounded input', async () => {
    const variantIds = Array.from(
      { length: CONTEXTUAL_PRICING_BATCH_SIZE + 1 },
      (_, index) => `gid://shopify/ProductVariant/${index + 1}`,
    );
    const execute = vi.fn(async (request: { variables: { ids: readonly string[] } }) => ({
      status: 200,
      body: {
        data: {
          nodes: request.variables.ids.map((id) => ({
            __typename: 'ProductVariant',
            id,
            product: { id: target.productId },
            contextualPricing: { price: { amount: '12.00', currencyCode: 'EUR' } },
          })),
        },
      },
    }));
    const result = await resolveVariantContext({ ...target, variantIds }, { transport: { execute } });
    expect(result.map((snapshot) => snapshot.variantId)).toEqual(variantIds);
    expect(execute.mock.calls.map(([request]) => request.variables.ids.length)).toEqual([25, 1]);
    await expect(
      resolveVariantContext(
        {
          ...target,
          variantIds: Array.from(
            { length: CONTEXTUAL_PRICING_MAX_VARIANTS + 1 },
            (_, index) => `gid://shopify/ProductVariant/${index + 1}`,
          ),
        },
        { transport: { execute } },
      ),
    ).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  test('read-only HTTP transport uses the pinned endpoint and scoped injected credential', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(response().body, {
        headers: { 'x-request-id': 'req-123' },
      }),
    );
    const acquire = vi.fn(async () => ({
      kind: 'usable' as const,
      shopDomain: 'synthetic-store.myshopify.com',
      accessToken: 'synthetic-token',
      accessExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
    }));
    const transport = createShopifyAdminGraphqlReadTransport({ credentials: { acquire }, fetchImpl });
    const [snapshot] = await resolveVariantContext(target, { transport });
    expect(snapshot?.correlation).toEqual({ requestId: 'req-123' });
    expect(acquire).toHaveBeenCalledWith({ shopId: target.shopId, installationGeneration: '7' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://synthetic-store.myshopify.com/admin/api/2026-07/graphql.json');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.headers).toMatchObject({ 'x-shopify-access-token': 'synthetic-token' });
    expect(JSON.parse(init.body as string)).toMatchObject({ variables: { country: 'NL', ids: target.variantIds } });
  });

  test('uses an opaque M3 tenant ID and refuses an expiring token before HTTP', async () => {
    const fetchImpl = vi.fn();
    const transport = createShopifyAdminGraphqlReadTransport({
      credentials: {
        acquire: async () => ({
          kind: 'usable',
          shopDomain: 'synthetic-store.myshopify.com',
          accessToken: 'synthetic-token',
          accessExpiresAt: new Date('2026-09-29T12:00:29.000Z'),
        }),
      },
      now: () => new Date('2026-09-29T12:00:00.000Z'),
      fetchImpl,
    });
    await expect(
      resolveVariantContext({ ...target, shopId: '4ecf3cd6-9751-4280-acdc-59c817d401f0' }, { transport }),
    ).rejects.toMatchObject({ kind: 'reauth_required' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test.each([
    ['missing', 'credential_missing'],
    ['inactive', 'credential_inactive'],
    ['reauth_required', 'reauth_required'],
  ] as const)('credential state %s fails before HTTP', async (state, kind) => {
    const fetchImpl = vi.fn();
    const transport = createShopifyAdminGraphqlReadTransport({
      credentials: { acquire: async () => ({ kind: state }) },
      fetchImpl,
    });
    await expect(resolveVariantContext(target, { transport })).rejects.toMatchObject({ kind });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('rejects an untrusted credential host before HTTP and strips unsafe provider correlation', async () => {
    const fetchImpl = vi.fn();
    const transport = createShopifyAdminGraphqlReadTransport({
      credentials: {
        acquire: async () => ({
          kind: 'usable',
          shopDomain: 'synthetic-store.myshopify.com.evil.test',
          accessToken: 'synthetic-token',
          accessExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
        }),
      },
      fetchImpl,
    });
    await expect(resolveVariantContext(target, { transport })).rejects.toMatchObject({ kind: 'credential_inactive' });
    expect(fetchImpl).not.toHaveBeenCalled();

    const malformed = await resolveVariantContext(target, {
      transport: { execute: async () => ({ status: 429, requestId: 'synthetic\nsecret', body: null }) },
    }).catch((error: unknown) => error);
    expect(malformed).toMatchObject({ kind: 'throttled', correlation: { requestId: null } });
  });
});
