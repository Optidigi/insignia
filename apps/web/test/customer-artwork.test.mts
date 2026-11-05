import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type CustomerArtworkGrant,
  type CustomerArtworkStore,
  createCustomerArtworkLinks,
} from '@insignia/application';
import {
  type CustomerArtworkHttpServices,
  handleCustomerArtworkRequest,
  handleMerchantArtworkLinkRequest,
} from '../src/server/customer-artwork/http.ts';
import { actorFixture } from './http-fixtures.mts';

const purchaseId = '4ae66163-79b4-48fa-a8c6-f84b22c30f01';
const requestId = '4ae66163-79b4-48fa-a8c6-f84b22c30f02';
function fixture() {
  let saved: CustomerArtworkGrant | null = null;
  const store: CustomerArtworkStore = {
    async epoch() {
      return '4ae66163-79b4-48fa-a8c6-f84b22c30f03';
    },
    async issue(scope, input) {
      saved = {
        ...input,
        shopId: scope.shopId,
        installationGeneration: scope.installationGeneration,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        artworkVersion: 0,
        slots: [
          {
            groupIndex: 0,
            placementId: 'front',
            productId: '11',
            revisionId: purchaseId,
            methodId: 'print',
            stepId: 'small',
          },
        ],
      };
      return saved;
    },
    async resolve(hash) {
      return saved?.capabilityHash === hash ? saved : null;
    },
    async attach() {
      throw new Error('CUSTOMER_ARTWORK_UNAVAILABLE');
    },
    async revoke() {},
  };
  const links = createCustomerArtworkLinks({
    store,
    secret: 'test-only-customer-link-secret-at-least-32',
    appOrigin: 'https://insignia.test',
  });
  const services: CustomerArtworkHttpServices = {
    links,
    appOrigin: 'https://insignia.test',
    authenticate: async () => null,
    artwork: undefined,
    ensureInspectionReady: async () => {},
  };
  return { services, links };
}
test('customer route requires an explicit capability, accepts no tenant/purchase body authority and does not grant CORS', async () => {
  const { services, links } = fixture();
  const grant = await links.issue(
    { kind: 'merchant', shopId: 'shop-one', installationGeneration: '1' },
    { purchaseId, requestId },
  );
  const capability = grant.url.split('capability=')[1];
  const request = (body: unknown, token = capability) =>
    new Request('https://insignia.test/api/customer-artwork/v1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  assert.equal((await handleCustomerArtworkRequest(request({ action: 'view' }, ''), services)).status, 401);
  assert.equal(
    (await handleCustomerArtworkRequest(request({ action: 'view', shopId: 'another-shop' }), services)).status,
    422,
  );
  const response = await handleCustomerArtworkRequest(request({ action: 'view' }), services);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.match(response.headers.get('Cache-Control') ?? '', /no-store/);
  const body = await response.json();
  assert.equal(body.purchaseId, purchaseId);
  assert.equal(body.capabilityHash, undefined);
  assert.equal(body.shopId, undefined);
});
test('merchant link issuance requires real merchant authentication instead of treating customer bearer as staff authority', async () => {
  const { services } = fixture();
  const request = new Request(`https://insignia.test/api/admin/purchases/${purchaseId}/artwork-link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://insignia.test',
      Authorization: `Bearer ${'a'.repeat(64)}`,
    },
    body: JSON.stringify({ requestId }),
  });
  assert.equal((await handleMerchantArtworkLinkRequest(request, services, purchaseId)).status, 401);
});

test('merchant copy preflights the retained customer view and never returns an unusable portal link', async () => {
  const { services } = fixture();
  let previews = 0;
  services.authenticate = async () =>
    actorFixture({
      tenantShopId: 'shop-one',
      installationGeneration: '1',
      canReadOrders: true,
      canReadArtwork: true,
      canUploadArtwork: true,
      expiresAtMs: Date.now() + 60000,
    });
  services.view = async () => {
    previews++;
    throw new Error('CUSTOMER_ARTWORK_PREVIEW_UNAVAILABLE');
  };
  const request = () =>
    new Request(`https://insignia.test/api/admin/purchases/${purchaseId}/artwork-link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://insignia.test',
        Authorization: 'Bearer staff-token',
      },
      body: JSON.stringify({ requestId }),
    });
  const denied = await handleMerchantArtworkLinkRequest(request(), services, purchaseId);
  assert.equal(denied.status, 503);
  assert.equal((await denied.json()).url, undefined);
  assert.equal(previews, 1);
  services.view = async (token) => {
    assert.match(token, /^[a-f0-9]{64}$/);
    return { configuration: 'ready-test-only' };
  };
  const issued = await handleMerchantArtworkLinkRequest(request(), services, purchaseId);
  assert.equal(issued.status, 201);
  assert.match((await issued.json()).url, /\/artwork-upload#capability=/);
  assert.match(issued.headers.get('Cache-Control') ?? '', /no-store/);
});
