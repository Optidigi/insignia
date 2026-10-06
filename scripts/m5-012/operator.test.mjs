import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createOperator } from './operator.mjs';

test('alternate product and broad search are refused before HTTP', async () => {
  let calls = 0;
  const op = createOperator({
    directory: mkdtempSync(join(tmpdir(), 'm5012-')),
    binding: { synthetic: true },
    fetchImpl: async () => {
      calls++;
      throw Error('HTTP forbidden');
    },
  });
  await assert.rejects(
    op.fetch('https://insignia-rewrite-dev.myshopify.com/admin/api/2026-07/graphql.json', {
      method: 'POST',
      body: JSON.stringify({ query: 'query { products(first:2) { nodes { id } } }', variables: {} }),
    }),
    /document_or_target_denied/,
  );
  assert.equal(calls, 0);
});

import { readFileSync } from 'node:fs';
import { runSynthetic } from './qualification.mjs';

const marker = 'insignia-m5-010-503f5c3d-a0d5-4c67-b2ef-5e22ad3f31bb';
const fixture = 'gid://shopify/Product/10490211467547';
const pub = 'gid://shopify/Publication/339456917787';
const identity = {
  shop: {
    id: 'gid://shopify/Shop/105501393179',
    myshopifyDomain: 'insignia-rewrite-dev.myshopify.com',
    plan: { partnerDevelopment: true, displayName: 'Basic App Development' },
  },
  currentAppInstallation: {
    id: 'gid://shopify/AppInstallation/1054356963611',
    app: { id: 'gid://shopify/App/429028933633', apiKey: '1443cf6d03d39edae7c101a943c5c684' },
    accessScopes: ['read_products', 'write_products', 'read_publications', 'read_product_listings'].map((handle) => ({
      handle,
    })),
  },
};
const product = () => ({
  __typename: 'Product',
  id: fixture,
  handle: marker,
  title: marker,
  tags: [marker],
  createdAt: '2026-10-02T21:19:48Z',
  status: 'DRAFT',
  updatedAt: '2026-10-06T13:09:52Z',
  publishedAt: null,
  onlineStoreUrl: null,
  publishedOnPublication: false,
  resourcePublications: { nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
});
const connection = (nodes = []) => ({ nodes, pageInfo: { hasNextPage: false, hasPreviousPage: false } });
function provider(options = {}) {
  const p = product();
  if (options.archived) p.status = 'ARCHIVED';
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if (url.endsWith('/access_token')) {
      if (options.authFailure) return Response.json({ error: 'synthetic denial' }, { status: 401 });
      return Response.json({ access_token: 'synthetic-token', expires_in: 3600 });
    }
    const q = body.query;
    let d = { ...structuredClone(identity), product: structuredClone(p) };
    if (q.includes('M5012Identity')) d = structuredClone(identity);
    if (q.includes('M5012Publication'))
      d.publication = {
        id: pub,
        autoPublish: true,
        supportsFuturePublishing: false,
        catalog: {
          __typename: 'AppCatalog',
          id: 'gid://shopify/AppCatalog/188090286363',
          title: 'Channel Catalog for Microsoft Copilot',
          status: 'ACTIVE',
        },
        channels: connection([
          {
            id: 'gid://shopify/Channel/339456917787',
            name: 'Microsoft Copilot',
            app: { id: 'gid://shopify/App/294412484609', title: 'Microsoft Copilot' },
          },
        ]),
      };
    const own = Object.fromEntries(
      ['__typename', 'id', 'handle', 'title', 'tags', 'createdAt', 'status', 'updatedAt'].map((k) => [k, p[k]]),
    );
    if (q.includes('M5012Included'))
      d.publication = { id: pub, includedProducts: connection(options.intent ? [own] : []) };
    if (q.includes('M5012Search')) d.products = connection(options.intent ? [own] : []);
    if (q.includes('M5012Archive')) {
      assert.deepEqual(body.variables, { product: { id: fixture, status: 'ARCHIVED' } });
      p.status = 'ARCHIVED';
      p.updatedAt = '2026-10-06T14:00:00Z';
      d = { productUpdate: { product: structuredClone(p), userErrors: [] } };
    }
    if (options.change) options.change(d, body, calls.length);
    if (options.respond) {
      const r = await options.respond(d, body, calls.length);
      if (r) return r;
    }
    return Response.json({ data: d });
  };
  return { fetchImpl, calls };
}
async function synthetic(options = {}) {
  const external = provider(options),
    directory = mkdtempSync(join(tmpdir(), 'm5012-run-'));
  const evidence = await runSynthetic({
    directory,
    fetchImpl: external.fetchImpl,
    credentialLoader: () => ({ secret: 'synthetic-secret', ownership: { synthetic: true } }),
  });
  return {
    evidence,
    calls: external.calls,
    register: JSON.parse(readFileSync(join(directory, 'register.json'))),
    directory,
  };
}
test('fixed intent reads clean up one owned DRAFT and close with exact ARCHIVED settlement', async () => {
  const r = await synthetic({ intent: true });
  assert.equal(r.evidence.classification, 'INTENT_CONFIRMED');
  assert.equal(r.evidence.cleanup.outcome, 'EXACT_ARCHIVED');
  assert.deepEqual(r.evidence.accounting, { auth: 1, read: 8, update: 1 });
  assert.equal(r.register.closed, true);
  assert.equal(r.register.events.find((e) => e.kind === 'update').settlement, 'EXACT');
});

