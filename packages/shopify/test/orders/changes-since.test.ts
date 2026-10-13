import { describe, expect, it, vi } from 'vitest';
import { readShopifyOrderChanges } from '../../src/orders/read-order.js';

const now = new Date('2026-10-13T12:00:00Z');
const target = {
  shopId: 'tenant',
  installationGeneration: '1',
  since: '2026-10-12T12:00:00.000Z',
  until: now.toISOString(),
  cursor: null,
};
function fixture() {
  return {
    clock: () => now,
    credentials: {
      acquire: vi.fn(async () => ({
        kind: 'usable' as const,
        shopDomain: 'owned.myshopify.com',
        accessToken: 'synthetic-private-token',
        accessExpiresAt: new Date(+now + 60000),
      })),
    },
    fetchImpl: vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              orders: {
                nodes: [{ id: 'gid://shopify/Order/100', updatedAt: '2026-10-13T10:00:00Z' }],
                pageInfo: { hasNextPage: true, endCursor: 'next' },
              },
            },
          }),
        ),
    ),
  };
}
describe('missing-webhook order discovery', () => {
  it('returns only bounded independently read IDs and cursor with a fixed updated-at window and stable sort', async () => {
    const d = fixture(),
      result = await readShopifyOrderChanges(target, d);
    expect(result).toEqual({
      shopId: 'tenant',
      installationGeneration: '1',
      since: target.since,
      until: target.until,
      orders: [{ orderId: 'gid://shopify/Order/100', updatedAt: '2026-10-13T10:00:00.000Z' }],
      nextCursor: 'next',
      observedAt: now.toISOString(),
    });
    const [, init] = d.fetchImpl.mock.calls[0] as unknown as [string, RequestInit],
      body = JSON.parse(init.body as string);
    expect(body.query).toContain('sortKey:UPDATED_AT');
    expect(body.query).not.toMatch(/customer|email|originalUnitPrice/);
    expect(body.variables).toEqual({
      after: null,
      query: "updated_at:>='2026-10-12T12:00:00.000Z' AND updated_at:<='2026-10-13T12:00:00.000Z'",
    });
    d.fetchImpl.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ data: { orders: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }),
        ),
    );
    await readShopifyOrderChanges({ ...target, cursor: 'next' }, d);
    expect(
      JSON.parse((d.fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body as string).variables.query,
    ).toBe(body.variables.query);
  });
  it('rejects invalid windows and incomplete/outside-window/duplicate/unsorted provider pages', async () => {
    const d = fixture();
    for (const change of [
      { since: 'not-date' },
      { until: '2026-10-14T12:00:00Z' },
      { since: '2026-10-13T13:00:00Z' },
      { cursor: 'x'.repeat(1025) },
    ])
      await expect(readShopifyOrderChanges({ ...target, ...change }, d)).rejects.toThrow('invalid_request');
    expect(d.credentials.acquire).not.toHaveBeenCalled();
    for (const nodes of [
      [],
      [{ id: 'gid://shopify/Order/100', updatedAt: '2026-10-11T12:00:00Z' }],
      [
        { id: 'gid://shopify/Order/100', updatedAt: '2026-10-13T11:00:00Z' },
        { id: 'gid://shopify/Order/100', updatedAt: '2026-10-13T11:00:00Z' },
      ],
      [
        { id: 'gid://shopify/Order/100', updatedAt: '2026-10-13T11:00:00Z' },
        { id: 'gid://shopify/Order/101', updatedAt: '2026-10-13T10:00:00Z' },
      ],
    ]) {
      d.fetchImpl.mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ data: { orders: { nodes, pageInfo: { hasNextPage: true, endCursor: 'next' } } } }),
          ),
      );
      await expect(readShopifyOrderChanges(target, d)).rejects.toThrow();
    }
  });
});
