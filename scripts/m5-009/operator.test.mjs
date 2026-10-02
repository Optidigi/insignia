import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertIdentity, TARGET } from './operator.mjs';

const identity = (handles) => ({
  shop: { id: TARGET.shop, myshopifyDomain: TARGET.domain, plan: { partnerDevelopment: true } },
  currentAppInstallation: {
    id: TARGET.installation,
    app: { id: TARGET.app, apiKey: TARGET.client },
    accessScopes: handles.map((handle) => ({ handle })),
  },
});

test('current product capability accepts write_products without the obsolete nine grants', () => {
  assert.doesNotThrow(() => assertIdentity(identity(['write_products'])));
  assert.doesNotThrow(() => assertIdentity(identity(['read_products', 'write_products', 'read_orders'])));
});

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as legacy from '../m5-004/operator.mjs';
import { createOperator, initialize, LIVE_DIRECTORY } from './operator.mjs';

test('legacy exact-nine guard stays unchanged while successor records current additional grants', () => {
  assert.throws(() => legacy.assertIdentity(identity(['write_products'])), { kind: 'retained_grants' });
  const directory = mkdtempSync(join(tmpdir(), 'm5009-'));
  try {
    initialize(directory, { source: 'synthetic', modules: {} }, { synthetic: true });
    const op = createOperator({ directory, fetchImpl: async () => Response.json({}) });
    try {
      const data = identity(['read_orders', 'write_products', 'read_products']);
      op.identity(data);
      const saved = JSON.parse(readFileSync(join(directory, 'register.json')));
      assert.deepEqual(saved.identity.currentAppInstallation.accessScopes, data.currentAppInstallation.accessScopes);
      assert.match(saved.run, /^insignia-m5-009-/);
    } finally {
      op.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('successor rejects absent capability, malformed grants and every wrong routing identity', () => {
  for (const handles of [[], ['read_products']])
    assert.throws(() => assertIdentity(identity(handles)), { kind: 'product_capability' });
  for (const scopes of [
    null,
    {},
    [null],
    [{ handle: 5 }],
    [{ handle: 'write_products', extra: true }],
    [{ handle: 'write_products' }, { handle: 'write_products' }],
    [{ handle: 'write_products\n' }],
    [{ handle: 'x'.repeat(129) }],
    Array(251).fill({ handle: 'write_products' }),
  ]) {
    const data = identity(['write_products']);
    data.currentAppInstallation.accessScopes = scopes;
    assert.throws(() => assertIdentity(data), { kind: 'grant_shape' });
  }
  for (const mutate of [
    (d) => {
      d.shop.id = 'gid://shopify/Shop/1';
    },
    (d) => {
      d.shop.myshopifyDomain = 'other.myshopify.com';
    },
    (d) => {
      d.shop.plan.partnerDevelopment = false;
    },
    (d) => {
      d.currentAppInstallation.id = 'gid://shopify/AppInstallation/1';
    },
    (d) => {
      d.currentAppInstallation.app.id = 'gid://shopify/App/1';
    },
    (d) => {
      d.currentAppInstallation.app.apiKey = 'different';
    },
  ]) {
    const data = identity(['write_products']);
    mutate(data);
    assert.throws(() => assertIdentity(data), { kind: 'identity' });
  }
});

test('successor rejects the legacy canonical live directory before writing and cannot reopen legacy history', () => {
  assert.notEqual(LIVE_DIRECTORY, legacy.LIVE_DIRECTORY);
  assert.throws(() => initialize(legacy.LIVE_DIRECTORY, { source: 'synthetic', modules: {} }), {
    kind: 'canonical_register',
  });
  const directory = mkdtempSync(join(tmpdir(), 'm5009-cross-'));
  try {
    legacy.initialize(directory, { source: 'synthetic', modules: {} }, { synthetic: true });
    const before = readFileSync(join(directory, 'register.json'));
    assert.throws(() => createOperator({ directory, fetchImpl: async () => Response.json({}) }), { kind: 'register' });
    assert.deepEqual(readFileSync(join(directory, 'register.json')), before);
    assert.equal(existsSync(join(directory, 'operator.lock')), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

import { execFileSync } from 'node:child_process';
import {
  ADAPTER_READ,
  ADAPTER_UPDATE,
  CATALOG_DETAIL,
  CATALOG_LIST,
  CREATE,
  FIXTURE,
  IDENTITY,
  LIMITS,
  SETUP,
} from './operator.mjs';
import { qualify, qualifySynthetic } from './qualification.mjs';

test('successor documents, request ceilings, ownership, settlement and shared matrix stay source-identical', () => {
  for (const name of [
    'ADAPTER_READ',
    'ADAPTER_UPDATE',
    'CATALOG_DETAIL',
    'CATALOG_LIST',
    'CREATE',
    'FIXTURE',
    'IDENTITY',
    'SETUP',
    'LIMITS',
  ]) {
    assert.equal(
      legacy[name],
      { ADAPTER_READ, ADAPTER_UPDATE, CATALOG_DETAIL, CATALOG_LIST, CREATE, FIXTURE, IDENTITY, SETUP, LIMITS }[name],
    );
  }
  for (const file of ['operator.mjs', 'qualification.mjs']) {
    const original = execFileSync('git', ['show', `9ce56a1a9b8f674a3500f6592803f7a52e2ef18d:scripts/m5-004/${file}`], {
      encoding: 'utf8',
    });
    const current = readFileSync(new URL(`../m5-004/${file}`, import.meta.url), 'utf8');
    const start = file === 'operator.mjs' ? 'export function assertUnpublished' : 'async function runQualification';
    const end = file === 'operator.mjs' ? 'export function createOperator' : '\nif (process.argv[1]';
    const segment = (s) => s.slice(s.indexOf(start), s.indexOf(end));
    assert.equal(segment(current), segment(original), `${file} shared behavior`);
  }
});

async function syntheticRun({
  handles = ['read_products', 'write_products'],
  wrongIdentity = false,
  lost = false,
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'm5009-matrix-'));
  const binding = { source: 'synthetic-successor', modules: {} };
  const state = initialize(directory, binding, { synthetic: true });
  let product,
    version = Date.now() - 60000,
    active = 0,
    peak = 0;
  const requests = [];
  const fetchImpl = async (url, init) => {
    peak = Math.max(peak, ++active);
    await Promise.resolve();
    active--;
    if (url.endsWith('/access_token')) return Response.json({ access_token: 'synthetic-bearer', expires_in: 86400 });
    const { query, variables } = JSON.parse(init.body);
    requests.push({ query, variables });
    if (query === IDENTITY) {
      const data = identity(handles);
      if (wrongIdentity) data.shop.id = 'gid://shopify/Shop/1';
      return Response.json({ data });
    }
    if (query === CREATE) {
      assert.deepEqual(variables, {
        product: { title: state.run, handle: state.run, tags: [state.run], status: 'DRAFT' },
      });
      product = {
        __typename: 'Product',
        id: 'gid://shopify/Product/999999',
        status: 'DRAFT',
        handle: state.run,
        title: state.run,
        tags: [state.run],
        createdAt: new Date().toISOString(),
        updatedAt: new Date(version).toISOString(),
        publishedAt: null,
        onlineStoreUrl: null,
        resourcePublications: { nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
        unpublishedPublications: { nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
      };
      return Response.json({ data: { productCreate: { product, userErrors: [] } } });
    }
    if (query === SETUP || query === ADAPTER_UPDATE) {
      assert.deepEqual(Object.keys(variables.product).sort(), ['id', 'status']);
      assert.equal(variables.product.id, product.id);
      version += 1000;
      product = { ...product, status: variables.product.status, updatedAt: new Date(version).toISOString() };
      if (lost && query === ADAPTER_UPDATE) throw new Error('synthetic lost response');
      return Response.json({ data: { productUpdate: { product, userErrors: [] } } });
    }
    if (query === ADAPTER_READ) return Response.json({ data: { ...identity(handles), node: product } });
    if (query === FIXTURE) return Response.json({ data: { product } });
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
    throw new Error('unallowlisted synthetic request');
  };
  try {
    const result = await qualifySynthetic({
      directory,
      binding,
      fetchImpl,
      credentialLoader: () => ({ secret: 'synthetic-secret', ownership: { synthetic: true } }),
    });
    const disk = readFileSync(join(directory, 'register.json'), 'utf8');
    assert.ok(!disk.includes('synthetic-secret') && !disk.includes('synthetic-bearer'));
    assert.equal(existsSync(join(directory, 'operator.lock')), false);
    return { result, register: JSON.parse(disk), requests, peak };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('fresh complete successor workflow uses real adapters, current product grants, persisted holds and unchanged matrix', async () => {
  for (const handles of [
    ['read_products', 'write_products'],
    ['read_products', 'read_orders', 'write_products'],
  ]) {
    const { result, register, peak } = await syntheticRun({ handles });
    assert.equal(result.outcome, 'TESTED_MATRIX_PASS');
    assert.equal(result.final.outcome, 'ARCHIVED_UNPUBLISHED_RETAINED');
    assert.deepEqual(
      result.cases.map((x) => x.case),
      ['DRAFT', 'ACTIVE', 'UNLISTED', 'ARCHIVED', 'observed-drift'],
    );
    assert.deepEqual(
      result.cases.slice(0, 4).map((x) => x.adapterMutations),
      [0, 2, 2, 2],
    );
    assert.equal(result.cases.at(-1).additionalRestoreMutations, 0);
    assert.equal(result.cases.at(-1).observation.kind, 'CONFLICT');
    assert.equal(result.cases.at(-1).restored.kind, 'CONFLICT');
    assert.equal(result.catalog.outcome, 'PASS');
    assert.equal(result.normalized.length, 5);
    assert.ok(result.normalized.every((x) => x.persistedDigest === x.reloadedDigest));
    assert.deepEqual(register.counts, { auth: 1, read: 62, create: 1, update: 12 });
    assert.deepEqual(
      register.identity.currentAppInstallation.accessScopes,
      handles.map((handle) => ({ handle })),
    );
    assert.equal(peak, 1);
  }
});

for (const [name, options, final] of [
  ['missing capability', { handles: ['read_products'] }, 'NO_FIXTURE_CREATED'],
  ['wrong identity', { wrongIdentity: true }, 'NO_FIXTURE_CREATED'],
  ['lost status acknowledgement', { lost: true }, 'UNRESOLVED_NO_MORE_MUTATIONS'],
])
  test(`public successor workflow stops on ${name} without unsafe cleanup or retries`, async () => {
    const { result, register, requests } = await syntheticRun(options);
    assert.equal(result.outcome, 'STOPPED');
    assert.equal(result.final.outcome, final);
    if (options.lost) assert.equal(requests.filter((x) => x.query === ADAPTER_UPDATE).length, 1);
    else {
      assert.equal(register.counts.create, 0);
      assert.equal(register.counts.update, 0);
    }
  });

test('successor live entry refuses incomplete gate before the protected credential route', async () => {
  await assert.rejects(qualify({ directory: LIVE_DIRECTORY, binding: {}, gate: {} }));
});

import { mkdirSync, writeFileSync } from 'node:fs';
import { BASE, digest, freeze, verifyGate, WORKFLOWS } from './binding.mjs';

test('successor gate binds its own tree, directory, exact source and independent review/CI receipts', () => {
  const root = mkdtempSync(join(tmpdir(), 'm5009-gate-'));
  const evidenceRoot = join(root, 'receipts');
  try {
    for (const p of [
      '.github/workflows',
      'scripts/m5-004',
      'scripts/m5-009',
      'packages/shopify/src',
      'packages/shopify/dist',
      'packages/application/src',
      'packages/application/dist',
      'packages/domain/src',
      'packages/domain/dist',
      'packages/contracts/src',
      'packages/contracts/dist',
    ])
      mkdirSync(join(root, p), { recursive: true });
    mkdirSync(evidenceRoot);
    writeFileSync(join(root, '.gitignore'), 'receipts/\n');
    for (const p of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) writeFileSync(join(root, p), '{}');
    writeFileSync(join(root, 'scripts/m5-009/operator.mjs'), '// synthetic successor\n');
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync(
      'git',
      ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-qm', 'synthetic'],
      { cwd: root },
    );
    const binding = freeze(root),
      fingerprint = digest(JSON.stringify(binding));
    assert.equal(
      binding.tree,
      execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).trim(),
    );
    assert.ok(binding.modules['scripts/m5-009/operator.mjs']);
    const artifact = (name, text) => {
      const path = join(evidenceRoot, name);
      writeFileSync(path, text);
      return { path, sha256: digest(text) };
    };
    const gate = {
      source: binding.source,
      tree: binding.tree,
      base: BASE,
      bindingDigest: fingerprint,
      offline: {
        source: binding.source,
        bindingDigest: fingerprint,
        exitCode: 0,
        report: artifact('offline.md', 'synthetic offline receipt'),
      },
      reviews: ['spec', 'security'].map((role, i) => {
        const thread = `00000000-0000-0000-0000-00000000000${i}`;
        return {
          role,
          thread,
          base: BASE,
          head: binding.source,
          bindingDigest: fingerprint,
          model: 'gpt-6.1-sol',
          effort: 'high',
          sandbox: 'read-only',
          verdict: 'no unresolved material finding',
          report: artifact(`${role}.md`, 'synthetic review'),
          settings: artifact(
            `${role}.json`,
            JSON.stringify({
              role,
              thread,
              selectedSameLaunchContext: [
                {
                  cwd: root,
                  model: 'gpt-6.1-sol',
                  effort: 'high',
                  sandbox_policy: { type: 'read-only' },
                  approval_policy: 'never',
                },
              ],
            }),
          ),
        };
      }),
      ci: WORKFLOWS.map((workflowName, i) => ({
        workflowName,
        headSha: binding.source,
        status: 'completed',
        conclusion: 'success',
        databaseId: 9000 + i,
        url: `https://github.com/Optidigi/insignia/actions/runs/${9000 + i}`,
      })),
    };
    const verify = (g) => verifyGate(root, g, binding, { evidenceRoot });
    verify(gate);
    for (const change of [
      (g) => {
        g.tree = 'stale';
      },
      (g) => {
        g.base = 'a7b2ba236f6b7726f48af0cd50ae14e0b7cc8e30';
      },
      (g) => {
        g.ci.pop();
      },
      (g) => {
        g.reviews[0].head = 'stale';
      },
      (g) => {
        g.offline.bindingDigest = '0'.repeat(64);
      },
    ]) {
      const bad = structuredClone(gate);
      change(bad);
      assert.throws(() => verify(bad), { kind: 'offline_gate' });
    }
    writeFileSync(join(root, 'scripts/m5-009/operator.mjs'), '// changed after freeze\n');
    assert.throws(() => verify(gate), { kind: 'source_binding' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
