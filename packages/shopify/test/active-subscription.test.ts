import { describe, expect, test, vi } from 'vitest';
import {
  ACTIVE_SUBSCRIPTION_QUERY,
  createActiveSubscriptionClient,
  createPartnerGraphqlTransport,
  PartnerSubscriptionError,
} from '../src/active-subscription.js';

const appId = 'gid://shopify/App/123';
const shopId = 'gid://shopify/Shop/456';
const flat = (handle = 'plan.alpha', amount = '29.00') => ({
  handle,
  price: { __typename: 'FlatRatePrice', active: true, currency: 'USD', amount },
  discount: null,
  usage: null,
});
const tiered = (handle = 'meter.orders', mode = 'GRADUATED') => ({
  handle,
  price: {
    __typename: 'TieredPrice',
    active: true,
    currency: 'USD',
    tiersMode: mode,
    tiers: [
      { upTo: 10, amountPerUnit: '0.00', amount: '0.00' },
      { upTo: null, amountPerUnit: '0.125', amount: '0.00' },
    ],
  },
  discount: null,
  usage: { quantity: 3.25, cost: { amount: '0.000', currencyCode: 'USD' } },
});
const contract = (overrides: Record<string, unknown> = {}) => ({
  app: { id: appId },
  shop: { id: shopId },
  billingPeriod: 'EVERY_30_DAYS',
  cancelAtEndOfCycle: false,
  trialEndsAt: null,
  currentBillingCycle: { startTime: '2026-09-01T00:00:00Z', endTime: '2026-10-01T00:00:00Z' },
  items: [flat()],
  pendingUpdate: null,
  ...overrides,
});
const response = (value: unknown) => JSON.stringify({ data: { activeSubscription: value } });
const client = (body: string) =>
  createActiveSubscriptionClient({
    transport: { query: vi.fn(async () => body) },
    now: () => new Date('2026-09-29T12:00:00Z'),
  });

