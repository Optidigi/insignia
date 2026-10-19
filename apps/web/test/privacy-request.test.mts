import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handlePurchaseRequest } from '../src/server/purchase/http.ts';
import { createPurchaseServices } from '../src/server/purchase/service.ts';
import { coreFixture, purchaseHttpFixture, required } from './http-fixtures.mts';

const inbox = '83cec3c3-6010-4941-9743-99ea655a9999';
const manifest = {
  requestId: 'request',
  receivedAt: '2026-10-19T00:00:00Z',
  fulfillBy: '2026-11-19T00:00:00Z',
  requestedOrderCount: 1,
  matchedPurchaseCount: 1,
};
const purchase = '9f959f81-f169-4848-a190-0b0059db8888';
const actor = {
  shop: 'synthetic.myshopify.com',
  shopId: 'gid://shopify/Shop/1',
  installationId: 'installed',
  tenantShopId: 'tenant-a',
  installationGeneration: '3',
  staffId: 'staff',
  sessionId: 'session',
  expiresAtMs: Date.now() + 60000,
  canRead: true,
  canEdit: true,
  canReadOrders: true,
  canReadArtwork: true,
};
test('privacy download authenticates the merchant and fences every manifest and order export to its shop/generation', async () => {
  const seen: Parameters<ReturnType<typeof coreFixture>['customerPrivacy']['listDataRequests']>[0][] = [];
  let identity = actor;
  const services = createPurchaseServices({
    appOrigin: 'https://app.example',
    authenticate: async () => identity,
    core: coreFixture({
      purchases: {},
      customerPrivacy: {
        async listDataRequests(scope) {
          seen.push(scope);
          return [{ ...manifest, inboxId: inbox }];
        },
        async readDataRequest(scope, id) {
          seen.push(scope);
          return id === inbox
            ? { ...manifest, inboxId: inbox, orders: [{ orderId: '123', purchaseId: purchase }] }
            : null;
        },
        async exportOrder(scope, id, order) {
          seen.push(scope);
          return id === inbox && order === purchase ? { order: { originalTotalMinor: '2001' } } : null;
        },
      },
    }),
  });
  const request = (route: string) =>
    new Request(`https://app.example/api/purchases/v1/${route}`, { headers: { Authorization: 'Bearer synthetic' } });
  assert.equal((await handlePurchaseRequest(request('privacy'), services, 'privacy')).status, 200);
  const result = await handlePurchaseRequest(
    request(`privacy/${inbox}/orders/${purchase}`),
    services,
    `privacy/${inbox}/orders/${purchase}`,
  );
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { order: { originalTotalMinor: '2001' } });
  assert.match(required(result.headers.get('Cache-Control')), /no-store/);
  assert.deepEqual(seen, [
    { shopId: 'tenant-a', installationGeneration: '3', kind: 'merchant' },
    { shopId: 'tenant-a', installationGeneration: '3', kind: 'merchant' },
  ]);
  assert.equal(
    (await handlePurchaseRequest(new Request('https://app.example/api/purchases/v1/privacy'), services, 'privacy'))
      .status,
    401,
  );
  identity = { ...actor, canReadArtwork: false };
  assert.equal((await handlePurchaseRequest(request('privacy'), services, 'privacy')).status, 403);
  assert.equal(seen.length, 2);
});

test('bounded individual design export accepts a retained payload above1MiB and rejects unknown shapes', async () => {
  const set = 'a6b0764e-82a3-4a9b-aa27-b9f091d27777';
  const payload = 'x'.repeat(1048576);
  const services = purchaseHttpFixture({
    appOrigin: 'https://app.example',
    authenticate: async () => actor,
    privacyOrder: async (_actor, requestId, orderId, setId) =>
      requestId === inbox && orderId === purchase && setId === set ? { designs: [{ payload }] } : null,
  });
  const path = `privacy/${inbox}/orders/${purchase}/sets/${set}`;
  const request = new Request(`https://app.example/api/purchases/v1/${path}`, {
    headers: { Authorization: 'Bearer synthetic' },
  });
  const result = await handlePurchaseRequest(request, services, path);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).designs[0].payload.length, 1048576);
  assert.equal((await handlePurchaseRequest(request, services, `${path}/extra`)).status, 404);
});
