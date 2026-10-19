import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AdminOnlineIdentityError } from '@insignia/shopify';
import type { AdminIdentityPort, AdminInstallation, OnlineAdminGrant } from '../../src/server/admin/auth.ts';
import { AdminInstallationReconciliationError, createAdminAuthenticator } from '../../src/server/admin/auth.ts';
import { required } from './support/fixtures.mts';

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

function setup(overrides: Partial<AdminIdentityPort> = {}) {
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
  assert.deepEqual((({ canRead, canEdit }) => ({ canRead, canEdit }))(required(await h.auth(request))), {
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
  const cases: [Partial<AdminIdentityPort>, string][] = [
    [{ exchangeOnlineGrant: async () => ({ ...grant, shop: 'beta.myshopify.com' }) }, 'ONLINE_GRANT_MISMATCH'],
    [
      { readInstallation: async () => ({ ...installation, active: false }) },
      'CURRENT_INSTALLATION_MISSING_OR_INACTIVE',
    ],
    [
      { readInstallation: async () => ({ ...installation, trustedInstallationId: 'other' }) },
      'CURRENT_INSTALLATION_ID_MISMATCH',
    ],
  ];
  for (const [overrides, stage] of cases) {
    const events: string[] = [];
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
  ] as const) {
    const exchange = stage.startsWith('ONLINE_');
    const failure =
      stage === 'TENANT_READ_FAILED' ||
      stage === 'TENANT_NOT_FOUND_OR_SHOP_ID_MISMATCH' ||
      stage === 'CURRENT_INSTALLATION_READ_FAILED'
        ? new AdminInstallationReconciliationError(stage)
        : new AdminOnlineIdentityError(stage);
    const events: string[] = [];
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

test('early authentication rejection emits one bounded stage without downstream access', async () => {
  const cases: [string | null, AdminIdentityPort['verifySessionToken'], string][] = [
    [null, async () => identity, 'BEARER_MISSING'],
    ['Basic synthetic-private', async () => identity, 'BEARER_MALFORMED'],
    ...(
      [
        'SESSION_TOKEN_SIGNATURE_REJECTED',
        'SESSION_TOKEN_AUDIENCE_REJECTED',
        'SESSION_TOKEN_TIME_REJECTED',
        'SESSION_TOKEN_FORMAT_REJECTED',
        'SESSION_TOKEN_REJECTED',
      ] as const
    ).map((stage): [string, AdminIdentityPort['verifySessionToken'], string] => [
      'Bearer synthetic',
      async () => {
        throw new AdminOnlineIdentityError(stage);
      },
      stage,
    ]),
    [
      'Bearer synthetic',
      async () => {
        throw new Error('synthetic-private-SDK-token');
      },
      'SESSION_TOKEN_REJECTED',
    ],
    [
      'Bearer synthetic',
      async () => {
        throw new AdminOnlineIdentityError('SESSION_IDENTITY_REJECTED');
      },
      'SESSION_IDENTITY_REJECTED',
    ],
    ['Bearer synthetic', async () => ({ ...identity, expiresAtMs: now - 1 }), 'SESSION_IDENTITY_REJECTED'],
  ];
  for (const [authorization, verification, expected] of cases) {
    const events: string[] = [];
    const auth = createAdminAuthenticator(
      {
        verifySessionToken: verification,
        exchangeOnlineGrant: async () => {
          assert.fail('rejected identity reached exchange');
        },
        readInstallation: async () => {
          assert.fail('rejected identity reached installation');
        },
      },
      () => now,
      (stage) => events.push(stage),
    );
    const headers = new Headers();
    if (authorization !== null) headers.set('Authorization', authorization);
    assert.equal(await auth(new Request('https://app.example.test/api/admin/products', { headers })), null);
    assert.deepEqual(events, [expected]);
  }
});

test('private artwork permissions require the verified online account owner, independently of product scopes', async () => {
  assert.equal(required(await setup().auth(request)).canReadArtwork, false);
  assert.equal(required(await setup().auth(request)).canUploadArtwork, false);
  const owner = required(
    await setup({ exchangeOnlineGrant: async () => ({ ...grant, accountOwner: true }) }).auth(request),
  );
  assert.equal(owner.canReadArtwork, true);
  assert.equal(owner.canUploadArtwork, true);
  const reader = required(
    await setup({
      exchangeOnlineGrant: async () => ({ ...grant, accountOwner: true, userScopes: ['read_products'] }),
    }).auth(request),
  );
  assert.equal(reader.canReadArtwork, true);
  assert.equal(reader.canUploadArtwork, false);
});

test('purchase access requires account owner and read_orders in online app, user and current installation grants', async () => {
  const allowed = {
    ...grant,
    accountOwner: true,
    appScopes: ['write_products', 'read_orders'],
    userScopes: ['write_products', 'read_orders'],
  };
  const current = { ...installation, grantedScopes: ['write_products', 'read_orders'] };
  const verified = required(
    await setup({
      exchangeOnlineGrant: async () => allowed,
      readInstallation: async () => current,
    }).auth(request),
  );
  assert.equal(verified.canReadOrders, true);
  for (const [online, installed] of [
    [{ ...allowed, accountOwner: false }, current],
    [{ ...allowed, appScopes: ['write_products'] }, current],
    [{ ...allowed, userScopes: ['write_products'] }, current],
    [allowed, { ...current, grantedScopes: ['write_products'] }],
  ] satisfies [OnlineAdminGrant, AdminInstallation][]) {
    const actor = required(
      await setup({
        exchangeOnlineGrant: async () => online,
        readInstallation: async () => installed,
      }).auth(request),
    );
    assert.equal(actor.canReadOrders, false);
  }
});
