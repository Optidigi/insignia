import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
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
        connection(t === 'APP' && !(options.v2Disappear && status === 'DRAFT') ? [pub()] : []),
      ]),
    ),
  });
  const fetchImpl = async (url, init) => {
    const b = JSON.parse(init.body);
    calls.push(b);
    if (url.endsWith('/admin/oauth/access_token'))
      return Response.json({ access_token: 'synthetic-token', expires_in: 3600 });
    if (b.query === IDENTITY) return Response.json({ data: identity() });
    if (b.query === PROJECTION) {
      const p = product();
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
      if (options.readbackFail && status === 'DRAFT') throw new Error('synthetic-network');
      return Response.json({ data: { ...identity(), node: product() } });
    }
    if (b.query === ADAPTER_UPDATE || b.query === ARCHIVE) {
      updates++;
      status = b.variables.product.status;
      version = new Date(Date.parse(version) + 1000).toISOString();
      if (options.ackLoss && status === 'DRAFT') throw new Error('synthetic-network');
      if (options.archiveLoss && status === 'ARCHIVED') throw new Error('synthetic-network');
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
  assert.deepEqual(result.accounting, { auth: 1, read: 9, update: 2 });
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
