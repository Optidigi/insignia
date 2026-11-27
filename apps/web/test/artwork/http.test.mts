import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ArtworkError, type ArtworkScope } from '@insignia/application';
import { type ArtworkHttpServices, handleArtworkRequest } from '../../src/server/artwork/http.ts';
import { artworkAdmission, artworkFixture, artworkStatus, required } from '../http-fixtures.mts';

const actor = {
  shop: 'alpha.myshopify.com',
  shopId: 'gid://shopify/Shop/1',
  installationId: 'i',
  tenantShopId: 'tenant-1',
  installationGeneration: '4',
  staffId: 's',
  sessionId: 'ss',
  expiresAtMs: Date.now() + 60000,
  canRead: true,
  canEdit: true,
  canReadArtwork: true,
  canUploadArtwork: true,
};
const calls: {
  scope: Parameters<ArtworkHttpServices['artwork']['begin']>[0];
  input: Parameters<ArtworkHttpServices['artwork']['begin']>[1];
}[] = [];
const services: ArtworkHttpServices = {
  appOrigin: 'https://app.example.test',
  authenticate: async () => actor,
  ensureInspectionReady: async () => {},
  artwork: artworkFixture({
    begin: async (scope, input) => {
      calls.push({ scope, input });
      return artworkAdmission({ assetId: 'a', state: 'UPLOADING' });
    },
  }),
};
const request = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://app.example.test/api/artwork', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer synthetic',
      Origin: 'https://app.example.test',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
test('authenticated declaration allocates for the verified tenant and generation only', async () => {
  const response = await handleArtworkRequest(request({ contentType: 'image/png', byteLength: 108 }), services, {
    kind: 'begin',
    audience: 'merchant',
  });
  assert.equal(response.status, 201);
  assert.deepEqual(required(calls.pop()).scope, { shopId: 'tenant-1', installationGeneration: '4', kind: 'merchant' });
  assert.equal(
    (
      await handleArtworkRequest(request({ contentType: 'image/png', byteLength: 108, shopId: 'foreign' }), services, {
        kind: 'begin',
        audience: 'merchant',
      })
    ).status,
    422,
  );
});
test('anonymous, read-only, expired and cross-site clients never allocate; inspection absence fails closed', async () => {
  const body = { contentType: 'image/png', byteLength: 108 };
  const route = { kind: 'begin' as const, audience: 'merchant' as const };
  assert.equal((await handleArtworkRequest(request(body, { Authorization: '' }), services, route)).status, 401);
  assert.equal(
    (await handleArtworkRequest(request(body, { Origin: 'https://evil.example' }), services, route)).status,
    403,
  );
  assert.equal(
    (
      await handleArtworkRequest(
        request(body),
        { ...services, authenticate: async () => ({ ...actor, canEdit: false, canUploadArtwork: false }) },
        route,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleArtworkRequest(
        request(body),
        { ...services, authenticate: async () => ({ ...actor, expiresAtMs: 0 }) },
        route,
      )
    ).status,
    401,
  );
  assert.equal(
    (await handleArtworkRequest(request(body), { ...services, ensureInspectionReady: undefined }, route)).status,
    503,
  );
  assert.equal((await handleArtworkRequest(request({ ...body, byteLength: 5242881 }), services, route)).status, 422);
});
test('guest reads require verified proxy and owner capability; guest original download is denied', async () => {
  const assetId = 'ae771020-1f54-47ab-a8af-48b1eb7de3d2';
  const req = new Request(`https://app.example.test/api/artwork/guest/${assetId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ capability: 'synthetic' }),
  });
  assert.equal((await handleArtworkRequest(req, services, { kind: 'status', assetId, audience: 'guest' })).status, 401);
  assert.equal(
    (await handleArtworkRequest(req, services, { kind: 'download', assetId, audience: 'guest' })).status,
    403,
  );
  let observed: ArtworkScope | undefined;
  const guest: ArtworkHttpServices = {
    ...services,
    verifyGuest: async () => ({
      kind: 'guest',
      shopId: 'tenant-2',
      installationGeneration: '9',
      ownerHash: 'a'.repeat(64),
    }),
    artwork: artworkFixture({
      status: async (scope) => {
        observed = scope;
        return artworkStatus({ state: 'QUEUED' });
      },
    }),
  };
  const response = await handleArtworkRequest(req, guest, { kind: 'status', assetId, audience: 'guest' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).state, 'QUEUED');
  assert.equal(required(observed).ownerHash, 'a'.repeat(64));
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});
test('processing and expired assets produce no preview URL, and resource lookup uses the current authenticated generation', async () => {
  const { ArtworkError } = await import('@insignia/application');
  const assetId = 'ae771020-1f54-47ab-a8af-48b1eb7de3d2';
  let scope: ArtworkScope | undefined;
  const reading = {
    ...services,
    artwork: artworkFixture({
      preview: async (value) => {
        scope = value;
        throw new ArtworkError('NOT_USABLE');
      },
      status: async () => {
        throw new ArtworkError('EXPIRED');
      },
    }),
  };
  const req = new Request(`https://app.example.test/api/artwork/${assetId}/preview`, {
    headers: { Authorization: 'Bearer synthetic' },
  });
  const response = await handleArtworkRequest(req, reading, { kind: 'preview', audience: 'merchant', assetId });
  assert.equal(response.status, 409);
  assert.equal('url' in (await response.json()), false);
  assert.equal(required(scope).installationGeneration, '4');
  assert.equal(
    (await handleArtworkRequest(req, reading, { kind: 'status', audience: 'merchant', assetId })).status,
    410,
  );
});

