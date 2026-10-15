import { createHash } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';
import { createPartnerGraphqlTransport } from '../src/active-subscription.js';
import { createSubscriptionHistoryClient, PARTNER_HISTORY_QUERY } from '../src/subscription-history.js';

const appId = 'gid://shopify/App/123',
  shopId = 'gid://shopify/Shop/456';
const input = { appId, shopId, from: '2026-09-01T00:00:00.000Z', through: '2026-10-01T00:00:00.000Z' };
const event = (overrides: Record<string, unknown> = {}) => ({
  id: 'gid://partners/SubscriptionStatus/opaque-event-a',
  occurredAt: '2026-09-28T16:53:02.000000Z',
  eventType: 'SUBSCRIPTION_CREATED',
  shop: { id: shopId },
  subject: { id: appId },
  state: 'ACTIVE',
  cancelEffectiveOn: '2026-10-28',
  plan: { handle: 'synthetic_plan', billingPeriod: 'EVERY_30_DAYS', trialDays: 14, trialDaysRemaining: 0 },
  ...overrides,
});
const page = (nodes: unknown[] = [event()], pageInfo: unknown = { hasNextPage: false, endCursor: 'cursor-a' }) =>
  JSON.stringify({
    data: {
      events: {
        edges: nodes.map((node, index) => ({
          cursor: `cursor-${index < 2 ? String.fromCharCode(97 + index) : `row-${index}`}`,
          node,
        })),
        pageInfo,
      },
    },
  });
const client = (body: string) =>
  createSubscriptionHistoryClient({
    transport: { query: vi.fn(async () => body) },
    now: () => new Date('2026-10-15T00:00:00.000Z'),
  });

