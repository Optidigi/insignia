import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createShopifyAvailabilityHoldPort } from '../../packages/shopify/dist/index.js';
import {
  ADAPTER_READ,
  ADAPTER_UPDATE,
  ARCHIVE,
  CREATED_AT,
  FIXTURE,
  IDENTITY,
  MARKER,
  PARTITIONS,
  PROJECTION,
  PUBLICATION,
  PUBLICATION_ID,
  TARGET,
  V2_DOCUMENTS,
} from './documents.mjs';
import { assertOwned, createOperator } from './operator.mjs';
import { runSynthetic } from './qualification.mjs';

test('exact historical ownership accepts the fixed fixture and rejects an alternate target', () => {
  const product = {
    __typename: 'Product',
    id: FIXTURE,
    handle: MARKER,
    title: MARKER,
    tags: [MARKER],
    createdAt: CREATED_AT,
  };
  assert.doesNotThrow(() => assertOwned(product));
  assert.throws(() => assertOwned({ ...product, id: 'gid://shopify/Product/1' }), /ownership/);
  assert.throws(() => assertOwned({ ...product, tags: [MARKER, 'other'] }), /ownership/);
});

function simulator(options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'm5011-'));
  let status = options.prestatus ?? 'ACTIVE',
    version = new Date(Date.now() - 10000).toISOString(),
    updates = 0;
  const calls = [];
  const identity = () => ({
    shop: {
      id: TARGET.shop,
      myshopifyDomain: TARGET.domain,
      plan: { partnerDevelopment: true, displayName: 'synthetic development' },
    },
    currentAppInstallation: {
      id: TARGET.installation,
      app: { id: TARGET.app, apiKey: TARGET.client },
      accessScopes: ['read_products', 'write_products', 'read_publications', 'read_product_listings']
        .filter((x) => x !== options.missingGrant)
        .map((handle) => ({ handle })),
    },
  });
  const connection = (nodes) => ({ nodes, pageInfo: { hasNextPage: false, hasPreviousPage: false } });
  const pub = () => ({
    isPublished: status === 'ACTIVE',
    publishDate: CREATED_AT,
    publication: { id: PUBLICATION_ID },
  });
  const product = () => ({
    __typename: 'Product',
    id: FIXTURE,
    handle: MARKER,
    title: options.wrongOwnership ? 'foreign' : MARKER,
    tags: [MARKER],
    createdAt: CREATED_AT,
    status,
    updatedAt: version,
    publishedAt: null,
    onlineStoreUrl: null,
    resourcePublications: connection(status === 'ACTIVE' ? [pub()] : []),
    unpublishedPublications: connection([]),
    ...Object.fromEntries(
      PARTITIONS.map((t) => [
        t,
        connection(
          t === 'APP' && !(options.v2Disappear && status === 'DRAFT') && !(options.v2Appear && status === 'ACTIVE')
            ? [pub()]
            : [],
        ),
      ]),
    ),
  });
  const fetchImpl = async (url, init) => {
    const b = JSON.parse(init.body);
    calls.push(b);
    if (url.endsWith('/admin/oauth/access_token'))
      return Response.json({ access_token: 'synthetic-token', expires_in: 3600 });
    if (b.query === IDENTITY) return Response.json({ data: identity() });
    if (b.query === PROJECTION || Object.values(V2_DOCUMENTS).includes(b.query)) {
      const p = product();
      if (
        Object.values(V2_DOCUMENTS).includes(b.query) &&
        (options.partitionDrift || (options.postPartitionDrift && status === 'DRAFT'))
      )
        p.updatedAt = new Date(Date.parse(version) + 1000).toISOString();
      if (options.incomplete)
        p[options.incomplete === true ? 'MARKET' : options.incomplete].pageInfo.hasNextPage = true;
      if (options.postOwnership && status === 'DRAFT') p.title = 'changed';
      return Response.json({ data: { ...identity(), product: p } });
    }
    if (b.query === PUBLICATION)
      return Response.json({
        data: {
          publication: {
            id: PUBLICATION_ID,
            autoPublish: true,
            supportsFuturePublishing: false,
            catalog: null,
            channels: connection([
              {
                id: 'gid://shopify/Channel/1',
                name: 'synthetic',
                app: { id: 'gid://shopify/App/1', title: 'synthetic' },
              },
            ]),
          },
        },
      });
    if (b.query === ADAPTER_READ) {
      if (options.adapterFailure === 'http403') return new Response('<h1>Forbidden</h1>', { status: 403 });
      if (options.adapterFailure === 'graphql')
        return Response.json({ errors: [{ message: 'synthetic denial', extensions: { code: 'ACCESS_DENIED' } }] });
      if (options.adapterFailure === 'invalidJSON') return new Response('{', { status: 200 });
      if (options.adapterFailure === 'missingBody') return new Response(null, { status: 200 });
      if (options.adapterFailure === 'badScopes')
        return Response.json({
          data: {
            ...identity(),
            currentAppInstallation: { ...identity().currentAppInstallation, accessScopes: {} },
            node: product(),
          },
        });
      if (options.adapterFailure === 'badNodes') {
        const p = product();
        p.resourcePublications.nodes = {};
        return Response.json({ data: { ...identity(), node: p } });
      }
      if (options.readbackFail && status === 'DRAFT') throw new Error('synthetic-network');
      const i = identity();
      if (options.adapterGrantDrift)
        i.currentAppInstallation.accessScopes = i.currentAppInstallation.accessScopes.filter(
          (n) => n.handle !== 'read_product_listings',
        );
      return Response.json({ data: { ...i, node: product() } });
    }
    if (b.query === ADAPTER_UPDATE || b.query === ARCHIVE) {
      updates++;
      if (options.userError && b.query === ADAPTER_UPDATE)
        return Response.json({
          data: {
            productUpdate: { product: null, userErrors: [{ field: ['status'], message: 'synthetic rejection' }] },
          },
        });
      status = b.variables.product.status;
      version = new Date(Date.parse(version) + 1000).toISOString();
      if (options.ackLoss && status === 'DRAFT') throw new Error('synthetic-network');
      if (options.archiveLoss && status === 'ARCHIVED') throw new Error('synthetic-network');
      if (options.archiveOutstanding && status === 'ARCHIVED') return new Promise(() => {});
      if (options.archiveBodyOutstanding && status === 'ARCHIVED')
        return new Response(new ReadableStream({ cancel: () => new Promise(() => {}) }), { status: 503 });
      if (options.archiveBodyAbortOutstanding && status === 'ARCHIVED')
        return new Response(new ReadableStream({ cancel: () => new Promise(() => {}) }), { status: 200 });
      if (options.archiveBodyCancelRejected && status === 'ARCHIVED')
        return new Response(new ReadableStream({ cancel: () => Promise.reject(new Error('synthetic cancel')) }), {
          status: 503,
        });
      if (options.archiveOversizeOutstanding && status === 'ARCHIVED')
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(128 * 1024 + 1));
            },
            cancel: () => new Promise(() => {}),
          }),
          { status: 200 },
        );
      return Response.json({ data: { productUpdate: { product: product(), userErrors: [] } } });
    }
    throw new Error('Unexpected external request');
  };
  return {
    directory,
    fetchImpl,
    credentialLoader: () => ({ secret: 'synthetic-secret', ownership: { synthetic: true } }),
    calls,
    updates: () => updates,
  };
}

