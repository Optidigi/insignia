import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleAdminRequest } from '../../src/server/admin/http.ts';

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
function deps(overrides = {}) {
  const calls = [];
  return {
    calls,
    services: {
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
          return { configId: 'config-1' };
        },
        save: async (actor, id, input) => {
          calls.push(['save', actor.shopId, id, input]);
          return { kind: 'saved', draftVersion: '2' };
        },
        copy: async (actor, id, target, key) => {
          calls.push(['copy', actor.shopId, id, target, key]);
          return { configId: 'config-2' };
        },
        publish: async (actor, id, input) => {
          calls.push(['publish', actor.shopId, id, input]);
          return { kind: 'accepted', state: 'REMOTE_READY_ACTIVATION_PENDING' };
        },
      },
      ...overrides,
    },
  };
}
function request(path, method = 'GET', body, headers = {}) {
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
