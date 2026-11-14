import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AdminOnlineIdentityError } from '@insignia/shopify';
import type { AdminIdentityPort, AdminInstallation, OnlineAdminGrant } from '../../src/server/admin/auth.ts';
import {
  ADMIN_INSTALLATION_REUSE_MS,
  AdminAuthenticationBusyError,
  AdminInstallationReconciliationError,
  createAdminAuthenticationCache,
  createAdminAuthenticator,
} from '../../src/server/admin/auth.ts';
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

function cachedSetup(overrides: Partial<AdminIdentityPort> = {}, options: { now?: () => number } = {}) {
  const counts = { verify: 0, exchange: 0, read: 0, confirm: 0 };
  const events: string[] = [];
  const cache = createAdminAuthenticationCache();
  const port: AdminIdentityPort = {
    verifySessionToken: async (token) => {
      counts.verify++;
      if (token !== 'synthetic') throw new AdminOnlineIdentityError('SESSION_TOKEN_SIGNATURE_REJECTED');
      return identity;
    },
    exchangeOnlineGrant: async () => {
      counts.exchange++;
      return grant;
    },
    readInstallation: async () => {
      counts.read++;
      return installation;
    },
    confirmInstallation: async () => {
      counts.confirm++;
      return true;
    },
    ...overrides,
  };
  const auth = createAdminAuthenticator(port, options.now ?? (() => now), (stage) => events.push(stage), cache);
  return { auth, counts, events, cache };
}

test('#435: repeated requests from one staff session reuse one online exchange and one installation read', async () => {
  const h = cachedSetup();
  for (let i = 0; i < 5; i++) assert.equal(required(await h.auth(request)).canEdit, true);
  // Before the fix every request exchanged and read the installation (5 and 5).
  assert.deepEqual(h.counts, { verify: 5, exchange: 1, read: 1, confirm: 4 });
  assert.ok(h.events.includes('ONLINE_GRANT_REUSED_SUCCEEDED'));
  assert.ok(h.events.includes('INSTALLATION_OBSERVATION_REUSED_SUCCEEDED'));
});

test('#435: concurrent first requests share one exchange and one installation read', async () => {
  const h = cachedSetup();
  const actors = await Promise.all(Array.from({ length: 4 }, () => h.auth(request)));
  assert.ok(actors.every((actor) => actor?.canEdit === true));
  assert.equal(h.counts.exchange, 1);
  assert.equal(h.counts.read, 1);
});

test('#435: session token identity checks still run on every request', async () => {
  const h = cachedSetup();
  assert.ok(await h.auth(request));
  const forged = new Request(request.url, { headers: { Authorization: 'Bearer forged' } });
  assert.equal(await h.auth(forged), null);
  let expired = false;
  const late = cachedSetup({
    verifySessionToken: async () => (expired ? { ...identity, expiresAtMs: now - 1 } : identity),
  });
  assert.ok(await late.auth(request));
  expired = true;
  assert.equal(await late.auth(request), null);
});

test('#435: a fresh request bypasses both caches; staff-sensitive actions exchange again', async () => {
  const h = cachedSetup();
  await h.auth(request);
  await h.auth(request, { fresh: true });
  assert.equal(h.counts.exchange, 2);
  assert.equal(h.counts.read, 2);
  await h.auth(request);
  assert.equal(h.counts.exchange, 2);
});

test('#435: a grant is reused only for the same shop, staff and session, and never near its expiry', async () => {
  let session = identity.sessionId;
  let staff = identity.staffId;
  let clock = now;
  const h = cachedSetup(
    {
      verifySessionToken: async () => ({
        ...identity,
        staffId: staff,
        sessionId: session,
        expiresAtMs: clock + 60_000,
      }),
      exchangeOnlineGrant: async () => {
        h.counts.exchange++;
        return { ...grant, staffId: staff, expiresAtMs: now + 120_000 };
      },
    },
    { now: () => clock },
  );
  await h.auth(request);
  session = 'session-456';
  await h.auth(request);
  assert.equal(h.counts.exchange, 2);
  staff = '456';
  await h.auth(request);
  assert.equal(h.counts.exchange, 3);
  await h.auth(request);
  assert.equal(h.counts.exchange, 3);
  clock = now + 91_000; // within the 30 s reuse margin before the online grant's expiry
  await h.auth(request);
  assert.equal(h.counts.exchange, 4);
});

