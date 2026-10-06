import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as shared from '../m5-004/operator.mjs';

const capabilities = ['write_products', 'read_publications', 'read_product_listings'];
const identity = (handles = capabilities) => ({
  shop: { id: shared.TARGET.shop, myshopifyDomain: shared.TARGET.domain, plan: { partnerDevelopment: true } },
  currentAppInstallation: {
    id: shared.TARGET.installation,
    app: { id: shared.TARGET.app, apiKey: shared.TARGET.client },
    accessScopes: handles.map((handle) => ({ handle })),
  },
});

test('010 requires all publication/product capabilities and permits additional well formed grants', () => {
  const check = (data) => shared.assertIdentity(data, { profile: 'm5-010' });
  assert.doesNotThrow(() => check(identity([...capabilities, 'read_orders'])));
  for (const missing of capabilities)
    assert.throws(() => check(identity(capabilities.filter((x) => x !== missing))), { kind: 'product_capability' });
  for (const scopes of [
    null,
    {},
    [null],
    [{ handle: 1 }],
    [...identity().currentAppInstallation.accessScopes, { handle: 'bad\n' }],
    [...identity().currentAppInstallation.accessScopes, { handle: 'read_orders', extra: 1 }],
    [...identity().currentAppInstallation.accessScopes, { handle: 'write_products' }],
    Array(251).fill({ handle: 'read_orders' }),
  ]) {
    const data = identity();
    data.currentAppInstallation.accessScopes = scopes;
    assert.throws(() => check(data), { kind: 'grant_shape' });
  }
});

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOperator, initialize } from './operator.mjs';

const graphUrl = `https://${shared.TARGET.domain}/admin/api/2026-07/graphql.json`;
const send = (op, query, variables = {}) =>
  op.fetch(graphUrl, {
    method: 'POST',
    body: JSON.stringify({ query, variables }),
  });
