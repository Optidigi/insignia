import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AdminOnlineIdentityError, CatalogReadError, createCatalogTransport } from '@insignia/shopify';
import { handleAdminRequest } from '../../src/server/admin/http.ts';
import { adminServices } from './support/fixtures.mts';

const productId = 'gid://shopify/Product/10485042479387';
const identity = {
  shop: 'alpha.myshopify.com',
  shopId: 'gid://shopify/Shop/1',
  tenantShopId: 'tenant-1',
  installationGeneration: '1',
  installationId: 'installation-1',
  staffId: 'staff-1',
  sessionId: 'session-1',
  expiresAtMs: Date.now() + 60_000,
  canRead: true,
  canEdit: true,
};
const origin = 'https://app.example.test';
function deps(overrides: Parameters<typeof adminServices>[0] = {}) {
  const calls: unknown[][] = [];
  return {
    calls,
    services: adminServices({
      appOrigin: origin,
      authenticate: async () => identity,
      catalog: {
        list: async () => ({ products: [], nextCursor: null }),
        get: async (_actor, id) =>
          id === productId ? { id, title: 'Synthetic shirt', status: 'ACTIVE', imageUrl: null, variants: [] } : null,
      },
      configs: {
        read: async () => ({
          product: { id: productId, title: 'Synthetic shirt', status: 'ACTIVE', imageUrl: null, variants: [] },
          config: null,
        }),
        create: async (actor, id, key) => {
          calls.push(['create', actor.shopId, id, key]);
          return { kind: 'created', configId: 'config-1' };
        },
        save: async (actor, id, input) => {
          calls.push(['save', actor.shopId, id, input]);
          return { kind: 'saved', draftVersion: '2' };
        },
        publish: async (actor, id, input) => {
          calls.push(['publish', actor.shopId, id, input]);
          return { kind: 'accepted', state: 'REMOTE_READY_ACTIVATION_PENDING' };
        },
      },
      ...overrides,
    }),
  };
}
function request(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}${path}`, {
    method,
    headers: {
      Authorization: 'Bearer synthetic',
      ...(body ? { Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': 'command-123' } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test('read requires current verified staff and exact shop, even on deep links', async () => {
  const h = deps();
  const missing = await handleAdminRequest(
    request('/api/admin/products', 'GET', undefined, { Authorization: '' }),
    h.services,
    { kind: 'list' },
  );
  assert.equal(missing.status, 401);
  const cross = await handleAdminRequest(request('/api/admin/products?shop=beta.myshopify.com'), h.services, {
    kind: 'list',
  });
  assert.equal(cross.status, 403);
  const ok = await handleAdminRequest(request('/api/admin/products/10485042479387/config'), h.services, {
    kind: 'config',
    productId,
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'private, no-store');
});

test('editor GET refreshes a Shopify-rejected online grant once for the same staff session', async (t) => {
  for (const scenario of [
    { name: 'recovers', first: 401, second: 200, status: 200, attempts: 2 },
    { name: 'does not loop', first: 401, second: 401, status: 503, attempts: 2 },
    { name: 'rejects a changed installation', first: 401, second: 200, generation: '2', status: 403, attempts: 1 },
    { name: 'rejects a changed session', first: 401, second: 200, session: 'different', status: 403, attempts: 1 },
    { name: 'honors a revoked read grant', first: 401, second: 200, canRead: false, status: 403, attempts: 1 },
    { name: 'keeps permanent provider denials', first: 403, second: 200, status: 503, attempts: 1 },
  ])
    await t.test(scenario.name, async () => {
      const refreshes: boolean[] = [];
      const providerCalls: string[] = [];
      const replacement = {
        ...identity,
        installationGeneration: scenario.generation ?? identity.installationGeneration,
        sessionId: scenario.session ?? identity.sessionId,
        canRead: scenario.canRead ?? identity.canRead,
      };
      const h = deps({
        authenticate: async (_request, options) => {
          refreshes.push(options?.fresh === true);
          return options?.fresh ? replacement : identity;
        },
      });
      const view = await h.services.configs.read(identity, productId);
      h.services.catalog.get = async (actor) => {
        const token = actor === replacement ? 'replacement' : 'original';
        const transport = createCatalogTransport({
          shop: actor.shop,
          accessToken: token,
          fetchImpl: async (_url, init) => {
            providerCalls.push(new Headers(init?.headers).get('X-Shopify-Access-Token') ?? '');
            const status = token === 'original' ? scenario.first : scenario.second;
            return new Response(JSON.stringify({ data: {} }), { status });
          },
        });
        await transport.read('detail', { id: productId });
        return view.product;
      };
      const response = await handleAdminRequest(request('/api/admin/products/10485042479387/config'), h.services, {
        kind: 'config',
        productId,
      });
      assert.equal(response.status, scenario.status);
      assert.deepEqual(refreshes, scenario.first === 401 ? [false, true] : [false]);
      assert.deepEqual(providerCalls, scenario.attempts === 2 ? ['original', 'replacement'] : ['original']);
      if (scenario.status === 200) assert.deepEqual(await response.json(), view);
    });
});

test('a Shopify-rejected online grant during publish does not replay the command', async () => {
  let attempts = 0;
  const refreshes: boolean[] = [];
  const h = deps({
    authenticate: async (_request, options) => {
      refreshes.push(options?.fresh === true);
      return identity;
    },
    configs: {
      publish: async () => {
        attempts++;
        throw new CatalogReadError('http_error', 'Catalog read failed', 401);
      },
    },
  });
  const response = await handleAdminRequest(
    request('/api/admin/products/10485042479387/config', 'POST', {
      action: 'publish',
      configId: 'config-1',
      draftVersion: '1',
    }),
    h.services,
    { kind: 'config', productId },
  );
  assert.equal(response.status, 503);
  assert.equal(attempts, 1);
  assert.deepEqual(refreshes, [false, true]);
});

test('mutation refuses cross-origin and staff denial before invoking command', async () => {
  const h = deps({ authenticate: async () => ({ ...identity, canEdit: false }) });
  const body = { draftVersion: '1', draft: { version: 'm5-merchant-draft-v1' } };
  const denied = await handleAdminRequest(
    request('/api/admin/products/10485042479387/config', 'POST', body),
    h.services,
    { kind: 'config', productId },
  );
  assert.equal(denied.status, 403);
  const foreign = await handleAdminRequest(
    request('/api/admin/products/10485042479387/config', 'POST', body, { Origin: 'https://evil.example' }),
    h.services,
    { kind: 'config', productId },
  );
  assert.equal(foreign.status, 403);
  assert.deepEqual(h.calls, []);
});

test('save carries exact product, draft version and idempotency to durable command', async () => {
  const h = deps();
  const draft = { version: 'm5-merchant-draft-v1', mode: 'optional' };
  const response = await handleAdminRequest(
    request('/api/admin/products/10485042479387/config', 'PUT', {
      action: 'save',
      configId: 'config-1',
      draftVersion: '1',
      draft,
    }),
    h.services,
    { kind: 'config', productId },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(h.calls, [
    [
      'save',
      identity.shopId,
      productId,
      { configId: 'config-1', draftVersion: '1', draft, idempotencyKey: 'command-123' },
    ],
  ]);
});

test('stale draft save is a conflict, never a success response', async () => {
  const h = deps({
    configs: {
      save: async () => ({ kind: 'conflict', message: 'Draft version changed' }),
    },
  });
  const response = await handleAdminRequest(
    request('/api/admin/products/10485042479387/config', 'PUT', {
      action: 'save',
      configId: 'config-1',
      draftVersion: '1',
      draft: { version: 'm5-merchant-draft-v1' },
    }),
    h.services,
    { kind: 'config', productId },
  );
  assert.equal(response.status, 409);
});

test('publish returns activation-pending truthfully and requires current edit grant', async () => {
  const h = deps();
  const response = await handleAdminRequest(
    request('/api/admin/products/10485042479387/config', 'POST', {
      action: 'publish',
      configId: 'config-1',
      draftVersion: '2',
    }),
    h.services,
    { kind: 'config', productId },
  );
  assert.equal(response.status, 202);
  assert.equal((await response.json()).state, 'REMOTE_READY_ACTIVATION_PENDING');
});

test('a product missing from the verified shop cannot be changed', async () => {
  const h = deps({ catalog: { list: async () => ({ products: [], nextCursor: null }), get: async () => null } });
  const response = await handleAdminRequest(
    request('/api/admin/products/10485042479387/config', 'POST', { action: 'create' }),
    h.services,
    { kind: 'config', productId },
  );
  assert.equal(response.status, 404);
  assert.deepEqual(h.calls, []);
});

test('expired identity and shop supplied in command body cannot create a config', async () => {
  const expired = deps({ authenticate: async () => ({ ...identity, expiresAtMs: Date.now() - 1 }) });
  const denied = await handleAdminRequest(
    request('/api/admin/products/10485042479387/config', 'POST', { action: 'create' }),
    expired.services,
    { kind: 'config', productId },
  );
  assert.equal(denied.status, 401);
  const h = deps();
  const replay = await handleAdminRequest(
    request('/api/admin/products/10485042479387/config', 'POST', { action: 'create', shopId: 'gid://shopify/Shop/2' }),
    h.services,
    { kind: 'config', productId },
  );
  assert.equal(replay.status, 422);
  assert.deepEqual(h.calls, []);
});

test('unwired admin backend serves no private catalog data', async () => {
  const response = await handleAdminRequest(request('/api/admin/products'), undefined, { kind: 'list' });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /Synthetic shirt|gid:\/\/shopify\/Product/);
});

test('unknown durable command failures remain unavailable without leaking details', async () => {
  const h = deps({
    configs: {
      save: async () => {
        throw new Error('synthetic internal diagnostic');
      },
    },
  });
  const response = await handleAdminRequest(
    request('/api/admin/products/10485042479387/config', 'PUT', {
      action: 'save',
      configId: 'config-1',
      draftVersion: '1',
      draft: { version: 'm5-merchant-draft-v1' },
    }),
    h.services,
    { kind: 'config', productId },
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'Admin service unavailable' });
});

test('an unexpected admin failure is recorded by safe fields only and keeps the same 503', async () => {
  const recorded: unknown[] = [];
  const secret = 'password=SECRET-9f2c for alpha.myshopify.com gid://shopify/Product/10485042479387';
  const h = deps({
    recordAdminFailure: (failure) => recorded.push(failure),
    configs: {
      read: async () => {
        throw Object.assign(new RangeError(secret), { code: 'ERR_INJECTED_FAILURE' });
      },
    },
  });
  const response = await handleAdminRequest(request('/api/admin/products/10485042479387/config'), h.services, {
    kind: 'config',
    productId,
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'Admin service unavailable' });
  assert.equal(recorded.length, 1);
  const failure = recorded[0] as Record<string, unknown>;
  assert.deepEqual(Object.keys(failure).sort(), ['adminRoute', 'errorClass', 'errorCode', 'errorSite', 'httpMethod']);
  assert.equal(failure.adminRoute, 'product-config');
  assert.equal(failure.httpMethod, 'GET');
  assert.equal(failure.errorClass, 'RangeError');
  assert.equal(failure.errorCode, 'ERR_INJECTED_FAILURE');
  assert.match(String(failure.errorSite), /^apps\/web\/test\/admin\/commands\.test\.mts:[1-9][0-9]*$/);
  assert.doesNotMatch(JSON.stringify(recorded), /SECRET|myshopify|gid:|10485042479387|synthetic/i);

  const command = deps({
    recordAdminFailure: (failure) => recorded.push(failure),
    configs: {
      publish: async () => {
        throw new Error(secret);
      },
    },
  });
  const failed = await handleAdminRequest(
    request('/api/admin/products/10485042479387/config', 'POST', {
      action: 'publish',
      configId: 'config-1',
      draftVersion: '1',
    }),
    command.services,
    { kind: 'config', productId },
  );
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: 'Admin service unavailable' });
  assert.deepEqual(
    { ...(recorded[1] as object), errorSite: undefined },
    { adminRoute: 'product-config-command', httpMethod: 'POST', errorClass: 'Error', errorSite: undefined },
  );

  const throwing = deps({
    recordAdminFailure: () => {
      throw new Error('recorder down');
    },
    configs: {
      read: async () => {
        throw new Error(secret);
      },
    },
  });
  const still = await handleAdminRequest(request('/api/admin/products/10485042479387/config'), throwing.services, {
    kind: 'config',
    productId,
  });
  assert.equal(still.status, 503);
  assert.deepEqual(await still.json(), { error: 'Admin service unavailable' });
});

test('handled admin outcomes are not recorded as unexpected failures', async () => {
  const recorded: unknown[] = [];
  const h = deps({
    recordAdminFailure: (failure) => recorded.push(failure),
    configs: {
      read: async () => {
        throw Object.assign(new Error('Shopify throttled'), { transient: true });
      },
    },
  });
  const busy = await handleAdminRequest(request('/api/admin/products/10485042479387/config'), h.services, {
    kind: 'config',
    productId,
  });
  assert.equal(busy.status, 409);
  assert.deepEqual(recorded, []);
});

test('refresh-required online exchange is 401 with Shopify fresh-ID-token retry signal', async () => {
  const h = deps({
    authenticate: async () => {
      throw new AdminOnlineIdentityError('ONLINE_EXCHANGE_REFRESH_REQUIRED');
    },
  });
  const response = await handleAdminRequest(
    new Request(`${origin}/api/admin/products`, {
      headers: { Authorization: 'Bearer synthetic' },
    }),
    h.services,
    { kind: 'list' },
  );
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('X-Shopify-Retry-Invalid-Session-Request'), '1');
  assert.deepEqual(await response.json(), { error: 'Authentication required' });
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});

test('generic exchange/provider/database failures do not gain the fresh-token retry response', async () => {
  for (const error of [
    new AdminOnlineIdentityError('ONLINE_EXCHANGE_FAILED'),
    new AdminOnlineIdentityError('ONLINE_GRANT_MISMATCH'),
    new AdminOnlineIdentityError('INSTALLATION_PROVIDER_READ_FAILED'),
    new Error('Identity refresh required'),
    new Error('synthetic-private-database-error'),
  ]) {
    const h = deps({
      authenticate: async () => {
        throw error;
      },
    });
    const response = await handleAdminRequest(
      new Request(`${origin}/api/admin/products`, {
        headers: { Authorization: 'Bearer synthetic' },
      }),
      h.services,
      { kind: 'list' },
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('X-Shopify-Retry-Invalid-Session-Request'), null);
    assert.deepEqual(await response.json(), { error: 'Authentication unavailable' });
  }
});

test('product configuration filtering reaches the full catalog query boundary and validates cursor/limit input', async () => {
  let input: unknown;
  const h = deps({
    catalog: {
      list: async (_actor, query) => {
        input = query;
        return { products: [], nextCursor: null };
      },
    },
  });
  assert.equal(
    (
      await handleAdminRequest(request('/api/admin/products?q=shirt&configuration=published&limit=10'), h.services, {
        kind: 'list',
      })
    ).status,
    200,
  );
  assert.deepEqual(input, { query: 'shirt', cursor: null, limit: 10, configuration: 'published' });
  for (const query of ['configuration=garbage', 'limit=100', 'limit=0', 'cursor=' + 'a'.repeat(513)])
    assert.equal(
      (await handleAdminRequest(request(`/api/admin/products?${query}`), h.services, { kind: 'list' })).status,
      422,
    );
});
