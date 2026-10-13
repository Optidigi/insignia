import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { readShopifyOrder } from '../../src/orders/read-order.js';

const now = new Date('2026-10-13T12:00:00Z');
const target = { shopId: 'tenant', installationGeneration: '1', orderId: 'gid://shopify/Order/100' };
const money = (amount: string) => ({ presentmentMoney: { amount, currencyCode: 'EUR' } });
const connection = (nodes: unknown[], more = false, cursor: string | null = null) => ({
  nodes,
  pageInfo: { hasNextPage: more, endCursor: cursor },
});
const line = (id = 'gid://shopify/LineItem/200') => ({
  id,
  product: { id: 'gid://shopify/Product/300' },
  variant: { id: 'gid://shopify/ProductVariant/400' },
  quantity: 3,
  currentQuantity: 2,
  originalUnitPriceSet: money('30.00'),
  sellingPlan: null,
  customAttributes: [
    { key: '_insignia_set', value: 'opaque-envelope' },
    { key: '_insignia_member', value: 'opaque-member' },
  ],
});
const tx = {
  id: 'gid://shopify/OrderTransaction/500',
  kind: 'SALE',
  status: 'SUCCESS',
  processedAt: '2026-10-12T12:05:00Z',
  amountSet: money('91.00'),
};
const order = () => ({
  id: target.orderId,
  checkoutToken: null as string | null,
  app: { id: 'gid://shopify/App/77' } as { id: string } | null,
  sourceName: 'web' as string | null,
  createdAt: '2026-10-12T12:00:00Z',
  processedAt: '2026-10-12T12:00:00Z',
  updatedAt: '2026-10-13T10:00:00Z',
  presentmentCurrencyCode: 'EUR',
  displayFinancialStatus: 'PARTIALLY_REFUNDED',
  edited: false,
  test: true,
  cancelledAt: null,
  originalTotalPriceSet: money('91.00'),
  transactionsCount: { count: 1, precision: 'EXACT' },
  transactions: [tx],
  refunds: [],
  lineItems: connection([line()]),
});
function fixture() {
  const credential = {
    kind: 'usable' as const,
    shopDomain: 'owned.myshopify.com',
    accessToken: 'synthetic-private-token',
    accessExpiresAt: new Date(+now + 60000),
  };
  const dependencies = {
    credentials: { acquire: vi.fn(async () => credential) },
    currency: { exponent: (code: string) => (code === 'EUR' ? 2 : null) },
    clock: () => now,
    fetchImpl: vi.fn(async () => new Response(JSON.stringify({ data: { order: order() } }))),
  };
  return dependencies;
}
describe('independent Shopify order reconciliation', () => {
  it('reads creator provenance independently without promoting it to checkout context authority', async () => {
    const d = fixture();
    const result = await readShopifyOrder(target, d);
    expect(result).toMatchObject({
      checkoutOrigin: { creatorAppId: 'gid://shopify/App/77', sourceName: 'web', checkoutTokenDigest: null },
      country: null,
      marketId: null,
      contextVerified: false,
    });
  });

  it('preserves unknown creator metadata and rejects malformed or changing origin reads', async () => {
    const d = fixture();
    d.fetchImpl.mockImplementation(
      async () => new Response(JSON.stringify({ data: { order: { ...order(), app: null, sourceName: null } } })),
    );
    expect((await readShopifyOrder(target, d)).checkoutOrigin).toEqual({
      creatorAppId: null,
      sourceName: null,
      checkoutTokenDigest: null,
    });
    for (const app of [undefined, { id: 'gid://shopify/Order/77' }, { id: 'not-an-id' }]) {
      d.fetchImpl.mockImplementation(
        async () => new Response(JSON.stringify({ data: { order: { ...order(), app } } })),
      );
      await expect(readShopifyOrder(target, d)).rejects.toThrow('invalid_provider_shape');
    }
    let reads = 0;
    d.fetchImpl.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              order: { ...order(), app: { id: reads++ === 0 ? 'gid://shopify/App/77' : 'gid://shopify/App/88' } },
            },
          }),
        ),
    );
    await expect(readShopifyOrder(target, d)).rejects.toThrow('order_changed');
  });

  it('retains only authenticated order checkout correlation digest without granting context authority', async () => {
    const d = fixture();
    const token = 'synthetic-original-checkout-token';
    d.fetchImpl.mockImplementation(
      async () => new Response(JSON.stringify({ data: { order: { ...order(), checkoutToken: token } } })),
    );
    const result = await readShopifyOrder(target, d);
    expect(result).toMatchObject({
      checkoutTokenDigest: createHash('sha256').update(token).digest('hex'),
      contextVerified: false,
      country: null,
      marketId: null,
    });
    expect(JSON.stringify(result)).not.toContain(token);
    const query = JSON.parse((d.fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).query;
    expect(query).toMatch(/checkoutToken/);
    let reads = 0;
    d.fetchImpl.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            data: { order: { ...order(), checkoutToken: reads++ === 0 ? token : 'different-checkout' } },
          }),
        ),
    );
    await expect(readShopifyOrder(target, d)).rejects.toThrow('order_changed');
    d.fetchImpl.mockImplementation(async () => new Response(JSON.stringify({ data: { order: order() } })));
    expect((await readShopifyOrder(target, d)).checkoutTokenDigest).toBeNull();
  });

  it('rejects missing or malformed checkout correlation fields without exporting raw tokens', async () => {
    for (const checkoutToken of [undefined, 42, '', 'x'.repeat(1025), 'invalid\u0000token']) {
      const d = fixture();
      d.fetchImpl.mockImplementation(
        async () => new Response(JSON.stringify({ data: { order: { ...order(), checkoutToken } } })),
      );
      await expect(readShopifyOrder(target, d)).rejects.toThrow('invalid_provider_shape');
    }
  });
  it('preserves original quantities, pre-discount economics and settled transaction timing without inventing Market context', async () => {
    const d = fixture();
    const result = await readShopifyOrder(target, d);
    expect(result).toMatchObject({
      orderId: target.orderId,
      currency: 'EUR',
      totalPriceMinor: '9100',
      contextVerified: false,
      country: null,
      marketId: null,
      complete: true,
      test: true,
      lines: [{ quantity: 3, currentQuantity: 2, originalUnitPriceMinor: '3000' }],
      transactions: [{ kind: 'SALE', status: 'SUCCESS', amountMinor: '9100', occurredAt: '2026-10-12T12:05:00.000Z' }],
    });
    expect(d.credentials.acquire).toHaveBeenCalledWith({ shopId: 'tenant', installationGeneration: '1' });
    const [url, init] = d.fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://owned.myshopify.com/admin/api/2026-07/graphql.json');
    expect(init.redirect).toBe('error');
    expect(JSON.parse(init.body as string).query).not.toMatch(/email|customer|shippingAddress|billingAddress/);
  });
  it('follows line connection cursors and rejects duplicate, stalled or changing pages', async () => {
    const d = fixture();
    d.fetchImpl.mockImplementation(async (_url?: unknown, init?: RequestInit) => {
      const after = JSON.parse(init!.body as string).variables.after;
      const o = order();
      if (after === null) o.lineItems = connection([line()], true, 'next');
      else if (after === 'next') o.lineItems = connection([line('gid://shopify/LineItem/201')]);
      return new Response(JSON.stringify({ data: { order: o } }));
    });
    const result = await readShopifyOrder(target, d);
    expect(result.lines.map((l) => l.lineId)).toEqual(['gid://shopify/LineItem/200', 'gid://shopify/LineItem/201']);
    expect(d.fetchImpl).toHaveBeenCalledTimes(3);
    d.fetchImpl.mockImplementation(async (_url?: unknown, init?: RequestInit) => {
      const after = JSON.parse(init!.body as string).variables.after;
      const o = order();
      o.lineItems = after === null ? connection([line()], true, 'next') : connection([line()]);
      return new Response(JSON.stringify({ data: { order: o } }));
    });
    await expect(readShopifyOrder(target, d)).rejects.toThrow('incomplete_order');
    d.fetchImpl.mockImplementation(async (_url?: unknown, init?: RequestInit) => {
      const after = JSON.parse(init!.body as string).variables.after;
      const o = order();
      o.lineItems = connection([line()], true, 'next');
      if (after === 'next') o.updatedAt = '2026-10-13T11:00:00Z';
      return new Response(JSON.stringify({ data: { order: o } }));
    });
    await expect(readShopifyOrder(target, d)).rejects.toThrow('order_changed');
  });
  it('paginates refund details and preserves a failed refund transaction without declaring returned money', async () => {
    const d = fixture(),
      refundId = 'gid://shopify/Refund/600',
      refundUpdated = '2026-10-13T10:00:00Z';
    const refundTx = {
      ...tx,
      id: 'gid://shopify/OrderTransaction/501',
      kind: 'REFUND',
      status: 'FAILURE',
      amountSet: money('30.00'),
    };
    d.fetchImpl.mockImplementation(async (_url?: unknown, init?: RequestInit) => {
      const request = JSON.parse(init!.body as string);
      if (request.query.includes('InsigniaPurchaseRefund')) {
        const base = {
          id: refundId,
          order: { id: target.orderId },
          updatedAt: refundUpdated,
          processedAt: refundUpdated,
          totalRefundedSet: money('30.00'),
        };
        return new Response(
          JSON.stringify({
            data: {
              refund: {
                ...base,
                ...(request.query.includes('refundLineItems')
                  ? {
                      refundLineItems: connection([
                        {
                          id: 'gid://shopify/RefundLineItem/700',
                          lineItem: { id: line().id },
                          quantity: 1,
                          subtotalSet: money('30.00'),
                        },
                      ]),
                    }
                  : { transactions: connection([refundTx]) }),
              },
            },
          }),
        );
      }
      const o = {
        ...order(),
        transactions: [tx, refundTx],
        transactionsCount: { count: 2, precision: 'EXACT' },
        refunds: [{ id: refundId, updatedAt: refundUpdated }],
      };
      return new Response(JSON.stringify({ data: { order: o } }));
    });
    const result = await readShopifyOrder(target, d);
    expect(result.refunds).toEqual([
      {
        refundId,
        occurredAt: '2026-10-13T10:00:00.000Z',
        currency: 'EUR',
        amountMinor: '3000',
        lines: [{ lineId: line().id, quantity: 1, amountMinor: '3000' }],
      },
    ]);
    expect(result.transactions[1]).toMatchObject({ kind: 'REFUND', status: 'FAILURE' });
    expect(d.fetchImpl).toHaveBeenCalledTimes(4);
  });
  it('never treats inaccessible, truncated, malformed or edited provider order data as a verified purchase', async () => {
    const d = fixture();
    for (const mutation of [
      (o: any) => {
        o.transactionsCount.count = 2;
      },
      (o: any) => {
        o.transactionsCount.precision = 'AT_LEAST';
      },
      (o: any) => {
        o.lines = [];
        o.lineItems.nodes[0].originalUnitPriceSet = money('30.001');
      },
      (o: any) => {
        o.lineItems.nodes[0].customAttributes.push({ ...o.lineItems.nodes[0].customAttributes[0] });
      },
      (o: any) => {
        o.id = 'gid://shopify/Order/999';
      },
      (o: any) => {
        o.originalTotalPriceSet = money('1e3');
      },
    ]) {
      const o = order();
      mutation(o);
      d.fetchImpl.mockImplementation(async () => new Response(JSON.stringify({ data: { order: o } })));
      await expect(readShopifyOrder(target, d)).rejects.toThrow();
    }
    for (const status of [401, 403, 429, 500]) {
      d.fetchImpl.mockImplementation(async () => new Response('{}', { status }));
      await expect(readShopifyOrder(target, d)).rejects.toThrow(
        status === 429 ? 'throttled' : status === 500 ? 'provider_unavailable' : 'access_denied',
      );
    }
    d.fetchImpl.mockImplementation(async () => new Response(JSON.stringify({ data: { order: null } })));
    await expect(readShopifyOrder(target, d)).rejects.toThrow('order_unavailable');
    d.fetchImpl.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            data: { order: order() },
            errors: [{ message: 'no order scope', extensions: { code: 'ACCESS_DENIED' } }],
          }),
        ),
    );
    await expect(readShopifyOrder(target, d)).rejects.toThrow('access_denied');
  });
  it('preserves unavailable pending transaction timing without substituting creation or observation time', async () => {
    const d = fixture();
    const o = order();
    o.transactions = [{ ...tx, status: 'PENDING', processedAt: null } as typeof tx];
    d.fetchImpl.mockImplementation(async () => new Response(JSON.stringify({ data: { order: o } })));
    expect((await readShopifyOrder(target, d)).transactions[0]).toMatchObject({ status: 'PENDING', occurredAt: null });
  });
  it('preserves edited-order payment and refund facts for an explicit application binding exception', async () => {
    const d = fixture(),
      o = order();
    o.edited = true;
    d.fetchImpl.mockImplementation(async () => new Response(JSON.stringify({ data: { order: o } })));
    expect(await readShopifyOrder(target, d)).toMatchObject({
      edited: true,
      transactions: [{ kind: 'SALE', amountMinor: '9100' }],
    });
  });
  it('accepts ordinary line attributes while preserving complete customized lines', async () => {
    const d = fixture(),
      o = order();
    o.lineItems.nodes = [
      line(),
      {
        ...line('gid://shopify/LineItem/201'),
        customAttributes: [{ key: 'Gift note', value: 'Happy birthday!\nLove from us' }],
      },
    ];
    d.fetchImpl.mockImplementation(async () => new Response(JSON.stringify({ data: { order: o } })));
    expect((await readShopifyOrder(target, d)).lines[1]!.attributes[0]!.value).toBe('Happy birthday!\nLove from us');
  });
  it('reads through a real HTTP wire with the fixed pinned query, credentials and final coherence read', async () => {
    let reads = 0;
    const server = createServer(async (req, res) => {
      expect(req.method).toBe('POST');
      expect(req.url).toBe('/admin/api/2026-07/graphql.json');
      expect(req.headers['x-shopify-access-token']).toBe('synthetic-private-token');
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      expect(body.variables.id).toBe(target.orderId);
      expect(body.query).not.toMatch(/mutation|customer|email/);
      reads++;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: { order: order() } }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('local server missing');
    const d = fixture();
    d.fetchImpl.mockImplementation(async (_url?: unknown, init?: RequestInit) =>
      fetch(`http://127.0.0.1:${address.port}/admin/api/2026-07/graphql.json`, init),
    );
    try {
      expect((await readShopifyOrder(target, d)).totalPriceMinor).toBe('9100');
      expect(reads).toBe(2);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
  it('bounds provider bytes and rejects identity drift in the final coherence read', async () => {
    const d = fixture();
    d.fetchImpl.mockImplementation(async () => new Response(' '.repeat(1024 * 1024 + 1)));
    await expect(readShopifyOrder(target, d)).rejects.toThrow('incomplete_order');
    let reads = 0;
    d.fetchImpl.mockImplementation(async () => {
      const o = order();
      if (++reads === 2) o.transactions[0] = { ...tx, amountSet: money('92.00') };
      return new Response(JSON.stringify({ data: { order: o } }));
    });
    await expect(readShopifyOrder(target, d)).rejects.toThrow('order_changed');
    d.credentials.acquire.mockClear();
    await expect(readShopifyOrder({ ...target, orderId: 'https://attacker.invalid/order' }, d)).rejects.toThrow(
      'invalid_request',
    );
    expect(d.credentials.acquire).not.toHaveBeenCalled();
  });
  it('requires generation-fenced usable credentials and bounds ignored-signal transport hangs', async () => {
    const d = fixture();
    d.credentials.acquire.mockImplementation(async () => ({
      ...(await fixture().credentials.acquire()),
      accessExpiresAt: new Date('invalid'),
    }));
    await expect(readShopifyOrder(target, d)).rejects.toThrow('credential_unavailable');
    expect(d.fetchImpl).not.toHaveBeenCalled();
    const h = fixture();
    vi.useFakeTimers();
    try {
      h.fetchImpl.mockImplementation(async () => new Promise<Response>(() => {}));
      const pending = readShopifyOrder(target, h);
      const assertion = expect(pending).rejects.toThrow('provider_unavailable');
      await vi.advanceTimersByTimeAsync(10001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