function operatorRun(fetchImpl) {
  const directory = mkdtempSync(join(tmpdir(), 'm5010-'));
  const state = initialize(directory, { source: 'synthetic', modules: {} }, { synthetic: true });
  const op = createOperator({ directory, fetchImpl });
  op.identity(identity());
  return {
    directory,
    state,
    op,
    cleanup() {
      this.op.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
const freshCreate = (state) => ({
  product: { title: state.run, handle: state.run, tags: [state.run], status: 'DRAFT' },
});
test('010 denies normal fresh create until fixed predecessor has been safely resolved', async () => {
  let calls = 0;
  const run = operatorRun(async () => {
    calls++;
    return Response.json({});
  });
  try {
    await assert.rejects(send(run.op, shared.CREATE, freshCreate(run.state)), { kind: 'create_permission' });
    assert.equal(calls, 0);
    assert.equal(run.op.state().counts.create, 0);
  } finally {
    run.cleanup();
  }
});

const predecessorMarker = 'insignia-m5-009-439c9699-af2f-4e8a-b0f1-89003b88a2d4';
const predecessorStart = '2026-10-02T19:57:53.469Z';
const complete = { hasNextPage: false, hasPreviousPage: false };
const product = (
  marker,
  status = 'DRAFT',
  createdAt = new Date().toISOString(),
  id = 'gid://shopify/Product/999999',
) => ({
  __typename: 'Product',
  id,
  status,
  handle: marker,
  title: marker,
  tags: [marker],
  createdAt,
  updatedAt: '2026-10-02T20:00:00.000Z',
  publishedAt: null,
  onlineStoreUrl: null,
  resourcePublications: { nodes: [], pageInfo: complete },
  unpublishedPublications: { nodes: [{ id: 'gid://shopify/Publication/1' }], pageInfo: complete },
});
const lookup = (op) => send(op, shared.FIND, { search: `handle:${predecessorMarker}` });
test('complete absent predecessor lookup permits one fresh create and retains resolution independently', async () => {
  let calls = 0;
  const run = operatorRun(async (_url, init) => {
    calls++;
    const request = JSON.parse(init.body);
    if (request.query === shared.FIND) return Response.json({ data: { products: { nodes: [], pageInfo: complete } } });
    return Response.json({ data: { productCreate: { product: product(run.state.run), userErrors: [] } } });
  });
  try {
    await lookup(run.op);
    assert.equal(run.op.state().predecessor.resolution, 'ABSENT');
    await send(run.op, shared.CREATE, freshCreate(run.state));
    assert.equal(run.op.state().fixture, 'gid://shopify/Product/999999');
    assert.equal(run.op.state().predecessor.fixture, null);
    assert.equal(run.op.state().counts.predecessorArchive, 0);
    assert.equal(calls, 2);
    assert.equal(JSON.parse(readFileSync(join(run.directory, 'register.json'))).predecessor.resolution, 'ABSENT');
  } finally {
    run.cleanup();
  }
});

for (const status of ['ARCHIVED', 'DRAFT', 'ACTIVE', 'UNLISTED'])
  test(`owned unpublished ${status} predecessor requires exact archived readback before fresh create`, async () => {
    let predecessor = product(predecessorMarker, status, predecessorStart, 'gid://shopify/Product/888888');
    const requests = [];
    const run = operatorRun(async (_url, init) => {
      const { query, variables } = JSON.parse(init.body);
      requests.push({ query, variables });
      if (query === shared.FIND)
        return Response.json({ data: { products: { nodes: [predecessor], pageInfo: complete } } });
      if (query === shared.SETUP) {
        assert.deepEqual(variables, { product: { id: predecessor.id, status: 'ARCHIVED' } });
        predecessor = { ...predecessor, status: 'ARCHIVED' };
        return Response.json({ data: { productUpdate: { product: predecessor, userErrors: [] } } });
      }
      if (query === shared.FIXTURE) {
        assert.deepEqual(variables, { id: predecessor.id });
        return Response.json({ data: { product: predecessor } });
      }
      return Response.json({ data: { productCreate: { product: product(run.state.run), userErrors: [] } } });
    });
    try {
      await lookup(run.op);
      assert.equal(run.op.state().fixture, null);
      await assert.rejects(send(run.op, shared.CREATE, freshCreate(run.state)), { kind: 'create_permission' });
      if (status !== 'ARCHIVED') {
        await send(run.op, shared.SETUP, { product: { id: predecessor.id, status: 'ARCHIVED' } });
        await assert.rejects(send(run.op, shared.CREATE, freshCreate(run.state)), { kind: 'create_permission' });
      }
      await send(run.op, shared.FIXTURE, { id: predecessor.id });
      assert.equal(run.op.state().predecessor.resolution, 'ARCHIVED_VERIFIED');
      await send(run.op, shared.CREATE, freshCreate(run.state));
      assert.equal(run.op.state().predecessor.fixture, predecessor.id);
      assert.equal(run.op.state().fixture, 'gid://shopify/Product/999999');
      assert.equal(run.op.state().counts.predecessorArchive, status === 'ARCHIVED' ? 0 : 1);
      assert.equal(run.op.state().counts.update, 0);
      assert.equal(requests.filter((r) => r.query === shared.SETUP).length, status === 'ARCHIVED' ? 0 : 1);
    } finally {
      run.cleanup();
    }
  });

const stopLookups = [
  [
    'multiple',
    (d, p) => {
      d.products.nodes = [p, p];
    },
  ],
  [
    'partial next',
    (d) => {
      d.products.pageInfo.hasNextPage = true;
    },
  ],
  [
    'partial previous',
    (d) => {
      d.products.pageInfo.hasPreviousPage = true;
    },
  ],
  [
    'missing page info',
    (d) => {
      delete d.products.pageInfo;
    },
  ],
  [
    'missing nodes',
    (d) => {
      delete d.products.nodes;
    },
  ],
  [
    'invalid product id',
    (_d, p) => {
      p.id = 'gid://shopify/Product/0';
    },
  ],
  [
    'wrong type',
    (_d, p) => {
      p.__typename = 'Collection';
    },
  ],
  [
    'wrong handle',
    (_d, p) => {
      p.handle = 'other';
    },
  ],
  [
    'wrong title',
    (_d, p) => {
      p.title = 'other';
    },
  ],
  [
    'wrong tag',
    (_d, p) => {
      p.tags = [];
    },
  ],
  [
    'too early creation',
    (_d, p) => {
      p.createdAt = '2026-10-02T19:57:48.468Z';
    },
  ],
  [
    'invalid creation',
    (_d, p) => {
      p.createdAt = 'invalid';
    },
  ],
  [
    'future creation',
    (_d, p) => {
      p.createdAt = new Date(Date.now() + 60000).toISOString();
    },
  ],
  [
    'published',
    (_d, p) => {
      p.publishedAt = predecessorStart;
    },
  ],
  [
    'store url',
    (_d, p) => {
      p.onlineStoreUrl = 'https://example.invalid';
    },
  ],
  [
    'publication membership',
    (_d, p) => {
      p.resourcePublications.nodes = [{ isPublished: false }];
    },
  ],
  [
    'resource partial',
    (_d, p) => {
      p.resourcePublications.pageInfo = { ...complete, hasNextPage: true };
    },
  ],
  [
    'unpublished partial',
    (_d, p) => {
      p.unpublishedPublications.pageInfo = { ...complete, hasPreviousPage: true };
    },
  ],
  [
    'missing publications',
    (_d, p) => {
      delete p.unpublishedPublications;
    },
  ],
  [
    'unsupported status',
    (_d, p) => {
      p.status = 'NEW';
    },
  ],
];
for (const [name, mutate] of stopLookups)
  test(`predecessor ${name} stops without any mutation or second lookup`, async () => {
    let calls = 0;
    const p = structuredClone(product(predecessorMarker, 'DRAFT', predecessorStart));
    const data = { products: { nodes: [p], pageInfo: { ...complete } } };
    mutate(data, p);
    const run = operatorRun(async () => {
      calls++;
      return Response.json({ data });
    });
    try {
      await lookup(run.op);
      assert.equal(run.op.state().predecessor.resolution, 'STOPPED');
      await assert.rejects(send(run.op, shared.CREATE, freshCreate(run.state)));
      await assert.rejects(send(run.op, shared.SETUP, { product: { id: p.id, status: 'ARCHIVED' } }));
      await assert.rejects(lookup(run.op));
      assert.equal(calls, 1);
      assert.deepEqual(run.op.state().counts, { auth: 0, read: 1, create: 0, update: 0, predecessorArchive: 0 });
    } finally {
      run.cleanup();
    }
  });

const badResponses = [
  [
    'transport',
    () => {
      throw new Error('synthetic transport');
    },
  ],
  [
    'stream failure',
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('synthetic stream failure'));
          },
        }),
      ),
  ],
  [
    'invalid utf8',
    () => new Response(Buffer.concat([Buffer.from('{"data":{},"probe":"'), Buffer.from([255]), Buffer.from('"}')])),
  ],
  ['http', () => new Response(null, { status: 403 })],
  ['missing body', () => new Response(null, { status: 200 })],
  ['invalid json', () => new Response('invalid')],
  ['oversized', () => new Response(' '.repeat(128 * 1024 + 1))],
  ['graphql permission', () => Response.json({ data: null, errors: [{ extensions: { code: 'ACCESS_DENIED' } }] })],
  ['partial graphql data', () => Response.json({ data: { products: { nodes: [], pageInfo: complete } }, errors: [] })],
  [
    'mutation rejected',
    () =>
      Response.json({
        data: { productUpdate: { product: null, userErrors: [{ field: ['status'], message: 'synthetic' }] } },
      }),
  ],
];
for (const stage of ['lookup', 'archive', 'readback'])
  for (const [name, respond] of badResponses)
    test(`predecessor ${stage} ${name} retains stop and never retries or creates`, async () => {
      let calls = 0;
      const p = product(predecessorMarker, 'DRAFT', predecessorStart);
      const run = operatorRun(async (_url, init) => {
        calls++;
        const { query } = JSON.parse(init.body);
        if (
          (stage === 'lookup' && query === shared.FIND) ||
          (stage === 'archive' && query === shared.SETUP) ||
          (stage === 'readback' && query === shared.FIXTURE)
        )
          return respond();
        if (query === shared.FIND) return Response.json({ data: { products: { nodes: [p], pageInfo: complete } } });
        return Response.json({ data: { productUpdate: { product: { ...p, status: 'ARCHIVED' }, userErrors: [] } } });
      });
      try {
        await lookup(run.op).catch(() => {});
        if (stage !== 'lookup')
          await send(run.op, shared.SETUP, { product: { id: p.id, status: 'ARCHIVED' } }).catch(() => {});
        if (stage === 'readback') await send(run.op, shared.FIXTURE, { id: p.id }).catch(() => {});
        assert.equal(run.op.state().predecessor.resolution, 'STOPPED');
        await assert.rejects(send(run.op, shared.CREATE, freshCreate(run.state)));
        await assert.rejects(send(run.op, shared.SETUP, { product: { id: p.id, status: 'ARCHIVED' } }));
        assert.equal(calls, { lookup: 1, archive: 2, readback: 3 }[stage]);
        assert.equal(run.op.state().counts.create, 0);
        assert.equal(run.op.state().counts.update, 0);
        assert.equal(run.op.state().counts.predecessorArchive, stage === 'lookup' ? 0 : 1);
        const reopenedState = JSON.parse(readFileSync(join(run.directory, 'register.json')));
        assert.equal(reopenedState.predecessor.resolution, 'STOPPED');
      } finally {
        run.cleanup();
      }
    });

