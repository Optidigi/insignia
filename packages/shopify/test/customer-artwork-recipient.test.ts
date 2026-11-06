import { expect, it } from 'vitest';
import { createCustomerArtworkRecipientReader } from '../src/orders/customer-artwork-recipient.js';

const target = { shopId: 'shop', installationGeneration: '1', orderId: 'gid://shopify/Order/123' };
const now = new Date('2026-11-05T12:00:00Z');
it('reads only exact owned order email through the scoped credential and omits names/addresses from its static query', async () => {
  let body: Record<string, unknown> | undefined;
  const reader = createCustomerArtworkRecipientReader({
    clock: () => now,
    credentials: {
      acquire: async () => ({
        kind: 'usable',
        shopDomain: 'fixture.myshopify.com',
        accessToken: 'synthetic-only',
        authorizationBinding: 'epoch-one',
        accessExpiresAt: new Date(+now + 60000),
      }),
    },
    fetchImpl: async (url, init) => {
      expect(String(url)).toBe('https://fixture.myshopify.com/admin/api/2026-07/graphql.json');
      body = JSON.parse(String(init?.body));
      return Response.json({ data: { order: { id: target.orderId, email: 'buyer@example.test', cancelledAt: null } } });
    },
  });
  expect(await reader.read(target)).toBe('buyer@example.test');
  expect(body?.variables).toEqual({ id: target.orderId });
  expect(String(body?.query)).not.toMatch(/customer|shippingAddress|billingAddress|phone/);
});
it('denied protected field, mismatched order, cancellation and installation loss remain unavailable instead of fabricating a recipient', async () => {
  for (const response of [
    { errors: [{ message: 'Protected customer data denied' }] },
    { data: { order: { id: 'gid://shopify/Order/999', email: 'other@example.test', cancelledAt: null } } },
    { data: { order: { id: target.orderId, email: 'buyer@example.test', cancelledAt: now.toISOString() } } },
  ]) {
    const reader = createCustomerArtworkRecipientReader({
      clock: () => now,
      credentials: {
        acquire: async () => ({
          kind: 'usable',
          shopDomain: 'fixture.myshopify.com',
          accessToken: 'synthetic-only',
          authorizationBinding: 'epoch-one',
          accessExpiresAt: new Date(+now + 60000),
        }),
      },
      fetchImpl: async () => Response.json(response),
    });
    expect(await reader.read(target)).toBeNull();
  }
  let reads = 0;
  const reader = createCustomerArtworkRecipientReader({
    clock: () => now,
    credentials: {
      acquire: async () =>
        ++reads === 1
          ? {
              kind: 'usable',
              shopDomain: 'fixture.myshopify.com',
              accessToken: 'synthetic-only',
              authorizationBinding: 'epoch-one',
              accessExpiresAt: new Date(+now + 60000),
            }
          : { kind: 'inactive' },
    },
    fetchImpl: async () =>
      Response.json({ data: { order: { id: target.orderId, email: 'buyer@example.test', cancelledAt: null } } }),
  });
  expect(await reader.read(target)).toBeNull();
});

it('a changed authorization epoch after the protected query discards the recipient', async () => {
  let reads = 0;
  const reader = createCustomerArtworkRecipientReader({
    clock: () => now,
    credentials: {
      acquire: async () => ({
        kind: 'usable',
        shopDomain: 'fixture.myshopify.com',
        accessToken: 'synthetic-only',
        authorizationBinding: ++reads === 1 ? 'epoch-one' : 'epoch-two',
        accessExpiresAt: new Date(+now + 60000),
      }),
    },
    fetchImpl: async () =>
      Response.json({ data: { order: { id: target.orderId, email: 'buyer@example.test', cancelledAt: null } } }),
  });
  expect(await reader.read(target)).toBeNull();
});
