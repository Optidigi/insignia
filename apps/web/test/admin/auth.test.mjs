import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAdminAuthenticator } from '../../src/server/admin/auth.ts';

const now = Date.now();
const identity = { shop: 'alpha.myshopify.com', staffId: '123', sessionId: 'session-123', expiresAtMs: now + 60_000 };
const grant = {
  shop: identity.shop,
  staffId: identity.staffId,
  expiresAtMs: now + 60_000,
  appScopes: ['write_products'],
  userScopes: ['write_products'],
};
const installation = {
  shop: identity.shop,
  shopId: 'gid://shopify/Shop/1',
  installationId: 'current',
  trustedInstallationId: 'current',
  tenantShopId: 'tenant-1',
  installationGeneration: '1',
  active: true,
  grantedScopes: ['write_products'],
};
const request = new Request('https://app.example.test/api/admin/products', {
  headers: { Authorization: 'Bearer synthetic' },
});

function setup(overrides = {}) {
  let reads = 0;
  const auth = createAdminAuthenticator(
    {
      verifySessionToken: async () => identity,
      exchangeOnlineGrant: async () => grant,
      readInstallation: async () => {
        reads++;
        return installation;
      },
      ...overrides,
    },
    () => now,
  );
  return { auth, reads: () => reads };
}

test('current staff and installation grant read and edit; reinstallation is checked every request', async () => {
  const h = setup();
  assert.equal((await h.auth(request))?.canEdit, true);
  assert.equal((await h.auth(request))?.canRead, true);
  assert.equal(h.reads(), 2);
});

test('staff read access does not grant mutation', async () => {
  const h = setup({ exchangeOnlineGrant: async () => ({ ...grant, userScopes: ['read_products'] }) });
  assert.deepEqual((({ canRead, canEdit }) => ({ canRead, canEdit }))(await h.auth(request)), {
    canRead: true,
    canEdit: false,
  });
});

test('expired or cross-shop identity and stale installation fail closed', async () => {
  assert.equal(
    await setup({ verifySessionToken: async () => ({ ...identity, expiresAtMs: now - 1 }) }).auth(request),
    null,
  );
  assert.equal(
    await setup({ exchangeOnlineGrant: async () => ({ ...grant, shop: 'beta.myshopify.com' }) }).auth(request),
    null,
  );
  assert.equal(
    await setup({ readInstallation: async () => ({ ...installation, trustedInstallationId: 'reinstalled' }) }).auth(
      request,
    ),
    null,
  );
  assert.equal(await setup({ readInstallation: async () => ({ ...installation, active: false }) }).auth(request), null);
});
