import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handlePurchaseRequest } from '../src/server/purchase/http.ts';
import { createPurchaseServices } from '../src/server/purchase/service.ts';

const id = 'd841ee12-2075-4101-b3bc-429ad31a4059';
const actor = {
  shop: 'synthetic.myshopify.com',
  shopId: 'gid://shopify/Shop/1',
  installationId: 'installed',
  tenantShopId: 'tenant',
  installationGeneration: '2',
  staffId: 'staff',
  sessionId: 'session',
  expiresAtMs: Date.now() + 60000,
  canRead: true,
  canEdit: true,
  canReadOrders: true,
  canReadArtwork: true,
  canUploadArtwork: true,
};
const view = {
  version: 'm8-purchase-v1',
  isTest: true,
  purchaseId: id,
  orderId: 'gid://shopify/Order/1',
  orderCreatedAt: '2026-10-13T10:00:00Z',
  currency: 'USD',
  exponent: 2,
  originalTotalMinor: '100',
  firstPaidAt: null,
  financialStatus: 'PENDING',
  cancelledAt: null,
  exceptions: [],
  artworkVersion: 0,
  artworkState: 'PENDING_ARTWORK',
  refunds: [],
  lines: [],
  groups: [],
  artworkEvents: [],
};
test('merchant reconciliation calls only existing worker schedule, without provider reads or fact writes', async () => {
  const calls = [];
  const services = createPurchaseServices({
    core: {
      purchases: {
        requestReconciliation: async (scope, purchaseId) => calls.push({ scope, purchaseId }),
        get: () => {
          throw Error('No synchronous read for scheduling');
        },
        getOffer: () => {
          throw Error('No worker history authority');
        },
        reconcile: () => {
          throw Error('No web economic writes');
        },
      },
    },
    appOrigin: 'https://insignia.example',
    authenticate: async () => actor,
    orders: {
      read: () => {
        throw Error('No web provider read');
      },
    },
  });
  await services.reconcile(actor, id);
  assert.deepEqual(calls, [
    { scope: { shopId: 'tenant', installationGeneration: '2', kind: 'merchant' }, purchaseId: id },
  ]);
});
test('authenticated known-purchase request responds202 with unchanged view; denied origins/permissions do not schedule', async () => {
  let calls = 0;
  const services = {
    appOrigin: 'https://insignia.example',
    authenticate: async () => actor,
    reconcile: async () => {
      calls++;
    },
    get: async () => view,
  };
  const request = (origin = 'https://insignia.example', body = {}) =>
    new Request(`https://insignia.example/api/purchases/v1/${id}/reconcile`, {
      method: 'POST',
      headers: { Authorization: 'Bearer synthetic', Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const response = await handlePurchaseRequest(request(), services, `${id}/reconcile`);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), view);
  assert.equal(calls, 1);
  assert.equal(
    (await handlePurchaseRequest(request('https://foreign.example'), services, `${id}/reconcile`)).status,
    403,
  );
  assert.equal(
    (await handlePurchaseRequest(request(undefined, { force: true }), services, `${id}/reconcile`)).status,
    400,
  );
  services.authenticate = async () => ({ ...actor, canUploadArtwork: false });
  assert.equal((await handlePurchaseRequest(request(), services, `${id}/reconcile`)).status, 403);
  assert.equal(calls, 1);
});
