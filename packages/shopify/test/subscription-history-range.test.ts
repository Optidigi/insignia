import { expect, test, vi } from 'vitest';
import { createSubscriptionHistoryClient } from '../src/subscription-history.js';

const scope = {
  appId: 'gid://shopify/App/123',
  shopId: 'gid://shopify/Shop/456',
  from: '2026-09-01T00:00:00.000Z',
  through: '2026-10-01T00:00:00.000Z',
};
function page(id: string, cursor: string, hasNextPage: boolean) {
  return JSON.stringify({
    data: {
      events: {
        edges: [
          {
            cursor,
            node: {
              id: `gid://partners/SubscriptionStatus/${id}`,
              occurredAt: '2026-09-28T16:53:02.000000Z',
              eventType: 'SUBSCRIPTION_CREATED',
              shop: { id: scope.shopId },
              subject: { id: scope.appId },
              state: 'CREATED',
              cancelEffectiveOn: null,
              plan: null,
            },
          },
        ],
        pageInfo: { hasNextPage, endCursor: cursor },
      },
    },
  });
}

test('reads all pages of one fixed scoped range without granting entitlement authority', async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce(page('newer', 'next', true))
    .mockResolvedValueOnce(page('older', 'last', false));
  const result = await createSubscriptionHistoryClient({ transport: { query } }).readRange(scope);
  expect(result.pagination).toBe('EXHAUSTED');
  expect(result.pagesRead).toBe(2);
  expect(result.events.map((e) => e.id)).toEqual([
    'gid://partners/SubscriptionStatus/newer',
    'gid://partners/SubscriptionStatus/older',
  ]);
  expect(result.trustedEntitlementIntervals).toBe(false);
  expect(result.nextCursor).toBe(null);
  expect(query.mock.calls.map(([call]) => call.variables)).toEqual([
    { ...scope, after: null },
    { ...scope, after: 'next' },
  ]);
});

test('rejects IDs or cursors repeated across pages instead of treating an exhausted chain as complete', async () => {
  for (const second of [page('same', 'last', false), page('other', 'first', false)]) {
    const query = vi
      .fn()
      .mockResolvedValueOnce(page('same', 'first', true))
      .mockResolvedValueOnce(page('middle', 'middle', true))
      .mockResolvedValueOnce(second);
    await expect(createSubscriptionHistoryClient({ transport: { query } }).readRange(scope)).rejects.toMatchObject({
      kind: 'malformed_response',
    });
    expect(query).toHaveBeenCalledTimes(3);
  }
});

test('stops at four pages and exposes the limit and continuation without claiming complete history', async () => {
  const query = vi.fn();
  for (let i = 0; i < 5; i++) query.mockResolvedValueOnce(page(`event-${i}`, `cursor-${i}`, true));
  const result = await createSubscriptionHistoryClient({ transport: { query } }).readRange(scope);
  expect(result).toMatchObject({
    pagination: 'PAGE_LIMIT',
    pagesRead: 4,
    nextCursor: 'cursor-3',
    trustedEntitlementIntervals: false,
  });
  expect(result.events).toHaveLength(4);
  expect(query).toHaveBeenCalledTimes(4);
});

test('a later failed page is not retried or returned as an exhausted partial result', async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce(page('first', 'next', true))
    .mockRejectedValueOnce(new Error('synthetic failure'));
  await expect(createSubscriptionHistoryClient({ transport: { query } }).readRange(scope)).rejects.toMatchObject({
    kind: 'network_or_timeout',
  });
  expect(query).toHaveBeenCalledTimes(2);
});

test('pins the canonical requested scope before the first asynchronous page read', async () => {
  const mutable = { ...scope };
  const query = vi
    .fn()
    .mockImplementationOnce(async () => {
      mutable.through = '2026-10-02T00:00:00.000Z';
      return page('newer', 'next', true);
    })
    .mockResolvedValueOnce(page('older', 'last', false));
  const result = await createSubscriptionHistoryClient({ transport: { query } }).readRange(mutable);
  expect(result.through).toBe(scope.through);
  expect(query.mock.calls[1]?.[0].variables.through).toBe(scope.through);
});
