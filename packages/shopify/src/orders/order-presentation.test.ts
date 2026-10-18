import { expect, test } from 'vitest';
import { readOrderPresentation } from './order-presentation.js';

const target = {
  orderId: 'gid://shopify/Order/1',
  lines: [
    {
      orderLineId: 'gid://shopify/LineItem/2',
      productId: 'gid://shopify/Product/3',
      variantId: 'gid://shopify/ProductVariant/4',
    },
  ],
};
const order = {
  id: target.orderId,
  name: '#1001',
  lineItems: {
    nodes: [
      {
        id: target.lines[0].orderLineId,
        title: 'Purchased shirt',
        variantTitle: 'Blue / L',
        product: { id: target.lines[0].productId },
        variant: { id: target.lines[0].variantId },
      },
    ],
    pageInfo: { hasNextPage: false },
  },
};
test('retained order labels bind to exact order and purchased line identities', async () => {
  const transport = { read: async () => ({ order }) };
  expect(await readOrderPresentation(transport, target)).toEqual({
    orderName: '#1001',
    lines: [{ orderLineId: target.lines[0].orderLineId, title: 'Purchased shirt', variantTitle: 'Blue / L' }],
  });
  await expect(
    readOrderPresentation({ read: async () => ({ order: { ...order, id: 'gid://shopify/Order/9' } }) }, target),
  ).rejects.toThrow();
  const foreign = structuredClone(order);
  foreign.lineItems.nodes[0].variant.id = 'gid://shopify/ProductVariant/9';
  expect((await readOrderPresentation({ read: async () => ({ order: foreign }) }, target))?.lines).toEqual([]);
});

test('presentation transport uses pinned read-only query and rejects revoked authorization', async () => {
  const { createOrderPresentationTransport } = await import('./order-presentation.js');
  let request: RequestInit | undefined;
  const transport = createOrderPresentationTransport({
    shop: 'fixture.myshopify.com',
    accessToken: 'synthetic',
    fetchImpl: async (url, init) => {
      expect(url).toBe('https://fixture.myshopify.com/admin/api/2026-07/graphql.json');
      request = init;
      return new Response(JSON.stringify({ data: { order } }));
    },
  });
  expect((await readOrderPresentation(transport, target))?.orderName).toBe('#1001');
  expect(JSON.parse(String(request?.body)).query).not.toMatch(/mutation|customer|email|shippingAddress/);
  const denied = createOrderPresentationTransport({
    shop: 'fixture.myshopify.com',
    accessToken: 'synthetic',
    fetchImpl: async () => new Response('', { status: 403 }),
  });
  await expect(readOrderPresentation(denied, target)).rejects.toThrow();
});
