import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createOperator, IDENTITY, initialize, TARGET } from './operator.mjs';

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
import { mkdirSync, writeFileSync } from 'node:fs';
import { digest, freeze } from './binding.mjs';
import {
  ADAPTER_UPDATE,
  assertIdentity,
  assertUnpublished,
  CREATE,
  FIND,
  FIXTURE,
  GRANTS,
  SETUP,
} from './operator.mjs';
import { qualify } from './qualification.mjs';

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
      if (body.query === CREATE) return Response.json({ data: { productCreate: { product, userErrors: [] } } });
      if (body.query === SETUP || body.query === ADAPTER_UPDATE) {
        product = { ...product, status: body.variables.product.status };
        return Response.json({ data: { productUpdate: { product, userErrors: [] } } });
      }
      return Response.json({ data: body.query === IDENTITY ? identity() : { product } });
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
    assert.throws(() => createOperator({ directory: f.directory }), /EEXIST/);
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
    assert.throws(() => createOperator({ directory }));
    const state = initialize(directory, { source: 'synthetic-source', modules: {} });
    state.counts.create = 1;
    writeFileSync(join(directory, 'register.json'), JSON.stringify(state));
    assert.throws(() => createOperator({ directory }), /register_history/);
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

async function qualificationFixture({ mismatch = false, lost = false, published = false, wrongIdentity = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'm5004-source-'));
  const directory = join(root, 'run');
  for (const name of [
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
  let sends = 0;
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
      if (lost && query === ADAPTER_UPDATE) throw new Error('synthetic lost acknowledgement');
      if (mismatch && query === ADAPTER_UPDATE)
        product = { ...product, onlineStoreUrl: 'https://example.com/synthetic-visible' };
      return Response.json({ data: { productUpdate: { product, userErrors: [] } } });
    }
    if (query === ADAPTER_READ) return Response.json({ data: { ...identity(), node: product } });
    if (query === FIXTURE) return Response.json({ data: { product } });
    if (query === FIND)
      return Response.json({
        data: { products: { nodes: [product], pageInfo: { hasNextPage: false, hasPreviousPage: false } } },
      });
    const catalog = {
      ...product,
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
    const result = await qualify({
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
    assert.ok(state.counts.read <= 70);
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
])
  test(`complete workflow stops on ${name}; no manufacture or unsafe cleanup`, async () => {
    const f = await qualificationFixture(options);
    try {
      const result = await qualify({
        ...f,
        credentialLoader: () => ({ secret: 'synthetic-test-secret', ownership: { synthetic: true } }),
      });
      assert.equal(result.outcome, 'STOPPED');
      assert.equal(result.final.outcome, expected);
      const state = JSON.parse(readFileSync(join(f.directory, 'register.json')));
      assert.ok(state.counts.create <= 1);
      if (options.wrongIdentity || options.published) assert.equal(state.counts.update, 0);
      if (options.lost || options.mismatch) assert.equal(f.writes.filter((x) => x.query === ADAPTER_UPDATE).length, 1);
    } finally {
      f.close();
    }
  });