test('actual production acquire reports legacy membership conflict; V2 adjudication archives the owned fixture once', async () => {
  const s = simulator();
  const result = await runSynthetic(s);
  assert.equal(result.outcome, 'ADJUDICATED_AND_ARCHIVED', JSON.stringify(result));
  assert.equal(result.classification, 'SNAPSHOT_FIELD_DEFECT_SUPPORTED');
  assert.equal(result.adjudication.v2Staged, true);
  assert.equal(result.adapter.kind, 'CONFLICT');
  assert.equal(result.adapterConflictBecauseLegacyMembershipChanged, true);
  assert.equal(result.cleanup.outcome, 'EXACT_ARCHIVED');
  assert.deepEqual(result.accounting, { auth: 1, read: 16, update: 2 });
  assert.deepEqual(
    s.calls.filter((b) => b.query === ADAPTER_UPDATE || b.query === ARCHIVE).map((b) => b.variables.product.status),
    ['DRAFT', 'ARCHIVED'],
  );
});

for (const [name, options] of [
  ['ownership', { wrongOwnership: true }],
  ...['resourcePublications', 'unpublishedPublications', ...PARTITIONS].map((name) => [
    `incomplete ${name}`,
    { incomplete: name },
  ]),
  ['missing read scope', { missingGrant: 'read_products' }],
  ['initial DRAFT drift', { prestatus: 'DRAFT' }],
  ['cross-partition version drift', { partitionDrift: true }],
  ['observed required grant loss in adapter read', { adapterGrantDrift: true }],
])
  test(`${name} stops before any status mutation`, async () => {
    const s = simulator(options),
      result = await runSynthetic(s);
    assert.equal(result.outcome, 'STOPPED');
    assert.equal(s.updates(), 0);
    assert.equal(result.classification, 'INCONCLUSIVE');
  });