describe('Partner activeSubscription normalization', () => {
  test('null is normal no-contract state and query is read-only with IDs', async () => {
    const query = vi.fn(async () => response(null));
    const result = await createActiveSubscriptionClient({
      transport: { query },
      now: () => new Date('2026-09-29T12:00:00Z'),
    }).read({ appId, shopId });
    expect(result).toMatchObject({
      schemaVersion: 'm4-active-subscription-v1',
      sourceApiVersion: '2026-07',
      active: false,
      appId,
      shopId,
      observedAt: '2026-09-29T12:00:00.000Z',
      items: [],
    });
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { appId, shopId },
        query: expect.stringContaining('activeSubscription(appId: $appId, shopId: $shopId)'),
      }),
    );
  });
  test('normalizes flat, usage, both tier modes, discount and exact decimals independent of item order', async () => {
    const items = [
      flat('plan.alpha', '0.000'),
      tiered(),
      {
        ...tiered('meter.volume', 'VOLUME'),
        discount: {
          amount: '1.005',
          percentage: 12.125,
          originalDiscountCycles: 3,
          remainingDiscountCycles: 2,
          discountEndsAt: '2026-11-01T00:00:00Z',
        },
      },
    ];
    const a = await client(response(contract({ items }))).read({ appId, shopId });
    const b = await client(response(contract({ items: [...items].reverse() }))).read({ appId, shopId });
    expect(a).toEqual(b);
    expect(a.items.find((item) => item.handle === 'plan.alpha')?.price).toMatchObject({
      kind: 'flat',
      amount: '0.000',
    });
    expect(a.items.find((item) => item.handle === 'meter.orders')?.price).toMatchObject({
      kind: 'tiered',
      tiersMode: 'GRADUATED',
      tiers: [
        { upTo: 10, amountPerUnit: '0.00', amount: '0.00' },
        { upTo: null, amountPerUnit: '0.125', amount: '0.00' },
      ],
    });
    expect(a.items.find((item) => item.handle === 'meter.orders')?.usage).toMatchObject({
      quantity: '3.25',
      cost: { amount: '0.000' },
    });
    expect(a.items.find((item) => item.handle === 'meter.volume')?.price).toMatchObject({ tiersMode: 'VOLUME' });
    expect(a.items.find((item) => item.handle === 'meter.volume')?.discount).toMatchObject({
      amount: '1.005',
      percentage: '12.125',
    });
  });
  test('trial, scheduled cancellation and pending update stay separate from current items', async () => {
    const trial = await client(
      response(
        contract({
          trialEndsAt: '2026-10-04T00:00:00Z',
          currentBillingCycle: null,
          cancelAtEndOfCycle: true,
          pendingUpdate: {
            billingPeriod: 'EVERY_30_DAYS',
            items: [{ handle: 'plan.beta', price: { __typename: 'FlatRatePrice', amount: '99.00' } }],
            legacySubscriptionId: null,
          },
        }),
      ),
    ).read({ appId, shopId });
    expect(trial).toMatchObject({
      trialEndsAt: '2026-10-04T00:00:00.000Z',
      currentBillingCycle: null,
      cancelAtEndOfCycle: true,
      pendingUpdate: { itemHandles: ['plan.beta'] },
    });
    expect(trial.items.map((item) => item.handle)).toEqual(['plan.alpha']);
  });
  test('preserves exact wire Float values including exponent notation', async () => {
    const wire = response(contract({ items: [flat(), tiered()] })).replace('"quantity":3.25', '"quantity":1e-7');
    const result = await client(wire).read({ appId, shopId });
    expect(result.items.find((item) => item.handle === 'meter.orders')?.usage?.quantity).toBe('0.0000001');
  });
  test.each([
    [contract({ items: [flat('Same'), flat('Same')] }), 'malformed_response'],
    [contract({ items: [flat('Case'), flat('case')] }), null],
    [contract({ trialEndsAt: '2026-10-04T00:00:00Z' }), 'malformed_response'],
    [contract({ currentBillingCycle: null }), 'malformed_response'],
    [contract({ trialEndsAt: '2026-02-30T00:00:00Z', currentBillingCycle: null }), 'malformed_response'],
    [contract({ shop: { id: 'gid://shopify/Shop/999' } }), 'malformed_response'],
    [contract({ items: [{ ...flat(), price: { ...flat().price, amount: 1.2 } }] }), 'malformed_response'],
    [
      contract({
        items: [
          {
            ...tiered(),
            price: {
              ...tiered().price,
              tiers: [
                { upTo: 10, amountPerUnit: '0.00', amount: '0.00' },
                { upTo: 5, amountPerUnit: '0.125', amount: '0.00' },
              ],
            },
          },
        ],
      }),
      'malformed_response',
    ],
    [
      contract({
        pendingUpdate: { billingPeriod: 'EVERY_30_DAYS', items: [{ handle: 'plan.beta' }, { handle: 'plan.beta' }] },
      }),
      'malformed_response',
    ],
  ])('handles provider contradictions and case-sensitive handles', async (value, kind) => {
    const operation = client(response(value)).read({ appId, shopId });
    if (kind) await expect(operation).rejects.toMatchObject({ kind });
    else expect((await operation).items).toHaveLength(2);
  });
  test.each([
    [{ message: 'Only public apps can access active subscription' }, 'app_not_public'],
    [{ message: 'Shop not found' }, 'shop_not_found'],
    [{ message: 'Feature not enabled for the organization' }, 'feature_unavailable'],
    [{ message: 'Forbidden', extensions: { code: '403' } }, 'auth_or_permission'],
    [{ message: 'Throttled', extensions: { code: '429' } }, 'rate_limited'],
  ])('classifies GraphQL errors without leaking provider text', async (error, kind) => {
    const caught = await client(JSON.stringify({ errors: [error] }))
      .read({ appId, shopId })
      .catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(PartnerSubscriptionError);
    expect(caught).toMatchObject({ kind });
    expect(String(caught)).not.toContain(error.message);
  });
  test('HTTP transport pins endpoint and classifies network, auth and throttle', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: { activeSubscription: null } }));
    const transport = createPartnerGraphqlTransport({
      organizationId: '12345',
      accessToken: 'synthetic-token',
      fetchImpl,
    });
    await transport.query({ query: ACTIVE_SUBSCRIPTION_QUERY, variables: { appId, shopId } });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://partners.shopify.com/12345/api/2026-07/graphql.json');
    await expect(
      transport.query({ query: 'mutation { destroyEverything }', variables: { appId, shopId } }),
    ).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shopify-access-token': 'synthetic-token' },
    });
    for (const [status, kind] of [
      [401, 'auth_or_permission'],
      [403, 'auth_or_permission'],
      [429, 'rate_limited'],
    ] as const) {
      const failing = createPartnerGraphqlTransport({
        organizationId: '12345',
        accessToken: 'synthetic-token',
        fetchImpl: vi.fn(async () => new Response('', { status })),
      });
      await expect(
        failing.query({ query: ACTIVE_SUBSCRIPTION_QUERY, variables: { appId, shopId } }),
      ).rejects.toMatchObject({
        kind,
      });
    }
    const failing = createPartnerGraphqlTransport({
      organizationId: '12345',
      accessToken: 'synthetic-token',
      fetchImpl: vi.fn(async () => {
        throw new Error('synthetic-token');
      }),
    });
    await expect(
      failing.query({ query: ACTIVE_SUBSCRIPTION_QUERY, variables: { appId, shopId } }),
    ).rejects.toMatchObject({
      kind: 'network_or_timeout',
    });
  });
  test('bounds provider bodies and rejects malformed JSON', async () => {
    const transport = createPartnerGraphqlTransport({
      organizationId: '12345',
      accessToken: 'synthetic-token',
      fetchImpl: vi.fn(async () => new Response('x'.repeat(257 * 1024))),
    });
    await expect(
      transport.query({ query: ACTIVE_SUBSCRIPTION_QUERY, variables: { appId, shopId } }),
    ).rejects.toMatchObject({
      kind: 'malformed_response',
    });
    await expect(client('{bad json').read({ appId, shopId })).rejects.toMatchObject({ kind: 'malformed_response' });
  });
});
