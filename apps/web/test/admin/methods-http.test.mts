import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleAdminRequest } from '../../src/server/admin/http.ts';
import { MethodAuthorizationError } from '../../src/server/admin/methods.ts';
import { adminServices } from './support/fixtures.mts';

const actor = {
  shop: 'example.myshopify.com',
  shopId: 'gid://shopify/Shop/1',
  installationId: 'i',
  tenantShopId: 'tenant',
  installationGeneration: '1',
  staffId: 'staff',
  sessionId: 's',
  expiresAtMs: Date.now() + 600000,
  canRead: true,
  canEdit: true,
};
const id = 'cc756ade-f50a-4f5c-94b7-fd320a7a75e6';
function request(method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return new Request('https://app.example/api/admin/methods', {
    method,
    headers: {
      Authorization: 'Bearer synthetic',
      Origin: 'https://app.example',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'method-key-1',
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
test('method library boundary authenticates reads and validates scoped edits before invoking service', async () => {
  let calls = 0;
  const method = { id, name: 'Embroidery', version: '1' };
  const services = adminServices({
    appOrigin: 'https://app.example',
    authenticate: async () => actor,
    methods: {
      list: async (a) => {
        assert.equal(a, actor);
        calls++;
        return { methods: [method] };
      },
      create: async (a, name, key) => {
        assert.equal(a, actor);
        assert.equal(name, 'Embroidery');
        assert.equal(key, 'method-key-1');
        calls++;
        return { kind: 'created', method };
      },
      rename: async () => ({ kind: 'conflict', message: 'Reload' }),
      delete: async () => ({ kind: 'deleted' }),
    },
  });
  let res = await handleAdminRequest(request(), services, { kind: 'methods' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { methods: [method] });
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  res = await handleAdminRequest(request('POST', { name: ' Embroidery ' }), services, { kind: 'methods' });
  assert.equal(res.status, 201);
  assert.equal(
    (await handleAdminRequest(request('POST', { name: 'x'.repeat(81) }), services, { kind: 'methods' })).status,
    422,
  );
  assert.equal(
    (await handleAdminRequest(request('POST', { name: 'Embroidery', shopId: 'other' }), services, { kind: 'methods' }))
      .status,
    422,
  );
  assert.equal(
    (
      await handleAdminRequest(request('POST', { name: 'Embroidery' }, { Origin: 'https://evil.example' }), services, {
        kind: 'methods',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await handleAdminRequest(
        request('POST', { name: 'Embroidery' }),
        adminServices({ ...services, authenticate: async () => ({ ...actor, canEdit: false }) }),
        { kind: 'methods' },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleAdminRequest(request('POST', { name: 'Embroidery' }, { Authorization: '' }), services, {
        kind: 'methods',
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await handleAdminRequest(request('PUT', { name: 'Print', version: '1' }), services, {
        kind: 'method',
        methodId: id,
      })
    ).status,
    409,
  );
  assert.equal(
    (await handleAdminRequest(request('DELETE', { version: '1' }), services, { kind: 'method', methodId: id })).status,
    200,
  );
  assert.equal(
    (await handleAdminRequest(request('DELETE', { version: '01' }), services, { kind: 'method', methodId: id })).status,
    422,
  );
  assert.equal(calls, 2);
});

test('method authorization drift is denied explicitly without exposing internal scope details', async () => {
  const services = adminServices({
    appOrigin: 'https://app.example',
    authenticate: async () => actor,
    methods: {
      list: async () => {
        throw new MethodAuthorizationError('private scope details');
      },
    },
  });
  const result = await handleAdminRequest(request(), services, { kind: 'methods' });
  assert.equal(result.status, 403);
  assert.deepEqual(await result.json(), { error: 'Current tenant installation required' });
});