test('#435: installation reuse is bounded in time and fenced against the durable installation', async () => {
  let clock = now;
  let current = true;
  const h = cachedSetup(
    {
      exchangeOnlineGrant: async () => {
        h.counts.exchange++;
        return { ...grant, expiresAtMs: now + 3_600_000 };
      },
      confirmInstallation: async () => {
        h.counts.confirm++;
        return current;
      },
    },
    { now: () => clock },
  );
  await h.auth(request);
  clock = now + ADMIN_INSTALLATION_REUSE_MS - 1;
  await h.auth(request);
  assert.equal(h.counts.read, 1);
  clock = now + ADMIN_INSTALLATION_REUSE_MS;
  await h.auth(request);
  assert.equal(h.counts.read, 2);
  // Uninstall/reinstall: the durable fence no longer matches the cached observation.
  current = false;
  const exchanges = h.counts.exchange;
  await h.auth(request);
  assert.equal(h.counts.read, 3);
  assert.equal(h.counts.exchange, exchanges + 1);
});

test('#435: a reinstalled installation is never served from the cache', async () => {
  let reinstalled = false;
  const h = cachedSetup({
    readInstallation: async () => {
      h.counts.read++;
      return reinstalled ? { ...installation, trustedInstallationId: 'reinstalled' } : installation;
    },
    confirmInstallation: async () => {
      h.counts.confirm++;
      return !reinstalled;
    },
  });
  assert.ok(await h.auth(request));
  reinstalled = true;
  assert.equal(await h.auth(request), null);
  assert.equal(await h.auth(request), null);
  assert.equal(h.counts.read, 3);
});

test('#435: rejected installations are not cached', async () => {
  let active = false;
  const h = cachedSetup({
    readInstallation: async () => {
      h.counts.read++;
      return { ...installation, active };
    },
  });
  assert.equal(await h.auth(request), null);
  active = true;
  assert.ok(await h.auth(request));
  assert.equal(h.counts.read, 2);
});

test('#435: the process cache is bounded', async () => {
  const cache = createAdminAuthenticationCache({ maxGrants: 3, maxInstallations: 2 });
  let session = 0;
  let exchanges = 0;
  const auth = createAdminAuthenticator(
    {
      verifySessionToken: async () => ({ ...identity, sessionId: `session-${session}` }),
      exchangeOnlineGrant: async () => {
        exchanges++;
        return grant;
      },
      readInstallation: async () => installation,
      confirmInstallation: async () => true,
    },
    () => now,
    () => {},
    cache,
  );
  for (session = 0; session < 10; session++) await auth(request);
  assert.ok(cache.size().grants <= 3);
  assert.ok(cache.size().installations <= 2);
  session = 9;
  await auth(request);
  assert.equal(exchanges, 10);
  session = 0;
  await auth(request);
  assert.equal(exchanges, 11);
});

test('#446: a throttled installation read surfaces as a retryable busy failure with its provider code', async () => {
  const events: { stage: string; providerCode?: string }[] = [];
  const auth = createAdminAuthenticator(
    {
      verifySessionToken: async () => identity,
      exchangeOnlineGrant: async () => grant,
      readInstallation: async () => {
        throw new AdminOnlineIdentityError('INSTALLATION_PROVIDER_READ_FAILED', {
          transient: true,
          providerCode: 'THROTTLED',
        });
      },
    },
    () => now,
    (stage, detail) => events.push({ stage, ...detail }),
  );
  await assert.rejects(auth(request), AdminAuthenticationBusyError);
  assert.deepEqual(events.at(-1), { stage: 'INSTALLATION_PROVIDER_READ_FAILED', providerCode: 'THROTTLED' });
});
