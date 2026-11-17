import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type CustomerArtworkGrant,
  type CustomerArtworkStore,
  createCustomerArtworkLinks,
} from '@insignia/application';
import { AdminOnlineIdentityError } from '@insignia/shopify';
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

const linkRequest = (body: unknown = { requestId }) =>
  new Request(`https://insignia.test/api/admin/purchases/${purchaseId}/artwork-link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://insignia.test',
      Authorization: 'Bearer staff-token',
    },
    body: JSON.stringify(body),
  });
const linkActor = () =>
  actorFixture({
    tenantShopId: 'shop-one',
    installationGeneration: '1',
    canReadOrders: true,
    canReadArtwork: true,
    canUploadArtwork: true,
    expiresAtMs: Date.now() + 60000,
  });
const linkSecret = 'password=SECRET-9f2c for alpha.myshopify.com gid://shopify/Order/10485042479387';

test('an unexpected artwork-link failure is recorded by safe fields only and keeps the same 503', async () => {
  const recorded: unknown[] = [];
  const failing = (recordAdminFailure: (failure: unknown) => void): CustomerArtworkHttpServices => {
    const { services } = fixture();
    services.authenticate = async () => linkActor();
    services.recordAdminFailure = recordAdminFailure;
    services.links = {
      ...services.links,
      issue: async () => {
        throw Object.assign(new RangeError(linkSecret), { code: 'ERR_INJECTED_FAILURE' });
      },
    };
    return services;
  };
  const failed = await handleMerchantArtworkLinkRequest(
    linkRequest(),
    failing((failure) => recorded.push(failure)),
    purchaseId,
  );
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: 'Customer artwork link unavailable' });
  assert.equal(recorded.length, 1);
  const failure = recorded[0] as Record<string, unknown>;
  assert.deepEqual(Object.keys(failure).sort(), ['adminRoute', 'errorClass', 'errorCode', 'errorSite', 'httpMethod']);
  assert.equal(failure.adminRoute, 'artwork-link');
  assert.equal(failure.httpMethod, 'POST');
  assert.equal(failure.errorClass, 'RangeError');
  assert.equal(failure.errorCode, 'ERR_INJECTED_FAILURE');
  assert.match(String(failure.errorSite), /^apps\/web\/test\/customer-artwork\.test\.mts:[1-9][0-9]*$/);
  assert.doesNotMatch(JSON.stringify(recorded), /SECRET|myshopify|gid:|10485042479387|staff-token|4ae66163|shop-one/i);

  const still = await handleMerchantArtworkLinkRequest(
    linkRequest(),
    failing(() => {
      throw new Error('recorder down');
    }),
    purchaseId,
  );
  assert.equal(still.status, 503);
  assert.deepEqual(await still.json(), { error: 'Customer artwork link unavailable' });
});

test('handled artwork-link outcomes are not recorded as unexpected failures', async () => {
  const recorded: unknown[] = [];
  const { services } = fixture();
  services.recordAdminFailure = (failure) => recorded.push(failure);
  let authenticate: () => Promise<unknown> = async () => linkActor();
  services.authenticate = async () => (await authenticate()) as Awaited<ReturnType<typeof linkActor>>;
  const statusFor = async (body?: unknown, id = purchaseId) =>
    (await handleMerchantArtworkLinkRequest(linkRequest(body), services, id)).status;
  // Authentication outcomes are observed by admin_authentication, not as unexpected failures.
  for (const stage of ['ONLINE_EXCHANGE_REFRESH_REQUIRED', 'ONLINE_EXCHANGE_FAILED'] as const) {
    authenticate = async () => {
      throw new AdminOnlineIdentityError(stage);
    };
    await statusFor();
  }
  authenticate = async () => {
    throw new Error(linkSecret);
  };
  assert.equal(await statusFor(), 503);
  authenticate = async () => {
    throw Object.assign(new Error('Shopify throttled'), { transient: true });
  };
  assert.equal(await statusFor(), 409);
  authenticate = async () => null;
  assert.equal(await statusFor(), 401);
  authenticate = async () => linkActor();
  assert.equal(await statusFor({ requestId, extra: true }), 422);
  assert.equal(await statusFor(undefined, 'not-a-purchase'), 404);
  services.links = {
    ...services.links,
    issue: async () => {
      throw new Error('CUSTOMER_ARTWORK_UNAVAILABLE');
    },
  };
  assert.equal(await statusFor(), 409);
  assert.deepEqual(recorded, []);
});

const customerRequest = (body: unknown, token: string) =>
  new Request('https://insignia.test/api/customer-artwork/v1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
async function customerCapability(links: CustomerArtworkHttpServices['links']) {
  const grant = await links.issue(
    { kind: 'merchant', shopId: 'shop-one', installationGeneration: '1' },
    { purchaseId, requestId },
  );
  return String(grant.url.split('capability=')[1]);
}
async function snapshot(response: Response) {
  return { status: response.status, headers: [...response.headers], body: await response.text() };
}

test('an unexpected customer-artwork failure records one buyer failure and keeps the same 503', async () => {
  const recorded: unknown[] = [];
  const { services, links } = fixture();
  const capability = await customerCapability(links);
  services.recordBuyerFailure = (failure) => recorded.push(failure);
  services.view = async () => {
    throw Object.assign(new RangeError(linkSecret), { code: 'ERR_INJECTED_FAILURE' });
  };
  const failed = await handleCustomerArtworkRequest(customerRequest({ action: 'view' }, capability), services);
  const expected = {
    status: 503,
    headers: [
      ['cache-control', 'private, no-store'],
      ['content-type', 'application/json'],
      ['referrer-policy', 'no-referrer'],
      ['x-content-type-options', 'nosniff'],
    ],
    body: JSON.stringify({ error: 'Customer artwork temporarily unavailable' }),
  };
  assert.deepEqual(await snapshot(failed), expected);
  services.view = async () => {
    throw new TypeError(linkSecret);
  };
  assert.deepEqual(
    await snapshot(await handleCustomerArtworkRequest(customerRequest({ action: 'view' }, capability), services)),
    expected,
  );
  assert.equal(recorded.length, 2);
  for (const failure of recorded as Record<string, unknown>[]) {
    assert.deepEqual(Object.keys(failure).sort(), ['buyerStage', 'correlationId', 'errorClass']);
    assert.equal(failure.buyerStage, 'customer-artwork');
    assert.match(String(failure.correlationId), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  }
  assert.deepEqual(
    (recorded as Record<string, unknown>[]).map((failure) => failure.errorClass),
    ['UnexpectedFailure', 'TypeError'],
  );
  assert.doesNotMatch(
    JSON.stringify(recorded),
    new RegExp(`SECRET|myshopify|gid:|10485042479387|ERR_INJECTED|shop-one|${capability}|${purchaseId}`, 'i'),
  );

  services.recordBuyerFailure = () => {
    throw new Error('recorder down');
  };
  assert.deepEqual(
    await snapshot(await handleCustomerArtworkRequest(customerRequest({ action: 'view' }, capability), services)),
    expected,
  );
});

test('handled customer-artwork outcomes are not recorded as unexpected failures', async () => {
  const recorded: unknown[] = [];
  const { services, links } = fixture();
  const capability = await customerCapability(links);
  services.recordBuyerFailure = (failure) => recorded.push(failure);
  const status = async (body: unknown, token = capability) =>
    (await handleCustomerArtworkRequest(customerRequest(body, token), services)).status;
  assert.equal(
    (await handleCustomerArtworkRequest(customerRequest({ action: 'view' }, capability), undefined)).status,
    503,
  );
  assert.equal(await status({ action: 'view' }, ''), 401);
  assert.equal(await status({ action: 'view', shopId: 'another-shop' }), 422);
  // An unknown capability and a refused attachment are the link's own handled outcome.
  assert.equal(await status({ action: 'view' }, 'b'.repeat(64)), 409);
  assert.equal(
    await status({
      action: 'attach',
      assetId: purchaseId,
      groupIndex: 0,
      placementId: 'front',
      expectedVersion: 0,
      requestId,
    }),
    409,
  );
  // Processing not composed is a handled 503.
  assert.equal(await status({ action: 'status', assetId: purchaseId }), 503);
  let thrown: unknown;
  const fail = async () => {
    throw thrown;
  };
  services.artwork = { begin: fail, complete: fail, status: fail, preview: fail };
  for (const [code, expected] of [
    ['INVALID_INPUT', 422],
    ['UNAVAILABLE', 503],
    ['EXPIRED', 410],
    ['NOT_FOUND', 404],
    ['NOT_USABLE', 409],
    ['CONFLICT', 409],
  ] as const) {
    thrown = Object.assign(new Error(linkSecret), { code });
    assert.equal(await status({ action: 'status', assetId: purchaseId }), expected);
  }
  assert.equal(await status({ action: 'status', assetId: 'not-an-asset' }), 422);
  assert.deepEqual(recorded, []);
});