for (const stage of ['archive', 'readback'])
  for (const [name, mutate] of [
    [
      'wrong id',
      (p) => {
        p.id = 'gid://shopify/Product/777777';
      },
    ],
    [
      'wrong metadata',
      (p) => {
        p.tags.push('changed');
      },
    ],
    [
      'wrong status',
      (p) => {
        p.status = 'DRAFT';
      },
    ],
    [
      'exposed',
      (p) => {
        p.resourcePublications.nodes.push({ isPublished: false });
      },
    ],
  ])
    test(`${stage} ${name} cannot resolve predecessor`, async () => {
      const p = product(predecessorMarker, 'DRAFT', predecessorStart);
      const run = operatorRun(async (_url, init) => {
        const { query } = JSON.parse(init.body);
        if (query === shared.FIND) return Response.json({ data: { products: { nodes: [p], pageInfo: complete } } });
        const returned = structuredClone({ ...p, status: 'ARCHIVED' });
        if ((stage === 'archive' && query === shared.SETUP) || (stage === 'readback' && query === shared.FIXTURE))
          mutate(returned);
        return Response.json({
          data:
            query === shared.SETUP ? { productUpdate: { product: returned, userErrors: [] } } : { product: returned },
        });
      });
      try {
        await lookup(run.op);
        await send(run.op, shared.SETUP, { product: { id: p.id, status: 'ARCHIVED' } });
        if (stage === 'readback') await send(run.op, shared.FIXTURE, { id: p.id });
        assert.equal(run.op.state().predecessor.resolution, 'STOPPED');
        await assert.rejects(send(run.op, shared.CREATE, freshCreate(run.state)));
      } finally {
        run.cleanup();
      }
    });