test('product-only staff cannot obtain private originals or previews', async () => {
  const assetId = 'ae771020-1f54-47ab-a8af-48b1eb7de3d2';
  let reads = 0;
  const restricted = {
    ...services,
    authenticate: async () => ({ ...actor, canReadArtwork: undefined, canUploadArtwork: undefined }),
    artwork: artworkFixture({
      download: async () => {
        reads++;
        throw new Error('Original lookup forbidden in this fixture');
      },
      preview: async () => {
        reads++;
        throw new Error('Preview lookup forbidden in this fixture');
      },
    }),
  };
  for (const kind of ['download', 'preview'] as const) {
    const req = new Request(`https://app.example.test/api/artwork/${assetId}/${kind}`, {
      headers: { Authorization: 'Bearer synthetic' },
    });
    assert.equal((await handleArtworkRequest(req, restricted, { kind, assetId, audience: 'merchant' })).status, 403);
  }
  assert.equal(reads, 0);
});

test('guest begin, complete and status emit one bounded timing line each; merchant routes emit none', async () => {
  const { ArtworkError } = await import('@insignia/application');
  const assetId = 'ae771020-1f54-47ab-a8af-48b1eb7de3d2';
  const lines: Record<string, unknown>[] = [];
  const timing = (value: object) => lines.push({ ...value });
  const guestRequest = (body: Record<string, unknown> = {}) =>
    new Request('https://app.example.test/api/artwork/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capability: 'synthetic', ...body }),
    });
  let inspectionReady = true;
  const guest: ArtworkHttpServices = {
    ...services,
    verifyGuest: async () => ({ kind: 'guest', shopId: 't', installationGeneration: '1', ownerHash: 'a'.repeat(64) }),
    ensureInspectionReady: async () => {
      if (!inspectionReady) throw new Error('worker unavailable');
    },
    artwork: artworkFixture({
      begin: async () => artworkAdmission({ assetId, state: 'UPLOADING' }),
      complete: async () => artworkStatus({ assetId, state: 'QUEUED' }),
      status: async () => {
        throw new ArtworkError('EXPIRED');
      },
    }),
  };
  const begin = await handleArtworkRequest(
    guestRequest({ contentType: 'image/png', byteLength: 108 }),
    guest,
    { kind: 'begin', audience: 'guest' },
    timing,
  );
  assert.equal(begin.status, 201);
  await handleArtworkRequest(guestRequest(), guest, { kind: 'complete', assetId, audience: 'guest' }, timing);
  await handleArtworkRequest(guestRequest(), guest, { kind: 'status', assetId, audience: 'guest' }, timing);
  inspectionReady = false;
  await handleArtworkRequest(
    guestRequest({ contentType: 'image/png', byteLength: 108 }),
    guest,
    { kind: 'begin', audience: 'guest' },
    timing,
  );
  await handleArtworkRequest(
    guestRequest(),
    { ...guest, verifyGuest: async () => null },
    { kind: 'status', assetId, audience: 'guest' },
    timing,
  );
  await handleArtworkRequest(
    request({ contentType: 'image/png', byteLength: 108 }),
    services,
    { kind: 'begin', audience: 'merchant' },
    timing,
  );
  assert.equal(lines.length, 5);
  for (const line of lines) {
    assert.match(String(line.correlationId), /^[0-9a-f-]{36}$/);
    assert.ok(Number.isInteger(line.totalMs) && Number(line.totalMs) >= 0);
  }
  assert.deepEqual(
    lines.map(({ correlationId: _id, totalMs: _ms, ...line }) => line),
    [
      { operation: 'begin', outcome: 'success', httpStatus: 201, assetId, state: 'UPLOADING' },
      { operation: 'complete', outcome: 'success', httpStatus: 202, assetId, state: 'QUEUED' },
      { operation: 'status', outcome: 'failure', httpStatus: 410, assetId, failure: 'EXPIRED' },
      { operation: 'begin', outcome: 'failure', httpStatus: 503, failure: 'INSPECTION_UNAVAILABLE' },
      { operation: 'status', outcome: 'failure', httpStatus: 401, assetId, failure: 'AUTHENTICATION_REQUIRED' },
    ],
  );
});
test('an exhausted upload quota is a 429 with its code and Retry-After, which the app proxy passes through (#336)', async () => {
  const lines: Record<string, unknown>[] = [];
  const limited: ArtworkHttpServices = {
    ...services,
    verifyGuest: async () => ({ kind: 'guest', shopId: 't', installationGeneration: '1', ownerHash: 'a'.repeat(64) }),
    artwork: artworkFixture({
      begin: async () => {
        throw new ArtworkError('RATE_LIMITED', 120);
      },
    }),
  };
  const response = await handleArtworkRequest(
    new Request('https://app.example.test/api/artwork/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capability: 'synthetic', contentType: 'image/png', byteLength: 108 }),
    }),
    limited,
    { kind: 'begin', audience: 'guest' },
    (value) => lines.push({ ...value }),
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '120');
  assert.equal((await response.json()).code, 'RATE_LIMITED');
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.failure, 'RATE_LIMITED');
});

