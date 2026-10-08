import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AdminOnlineIdentityError } from '@insignia/shopify';
import { AdminInstallationReconciliationError, createAdminAuthenticator } from '../../src/server/admin/auth.ts';

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

test('authentication stages distinguish grant and installation mismatches without identity data', async () => {
  for (const [overrides, stage] of [
    [{ exchangeOnlineGrant: async () => ({ ...grant, shop: 'beta.myshopify.com' }) }, 'ONLINE_GRANT_MISMATCH'],
    [
      { readInstallation: async () => ({ ...installation, active: false }) },
      'CURRENT_INSTALLATION_MISSING_OR_INACTIVE',
    ],
    [
      { readInstallation: async () => ({ ...installation, trustedInstallationId: 'other' }) },
      'CURRENT_INSTALLATION_ID_MISMATCH',
    ],
  ]) {
    const events = [];
    const auth = createAdminAuthenticator(
      {
        verifySessionToken: async () => identity,
        exchangeOnlineGrant: async () => grant,
        readInstallation: async () => installation,
        ...overrides,
      },
      () => now,
      (stage) => events.push(stage),
    );
    assert.equal(await auth(request), null);
    assert.equal(events.at(-1), stage);
    assert.ok(events.every((value) => typeof value === 'string' && /^[A-Z_]+$/.test(value)));
  }
});
test('downstream failures preserve only their safe stage and refresh type after verified identity', async () => {
  for (const stage of [
    'ONLINE_EXCHANGE_REFRESH_REQUIRED',
    'ONLINE_EXCHANGE_FAILED',
    'INSTALLATION_PROVIDER_READ_FAILED',
    'INSTALLATION_PROVIDER_SHAPE_OR_IDENTITY_MISMATCH',
    'TENANT_READ_FAILED',
    'CURRENT_INSTALLATION_READ_FAILED',
    'TENANT_NOT_FOUND_OR_SHOP_ID_MISMATCH',
  ]) {
    const exchange = stage.startsWith('ONLINE_');
    const failure =
      stage.startsWith('TENANT_') || stage === 'CURRENT_INSTALLATION_READ_FAILED'
        ? new AdminInstallationReconciliationError(stage)
        : new AdminOnlineIdentityError(stage);
    const events = [];
    const auth = createAdminAuthenticator(
      {
        verifySessionToken: async () => identity,
        exchangeOnlineGrant: async () => {
          if (exchange) throw failure;
          return grant;
        },
        readInstallation: async () => {
          throw failure;
        },
      },
      () => now,
      (value) => events.push(value),
    );
    await assert.rejects(auth(request), (error) => {
      assert.equal(error instanceof AdminOnlineIdentityError, exchange);
      assert.doesNotMatch(String(error), /synthetic|Bearer|staffId|sessionId/);
      return true;
    });
    assert.equal(events.at(-1), stage);
  }
});