import { existsSync } from 'node:fs';
import {
  ADAPTER_READ,
  ADAPTER_UPDATE,
  CATALOG_DETAIL,
  CATALOG_LIST,
  CREATE,
  FIXTURE,
  IDENTITY,
  SETUP,
} from './operator.mjs';
import { qualify, qualifySynthetic } from './qualification.mjs';

const syntheticProduct = product;
async function syntheticRun({
  handles = [...capabilities, 'read_products', 'read_orders'],
  wrongIdentity = false,
  predecessorStatus = null,
  predecessorFailure = null,
  lost = false,
  lostCreate = false,
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'm5010-matrix-'));
  const binding = { source: 'synthetic-successor', modules: {} };
  const state = initialize(directory, binding, { synthetic: true });
  let product,
    version = Date.now() - 60000,
    active = 0,
    peak = 0;
  const requests = [];
  let predecessor =
    predecessorStatus === null
      ? null
      : syntheticProduct(predecessorMarker, predecessorStatus, predecessorStart, 'gid://shopify/Product/888888');
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
    if (query === shared.FIND) {
      assert.deepEqual(variables, { search: `handle:${predecessorMarker}` });
      if (predecessorFailure === true)
        return Response.json({ errors: [{ extensions: { code: 'ACCESS_DENIED' } }], data: null });
      return Response.json({ data: { products: { nodes: predecessor ? [predecessor] : [], pageInfo: complete } } });
    }
    if (predecessor && (variables.id === predecessor.id || variables.product?.id === predecessor.id)) {
      if (query === SETUP) {
        assert.deepEqual(variables.product, { id: predecessor.id, status: 'ARCHIVED' });
        predecessor = { ...predecessor, status: 'ARCHIVED' };
        if (predecessorFailure === 'archive') throw new Error('synthetic lost predecessor archive');
        return Response.json({ data: { productUpdate: { product: predecessor, userErrors: [] } } });
      }
      assert.equal(query, FIXTURE);
      if (predecessorFailure === 'readback')
        return Response.json({ data: null, errors: [{ extensions: { code: 'ACCESS_DENIED' } }] });
      return Response.json({ data: { product: predecessor } });
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
      if (lostCreate) throw new Error('synthetic lost create');
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

for (const predecessorStatus of [null, 'ARCHIVED', 'ACTIVE'])
  test(`public qualification resolves ${predecessorStatus ?? 'absent'} predecessor then runs unchanged real adapter matrix`, async () => {
    const { result, register, requests, peak } = await syntheticRun({ predecessorStatus });
    assert.equal(
      result.outcome,
      'TESTED_MATRIX_PASS',
      JSON.stringify({
        stop: result.stop,
        predecessor: result.predecessor,
        cases: result.cases.map((c) => ({ case: c.case, failure: c.failure })),
      }),
    );
    assert.equal(result.final.outcome, 'ARCHIVED_UNPUBLISHED_RETAINED');
    assert.equal(result.predecessor.resolution, predecessorStatus === null ? 'ABSENT' : 'ARCHIVED_VERIFIED');
    assert.deepEqual(register.counts, {
      auth: 1,
      read: predecessorStatus === null ? 63 : 64,
      create: 1,
      update: 12,
      predecessorArchive: predecessorStatus === 'ACTIVE' ? 1 : 0,
    });
    assert.equal(register.predecessor.fixture, predecessorStatus === null ? null : 'gid://shopify/Product/888888');
    assert.deepEqual(
      result.cases.map((c) => c.case),
      ['DRAFT', 'ACTIVE', 'UNLISTED', 'ARCHIVED', 'observed-drift'],
    );
    assert.deepEqual(
      result.cases.slice(0, 4).map((c) => c.adapterMutations),
      [0, 2, 2, 2],
    );
    assert.equal(result.cases.at(-1).additionalRestoreMutations, 0);
    assert.equal(result.cases.at(-1).restored.kind, 'CONFLICT');
    assert.equal(result.catalog.outcome, 'PASS');
    assert.equal(result.normalized.length, 5);
    assert.ok(result.normalized.every((h) => h.persistedDigest === h.reloadedDigest));
    assert.equal(requests[0].query, IDENTITY);
    assert.equal(requests[1].query, shared.FIND);
    assert.equal(peak, 1);
  });

import { writeFileSync } from 'node:fs';
import { LIMITS, LIVE_DIRECTORY } from './operator.mjs';

test('fixed predecessor search and status-only allowance cannot be caller substituted', async () => {
  const run = operatorRun(async () => Response.json({ data: { products: { nodes: [], pageInfo: complete } } }));
  try {
    for (const variables of [
      { search: 'handle:other' },
      { search: `handle:${run.state.run}` },
      { search: `handle:${predecessorMarker}`, extra: true },
    ])
      await assert.rejects(send(run.op, shared.FIND, variables));
    assert.equal(run.op.state().counts.read, 0);
    await lookup(run.op);
    await assert.rejects(lookup(run.op));
    assert.equal(run.op.state().counts.read, 1);
    assert.deepEqual(
      run.op.state().identity.currentAppInstallation.accessScopes,
      identity().currentAppInstallation.accessScopes,
    );
    assert.equal(LIVE_DIRECTORY, '/home/serveradmin/insignia-m5-010-handoff/run');
    assert.deepEqual(LIMITS, { auth: 3, read: 96, create: 1, update: 16, predecessorArchive: 1 });
  } finally {
    run.cleanup();
  }
});

for (const point of ['FOUND', 'ARCHIVE_ACKNOWLEDGED', 'ARCHIVED_VERIFIED', 'STOPPED', 'ABSENT'])
  test(`reload retains predecessor ${point}, independent identity and one archival reservation`, async () => {
    const p = product(predecessorMarker, 'DRAFT', predecessorStart);
    let transportCalls = 0;
    const fetchImpl = async (_url, init) => {
      transportCalls++;
      const { query } = JSON.parse(init.body);
      if (query === shared.FIND)
        return Response.json({ data: { products: { nodes: point === 'ABSENT' ? [] : [p], pageInfo: complete } } });
      if (point === 'STOPPED') throw new Error('synthetic lost archive');
      return Response.json({
        data:
          query === SETUP
            ? { productUpdate: { product: { ...p, status: 'ARCHIVED' }, userErrors: [] } }
            : { product: { ...p, status: 'ARCHIVED' } },
      });
    };
    const run = operatorRun(fetchImpl);
    try {
      await lookup(run.op);
      if (!['FOUND', 'ABSENT'].includes(point))
        await send(run.op, SETUP, { product: { id: p.id, status: 'ARCHIVED' } }).catch(() => {});
      if (point === 'ARCHIVED_VERIFIED') await send(run.op, FIXTURE, { id: p.id });
      const before = run.op.state();
      run.op.close();
      run.op = createOperator({ directory: run.directory, fetchImpl });
      assert.deepEqual(run.op.state(), before);
      assert.equal(run.op.state().predecessor.resolution, point);
      const callsBefore = transportCalls;
      await assert.rejects(lookup(run.op));
      if (!['FOUND', 'ABSENT'].includes(point))
        await assert.rejects(send(run.op, SETUP, { product: { id: p.id, status: 'ARCHIVED' } }));
      assert.equal(transportCalls, callsBefore);
    } finally {
      run.cleanup();
    }
  });

test('reopening refuses forged safe resolution or a retained lookup for a substituted marker', async () => {
  const run = operatorRun(async () => Response.json({ data: { products: { nodes: [], pageInfo: complete } } }));
  await lookup(run.op);
  run.op.close();
  const original = readFileSync(join(run.directory, 'register.json'));
  try {
    for (const mutate of [
      (s) => {
        s.predecessor.marker = 'other';
      },
      (s) => {
        s.predecessor.resolution = 'ARCHIVED_VERIFIED';
      },
      (s) => {
        s.events[0].bodyDigest = 'a'.repeat(64);
      },
    ]) {
      const state = JSON.parse(original);
      mutate(state);
      writeFileSync(join(run.directory, 'register.json'), JSON.stringify(state));
      assert.throws(() => createOperator({ directory: run.directory, fetchImpl: async () => Response.json({}) }));
      assert.equal(existsSync(join(run.directory, 'operator.lock')), false);
    }
  } finally {
    rmSync(run.directory, { recursive: true, force: true });
  }
});

test('serialized archive and readback attempts reserve actual HTTP once and never share the matrix allowance', async () => {
  let run,
    active = 0,
    peak = 0;
  const p = product(predecessorMarker, 'ACTIVE', predecessorStart);
  const fetchImpl = async (_url, init) => {
    peak = Math.max(peak, ++active);
    const disk = JSON.parse(readFileSync(join(run.directory, 'register.json')));
    assert.equal(disk.events.at(-1).result, 'RESERVED');
    const { query } = JSON.parse(init.body);
    if (query === SETUP) assert.equal(disk.counts.predecessorArchive, 1);
    await Promise.resolve();
    active--;
    if (query === shared.FIND) return Response.json({ data: { products: { nodes: [p], pageInfo: complete } } });
    return Response.json({
      data:
        query === SETUP
          ? { productUpdate: { product: { ...p, status: 'ARCHIVED' }, userErrors: [] } }
          : { product: { ...p, status: 'ARCHIVED' } },
    });
  };
  run = operatorRun(fetchImpl);
  try {
    await lookup(run.op);
    for (const variables of [
      { product: { id: p.id, status: 'DRAFT' } },
      { product: { id: p.id, status: 'ARCHIVED', title: predecessorMarker } },
      { product: { id: 'gid://shopify/Product/1', status: 'ARCHIVED' } },
    ])
      await assert.rejects(send(run.op, SETUP, variables));
    const archives = await Promise.allSettled(
      Array.from({ length: 4 }, () => send(run.op, SETUP, { product: { id: p.id, status: 'ARCHIVED' } })),
    );
    assert.equal(archives.filter((x) => x.status === 'fulfilled').length, 1);
    const reads = await Promise.allSettled(Array.from({ length: 4 }, () => send(run.op, FIXTURE, { id: p.id })));
    assert.equal(reads.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal(peak, 1);
    assert.deepEqual(run.op.state().counts, { auth: 0, read: 2, create: 0, update: 0, predecessorArchive: 1 });
  } finally {
    run.cleanup();
  }
});

test('predecessor lookup consumes normal read ceiling and auth remains bounded at three', async () => {
  const run = operatorRun(async () => Response.json({ data: identity() }));
  try {
    for (let i = 0; i < 84; i++) await send(run.op, IDENTITY);
    await assert.rejects(lookup(run.op), { kind: 'ceiling' });
    assert.equal(run.op.state().predecessor.resolution, 'PENDING');
    assert.equal(run.op.state().counts.read, 84);
    const auth = () =>
      run.op.fetch(`https://${shared.TARGET.domain}/admin/oauth/access_token`, {
        method: 'POST',
        body: JSON.stringify({
          client_id: shared.TARGET.client,
          client_secret: 'synthetic-secret',
          grant_type: 'client_credentials',
        }),
      });
    for (let i = 0; i < 3; i++) await auth();
    await assert.rejects(auth(), { kind: 'ceiling' });
    assert.equal(run.op.state().counts.auth, 3);
  } finally {
    run.cleanup();
  }
});

for (const [name, options] of [
  ['missing read_publications', { handles: ['write_products', 'read_product_listings'] }],
  ['wrong identity', { wrongIdentity: true }],
  ['predecessor permission failure', { predecessorFailure: true }],
  ['fresh create unknown', { lostCreate: true }],
  ['fresh adapter update unknown', { lost: true }],
])
  test(`public qualification stops on ${name} with no blind retry`, async () => {
    const { result, register, requests } = await syntheticRun(options);
    assert.equal(result.outcome, 'STOPPED');
    assert.ok(result.cases.length === 0 || options.lost);
    if (!options.lost && !options.lostCreate) {
      assert.equal(register.counts.create, 0);
      assert.equal(register.counts.update, 0);
      assert.equal(register.counts.predecessorArchive, 0);
      assert.equal(result.final.outcome, 'NO_FIXTURE_CREATED');
    } else {
      assert.equal(register.counts.create, 1);
      assert.equal(requests.filter((r) => r.query === CREATE).length, 1);
      assert.equal(register.predecessor.resolution, 'ABSENT');
      if (options.lost) assert.equal(requests.filter((r) => r.query === ADAPTER_UPDATE).length, 1);
    }
  });

test('010 cannot reopen closed-profile histories and synthetic qualification rejects every canonical live directory', async () => {
  for (const profile of ['m5-004', 'm5-009']) {
    const directory = mkdtempSync(join(tmpdir(), 'm5010-cross-'));
    try {
      shared.initialize(directory, { source: 'synthetic', modules: {} }, { synthetic: true, profile });
      assert.throws(() => createOperator({ directory, fetchImpl: async () => Response.json({}) }), {
        kind: 'register',
      });
      assert.equal(existsSync(join(directory, 'operator.lock')), false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
  for (const profile of ['m5-004', 'm5-009', 'm5-010'])
    await assert.rejects(
      qualifySynthetic({
        directory: shared.profileDirectory(profile),
        binding: {},
        fetchImpl: async () => Response.json({}),
        credentialLoader: () => ({ secret: 'synthetic-secret' }),
      }),
      { kind: 'synthetic_boundaries' },
    );
  await assert.rejects(qualify({ directory: LIVE_DIRECTORY, binding: {}, gate: {} }));
});

test('archival permission expiring during durable reservation consumes allowance without HTTP or retry', async () => {
  const p = product(predecessorMarker, 'DRAFT', predecessorStart);
  let calls = 0;
  const run = operatorRun(async () => {
    calls++;
    return Response.json({ data: { products: { nodes: [p], pageInfo: complete } } });
  });
  const actualNow = Date.now;
  try {
    await lookup(run.op);
    const before = actualNow();
    // Synthetic clock advances when the durable reservation is externally visible.
    Date.now = () =>
      JSON.parse(readFileSync(join(run.directory, 'register.json'))).events.at(-1).result === 'RESERVED'
        ? before + 61_000
        : before;
    await assert.rejects(send(run.op, SETUP, { product: { id: p.id, status: 'ARCHIVED' } }), { kind: 'deadline' });
    assert.equal(calls, 1);
    assert.equal(run.op.state().counts.predecessorArchive, 1);
    assert.equal(run.op.state().events.at(-1).result, 'NOT_SENT');
    assert.equal(run.op.state().predecessor.resolution, 'STOPPED');
    await assert.rejects(send(run.op, SETUP, { product: { id: p.id, status: 'ARCHIVED' } }));
  } finally {
    Date.now = actualNow;
    run.cleanup();
  }
});

test('pending predecessor HTTP retains exclusive lock and prevents early operator closure', async () => {
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const run = operatorRun(async () => {
    entered();
    await waiting;
    return Response.json({ data: { products: { nodes: [], pageInfo: complete } } });
  });
  try {
    const request = lookup(run.op);
    await started;
    assert.throws(() => run.op.close(), { kind: 'pending_dispatch' });
    assert.throws(() => createOperator({ directory: run.directory, fetchImpl: async () => Response.json({}) }), {
      code: 'EEXIST',
    });
    assert.equal(run.op.state().events.at(-1).result, 'RESERVED');
    release();
    await request;
    assert.equal(run.op.state().predecessor.resolution, 'ABSENT');
  } finally {
    release();
    run.cleanup();
  }
});

for (const [status, stage, reads, archival] of [
  ['ACTIVE', 'archive', 2, 1],
  ['ACTIVE', 'readback', 3, 1],
  ['ARCHIVED', 'readback', 3, 0],
])
  test(`public qualification stops before fresh create after ${status} predecessor ${stage} failure`, async () => {
    const { result, register, requests } = await syntheticRun({ predecessorStatus: status, predecessorFailure: stage });
    assert.equal(result.outcome, 'STOPPED');
    assert.equal(result.predecessor.resolution, 'STOPPED');
    assert.deepEqual(result.cases, []);
    assert.equal(result.final.outcome, 'NO_FIXTURE_CREATED');
    assert.deepEqual(register.counts, { auth: 1, read: reads, create: 0, update: 0, predecessorArchive: archival });
    assert.equal(requests.filter((r) => r.query === CREATE).length, 0);
    assert.equal(requests.filter((r) => r.query === SETUP).length, archival);
    if (stage === 'archive') assert.equal(register.events.at(-1).result, 'UNKNOWN');
    else assert.equal(requests.filter((r) => r.query === FIXTURE).length, 1);
  });