for (const [name, options] of [
  ['lost DRAFT acknowledgement', { ackLoss: true }],
  ['DRAFT readback failure', { readbackFail: true }],
  ['post-DRAFT ownership drift', { postOwnership: true }],
  ['post-DRAFT partition drift', { postPartitionDrift: true }],
])
  test(`${name} never retries or archives`, async () => {
    const s = simulator(options),
      result = await runSynthetic(s);
    assert.equal(result.outcome, 'STOPPED');
    assert.equal(s.updates(), 1);
    assert.equal(result.cleanup, null);
  });
test('different V2 behavior is classified from evidence without assuming staged membership', async () => {
  const s = simulator({ v2Disappear: true }),
    result = await runSynthetic(s);
  assert.equal(result.classification, 'DIFFERENT_PLATFORM_BEHAVIOR');
  assert.equal(result.cleanup.outcome, 'EXACT_ARCHIVED');
});
test('ambiguous archive has exactly one bounded final observation and no resend', async () => {
  const s = simulator({ archiveLoss: true }),
    result = await runSynthetic(s);
  assert.equal(result.outcome, 'STOPPED');
  assert.equal(s.updates(), 2);
  assert.equal(result.cleanup?.outcome, 'UNKNOWN_WRITE_OBSERVED_ARCHIVED');
  assert.equal(s.calls.at(-1).query, PROJECTION);
});

test('newly appearing DRAFT V2 membership is not described as retained from ACTIVE', async () => {
  const result = await runSynthetic(simulator({ v2Appear: true }));
  assert.equal(result.classification, 'DIFFERENT_PLATFORM_BEHAVIOR');
  assert.equal(result.adjudication.v2Retained, false);
});
for (const [options, expected] of [
  [{ userError: true }, 'user_error'],
  [{ adapterFailure: 'http403' }, 'forbidden'],
  [{ adapterFailure: 'graphql' }, 'forbidden'],
  [{ adapterFailure: 'invalidJSON' }, 'provider_shape'],
  [{ adapterFailure: 'missingBody' }, 'provider_shape'],
  [{ adapterFailure: 'badScopes' }, 'provider_shape'],
  [{ adapterFailure: 'badNodes' }, 'provider_shape'],
])
  test(`wrapped production failure preserves ${JSON.stringify(options)}`, async () => {
    const s = simulator(options),
      scope = {
        shopId: 'm5_011_fixture_only',
        installationGeneration: '1',
        shopifyShopId: TARGET.shop,
        appClientId: TARGET.client,
      };
    const direct = simulator(options),
      port = createShopifyAvailabilityHoldPort({
        fetchImpl: direct.fetchImpl,
        isCurrent: async () => true,
        credentials: {
          acquire: async () => ({
            kind: 'usable',
            shopDomain: TARGET.domain,
            accessToken: 'synthetic-token',
            accessExpiresAt: new Date(Date.now() + 3600000),
          }),
        },
      });
    let kind;
    try {
      const before = await port.snapshot(scope, FIXTURE);
      await port.acquire(scope, {
        version: 'm5-availability-hold-v1',
        operationId: 'synthetic_rejection',
        before,
        held: null,
      });
    } catch (error) {
      kind = error.kind;
    }
    assert.equal(kind, expected);
    const result = await runSynthetic(s);
    assert.equal(result.stop, expected);
    assert.equal(
      s.calls.filter((b) => b.query === ADAPTER_READ).length,
      direct.calls.filter((b) => b.query === ADAPTER_READ).length,
    );
  });