test('already ARCHIVED fixture is observed with no cleanup mutation', async () => {
  const r = await synthetic({ archived: true });
  assert.equal(r.evidence.cleanup.outcome, 'ALREADY_ARCHIVED');
  assert.deepEqual(r.evidence.accounting, { auth: 1, read: 8, update: 0 });
});
test('complete negative intent surfaces report NO_INTENT_OBSERVED before cleanup', async () => {
  const r = await synthetic();
  assert.equal(r.evidence.classification, 'NO_INTENT_OBSERVED');
  assert.equal(r.evidence.cleanup.outcome, 'EXACT_ARCHIVED');
});
for (const [name, change, stop] of [
  [
    'unexpected ownership',
    (d) => {
      if (d.product) d.product.tags.push('foreign');
    },
    'ownership',
  ],
  [
    'unexpected ACTIVE',
    (d) => {
      if (d.product) d.product.status = 'ACTIVE';
    },
    'product_shape',
  ],
  [
    'initial version drift',
    (d) => {
      if (d.product) d.product.updatedAt = '2026-10-06T13:09:53Z';
    },
    'prestate_drift',
  ],
  [
    'scope loss',
    (d) => {
      d.currentAppInstallation?.accessScopes.pop();
    },
    'grants',
  ],
  [
    'incomplete includedProducts',
    (d) => {
      if (d.publication?.includedProducts) d.publication.includedProducts.pageInfo.hasNextPage = true;
    },
    'connection_incomplete',
  ],
  [
    'foreign exact-ID result',
    (d) => {
      if (d.products) d.products.nodes = [{ id: 'gid://shopify/Product/123' }];
    },
    'ownership',
  ],
  [
    'duplicate exact-ID result',
    (d) => {
      if (d.products) d.products.nodes = [product(), product()];
    },
    'duplicate_result',
  ],
  [
    'one-second observation drift',
    (d) => {
      if (d.products) d.product.updatedAt = '2026-10-06T13:09:53Z';
    },
    'observation_drift',
  ],
  [
    'changed publication identity',
    (d) => {
      if (d.publication?.channels) d.publication.channels.nodes[0].app.id = 'gid://shopify/App/123';
    },
    'publication_drift',
  ],
  [
    'search anchor disagrees',
    (d) => {
      if (d.products?.nodes[0]) d.products.nodes[0].updatedAt = '2026-10-06T13:09:53Z';
    },
    'search_state_drift',
  ],
])
  test(`${name} stops before cleanup`, async () => {
    const r = await synthetic({ intent: true, change });
    assert.equal(r.evidence.stop, stop);
    assert.equal(r.evidence.accounting.update, 0);
    assert.equal(r.register.closed, true);
  });
