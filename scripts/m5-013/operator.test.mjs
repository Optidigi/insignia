import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PRESTATE } from './documents.mjs';
import { createOperator } from './operator.mjs';

test('alternate exact product is refused before HTTP', async () => {
  let calls = 0;
  const op = createOperator({
    directory: mkdtempSync(join(tmpdir(), 'm5013-deny-')),
    binding: { synthetic: true },
    fetchImpl: async () => {
      calls++;
      throw Error('HTTP invoked');
    },
  });
  await assert.rejects(
    op.fetch('https://insignia-rewrite-dev.myshopify.com/admin/api/2026-07/graphql.json', {
      method: 'POST',
      body: JSON.stringify({ query: PRESTATE.replaceAll('10490211467547', '123'), variables: {} }),
    }),
    /document_or_target_denied/,
  );
  assert.equal(calls, 0);
});

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
function provider(options = {}) {
  const p = product();
  if (options.archived) p.status = 'ARCHIVED';
  if (options.version) p.updatedAt = options.version;
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
    if (q.includes('M5013Archive')) {
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
    directory = mkdtempSync(join(tmpdir(), 'm5013-run-'));
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

test('disposable cleanup settles exact final ARCHIVED despite a one-second acknowledgement timestamp difference', async () => {
  const r = await synthetic({
    version: '2026-10-06T15:00:00Z',
    change: (d, b) => {
      if (b.query.includes('M5013Final')) d.product.updatedAt = '2026-10-06T14:00:01Z';
    },
  });
  assert.equal(r.evidence.outcome, 'SETTLED');
  assert.equal(r.evidence.cleanup.outcome, 'FINAL_ARCHIVED_UNPUBLISHED');
  assert.deepEqual(r.evidence.timestamps, {
    acknowledgedUpdatedAt: '2026-10-06T14:00:00Z',
    finalUpdatedAt: '2026-10-06T14:00:01Z',
    equal: false,
    deltaMilliseconds: 1000,
  });
  assert.deepEqual(r.evidence.accounting, { auth: 1, read: 2, update: 1 });
  assert.equal(r.register.closed, true);
});

test('already ARCHIVED is verified with no update', async () => {
  const r = await synthetic({ archived: true });
  assert.equal(r.evidence.cleanup.outcome, 'ALREADY_ARCHIVED_VERIFIED');
  assert.deepEqual(r.evidence.accounting, { auth: 1, read: 2, update: 0 });
});
for (const [name, change, stop] of [
  [
    'foreign ownership',
    (d) => {
      if (d.product) d.product.title = 'foreign-title-sentinel';
    },
    'ownership',
  ],
  [
    'ACTIVE state',
    (d) => {
      if (d.product) d.product.status = 'ACTIVE';
    },
    'product_shape',
  ],
  [
    'UNLISTED state',
    (d) => {
      if (d.product) d.product.status = 'UNLISTED';
    },
    'product_shape',
  ],
  [
    'effective publication',
    (d) => {
      if (d.product) d.product.publishedOnPublication = true;
    },
    'effective_publication',
  ],
  [
    'published timestamp',
    (d) => {
      if (d.product) d.product.publishedAt = '2026-10-06T14:00:00Z';
    },
    'effective_publication',
  ],
  [
    'online store URL',
    (d) => {
      if (d.product) d.product.onlineStoreUrl = 'https://example.invalid';
    },
    'effective_publication',
  ],
  [
    'legacy effective membership',
    (d) => {
      if (d.product)
        d.product.resourcePublications.nodes = [
          { isPublished: true, publishDate: '2026-10-06T14:00:00Z', publication: { id: pub } },
        ];
    },
    'effective_publication',
  ],
  [
    'incomplete legacy',
    (d) => {
      if (d.product) d.product.resourcePublications.pageInfo.hasNextPage = true;
    },
    'connection_incomplete',
  ],
  [
    'wrong installation',
    (d) => {
      if (d.currentAppInstallation) d.currentAppInstallation.id = 'gid://shopify/AppInstallation/123';
    },
    'identity',
  ],
  [
    'scope loss',
    (d) => {
      d.currentAppInstallation?.accessScopes.pop();
    },
    'grants',
  ],
])
  test(`${name} stops with zero update`, async () => {
    const r = await synthetic({ change });
    assert.equal(r.evidence.stop, stop);
    assert.equal(r.evidence.accounting.update, 0);
    assert.equal(r.register.closed, true);
    assert.doesNotMatch(JSON.stringify(r.register), /foreign-title-sentinel/);
  });
test('malformed GraphQL error fields are rejected before mutation', async () => {
  for (const errors of [null, false, 0, '', []]) {
    const r = await synthetic({ respond: (d) => Response.json({ data: d, errors }) });
    assert.equal(r.evidence.stop, 'provider_error');
    assert.equal(r.evidence.accounting.update, 0);
  }
});
test('ambiguous archive is not resent and one final exact read settles ARCHIVED', async () => {
  const r = await synthetic({
    respond: (_d, b) =>
      b.query.includes('M5013Archive') ? Response.json({ errors: [{ message: 'synthetic denial' }] }) : null,
  });
  assert.equal(r.evidence.outcome, 'SETTLED');
  assert.equal(r.evidence.stop, 'provider_error');
  assert.deepEqual(r.evidence.accounting, { auth: 1, read: 2, update: 1 });
  assert.equal(r.evidence.settlements[0].acknowledgementSettlement, 'UNKNOWN');
});
test('final DRAFT or effective-publication drift is unsettled with no retry', async () => {
  for (const change of [
    (d) => {
      d.product.status = 'DRAFT';
    },
    (d) => {
      d.product.publishedOnPublication = true;
    },
  ]) {
    const r = await synthetic({
      change: (d, b) => {
        if (b.query.includes('M5013Final')) change(d);
      },
    });
    assert.equal(r.evidence.outcome, 'STOPPED');
    assert.equal(r.evidence.cleanup.outcome, 'UNSETTLED_FINAL_READ');
    assert.deepEqual(r.evidence.accounting, { auth: 1, read: 2, update: 1 });
  }
});
test('unsettled archive transport forbids final read and any overlap', async () => {
  const r = await synthetic({ respond: (_d, b) => (b.query.includes('M5013Archive') ? new Promise(() => {}) : null) });
  assert.equal(r.evidence.cleanup.outcome, 'UNKNOWN_WRITE_REQUEST_STILL_OUTSTANDING');
  assert.deepEqual(r.evidence.accounting, { auth: 1, read: 1, update: 1 });
  assert.equal(r.register.pending, 2);
});
test('exact source documents have no searches or alternate mutation fields', async () => {
  const d = await import('./documents.mjs');
  for (const q of [d.PRESTATE, d.FINAL, d.ARCHIVE]) {
    assert.doesNotMatch(q, /includedProducts|published_status|publication_ids|products\(/);
    assert.match(q, /10490211467547|ProductUpdateInput/);
    assert.match(q, /publishedOnPublication\(publicationId:"gid:\/\/shopify\/Publication\/339456917787"\)/);
  }
  const r = await synthetic();
  const update = r.calls.find((c) => c.query?.includes('M5013Archive'));
  assert.deepEqual(update.variables, { product: { id: fixture, status: 'ARCHIVED' } });
});
test('alternate documents, extra fields and non-ARCHIVED statuses are denied before dispatch', async () => {
  const { ARCHIVE } = await import('./documents.mjs');
  for (const variables of [
    { product: { id: 'gid://shopify/Product/123', status: 'ARCHIVED' } },
    { product: { id: fixture, status: 'ACTIVE' } },
    { product: { id: fixture, status: 'DRAFT' } },
    { product: { id: fixture, status: 'ARCHIVED', title: 'extra' } },
  ]) {
    const external = provider();
    const op = createOperator({
      directory: mkdtempSync(join(tmpdir(), 'm5013-fence-')),
      binding: { synthetic: true },
      fetchImpl: external.fetchImpl,
    });
    await op.fetch('https://insignia-rewrite-dev.myshopify.com/admin/oauth/access_token', {
      method: 'POST',
      body: JSON.stringify({
        client_id: identity.currentAppInstallation.app.apiKey,
        client_secret: 'synthetic-secret',
        grant_type: 'client_credentials',
      }),
    });
    await op.fetch('https://insignia-rewrite-dev.myshopify.com/admin/api/2026-07/graphql.json', {
      method: 'POST',
      body: JSON.stringify({ query: PRESTATE, variables: {} }),
    });
    const n = external.calls.length;
    await assert.rejects(
      op.fetch('https://insignia-rewrite-dev.myshopify.com/admin/api/2026-07/graphql.json', {
        method: 'POST',
        body: JSON.stringify({ query: ARCHIVE, variables }),
      }),
    );
    assert.equal(external.calls.length, n);
    op.finish({ synthetic: 'denied' });
  }
});
test('closed cleanup register rejects any second initialization', async () => {
  const r = await synthetic();
  assert.throws(() => createOperator({ directory: r.directory, binding: {} }), /reentry/);
});
test('100 serial disposable cleanup cases never exceed one update', async () => {
  for (let i = 0; i < 100; i++) {
    const r = await synthetic({ archived: i % 2 === 0 });
    assert.equal(r.evidence.outcome, 'SETTLED');
    assert.equal(r.evidence.accounting.update, i % 2);
    assert.equal(r.register.pending, null);
  }
});
test('failed authentication cannot admit an Admin read through the public operator', async () => {
  const external = provider({ authFailure: true });
  const op = createOperator({
    directory: mkdtempSync(join(tmpdir(), 'm5013-auth-')),
    binding: { synthetic: true },
    fetchImpl: external.fetchImpl,
  });
  await assert.rejects(
    op.fetch('https://insignia-rewrite-dev.myshopify.com/admin/oauth/access_token', {
      method: 'POST',
      body: JSON.stringify({
        client_id: identity.currentAppInstallation.app.apiKey,
        client_secret: 'synthetic-secret',
        grant_type: 'client_credentials',
      }),
    }),
    /auth_response/,
  );
  const before = external.calls.length;
  await assert.rejects(
    op.fetch('https://insignia-rewrite-dev.myshopify.com/admin/api/2026-07/graphql.json', {
      method: 'POST',
      body: JSON.stringify({ query: PRESTATE, variables: {} }),
    }),
    /document_or_target_denied/,
  );
  assert.equal(external.calls.length, before);
  op.finish({ synthetic: 'failed auth' });
});

test('failed prestate or final reads cannot be retried and archive cannot be resent', async () => {
  const { ARCHIVE, FINAL } = await import('./documents.mjs');
  for (const operation of ['M5013Prestate', 'M5013Final']) {
    const external = provider({
      respond: (d, b) => (b.query.includes(operation) ? Response.json({ data: d, errors: false }) : null),
    });
    const op = createOperator({
      directory: mkdtempSync(join(tmpdir(), 'm5013-read-once-')),
      binding: { synthetic: true },
      fetchImpl: external.fetchImpl,
    });
    const endpoint = 'https://insignia-rewrite-dev.myshopify.com/admin/api/2026-07/graphql.json';
    const send = (query, variables = {}) =>
      op.fetch(endpoint, { method: 'POST', body: JSON.stringify({ query, variables }) });
    await op.fetch('https://insignia-rewrite-dev.myshopify.com/admin/oauth/access_token', {
      method: 'POST',
      body: JSON.stringify({
        client_id: identity.currentAppInstallation.app.apiKey,
        client_secret: 'synthetic-secret',
        grant_type: 'client_credentials',
      }),
    });
    const query = operation === 'M5013Prestate' ? PRESTATE : FINAL;
    if (operation === 'M5013Final') {
      await send(PRESTATE);
      await send(ARCHIVE, { product: { id: fixture, status: 'ARCHIVED' } });
    }
    await assert.rejects(send(query), /provider_error/);
    const before = external.calls.length;
    await assert.rejects(send(query), /read_reentry/);
    await assert.rejects(send(ARCHIVE, { product: { id: fixture, status: 'ARCHIVED' } }));
    assert.equal(external.calls.length, before);
    op.finish({ synthetic: 'no retry' });
  }
});
test('auth response disposal failure quarantines pending event index zero', async () => {
  const op = createOperator({
    directory: mkdtempSync(join(tmpdir(), 'm5013-index-zero-')),
    binding: { synthetic: true },
    fetchImpl: async () => {
      const r = new Response('synthetic body', { status: 503 });
      r.body.cancel = () => Promise.reject(Error('synthetic disposal failure'));
      return r;
    },
  });
  await assert.rejects(
    op.fetch('https://insignia-rewrite-dev.myshopify.com/admin/oauth/access_token', {
      method: 'POST',
      body: JSON.stringify({
        client_id: identity.currentAppInstallation.app.apiKey,
        client_secret: 'synthetic-secret',
        grant_type: 'client_credentials',
      }),
    }),
  );
  assert.equal(op.state().pending, 0);
  await assert.rejects(
    op.fetch('https://insignia-rewrite-dev.myshopify.com/admin/api/2026-07/graphql.json', {
      method: 'POST',
      body: JSON.stringify({ query: PRESTATE, variables: {} }),
    }),
    /closed_or_parallel/,
  );
  op.finish({ synthetic: 'quarantined auth' });
});
