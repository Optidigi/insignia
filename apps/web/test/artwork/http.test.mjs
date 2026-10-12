import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleArtworkRequest } from '../../src/server/artwork/http.ts';

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
};
const calls = [];
const services = {
  appOrigin: 'https://app.example.test',
  authenticate: async () => actor,
  ensureInspectionReady: async () => {},
  artwork: {
    begin: async (scope, input) => {
      calls.push({ scope, input });
      return { assetId: 'a', state: 'UPLOADING' };
    },
  },
};
const request = (body, headers = {}) =>
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
  assert.deepEqual(calls.pop().scope, { shopId: 'tenant-1', installationGeneration: '4', kind: 'merchant' });
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
  const route = { kind: 'begin', audience: 'merchant' };
  assert.equal((await handleArtworkRequest(request(body, { Authorization: '' }), services, route)).status, 401);
  assert.equal(
    (await handleArtworkRequest(request(body, { Origin: 'https://evil.example' }), services, route)).status,
    403,
  );
  assert.equal(
    (
      await handleArtworkRequest(
        request(body),
        { ...services, authenticate: async () => ({ ...actor, canEdit: false }) },
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
  let observed;
  const guest = {
    ...services,
    verifyGuest: async () => ({
      kind: 'guest',
      shopId: 'tenant-2',
      installationGeneration: '9',
      ownerHash: 'a'.repeat(64),
    }),
    artwork: {
      status: async (scope) => {
        observed = scope;
        return { state: 'QUEUED' };
      },
    },
  };
  const response = await handleArtworkRequest(req, guest, { kind: 'status', assetId, audience: 'guest' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).state, 'QUEUED');
  assert.equal(observed.ownerHash, 'a'.repeat(64));
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});
test('processing and expired assets produce no preview URL, and resource lookup uses the current authenticated generation', async () => {
  const { ArtworkError } = await import('@insignia/application');
  const assetId = 'ae771020-1f54-47ab-a8af-48b1eb7de3d2';
  let scope;
  const reading = {
    ...services,
    artwork: {
      preview: async (value) => {
        scope = value;
        throw new ArtworkError('NOT_USABLE');
      },
      status: async () => {
        throw new ArtworkError('EXPIRED');
      },
    },
  };
  const req = new Request(`https://app.example.test/api/artwork/${assetId}/preview`, {
    headers: { Authorization: 'Bearer synthetic' },
  });
  const response = await handleArtworkRequest(req, reading, { kind: 'preview', audience: 'merchant', assetId });
  assert.equal(response.status, 409);
  assert.equal('url' in (await response.json()), false);
  assert.equal(scope.installationGeneration, '4');
  assert.equal(
    (await handleArtworkRequest(req, reading, { kind: 'status', audience: 'merchant', assetId })).status,
    410,
  );
});
