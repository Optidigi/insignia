import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleAdminRequest } from '../../src/server/admin/http.ts';

const actor = {
  shop: 'example.myshopify.com',
  shopId: 'gid://shopify/Shop/1',
  installationId: 'install',
  tenantShopId: 'tenant',
  installationGeneration: '1',
  staffId: 'staff',
  sessionId: 'session',
  expiresAtMs: Date.now() + 60000,
  canRead: true,
  canEdit: false,
};
const view = { status: 'inactive', observedAt: '2026-10-17T10:00:00.000Z' };
function request(method = 'GET', suffix = '', authorized = true) {
  return new Request(`https://app.example/api/admin/billing${suffix}`, {
    method,
    headers: authorized ? { Authorization: 'Bearer synthetic' } : {},
  });
}
test('billing is a private read-only authenticated projection scoped to the current actor', async () => {
  let reads = 0;
  const services = {
    authenticate: async () => actor,
    billing: async (current) => {
      assert.equal(current, actor);
      reads++;
      return view;
    },
  };
  const result = await handleAdminRequest(request(), services, { kind: 'billing' });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), view);
  assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await handleAdminRequest(request('POST'), services, { kind: 'billing' })).status, 405);
  assert.equal(
    (await handleAdminRequest(request('GET', '?shop=other.myshopify.com'), services, { kind: 'billing' })).status,
    403,
  );
  assert.equal((await handleAdminRequest(request('GET', '', false), services, { kind: 'billing' })).status, 401);
  assert.equal(
    (
      await handleAdminRequest(
        request(),
        { ...services, authenticate: async () => ({ ...actor, canRead: false }) },
        { kind: 'billing' },
      )
    ).status,
    403,
  );
  assert.equal(reads, 1);
});
test('provider failure is unavailable rather than an invented inactive subscription', async () => {
  const response = await handleAdminRequest(
    request(),
    {
      authenticate: async () => actor,
      billing: async () => {
        throw new Error('private provider detail');
      },
    },
    { kind: 'billing' },
  );
  assert.equal(response.status, 503);
  assert.equal(JSON.stringify(await response.json()).includes('private provider detail'), false);
});