const failureAssetId = 'ae771020-1f54-47ab-a8af-48b1eb7de3d2';
test('storefront guest upload requests the lock bound and reports a retryable refusal without an upload grant', async () => {
  const lines: Record<string, unknown>[] = [];
  const response = await handleArtworkRequest(
    request({ capability: 'synthetic', contentType: 'image/png', byteLength: 108 }),
    {
      ...services,
      verifyGuest: async () => ({ kind: 'guest', shopId: 't', installationGeneration: '1', ownerHash: 'a'.repeat(64) }),
      artwork: artworkFixture({
        begin: async (_scope, _declaration, options) => {
          assert.deepEqual(options, { boundLockWait: true });
          throw new ArtworkError('BUSY', 1);
        },
      }),
    },
    { kind: 'begin', audience: 'guest' },
    (value) => lines.push({ ...value }),
  );
  assert.equal(response.status, 409);
  assert.equal(response.headers.get('Retry-After'), '1');
  const body = await response.json();
  assert.equal(body.code, 'BUSY');
  assert.equal(body.retryable, true);
  assert.equal(body.assetId, undefined);
  assert.equal(lines[0]?.failure, 'BUSY');
});

const failureSecret = 'password=SECRET-9f2c for alpha.myshopify.com gid://shopify/Product/10485042479387';
const merchantPreview = () =>
  new Request(`https://app.example.test/api/artwork/${failureAssetId}/preview`, {
    headers: { Authorization: 'Bearer synthetic' },
  });
