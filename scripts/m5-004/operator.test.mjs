import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createOperator, IDENTITY, initialize as initializeReal, TARGET } from './operator.mjs';

const initialize = (directory, binding) => initializeReal(directory, binding, { synthetic: true });

test('actual HTTP attempts are durably reserved before dispatch', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'm5004-'));
  try {
    initialize(directory, { source: 'synthetic-source', modules: {} });
    const operator = createOperator({
      directory,
      fetchImpl: async () => {
        const disk = JSON.parse(readFileSync(join(directory, 'register.json')));
        assert.equal(disk.counts.read, 1);
        return Response.json({ data: {} });
      },
    });
    try {
      await operator.fetch(`https://${TARGET.domain}/admin/api/2026-07/graphql.json`, {
        method: 'POST',
        body: JSON.stringify({ query: IDENTITY, variables: {} }),
      });
    } finally {
      operator.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { digest, freeze, verifyGate } from './binding.mjs';
import {
  ADAPTER_UPDATE,
  assertIdentity,
  assertOwned,
  assertUnpublished,
  CREATE,
  FIND,
  FIXTURE,
  GRANTS,
  replayResponse,
  SETUP,
} from './operator.mjs';
import { qualify, qualifySynthetic } from './qualification.mjs';

test('captured M5-004 empty grants stop the actual public workflow before any fixture write', async () => {
  const captured = JSON.parse(
    readFileSync(new URL('../../docs/delivery/evidence/m5-004/live/identity-response.json', import.meta.url)),
  );
  assert.equal(captured.source, 'e3d15d451f60fd3dc894679534f0f0132186857d');
  assert.equal(captured.response.data.shop.id, TARGET.shop);
  assert.equal(captured.response.data.currentAppInstallation.id, TARGET.installation);
  assert.deepEqual(captured.response.data.currentAppInstallation.accessScopes, []);
  assert.throws(() => assertIdentity(captured.response.data), { kind: 'retained_grants' });
  const directory = mkdtempSync(join(tmpdir(), 'm5004-captured-'));
  const binding = { source: 'synthetic-captured-response-replay', modules: {} };
  initialize(directory, binding);
  let requests = 0;
  try {
    const result = await qualifySynthetic({
      directory,
      binding,
      credentialLoader: () => ({ secret: 'synthetic-replay-secret', ownership: { synthetic: true } }),
      fetchImpl: async (url, init) => {
        requests++;
        if (url === `https://${TARGET.domain}/admin/oauth/access_token`)
          return Response.json({ access_token: 'synthetic-replay-bearer', expires_in: 86400 });
        assert.equal(url, `https://${TARGET.domain}/admin/api/2026-07/graphql.json`);
        assert.deepEqual(JSON.parse(init.body), { query: IDENTITY, variables: {} });
        return replayResponse(captured);
      },
    });
    assert.equal(result.executionMode, 'SYNTHETIC_OFF_STORE');
    assert.equal(result.outcome, 'STOPPED');
    assert.equal(result.stop, 'retained_grants');
    assert.equal(result.final.outcome, 'NO_FIXTURE_CREATED');
    assert.deepEqual(result.cases, []);
    assert.equal(requests, 2);
    const register = JSON.parse(readFileSync(join(directory, 'register.json')));
    assert.deepEqual(register.counts, { auth: 1, read: 1, create: 0, update: 0 });
    assert.equal(register.fixture, null);
    assert.equal(existsSync(join(directory, 'operator.lock')), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(_directory, state, status = 'DRAFT') {
  return {
    __typename: 'Product',
    id: 'gid://shopify/Product/999999',
    status,
    handle: state.run,
    title: state.run,
    tags: [state.run],
    createdAt: new Date().toISOString(),
    updatedAt: new Date(Date.now() - 60000).toISOString(),
    publishedAt: null,
    onlineStoreUrl: null,
    resourcePublications: { nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
    unpublishedPublications: {
      nodes: [{ id: 'gid://shopify/Publication/1' }],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    },
  };
}
const identity = () => ({
  shop: { id: TARGET.shop, myshopifyDomain: TARGET.domain, plan: { partnerDevelopment: true, displayName: 'Basic' } },
  currentAppInstallation: {
    id: TARGET.installation,
    app: { id: TARGET.app, apiKey: TARGET.client },
    accessScopes: GRANTS.map((handle) => ({ handle })),
  },
});
async function setup(options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'm5004-'));
  const initial = initialize(directory, { source: 'synthetic-source', modules: {} });
  let product = fixture(directory, initial),
    sends = 0,
    peak = 0,
    active = 0;
  const operator = createOperator({
    directory,
    fetchImpl: async (_url, init) => {
      sends++;
      peak = Math.max(peak, ++active);
      await Promise.resolve();
      active--;
      const body = JSON.parse(init.body);
      if (options.failure?.(body)) throw new Error('synthetic response lost');
      if (body.query === ADAPTER_READ && options.readResponse) return options.readResponse();
      if (body.query === CREATE) return Response.json({ data: { productCreate: { product, userErrors: [] } } });
      if (body.query === SETUP || body.query === ADAPTER_UPDATE) {
        if (options.mutationResponse) return options.mutationResponse();
        product = { ...product, status: body.variables.product.status };
        return Response.json({ data: { productUpdate: { product, userErrors: [] } } });
      }
      return Response.json({
        data:
          body.query === IDENTITY
            ? identity()
            : body.query === ADAPTER_READ
              ? { ...identity(), node: product }
              : { product },
      });
    },
  });
  const post = (query, variables = {}) =>
    operator.fetch(`https://${TARGET.domain}/admin/api/2026-07/graphql.json`, {
      method: 'POST',
      body: JSON.stringify({ query, variables }),
    });
  operator.identity(identity());
  await post(CREATE, { product: { title: initial.run, handle: initial.run, tags: [initial.run], status: 'DRAFT' } });
  return {
    directory,
    initial,
    operator,
    post,
    product: () => product,
    setProduct: (v) => {
      product = v;
    },
    sends: () => sends,
    peak: () => peak,
    close: () => {
      operator.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
test('fixed targets/documents/variables reject unrelated writes and extra payload before actual HTTP', async () => {
  const f = await setup();
  try {
    const count = f.sends();
    for (const [url, request] of [
      ['http://' + TARGET.domain + '/admin/api/2026-07/graphql.json', { query: IDENTITY, variables: {} }],
      ['https://other.myshopify.com/admin/api/2026-07/graphql.json', { query: IDENTITY, variables: {} }],
      ['https://' + TARGET.domain + '/admin/api/2026-10/graphql.json', { query: IDENTITY, variables: {} }],
      [
        'https://' + TARGET.domain + '/admin/api/2026-07/graphql.json',
        { query: 'mutation { publishablePublish { userErrors { message } } }', variables: {} },
      ],
      [
        'https://' + TARGET.domain + '/admin/api/2026-07/graphql.json',
        { query: FIXTURE, variables: { id: 'gid://shopify/Product/1' } },
      ],
      [
        'https://' + TARGET.domain + '/admin/api/2026-07/graphql.json',
        { query: SETUP, variables: { product: { id: f.product().id, status: 'ACTIVE', price: '0' } } },
      ],
      [
        'https://' + TARGET.domain + '/admin/api/2026-07/graphql.json',
        { query: IDENTITY, variables: {}, operationName: 'different' },
      ],
    ])
      await assert.rejects(f.operator.fetch(url, { method: 'POST', body: JSON.stringify(request) }));
    assert.equal(f.sends(), count);
  } finally {
    f.close();
  }
});
test('normal reserves cannot consume final 12 reads/3 updates; all attempts count, one lock and one create', async () => {
  const f = await setup();
  try {
    assert.throws(() => createOperator({ directory: f.directory, fetchImpl: async () => Response.json({}) }), /EEXIST/);
    assert.throws(() => initialize(f.directory, { source: 'other' }), /EEXIST/);
    await assert.rejects(
      f.post(CREATE, {
        product: { title: f.initial.run, handle: f.initial.run, tags: [f.initial.run], status: 'DRAFT' },
      }),
    );
    await Promise.all(Array.from({ length: 84 }, () => f.post(IDENTITY)));
    assert.equal(f.peak(), 1);
    await assert.rejects(f.post(IDENTITY), /ceiling/);
    for (let i = 0; i < 13; i++) {
      f.operator.step(`setup${i}`, 'ACTIVE', SETUP);
      await f.post(SETUP, { product: { id: f.product().id, status: 'ACTIVE' } });
    }
    f.operator.step('over-normal', 'ACTIVE', SETUP);
    await assert.rejects(f.post(SETUP, { product: { id: f.product().id, status: 'ACTIVE' } }), /ceiling/);
    f.operator.finalize();
    for (let i = 0; i < 12; i++) await f.post(IDENTITY);
    await assert.rejects(f.post(IDENTITY), /ceiling/);
    for (let i = 0; i < 3; i++) {
      f.operator.step(`final${i}`, 'ARCHIVED', SETUP);
      await f.post(SETUP, { product: { id: f.product().id, status: 'ARCHIVED' } });
    }
    f.operator.step('over-final', 'ARCHIVED', SETUP);
    await assert.rejects(f.post(SETUP, { product: { id: f.product().id, status: 'ARCHIVED' } }), /ceiling/);
    assert.deepEqual(f.operator.state().counts, { auth: 0, read: 96, create: 1, update: 16 });
  } finally {
    f.close();
  }
});
test('naturally lost mutation response stops all later writes and cleanup across reopen; no automatic retry', async () => {
  const f = await setup({ failure: (b) => b.query === SETUP });
  try {
    f.operator.step('lost', 'ACTIVE', SETUP);
    await assert.rejects(f.post(SETUP, { product: { id: f.product().id, status: 'ACTIVE' } }), /unknown_http_result/);
    const count = f.sends();
    assert.throws(() => f.operator.finalize(), /unsettled_write/);
    f.operator.step('retry', 'ACTIVE', SETUP);
    await assert.rejects(f.post(SETUP, { product: { id: f.product().id, status: 'ACTIVE' } }), /status_permission/);
    assert.equal(f.sends(), count);
    f.operator.close();
    const reopened = createOperator({
      directory: f.directory,
      fetchImpl: async () => {
        throw new Error('must not send');
      },
    });
    assert.throws(() => reopened.finalize(), /unsettled_write/);
    reopened.close();
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});
test('real routing identity, nine retained grants and complete empty publication history are mandatory', async () => {
  const f = await setup();
  try {
    const good = identity();
    assertIdentity(good);
    for (const change of [
      { shop: { ...good.shop, id: 'gid://shopify/Shop/1' } },
      { currentAppInstallation: { ...good.currentAppInstallation, id: 'gid://shopify/AppInstallation/1' } },
      { currentAppInstallation: { ...good.currentAppInstallation, accessScopes: [] } },
    ])
      assert.throws(() => assertIdentity({ ...good, ...change }));
    assertUnpublished(f.product());
    for (const change of [
      {
        resourcePublications: {
          nodes: [{ isPublished: false, publishDate: new Date().toISOString() }],
          pageInfo: { hasNextPage: false, hasPreviousPage: false },
        },
      },
      { unpublishedPublications: { nodes: [], pageInfo: { hasNextPage: true, hasPreviousPage: false } } },
      { onlineStoreUrl: 'https://store.example/product' },
    ])
      assert.throws(() => assertUnpublished({ ...f.product(), ...change }));
    f.setProduct({ ...f.product(), publishedAt: new Date().toISOString() });
    await f.post(FIXTURE, { id: f.product().id });
    f.operator.step('exposed', 'ARCHIVED', SETUP);
    await assert.rejects(f.post(SETUP, { product: { id: f.product().id, status: 'ARCHIVED' } }));
  } finally {
    f.close();
  }
});
test('auth exact app/route counts3 and never persists synthetic secret or returned token', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'm5004-'));
  initialize(directory, { source: 'synthetic-source', modules: {} });
  const operator = createOperator({
    directory,
    fetchImpl: async () => Response.json({ access_token: 'synthetic-private-token', expires_in: 86400 }),
  });
  try {
    const body = {
      client_id: TARGET.client,
      client_secret: 'synthetic-private-secret',
      grant_type: 'client_credentials',
    };
    for (let i = 0; i < 3; i++)
      await operator.fetch(`https://${TARGET.domain}/admin/oauth/access_token`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    await assert.rejects(
      operator.fetch(`https://${TARGET.domain}/admin/oauth/access_token`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      /ceiling/,
    );
    const disk = readFileSync(join(directory, 'register.json'), 'utf8');
    assert.ok(!disk.includes('synthetic-private-token') && !disk.includes('synthetic-private-secret'));
  } finally {
    operator.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test('missing/corrupt history never reinitializes or sends', () => {
  const directory = mkdtempSync(join(tmpdir(), 'm5004-'));
  try {
    assert.throws(() => createOperator({ directory, fetchImpl: async () => Response.json({}) }));
    const state = initialize(directory, { source: 'synthetic-source', modules: {} });
    state.counts.create = 1;
    writeFileSync(join(directory, 'register.json'), JSON.stringify(state));
    assert.throws(() => createOperator({ directory, fetchImpl: async () => Response.json({}) }), /register_history/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('offline gate prevents even credential loading', async () => {
  let loaded = false;
  await assert.rejects(
    qualify({
      root: '/nonexistent-synthetic-repo',
      directory: '/unopened',
      binding: {},
      gate: {},
      credentialLoader: () => {
        loaded = true;
        throw new Error('must not read');
      },
    }),
  );
  assert.equal(loaded, false);
});

async function qualificationFixture({
  mismatch = false,
  lost = false,
  published = false,
  wrongIdentity = false,
  metadataDrift = false,
  wrongCatalog = false,
  wrongDrift = false,
  malformedSuccess = false,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'm5004-source-'));
  const directory = join(root, 'run');
  for (const name of [
    '.github/workflows',
    'scripts/m5-004',
    'packages/shopify/src',
    'packages/shopify/dist',
    'packages/application/src',
    'packages/application/dist',
    'packages/domain/src',
    'packages/domain/dist',
    'packages/contracts/src',
    'packages/contracts/dist',
  ])
    mkdirSync(join(root, name), { recursive: true });
  for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) writeFileSync(join(root, name), '{}');
  writeFileSync(join(root, '.gitignore'), 'run/\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Synthetic Test',
      '-c',
      'user.email=synthetic@example.invalid',
      'commit',
      '-qm',
      'synthetic source',
    ],
    { cwd: root },
  );
  const binding = freeze(root);
  const state = initialize(directory, binding);
  const gate = {
    source: binding.source,
    bindingDigest: digest(JSON.stringify(binding)),
    offlineExit: 0,
    reviews: ['spec', 'security'].map((role) => ({
      role,
      model: 'gpt-6.1-sol',
      effort: 'high',
      sandbox: 'read-only',
      verdict: 'no unresolved material finding',
    })),
    ci: [{ head: binding.source, status: 'completed', conclusion: 'success' }],
  };
  let product = fixture(directory, state);
  let version = Date.now() - 60000;
  let sends = 0,
    lastHeldVersion;
  const writes = [];
  const fetchImpl = async (url, init) => {
    sends++;
    const request = JSON.parse(init.body);
    if (url.endsWith('/access_token'))
      return Response.json({ access_token: 'synthetic-token-not-real', expires_in: 86400 });
    const { query, variables } = request;
    if (query === IDENTITY) {
      const data = identity();
      if (wrongIdentity) data.currentAppInstallation.id = 'gid://shopify/AppInstallation/1';
      return Response.json({ data });
    }
    if (query === CREATE) {
      if (published) product = { ...product, publishedAt: new Date().toISOString() };
      return Response.json({ data: { productCreate: { product, userErrors: [] } } });
    }
    if (query === ADAPTER_UPDATE || query === SETUP) {
      writes.push({ status: variables.product.status, query });
      version += 1000;
      product = { ...product, status: variables.product.status, updatedAt: new Date(version).toISOString() };
      if (query === ADAPTER_UPDATE && variables.product.status === 'DRAFT') lastHeldVersion = product.updatedAt;
      if (malformedSuccess && query === ADAPTER_UPDATE)
        return Response.json({ data: { productUpdate: { product, userErrors: '' } } });
      if (lost && query === ADAPTER_UPDATE) throw new Error('synthetic lost acknowledgement');
      if (mismatch && query === ADAPTER_UPDATE)
        product = { ...product, onlineStoreUrl: 'https://example.com/synthetic-visible' };
      return Response.json({ data: { productUpdate: { product, userErrors: [] } } });
    }
    if (query === ADAPTER_READ)
      return Response.json({
        data: {
          ...identity(),
          node:
            wrongDrift && writes.length >= 12 && product.status === 'ARCHIVED'
              ? { ...product, status: 'DRAFT', updatedAt: lastHeldVersion }
              : product,
        },
      });
    if (query === FIXTURE) {
      if (metadataDrift) product = { ...product, tags: [state.run, 'unrelated'] };
      return Response.json({ data: { product } });
    }
    if (query === FIND)
      return Response.json({
        data: { products: { nodes: [product], pageInfo: { hasNextPage: false, hasPreviousPage: false } } },
      });
    const catalog = {
      ...product,
      status: wrongCatalog ? 'ACTIVE' : product.status,
      featuredMedia: null,
      variants: {
        nodes: [{ id: 'gid://shopify/ProductVariant/1', title: 'Default Title', selectedOptions: [], image: null }],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };
    if (query === CATALOG_DETAIL) return Response.json({ data: { product: catalog } });
    if (query === CATALOG_LIST)
      return Response.json({
        data: { products: { nodes: [catalog], pageInfo: { hasNextPage: false, endCursor: null } } },
      });
    throw new Error('unallowlisted query');
  };
  return {
    root,
    directory,
    binding,
    gate,
    fetchImpl,
    writes,
    sends: () => sends,
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

import { ADAPTER_READ, CATALOG_DETAIL, CATALOG_LIST } from './operator.mjs';

test('full qualification reuses unchanged actual status/catalog adapters, fresh-process hold reload and drift refusal', async () => {
  const f = await qualificationFixture();
  try {
    const result = await qualifySynthetic({
      ...f,
      credentialLoader: () => ({ secret: 'synthetic-test-secret', ownership: { synthetic: true } }),
    });
    assert.equal(result.outcome, 'TESTED_MATRIX_PASS');
    assert.equal(result.final.outcome, 'ARCHIVED_UNPUBLISHED_RETAINED');
    assert.deepEqual(
      result.cases.map((x) => x.case),
      ['DRAFT', 'ACTIVE', 'UNLISTED', 'ARCHIVED', 'observed-drift'],
    );
    assert.equal(result.normalized.length, 5);
    assert.ok(result.normalized.every((x) => x.persistedDigest === x.reloadedDigest));
    assert.equal(result.cases.at(-1).additionalRestoreMutations, 0);
    const state = JSON.parse(readFileSync(join(f.directory, 'register.json')));
    assert.equal(state.counts.create, 1);
    assert.equal(state.counts.auth, 1);
    assert.equal(state.counts.update, 12);
    assert.equal(state.counts.read, 62);
    assert.ok(f.writes.every((x) => ['DRAFT', 'ACTIVE', 'UNLISTED', 'ARCHIVED'].includes(x.status)));
    const text = readFileSync(join(f.directory, 'register.json'), 'utf8');
    assert.ok(!text.includes('synthetic-test-secret') && !text.includes('synthetic-token-not-real'));
  } finally {
    f.close();
  }
});
for (const [name, options, expected] of [
  ['changed installation', { wrongIdentity: true }, 'NO_FIXTURE_CREATED'],
  ['unexpected exposure', { published: true }, 'OWNERSHIP_UNRESOLVED_NO_MORE_MUTATIONS'],
  ['visibility mismatch', { mismatch: true }, 'UNRESOLVED_NO_MORE_MUTATIONS'],
  ['natural lost response', { lost: true }, 'UNRESOLVED_NO_MORE_MUTATIONS'],
  ['metadata drift', { metadataDrift: true }, 'UNRESOLVED_NO_MORE_MUTATIONS'],
  ['malformed success', { malformedSuccess: true }, 'UNRESOLVED_NO_MORE_MUTATIONS'],
])
  test(`complete workflow stops on ${name}; no manufacture or unsafe cleanup`, async () => {
    const f = await qualificationFixture(options);
    try {
      const result = await qualifySynthetic({
        ...f,
        credentialLoader: () => ({ secret: 'synthetic-test-secret', ownership: { synthetic: true } }),
      });
      assert.equal(result.outcome, 'STOPPED');
      assert.equal(result.final.outcome, expected);
      const state = JSON.parse(readFileSync(join(f.directory, 'register.json')));
      assert.ok(state.counts.create <= 1);
      if (options.wrongIdentity || options.published || options.metadataDrift) assert.equal(state.counts.update, 0);
      if (options.lost || options.mismatch || options.malformedSuccess)
        assert.equal(f.writes.filter((x) => x.query === ADAPTER_UPDATE).length, 1);
    } finally {
      f.close();
    }
  });

test('live register is canonical; synthetic initialization rejects unsafe directories and lost history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'm5004-register-'));
  try {
    assert.throws(() => initializeReal(directory, { source: 'synthetic', modules: {} }), /canonical_register/);
    chmodSync(directory, 0o777);
    assert.throws(() => initialize(directory, { source: 'synthetic', modules: {} }), /register_permissions/);
    chmodSync(directory, 0o700);
    initialize(directory, { source: 'synthetic', modules: {} });
    unlinkSync(join(directory, 'register.json'));
    assert.throws(() => initialize(directory, { source: 'synthetic', modules: {} }), /EEXIST/);
    assert.ok(!existsSync(join(directory, 'register.json')));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('malformed/unsuccessful mutation responses stay unknown; only valid explicit rejection permits finalization', async () => {
  for (const [status, userErrors, expected] of [
    [500, [{ field: ['status'], message: 'synthetic error' }], 'UNKNOWN'],
    [200, [{ field: ['status'] }], 'UNKNOWN'],
    [200, [{ field: ['status'], message: 'synthetic error' }], 'REJECTED'],
  ]) {
    const f = await setup({
      mutationResponse: () => Response.json({ data: { productUpdate: { product: null, userErrors } } }, { status }),
    });
    try {
      f.operator.step('rejected', 'ACTIVE', SETUP);
      await f.post(SETUP, { product: { id: f.product().id, status: 'ACTIVE' } });
      assert.equal(f.operator.state().events.at(-1).result, expected);
      if (expected === 'UNKNOWN') assert.throws(() => f.operator.finalize(), /unsettled_write/);
      else f.operator.finalize();
    } finally {
      f.close();
    }
  }
});

test('lock cannot release while late HTTP/body work can still persist history', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'm5004-late-'));
  initialize(directory, { source: 'synthetic', modules: {} });
  let release;
  const delayed = new Promise((r) => {
    release = r;
  });
  const op = createOperator({
    directory,
    fetchImpl: async () => {
      await delayed;
      return Response.json({ data: identity() });
    },
  });
  const pending = op.fetch(`https://${TARGET.domain}/admin/api/2026-07/graphql.json`, {
    method: 'POST',
    body: JSON.stringify({ query: IDENTITY, variables: {} }),
  });
  await Promise.resolve();
  try {
    assert.throws(() => op.close(), /pending_dispatch/);
    assert.throws(() => createOperator({ directory, fetchImpl: async () => Response.json({}) }), /EEXIST/);
  } finally {
    release();
    await pending;
    try {
      op.close();
    } catch {}
    rmSync(directory, { recursive: true, force: true });
  }
});
test('acknowledged fixture metadata baseline rejects added tags or changed creation identity', async () => {
  const f = await setup();
  try {
    for (const change of [
      { tags: [f.initial.run, 'unrelated'] },
      { createdAt: new Date(Date.parse(f.product().createdAt) + 1).toISOString() },
    ]) {
      assert.throws(() => assertOwned({ ...f.product(), ...change }, f.operator.state()), /fixture_identity/);
    }
  } finally {
    f.close();
  }
});

import { createShopifyAvailabilityHoldPort } from '../../packages/shopify/dist/index.js';

const testScope = {
  shopId: 'synthetic',
  installationGeneration: '1',
  shopifyShopId: TARGET.shop,
  appClientId: TARGET.client,
};
const adapter = (fetchImpl) =>
  createShopifyAvailabilityHoldPort({
    isCurrent: async () => true,
    credentials: {
      acquire: async () => ({
        kind: 'usable',
        shopDomain: TARGET.domain,
        accessToken: 'synthetic-token',
        accessExpiresAt: new Date(Date.now() + 86400000),
      }),
    },
    fetchImpl,
  });
const observedKind = async (fn) => {
  try {
    return (await fn()).state;
  } catch (e) {
    return e.kind;
  }
};
test('actual adapter HTTP/GraphQL outcomes survive bounded transport and sanitized response replay', async () => {
  for (const [status, wire, expected] of [
    [403, '', 'forbidden'],
    [429, 'not-json', 'throttled'],
    [500, 'not-json', 'provider_unavailable'],
    [200, 'not-json', 'provider_shape'],
    [200, { errors: [{ message: 'synthetic sensitive text', extensions: { code: 'THROTTLED' } }] }, 'throttled'],
    [200, { errors: null }, 'provider_shape'],
    [200, null, 'unavailable'],
  ]) {
    let f;
    f = await setup({
      readResponse: () =>
        new Response(
          typeof wire === 'string' ? wire : JSON.stringify(wire ?? { data: { ...identity(), node: f.product() } }),
          { status },
        ),
    });
    try {
      assert.equal(await observedKind(() => adapter(f.operator.fetch).snapshot(testScope, f.product().id)), expected);
      const event = f.operator.state().events.at(-1);
      assert.equal(event.httpStatus, status);
      const replay = () =>
        new Response(event.replayBody ?? JSON.stringify(event.response), { status: event.httpStatus });
      assert.equal(await observedKind(() => adapter(replay).snapshot(testScope, f.product().id)), expected);
      assert.ok(!JSON.stringify(event).includes('synthetic sensitive text'));
    } finally {
      f.close();
    }
  }
});

test('foreign live root and stale register binding cannot reach credential loading', async () => {
  let loaded = false;
  await assert.rejects(
    qualify({
      root: '/foreign-checkout',
      directory: '/tmp/alternate',
      binding: {},
      gate: {},
      credentialLoader: () => {
        loaded = true;
      },
    }),
    /executing_root/,
  );
  assert.equal(loaded, false);
  const f = await qualificationFixture();
  try {
    const state = JSON.parse(readFileSync(join(f.directory, 'register.json')));
    state.binding.source = 'stale-source';
    writeFileSync(join(f.directory, 'register.json'), JSON.stringify(state));
    await assert.rejects(
      qualifySynthetic({
        ...f,
        credentialLoader: () => {
          loaded = true;
          return { secret: 'synthetic-secret' };
        },
      }),
      /register_source_binding/,
    );
    assert.equal(loaded, false);
  } finally {
    f.close();
  }
});

test('gate rejects incomplete CI and unbound review receipts even when every supplied workflow is green', async () => {
  const f = await qualificationFixture();
  try {
    assert.throws(() => verifyGate(f.root, f.gate, f.binding), /offline_gate/);
  } finally {
    f.close();
  }
});

test('complete source/build/review/CI gate accepts bound receipts and rejects omissions, stale refs or altered evidence', async () => {
  const f = await qualificationFixture();
  try {
    const names = [
      'M0-008 local publication and architecture checks',
      'M0-009 embedded Astro local proof',
      'M0-010 local hybrid billing proof',
      'M0-011 local provider adapter boundary',
      'M0-012 real contract local prototype',
      'M0-013 off-store protocol capacity',
      'M0-014 local public-app candidate',
      'M1-001 foundation and boundaries',
      'M3-001 PostgreSQL durable core',
      'M3-002 local runtime and ingress',
    ];
    const base = 'a7b2ba236f6b7726f48af0cd50ae14e0b7cc8e30',
      fingerprint = digest(JSON.stringify(f.binding));
    const artifact = (name, text) => {
      const path = join(f.directory, name);
      writeFileSync(path, text);
      return { path, sha256: digest(text) };
    };
    const reviews = ['spec', 'security'].map((role, i) => {
      const thread = `00000000-0000-0000-0000-00000000000${i}`;
      return {
        role,
        thread,
        base,
        head: f.binding.source,
        bindingDigest: fingerprint,
        model: 'gpt-6.1-sol',
        effort: 'high',
        sandbox: 'read-only',
        verdict: 'no unresolved material finding',
        report: artifact(role + '.md', 'Synthetic source-bound report'),
        settings: artifact(
          role + '.json',
          JSON.stringify({
            role,
            thread,
            selectedSameLaunchContext: [
              {
                cwd: f.root,
                model: 'gpt-6.1-sol',
                effort: 'high',
                sandbox_policy: { type: 'read-only' },
                approval_policy: 'never',
              },
            ],
          }),
        ),
      };
    });
    const good = {
      source: f.binding.source,
      base,
      bindingDigest: fingerprint,
      offline: {
        source: f.binding.source,
        bindingDigest: fingerprint,
        exitCode: 0,
        report: artifact('offline.log', 'synthetic exit0'),
      },
      reviews,
      ci: names.map((workflowName, i) => ({
        workflowName,
        headSha: f.binding.source,
        status: 'completed',
        conclusion: 'success',
        databaseId: 9000 + i,
        url: `https://github.com/Optidigi/insignia/actions/runs/${9000 + i}`,
      })),
    };
    const verify = (g) => verifyGate(f.root, g, f.binding, { evidenceRoot: f.directory });
    verify(good);
    for (const change of [
      (g) => g.ci.pop(),
      (g) => (g.ci[0].conclusion = 'failure'),
      (g) => (g.ci[0].headSha = 'stale'),
      (g) => (g.reviews[0].head = 'stale'),
      (g) => (g.reviews[0].bindingDigest = '0'.repeat(64)),
      (g) => (g.offline.source = 'stale'),
      (g) => (g.reviews[1].thread = g.reviews[0].thread),
    ]) {
      const bad = structuredClone(good);
      change(bad);
      assert.throws(() => verify(bad), /offline_gate/);
    }
    writeFileSync(good.reviews[0].report.path, 'modified');
    assert.throws(() => verify(good), /gate_artifact/);
  } finally {
    f.close();
  }
});
test('actual adapter user-error failure remains identical when replayed from sanitized mutation evidence', async () => {
  const f = await setup({
    mutationResponse: () =>
      Response.json({
        data: {
          productUpdate: {
            product: null,
            userErrors: [{ field: ['status'], message: 'synthetic sensitive rejection' }],
          },
        },
      }),
  });
  try {
    f.setProduct({ ...f.product(), status: 'ACTIVE' });
    const port = adapter(f.operator.fetch);
    const before = await port.snapshot(testScope, f.product().id);
    f.operator.step('user-error', 'DRAFT', ADAPTER_UPDATE);
    const intent = { version: 'm5-availability-hold-v1', operationId: 'synthetic-user-error', before, held: null };
    const kind = await observedKind(() => port.acquire(testScope, intent));
    assert.equal(kind, 'user_error');
    const e = f.operator.state().events.at(-1);
    assert.equal(e.result, 'REJECTED');
    assert.ok(!JSON.stringify(e).includes('synthetic sensitive rejection'));
    const replay = adapter(async (_u, init) =>
      JSON.parse(init.body).query === ADAPTER_UPDATE
        ? Response.json(e.response, { status: e.httpStatus })
        : Response.json({ data: { ...identity(), node: f.product() } }),
    );
    assert.equal(await observedKind(() => replay.acquire(testScope, intent)), kind);
  } finally {
    f.close();
  }
});

test('malformed success userErrors cannot acknowledge a status mutation or allow cleanup', async () => {
  for (const userErrors of ['', { length: 0 }, null]) {
    let f;
    f = await setup({
      mutationResponse: () =>
        Response.json({ data: { productUpdate: { product: { ...f.product(), status: 'ACTIVE' }, userErrors } } }),
    });
    try {
      f.operator.step('malformed-success', 'ACTIVE', SETUP);
      await f.post(SETUP, { product: { id: f.product().id, status: 'ACTIVE' } });
      assert.equal(f.operator.state().events.at(-1).result, 'UNKNOWN');
      assert.throws(() => f.operator.finalize(), /unsettled_write/);
    } finally {
      f.close();
    }
  }
});

import { createCatalogTransport } from '../../packages/shopify/dist/index.js';

test('actual availability missing/oversized bodies keep direct/wrapped/replayed shape errors', async () => {
  for (const raw of [null, Buffer.alloc(128 * 1024 + 1, 32)]) {
    const f = await setup({ readResponse: () => new Response(raw, { status: 200 }) });
    try {
      assert.equal(
        await observedKind(() =>
          adapter(async () => new Response(raw, { status: 200 })).snapshot(testScope, f.product().id),
        ),
        'provider_shape',
      );
      assert.equal(
        await observedKind(() => adapter(f.operator.fetch).snapshot(testScope, f.product().id)),
        'provider_shape',
      );
      const event = f.operator.state().events.at(-1);
      assert.equal(
        await observedKind(() => adapter(async () => replayResponse(event)).snapshot(testScope, f.product().id)),
        'provider_shape',
      );
    } finally {
      f.close();
    }
  }
});
test('catalog receives original bounded UTF8 bytes and provenance hashes the bytes, not replacement text', async () => {
  const f = await setup();
  try {
    const value = {
      data: {
        product: {
          id: f.product().id,
          title: 'MARK',
          status: 'UNLISTED',
          featuredMedia: null,
          variants: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
        },
      },
    };
    const valid = Buffer.from(JSON.stringify(value));
    const at = valid.indexOf('MARK');
    const wire = Buffer.from(valid);
    wire[at] = 255;
    const fetchImpl = async () => new Response(wire, { status: 200 });
    const direct = createCatalogTransport({ shop: TARGET.domain, accessToken: 'synthetic', fetchImpl });
    await assert.rejects(direct.read('detail', { id: f.product().id, after: null }), /Catalog JSON response invalid/);

    f.operator.close();
    const wrapped = createOperator({ directory: f.directory, fetchImpl });
    try {
      const transport = createCatalogTransport({
        shop: TARGET.domain,
        accessToken: 'synthetic',
        fetchImpl: wrapped.fetch,
      });
      await assert.rejects(
        transport.read('detail', { id: f.product().id, after: null }),
        /Catalog JSON response invalid/,
      );
      const event = wrapped.state().events.at(-1);
      assert.equal(event.responseDigest, digest(wire));
      const replay = createCatalogTransport({
        shop: TARGET.domain,
        accessToken: 'synthetic',
        fetchImpl: async () => replayResponse(event),
      });
      await assert.rejects(replay.read('detail', { id: f.product().id, after: null }), /Catalog JSON response invalid/);
    } finally {
      wrapped.close();
    }
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});

for (const [name, options, key] of [
  ['catalog', { wrongCatalog: true }, 'UNLISTED'],
  ['drift', { wrongDrift: true }, 'observed-drift'],
])
  test(`failed ${name} preserves actual normalized results before STOP`, async () => {
    const f = await qualificationFixture(options);
    try {
      const result = await qualifySynthetic({
        ...f,
        credentialLoader: () => ({ secret: 'synthetic-key', ownership: { synthetic: true } }),
      });
      assert.equal(result.outcome, 'STOPPED');
      const entry = result.cases.find((x) => x.case === key);
      assert.equal(entry.outcome, 'STOPPED');
      if (options.wrongCatalog) {
        assert.equal(result.catalog.detail.status, 'ACTIVE');
        assert.equal(result.catalog.list.products[0].status, 'ACTIVE');
      }
      if (options.wrongDrift) {
        assert.equal(entry.observation.kind, 'HELD');
        assert.equal(f.writes.length, 12);
        assert.equal(entry.restored, undefined);
      }
      assert.equal(result.final.outcome, 'ARCHIVED_UNPUBLISHED_RETAINED');
    } finally {
      f.close();
    }
  });

test('availability preserves its lossy UTF8 semantics while catalog rejects the same original bad bytes', async () => {
  const f = await setup();
  try {
    const payload = Buffer.from(JSON.stringify({ data: { ...identity(), node: { ...f.product(), title: 'MARK' } } }));
    payload[payload.indexOf('MARK')] = 255;
    f.operator.close();
    const op = createOperator({
      directory: f.directory,
      fetchImpl: async () => new Response(payload, { status: 200 }),
    });
    try {
      assert.equal(await observedKind(() => adapter(op.fetch).snapshot(testScope, f.product().id)), 'unavailable');
      const event = op.state().events.at(-1);
      assert.equal(event.responseDigest, digest(payload));
      assert.equal(
        await observedKind(() => adapter(async () => replayResponse(event)).snapshot(testScope, f.product().id)),
        'unavailable',
      );
    } finally {
      op.close();
    }
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test('reopening a finished run preserves exact normalized evidence and refuses before credential loading', async () => {
  const f = await qualificationFixture();
  try {
    let loads = 0;
    const loader = () => {
      loads++;
      return { secret: 'synthetic-key', ownership: { synthetic: true } };
    };
    await qualifySynthetic({ ...f, credentialLoader: loader });
    const before = readFileSync(join(f.directory, 'qualification.json')),
      register = readFileSync(join(f.directory, 'register.json')),
      count = f.sends();
    await assert.rejects(qualifySynthetic({ ...f, credentialLoader: loader }), /qualification_reentry_refused/);
    assert.equal(loads, 1);
    assert.equal(f.sends(), count);
    assert.deepEqual(readFileSync(join(f.directory, 'qualification.json')), before);
    assert.deepEqual(readFileSync(join(f.directory, 'register.json')), register);
  } finally {
    f.close();
  }
});
test('catalog successful non200 keeps direct/wrapped/replayed body semantics', async () => {
  const f = await setup();
  f.operator.close();
  const data = {
    data: {
      product: {
        id: f.product().id,
        title: 'synthetic',
        status: 'UNLISTED',
        featuredMedia: null,
        variants: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
      },
    },
  };
  const fetchImpl = async () => Response.json(data, { status: 201 });
  const op = createOperator({ directory: f.directory, fetchImpl });
  try {
    const input = { id: f.product().id, after: null };
    const make = (fetchImpl) => createCatalogTransport({ shop: TARGET.domain, accessToken: 'synthetic', fetchImpl });
    const direct = await make(fetchImpl).read('detail', input);
    assert.deepEqual(await make(op.fetch).read('detail', input), direct);
    const event = op.state().events.at(-1);
    assert.deepEqual(await make(async () => replayResponse(event)).read('detail', input), direct);
    assert.equal(event.httpStatus, 201);
  } finally {
    op.close();
    rmSync(f.directory, { recursive: true, force: true });
  }
});