test('contradictory inclusion/search results stop before cleanup', async () => {
  const r = await synthetic({
    intent: true,
    change: (d, b) => {
      if (b.query.includes('M5012Searchchannel')) d.products.nodes = [];
    },
  });
  assert.equal(r.evidence.classification, 'INCONSISTENT');
  assert.equal(r.evidence.accounting.update, 0);
});
test('effective publication on DRAFT makes intent inconsistent and refuses cleanup', async () => {
  const r = await synthetic({
    change: (d) => {
      if (d.product) d.product.publishedOnPublication = true;
    },
  });
  assert.equal(r.evidence.classification, 'INCONSISTENT');
  assert.equal(r.evidence.accounting.update, 0);
});
test('ambiguous archive response consumes one final exact read without resend', async () => {
  const r = await synthetic({
    respond: (_d, b) =>
      b.query.includes('M5012Archive') ? Response.json({ errors: [{ message: 'synthetic error' }] }) : null,
  });
  assert.equal(r.evidence.stop, 'provider_error');
  assert.equal(r.evidence.cleanup.outcome, 'AMBIGUOUS_WRITE_OBSERVED_ARCHIVED');
  assert.deepEqual(r.evidence.accounting, { auth: 1, read: 8, update: 1 });
  assert.equal(r.register.events.find((e) => e.kind === 'update').settlement, 'UNKNOWN');
});
test('one-second archive acknowledgement/readback drift stays a conflict', async () => {
  const r = await synthetic({
    change: (d, b, n) => {
      if (n === 10 && b.query.includes('M5012Projection')) d.product.updatedAt = '2026-10-06T14:00:01Z';
    },
  });
  assert.equal(r.evidence.stop, 'archive_ack_readback_drift');
  assert.equal(r.evidence.cleanup.outcome, 'ACK_READBACK_CONFLICT_OBSERVED_ARCHIVED');
  assert.equal(r.evidence.accounting.update, 1);
});
test('authentication failure closes the fresh register without Admin requests', async () => {
  const r = await synthetic({ authFailure: true });
  assert.equal(r.evidence.stop, 'auth_response');
  assert.equal(r.evidence.accounting.read, 0);
  assert.equal(r.evidence.accounting.update, 0);
});
test('quarantined outstanding archive forbids final read and any overlapping request', async () => {
  const r = await synthetic({ respond: (_d, b) => (b.query.includes('M5012Archive') ? new Promise(() => {}) : null) });
  assert.equal(r.evidence.cleanup.outcome, 'UNKNOWN_WRITE_REQUEST_STILL_OUTSTANDING');
  assert.equal(r.evidence.accounting.read, 7);
  assert.equal(r.register.pending, 8);
});
test('fixed documents and variables exclude every alternate target before HTTP', async () => {
  const { READS, ARCHIVE } = await import('./documents.mjs');
  for (const [name, q] of [...Object.entries(READS), ['archive', ARCHIVE]]) {
    const variants = [
      { query: q, variables: { id: 'gid://shopify/Product/123' } },
      { query: q + ' ', variables: {} },
      ...['10490211467547', '339456917787', '294412484609']
        .filter((id) => q.includes(id))
        .map((id) => ({ query: q.replaceAll(id, '123'), variables: {} })),
    ];
    if (name === 'archive')
      variants.push(
        { query: q, variables: { product: { id: fixture, status: 'ACTIVE' } } },
        { query: q, variables: { product: { id: fixture, status: 'ARCHIVED', title: 'extra' } } },
      );
    for (const body of variants) {
      const external = provider(),
        op = createOperator({
          directory: mkdtempSync(join(tmpdir(), 'm5012-deny-')),
          binding: { synthetic: true },
          fetchImpl: external.fetchImpl,
        });
      await op.fetch('https://insignia-rewrite-dev.myshopify.com/admin/oauth/access_token', {
        method: 'POST',
        body: JSON.stringify({
          client_id: '1443cf6d03d39edae7c101a943c5c684',
          client_secret: 'synthetic-secret',
          grant_type: 'client_credentials',
        }),
      });
      for (const [prior, query] of Object.entries(READS)) {
        if (prior === name) break;
        await op.fetch('https://insignia-rewrite-dev.myshopify.com/admin/api/2026-07/graphql.json', {
          method: 'POST',
          body: JSON.stringify({ query, variables: {} }),
        });
      }
      const before = external.calls.length;
      await assert.rejects(
        op.fetch('https://insignia-rewrite-dev.myshopify.com/admin/api/2026-07/graphql.json', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      );
      assert.equal(external.calls.length, before);
      op.finish({ synthetic: 'denied' });
    }
  }
});
test('fixed source query literals are exactly the authorized ID filters and first:2', async () => {
  const d = await import('./documents.mjs');
  assert.equal(d.SEARCH_STRINGS.app, 'id:10490211467547 published_status:294412484609-intended');
  assert.equal(d.SEARCH_STRINGS.channel, 'id:10490211467547 published_status:339456917787-intended');
  assert.equal(d.SEARCH_STRINGS.association, 'id:10490211467547 publication_ids:339456917787');
  assert.match(d.INCLUDED, /includedProducts\(first:2, query:"id:10490211467547"\)/);
  assert.match(d.PROJECTION, /publishedOnPublication\(publicationId:"gid:\/\/shopify\/Publication\/339456917787"\)/);
  for (const q of Object.values(d.READS)) assert.doesNotMatch(q, /first:(?!2\b)/);
});
test('closed register cannot be initialized a second time', async () => {
  const r = await synthetic();
  assert.throws(() => createOperator({ directory: r.directory, binding: {} }), /reentry/);
});
test('100 serial synthetic runs preserve zero or one mutation and never overlap', async () => {
  for (let i = 0; i < 100; i++) {
    const r = await synthetic({ archived: i % 2 === 0, intent: i % 2 !== 0 });
    assert.equal(r.evidence.accounting.update, i % 2);
    assert.equal(r.register.pending, null);
  }
});

test('invalid or malformed runtime search metadata stops before cleanup', async () => {
  for (const search of [[{ warnings: [{ message: 'Invalid search field' }] }], { warnings: [] }]) {
    const r = await synthetic({
      respond: (d, b) =>
        b.query.includes('M5012Included') ? Response.json({ data: d, extensions: { search } }) : null,
    });
    assert.equal(r.evidence.stop, 'provider_error');
    assert.equal(r.evidence.accounting.update, 0);
  }
});