const guestRead = () =>
  new Request(`https://app.example.test/api/artwork/guest/${failureAssetId}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ capability: 'synthetic' }),
  });
const verifyGuest = async (): Promise<ArtworkScope> => ({
  kind: 'guest',
  shopId: 'tenant-2',
  installationGeneration: '9',
  ownerHash: 'a'.repeat(64),
});

test('an unexpected merchant artwork failure is recorded by safe fields only and keeps the same 503', async () => {
  const admin: unknown[] = [];
  const buyer: unknown[] = [];
  const failing = (recordAdminFailure: (failure: unknown) => void): ArtworkHttpServices => ({
    ...services,
    recordAdminFailure,
    recordBuyerFailure: (failure) => buyer.push(failure),
    artwork: artworkFixture({
      preview: async () => {
        throw Object.assign(new RangeError(failureSecret), { code: 'ERR_INJECTED_FAILURE' });
      },
      begin: async () => {
        throw new Error(failureSecret);
      },
    }),
  });
  const recording = failing((failure) => admin.push(failure));
  const read = await handleArtworkRequest(merchantPreview(), recording, {
    kind: 'preview',
    audience: 'merchant',
    assetId: failureAssetId,
  });
  assert.equal(read.status, 503);
  assert.deepEqual(await read.json(), { code: 'UNAVAILABLE', error: 'Artwork unavailable' });
  assert.equal(admin.length, 1);
  const failure = admin[0] as Record<string, unknown>;
  assert.deepEqual(Object.keys(failure).sort(), ['adminRoute', 'errorClass', 'errorCode', 'errorSite', 'httpMethod']);
  assert.equal(failure.adminRoute, 'merchant-artwork');
  assert.equal(failure.httpMethod, 'GET');
  assert.equal(failure.errorClass, 'RangeError');
  assert.equal(failure.errorCode, 'ERR_INJECTED_FAILURE');
  assert.match(String(failure.errorSite), /^apps\/web\/test\/artwork\/http\.test\.mts:[1-9][0-9]*$/);

  const begun = await handleArtworkRequest(request({ contentType: 'image/png', byteLength: 108 }), recording, {
    kind: 'begin',
    audience: 'merchant',
  });
  assert.equal(begun.status, 503);
  assert.deepEqual(await begun.json(), { code: 'UNAVAILABLE', error: 'Artwork unavailable' });
  assert.deepEqual(
    { ...(admin[1] as object), errorSite: undefined },
    { adminRoute: 'merchant-artwork', httpMethod: 'POST', errorClass: 'Error', errorSite: undefined },
  );
  assert.deepEqual(buyer, []);
  assert.doesNotMatch(JSON.stringify(admin), /SECRET|myshopify|gid:|10485042479387|synthetic|ae771020/i);

  const still = await handleArtworkRequest(
    merchantPreview(),
    failing(() => {
      throw new Error('recorder down');
    }),
    { kind: 'preview', audience: 'merchant', assetId: failureAssetId },
  );
  assert.equal(still.status, 503);
  assert.deepEqual(await still.json(), { code: 'UNAVAILABLE', error: 'Artwork unavailable' });
});

test('an unexpected guest artwork failure is recorded as a buyer failure and keeps the same 503', async () => {
  const admin: unknown[] = [];
  const buyer: unknown[] = [];
  const lines: Record<string, unknown>[] = [];
  const failing = (recordBuyerFailure: (failure: unknown) => void): ArtworkHttpServices => ({
    ...services,
    verifyGuest,
    recordAdminFailure: (failure) => admin.push(failure),
    recordBuyerFailure,
    artwork: artworkFixture({
      preview: async () => {
        throw Object.assign(new RangeError(failureSecret), { code: 'ERR_INJECTED_FAILURE' });
      },
      status: async () => {
        throw new TypeError(failureSecret);
      },
    }),
  });
  const recording = failing((failure) => buyer.push(failure));
  const preview = await handleArtworkRequest(guestRead(), recording, {
    kind: 'preview',
    audience: 'guest',
    assetId: failureAssetId,
  });
  assert.equal(preview.status, 503);
  assert.deepEqual(await preview.json(), { code: 'UNAVAILABLE', error: 'Artwork unavailable' });
  const status = await handleArtworkRequest(
    guestRead(),
    recording,
    { kind: 'status', audience: 'guest', assetId: failureAssetId },
    (value) => lines.push({ ...value }),
  );
  assert.equal(status.status, 503);
  assert.deepEqual(await status.json(), { code: 'UNAVAILABLE', error: 'Artwork unavailable' });
  assert.equal(buyer.length, 2);
  for (const failure of buyer as Record<string, unknown>[]) {
    assert.deepEqual(Object.keys(failure).sort(), ['buyerStage', 'correlationId', 'errorClass']);
    assert.equal(failure.buyerStage, 'artwork');
    assert.match(String(failure.correlationId), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  }
  assert.equal((buyer[0] as Record<string, unknown>).errorClass, 'UnexpectedFailure');
  assert.equal((buyer[1] as Record<string, unknown>).errorClass, 'TypeError');
  // The failure line correlates with the guest timing line of the same request.
  assert.equal(lines.length, 1);
  assert.equal((buyer[1] as Record<string, unknown>).correlationId, lines[0]?.correlationId);
  assert.deepEqual(admin, []);
  assert.doesNotMatch(JSON.stringify(buyer), /SECRET|myshopify|gid:|10485042479387|synthetic|ae771020/i);

  const still = await handleArtworkRequest(
    guestRead(),
    failing(() => {
      throw new Error('recorder down');
    }),
    { kind: 'preview', audience: 'guest', assetId: failureAssetId },
  );
  assert.equal(still.status, 503);
  assert.deepEqual(await still.json(), { code: 'UNAVAILABLE', error: 'Artwork unavailable' });
});

test('handled artwork outcomes are not recorded as unexpected failures', async () => {
  const recorded: unknown[] = [];
  let thrown: unknown;
  const recording: ArtworkHttpServices = {
    ...services,
    verifyGuest,
    recordAdminFailure: (failure) => recorded.push(failure),
    recordBuyerFailure: (failure) => recorded.push(failure),
    artwork: artworkFixture({
      preview: async () => {
        throw thrown;
      },
    }),
  };
  const merchant = { kind: 'preview', audience: 'merchant', assetId: failureAssetId } as const;
  const guest = { kind: 'preview', audience: 'guest', assetId: failureAssetId } as const;
  const codes = ['INVALID_INPUT', 'NOT_FOUND', 'EXPIRED', 'NOT_USABLE', 'CONFLICT', 'RATE_LIMITED', 'UNAVAILABLE'];
  for (const code of codes) {
    thrown = new ArtworkError(code as ArtworkError['code']);
    await handleArtworkRequest(merchantPreview(), recording, merchant);
    await handleArtworkRequest(guestRead(), recording, guest);
  }
  const authFailing: ArtworkHttpServices = {
    ...recording,
    authenticate: async () => {
      throw new Error(failureSecret);
    },
    verifyGuest: async () => {
      throw new Error(failureSecret);
    },
  };
  assert.equal((await handleArtworkRequest(merchantPreview(), authFailing, merchant)).status, 503);
  assert.equal((await handleArtworkRequest(guestRead(), authFailing, guest)).status, 503);
  const anonymous = { ...recording, authenticate: async () => null, verifyGuest: async () => null };
  assert.equal((await handleArtworkRequest(merchantPreview(), anonymous, merchant)).status, 401);
  assert.equal((await handleArtworkRequest(guestRead(), anonymous, guest)).status, 401);
  const invalid = request({ contentType: 'image/png', byteLength: 0 });
  assert.equal((await handleArtworkRequest(invalid, recording, { kind: 'begin', audience: 'merchant' })).status, 422);
  assert.deepEqual(recorded, []);
});