describe('one bounded Partner subscription history page', () => {
  test('normalizes observed six-fraction zero extension exactly and never asserts historical entitlement', async () => {
    const result = await client(page()).readPage(input);
    expect(result.events[0]).toMatchObject({
      occurredAt: '2026-09-28T16:53:02.000Z',
      cancelEffectiveOn: '2026-10-28',
      state: 'ACTIVE',
      plan: { trialDays: 14, trialDaysRemaining: 0 },
    });
    expect(result.trustedEntitlementIntervals).toBe(false);
    expect(result.pageInfo).toEqual({ hasNextPage: false, endCursor: 'cursor-a' });
    expect(createHash('sha256').update(PARTNER_HISTORY_QUERY).digest('hex')).toBe(
      'be6053318dfb479b3a07fca085a004ab78d1d4c30ed6c6130c3578e2498e8706',
    );
  });
  test('uses the existing bounded factory for the exact history read and forwards canonical scope/cursor', async () => {
    const fetchImpl = vi.fn(async () => new Response(page(), { status: 200 }));
    const transport = createPartnerGraphqlTransport({
      organizationId: '789',
      accessToken: 'synthetic-not-a-token',
      fetchImpl: fetchImpl as never,
    });
    const result = await createSubscriptionHistoryClient({ transport }).readPage({
      ...input,
      after: 'previous-cursor',
    });
    expect(result.after).toBe('previous-cursor');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, request] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://partners.shopify.com/789/api/2026-07/graphql.json');
    expect(request.redirect).toBe('error');
    expect(JSON.parse(request.body as string)).toEqual({
      query: PARTNER_HISTORY_QUERY,
      variables: { ...input, after: 'previous-cursor' },
    });
  });
  test('rejects invalid scope, bounds, precision and cursor before fetching, including direct factory calls', async () => {
    const bad = [
      { appId: 'gid://shopify/App/0' },
      { shopId: 'gid://shopify/Shop/other' },
      { from: '2026-02-30T00:00:00Z' },
      { from: '2026-09-01T00:00:00.123001Z' },
      { from: '2026-09-01T00:00:00-00:00' },
      { from: '2026-09-01T00:00:00+24:00' },
      { from: '2026-10-02T00:00:00Z' },
      { from: '2024-01-01T00:00:00Z' },
      { after: '' },
      { after: 'cursor\nother' },
    ];
    const fetchImpl = vi.fn(async () => new Response(page()));
    const transport = createPartnerGraphqlTransport({
      organizationId: '789',
      accessToken: 'synthetic-not-a-token',
      fetchImpl: fetchImpl as never,
    });
    for (const override of bad) {
      await expect(
        createSubscriptionHistoryClient({ transport }).readPage({ ...input, ...override }),
      ).rejects.toMatchObject({ kind: 'invalid_request' });
      await expect(
        transport.query({ query: PARTNER_HISTORY_QUERY, variables: { ...input, ...override } }),
      ).rejects.toMatchObject({ kind: 'invalid_request' });
    }
    await expect(transport.query({ query: 'mutation Unsafe { any }', variables: input })).rejects.toMatchObject({
      kind: 'invalid_request',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  test('preserves source state/date without inference and normalizes exact timezone offsets', async () => {
    const result = await client(
      page([event({ state: 'SOURCE_FUTURE_STATE', occurredAt: '2026-09-28T18:53:02.123000+02:00' })]),
    ).readPage(input);
    expect(result.events[0]).toMatchObject({
      state: 'SOURCE_FUTURE_STATE',
      occurredAt: '2026-09-28T16:53:02.123Z',
      cancelEffectiveOn: '2026-10-28',
    });
    expect(result.trustedEntitlementIntervals).toBe(false);
  });
  test('refuses precision loss, impossible dates, unsupported types and malformed plan fields', async () => {
    const bad = [
      { occurredAt: '2026-09-28T16:53:02.123001Z' },
      { occurredAt: '2026-09-28T16:53:02-00:00' },
      { occurredAt: '2026-02-30T00:00:00Z' },
      { occurredAt: '2026-10-02T00:00:00Z' },
      { cancelEffectiveOn: '2026-02-30' },
      { cancelEffectiveOn: '2026-10-28T00:00:00Z' },
      { eventType: 'SUBSCRIPTION_UNKNOWN' },
      { id: 'gid://shopify/Order/123' },
      { plan: { handle: 'plan', billingPeriod: 'UNKNOWN', trialDays: 14, trialDaysRemaining: 0 } },
      { plan: { handle: 'plan', billingPeriod: 'EVERY_30_DAYS', trialDays: 1.5, trialDaysRemaining: 0 } },
    ];
    for (const override of bad)
      await expect(client(page([event(override)])).readPage(input)).rejects.toMatchObject({
        kind: 'malformed_response',
      });
  });
  test('rejects partial GraphQL errors and mismatched app/shop on every event', async () => {
    const partial = JSON.parse(page());
    partial.errors = [{ message: 'synthetic partial failure' }];
    await expect(client(JSON.stringify(partial)).readPage(input)).rejects.toMatchObject({ kind: 'provider_error' });
    for (const override of [{ shop: { id: 'gid://shopify/Shop/999' } }, { subject: { id: 'gid://shopify/App/999' } }])
      await expect(client(page([event(override)])).readPage(input)).rejects.toMatchObject({ kind: 'scope_mismatch' });
  });
  test('returns pagination metadata without fetching another page and rejects duplicate/nonprogressing cursors or IDs', async () => {
    const query = vi.fn(async () => page([event()], { hasNextPage: true, endCursor: 'cursor-a' }));
    const result = await createSubscriptionHistoryClient({ transport: { query } }).readPage(input);
    expect(query).toHaveBeenCalledTimes(1);
    expect(result.pageInfo.hasNextPage).toBe(true);
    expect(result.trustedEntitlementIntervals).toBe(false);
    await expect(client(page()).readPage({ ...input, after: 'cursor-a' })).rejects.toMatchObject({
      kind: 'malformed_response',
    });
    await expect(
      client(page([event(), event()], { hasNextPage: false, endCursor: 'cursor-b' })).readPage(input),
    ).rejects.toMatchObject({ kind: 'malformed_response' });
    const duplicateCursor = JSON.parse(
      page([event(), event({ id: 'gid://partners/SubscriptionStatus/opaque-b' })], {
        hasNextPage: false,
        endCursor: 'cursor-b',
      }),
    );
    duplicateCursor.data.events.edges[1].cursor = 'cursor-a';
    await expect(client(JSON.stringify(duplicateCursor)).readPage(input)).rejects.toMatchObject({
      kind: 'malformed_response',
    });
    await expect(client(page([], { hasNextPage: true, endCursor: null })).readPage(input)).rejects.toMatchObject({
      kind: 'malformed_response',
    });
    expect((await client(page([], { hasNextPage: false, endCursor: null })).readPage(input)).events).toEqual([]);
  });
  test('bounds page size/body and returns sanitized failures rather than provider bodies', async () => {
    await expect(
      client(
        page(Array.from({ length: 251 }, (_, i) => event({ id: `gid://partners/SubscriptionStatus/${i}` }))),
      ).readPage(input),
    ).rejects.toMatchObject({ kind: 'malformed_response' });
    await expect(client(' '.repeat(262145)).readPage(input)).rejects.toMatchObject({ kind: 'malformed_response' });
    await expect(client('synthetic-invalid-json').readPage(input)).rejects.toMatchObject({
      kind: 'malformed_response',
    });
    const query = vi.fn(async () => {
      throw new Error('DO_NOT_ECHO_PRIVATE_PROVIDER_DETAILS');
    });
    await expect(createSubscriptionHistoryClient({ transport: { query } }).readPage(input)).rejects.toMatchObject({
      kind: 'network_or_timeout',
      message: 'Partner subscription history page read failed: network_or_timeout',
    });
  });

  test('honors inclusive event bounds and the exact 365-day request limit', async () => {
    const query = vi.fn(async () => page([event({ occurredAt: '2026-10-01T00:00:00.000000Z' })]));
    const result = await createSubscriptionHistoryClient({ transport: { query } }).readPage({
      ...input,
      from: '2025-10-01T00:00:00.000Z',
    });
    expect(result.events[0]?.occurredAt).toBe('2026-10-01T00:00:00.000Z');
    const tooWide = { ...input, from: '2025-09-30T23:59:59.999Z' };
    await expect(createSubscriptionHistoryClient({ transport: { query } }).readPage(tooWide)).rejects.toMatchObject({
      kind: 'invalid_request',
    });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