for (const options of [
  { archiveOutstanding: true },
  { archiveBodyOutstanding: true },
  { archiveOversizeOutstanding: true },
  { archiveBodyAbortOutstanding: true },
  { archiveBodyCancelRejected: true },
])
  test(`outstanding archive transport quarantines all further dispatch ${JSON.stringify(options)}`, async (t) => {
    const original = AbortSignal.timeout.bind(AbortSignal);
    t.mock.method(AbortSignal, 'timeout', () => original(20));
    const keepalive = setTimeout(() => {}, 500);
    try {
      const s = simulator(options),
        result = await runSynthetic(s);
      assert.equal(result.outcome, 'STOPPED');
      assert.equal(s.calls.at(-1).query, ARCHIVE);
      assert.equal(result.accounting.read, 15);
      assert.equal(result.cleanup.outcome, 'UNKNOWN_WRITE_REQUEST_STILL_OUTSTANDING');
      assert.notEqual(JSON.parse(readFileSync(join(s.directory, 'register.json'))).pending, null);
    } finally {
      clearTimeout(keepalive);
    }
  });

test('durable transport denies alternate target, ACTIVE, extra fields and arbitrary documents before HTTP', async () => {
  let sent = 0;
  const directory = mkdtempSync(join(tmpdir(), 'm5011-'));
  const op = createOperator({
    directory,
    binding: { synthetic: true },
    fetchImpl: async () => {
      sent++;
      return Response.json({ data: {} });
    },
  });
  for (const body of [
    { query: PROJECTION, variables: { id: 'gid://shopify/Product/1' } },
    { query: ADAPTER_UPDATE, variables: { product: { id: FIXTURE, status: 'ACTIVE' } } },
    { query: ADAPTER_UPDATE, variables: { product: { id: FIXTURE, status: 'DRAFT', title: 'changed' } } },
    { query: 'mutation publishablePublish { id }', variables: {} },
  ])
    await assert.rejects(
      op.fetch(`https://${TARGET.domain}/admin/api/2026-07/graphql.json`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    );
  assert.equal(sent, 0);
  assert.throws(() => createOperator({ directory, binding: {} }), /reentry/);
  assert.equal(JSON.parse(readFileSync(join(directory, 'register.json'))).counts.update, 0);
});

test('100 serial synthetic adjudications preserve the fixed ceilings and stop on each ambiguous write', async () => {
  for (let i = 0; i < 100; i++) {
    const options = i % 4 === 0 ? { ackLoss: true } : i % 4 === 1 ? { archiveLoss: true } : {};
    const s = simulator(options),
      result = await runSynthetic(s);
    assert.equal(result.accounting.auth, 1);
    assert.ok(result.accounting.read <= 16 && result.accounting.update <= 2);
    assert.equal(result.outcome, options.ackLoss || options.archiveLoss ? 'STOPPED' : 'ADJUDICATED_AND_ARCHIVED');
    assert.equal(s.updates(), options.ackLoss ? 1 : 2);
  }
});
