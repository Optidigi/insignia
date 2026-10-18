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

test('retained order labels tolerate provider failure while expired or missing merchant access denies history', async () => {
  const record = { ...view, bindings: [], observations: [], artworkEvents: [] };
  let calls = 0;
  const services = createPurchaseServices({
    core: { purchases: { get: async () => record } },
    appOrigin: 'https://insignia.example',
    authenticate: async () => actor,
    orderPresentation: async () => {
      calls++;
      return { orderName: '#1001', lines: [] };
    },
  });
  assert.equal((await services.get(actor, id)).orderName, '#1001');
  await assert.rejects(services.get({ ...actor, canReadOrders: false }, id), { code: 'MERCHANT_REQUIRED' });
  await assert.rejects(services.get({ ...actor, expiresAtMs: 0 }, id), { code: 'MERCHANT_REQUIRED' });
  assert.equal(calls, 1);
  const unavailable = createPurchaseServices({
    core: { purchases: { get: async () => record } },
    appOrigin: 'https://insignia.example',
    authenticate: async () => actor,
    orderPresentation: async () => {
      throw Error('Provider unavailable');
    },
  });
  assert.equal((await unavailable.get(actor, id)).purchaseId, id);
  assert.equal((await unavailable.get(actor, id)).orderName, null);
});

test('purchase listing batches optional order names once and never performs per-purchase detail reads', async () => {
  const record = { ...view, bindings: [], observations: [], artworkEvents: [] };
  let batches = 0;
  const services = createPurchaseServices({
    core: { purchases: { list: async () => [record, record] } },
    appOrigin: 'https://insignia.example',
    authenticate: async () => actor,
    orderNames: async (_actor, ids) => {
      batches++;
      assert.deepEqual(ids, [record.orderId, record.orderId]);
      return { [record.orderId]: '#1001' };
    },
    orderPresentation: async () => {
      throw Error('No per-row lookup');
    },
  });
  const result = await services.list(actor, { limit: 10, before: null });
  assert.equal(batches, 1);
  assert.deepEqual(
    result.items.map((item) => item.orderName),
    ['#1001', '#1001'],
  );
});

test('expiry or installation/grant loss during optional label reads cannot return private purchase data', async () => {
  const record = { ...view, bindings: [], observations: [], artworkEvents: [] };
  for (const list of [false, true]) {
    for (const failure of ['expired', 'installation']) {
      const current = { ...actor, expiresAtMs: Date.now() + 60_000 };
      let active = true;
      const loseAccess = async () => {
        if (failure === 'expired') current.expiresAtMs = Date.now() - 1;
        else active = false;
        throw Error('Optional read failed');
      };
      const services = createPurchaseServices({
        core: { purchases: { get: async () => record, list: async () => [record] } },
        appOrigin: 'https://insignia.example',
        authenticate: async () => current,
        assertCurrentAccess: async () => {
          if (!active) throw Error('Current installation is inactive');
        },
        orderNames: loseAccess,
        orderPresentation: loseAccess,
      });
      const response = await handlePurchaseRequest(
        new Request(`https://insignia.example/api/purchases/v1/${list ? '' : id}`, {
          headers: { Authorization: 'Bearer synthetic' },
        }),
        services,
        list ? '' : id,
      );
      assert.equal(response.status, 403);
      const text = await response.text();
      assert.ok(!text.includes('originalTotalMinor') && !text.includes('purchaseId'));
    }
  }
});

test('empty retained order list does not query Shopify for labels', async () => {
  let calls = 0;
  const services = createPurchaseServices({
    core: { purchases: { list: async () => [] } },
    appOrigin: 'https://insignia.example',
    authenticate: async () => actor,
    orderNames: async () => {
      calls++;
      return {};
    },
  });
  assert.deepEqual((await services.list(actor, { limit: 10, before: null })).items, []);
  assert.equal(calls, 0);
});
