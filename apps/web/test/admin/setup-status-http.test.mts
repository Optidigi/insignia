import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleAdminRequest } from '../../src/server/admin/http.ts';
import { adminServices } from './support/fixtures.mts';

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
function request(method = 'GET', suffix = '', authorized = true) {
  return new Request(`https://app.example/api/admin/setup-status${suffix}`, {
    method,
    headers: authorized ? { Authorization: 'Bearer synthetic' } : {},
  });
}
const route = { kind: 'setup-status' } as const;

test('setup status is a private read-only projection scoped to the authenticated actor', async () => {
  let reads = 0;
  const services = adminServices({
    authenticate: async () => actor,
    setupStatus: async (current) => {
      assert.equal(current, actor);
      reads++;
      return { hasPublishedProduct: true };
    },
  });
  const result = await handleAdminRequest(request(), services, route);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { hasPublishedProduct: true });
  assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await handleAdminRequest(request('POST'), services, route)).status, 405);
  assert.equal((await handleAdminRequest(request('GET', '?shop=other.myshopify.com'), services, route)).status, 403);
  assert.equal((await handleAdminRequest(request('GET', '', false), services, route)).status, 401);
  assert.equal(
    (
      await handleAdminRequest(
        request(),
        adminServices({ ...services, authenticate: async () => ({ ...actor, canRead: false }) }),
        route,
      )
    ).status,
    403,
  );
  assert.equal(reads, 1);
});

test('setup status is unavailable, not invented, when the service is absent', async () => {
  const services = adminServices({ authenticate: async () => actor });
  assert.equal((await handleAdminRequest(request(), services, route)).status, 503);
});
