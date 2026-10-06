import type { AvailabilityHoldV2, AvailabilityScope, ProductAvailabilitySnapshotV2 } from '@insignia/application';
import { expect, test, vi } from 'vitest';
import { createShopifyAvailabilityHoldV2Port } from '../src/availability-hold-v2.js';

const scope: AvailabilityScope = {
  shopId: 'synthetic-shop',
  installationGeneration: '7',
  shopifyShopId: 'gid://shopify/Shop/101',
  appClientId: 'a'.repeat(32),
};
const productId = 'gid://shopify/Product/202',
  publicationId = 'gid://shopify/Publication/303';
const now = () => new Date('2026-10-01T12:00:00.000Z');
const complete = { hasNextPage: false, hasPreviousPage: false };
const product = (status = 'ACTIVE', updatedAt = '2026-10-01T11:00:00Z') => ({
  __typename: 'Product',
  id: productId,
  status,
  updatedAt,
  publishedAt: null,
  onlineStoreUrl: null,
  resourcePublications: {
    nodes:
      status === 'DRAFT'
        ? []
        : [{ publication: { id: publicationId }, isPublished: true, publishDate: '2026-09-30T11:00:00Z' }],
    pageInfo: complete,
  },
  unpublishedPublications: { nodes: [], pageInfo: complete },
});
const page = (node = product()) => ({
  data: {
    shop: { id: scope.shopifyShopId },
    currentAppInstallation: {
      app: { apiKey: scope.appClientId },
      accessScopes: ['read_products', 'write_products', 'read_publications'].map((handle) => ({ handle })),
    },
    node,
    publications: {
      nodes: [
        {
          id: publicationId,
          autoPublish: true,
          supportsFuturePublishing: false,
          includedProducts: { nodes: [{ id: productId }], pageInfo: complete },
        },
      ],
      pageInfo: { ...complete, endCursor: null },
    },
  },
});
const update = (node = product('DRAFT', '2026-10-01T11:01:00Z')) => ({
  data: { productUpdate: { product: node, userErrors: [] } },
});
function fixture(steps: unknown[], options: { now?: () => Date; timeoutMs?: number } = {}) {
  const queue = [...steps];
  const fetchImpl = vi.fn(async (_url: unknown, _init?: RequestInit) => {
    const next = queue.shift();
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next();
    if (next instanceof Response) return next;
    if (next === undefined) throw new Error('synthetic response queue exhausted');
    return new Response(JSON.stringify(next), { status: 200 });
  });
  const port = createShopifyAvailabilityHoldV2Port({
    credentials: {
      acquire: async () => ({
        kind: 'usable',
        shopDomain: 'synthetic.myshopify.com',
        accessToken: 'synthetic-token',
        accessExpiresAt: new Date('2099-01-01T00:00:00Z'),
      }),
    },
    isCurrent: async () => true,
    fetchImpl: fetchImpl as typeof fetch,
    now: options.now ?? now,
    timeoutMs: options.timeoutMs ?? 100,
  });
  return {
    port,
    fetchImpl,
    writes: () =>
      fetchImpl.mock.calls.map((c) => JSON.parse(String(c[1]?.body))).filter((r) => r.query.startsWith('mutation')),
  };
}
test('v2 keeps configured auto-publish intent while DRAFT loses effective membership and ACK metadata advances one second', async () => {
  const f = fixture([page(), page(), update(), page(product('DRAFT', '2026-10-01T11:01:01Z'))]);
  const before = (await f.port.snapshot(scope, productId)) as ProductAvailabilitySnapshotV2;
  expect(before.version).toBe('m5-product-availability-snapshot-v2');
  const hold: AvailabilityHoldV2 = { version: 'm5-availability-hold-v2', operationId: 'op-1', before, held: null };
  const acquired = await f.port.acquire(scope, hold);
  expect(acquired).toMatchObject({
    kind: 'HELD',
    hold: { version: 'm5-availability-hold-v2' },
    current: {
      state: 'unavailable',
      providerUpdatedAt: '2026-10-01T11:01:01.000Z',
      configuredIntent: { includedPublicationIds: [publicationId] },
      effectiveVisibility: { publishedPublicationIds: [] },
    },
  });
  expect(f.writes().map((r) => r.variables)).toEqual([{ product: { id: productId, status: 'DRAFT' } }]);
});

test('an ambiguous acquire cannot reserve another status update even if original semantics are still observed', async () => {
  const f = fixture([
    page(),
    page(),
    new Error('synthetic lost ACK'),
    page(),
    page(),
    update(),
    page(product('DRAFT')),
  ]);
  const before = (await f.port.snapshot(scope, productId)) as ProductAvailabilitySnapshotV2;
  const hold: AvailabilityHoldV2 = { version: 'm5-availability-hold-v2', operationId: 'ambiguous', before, held: null };
  expect((await f.port.acquire(scope, hold)).kind).toBe('NOT_HELD');
  await expect(f.port.acquire(scope, hold)).rejects.toMatchObject({ kind: 'ambiguous_write' });
  expect(f.writes()).toHaveLength(1);
});

const intent = (before: ProductAvailabilitySnapshotV2, operationId = 'op-1'): AvailabilityHoldV2 => ({
  version: 'm5-availability-hold-v2',
  operationId,
  before,
  held: null,
});
const requireHeld = async (f: ReturnType<typeof fixture>) => {
  const before = (await f.port.snapshot(scope, productId)) as ProductAvailabilitySnapshotV2;
  const result = await f.port.acquire(scope, intent(before));
  if (result.kind !== 'HELD' || result.hold.version !== 'm5-availability-hold-v2')
    throw new Error('expected exact v2 hold');
  return result.hold;
};
const withMembership = (status = 'ACTIVE', ids = [publicationId], publishDate = '2026-09-30T11:00:00Z') => {
  const p = product(status);
  p.resourcePublications.nodes = ids.map((id) => ({ publication: { id }, isPublished: true, publishDate }));
  return p;
};
const addIncluded = (response: ReturnType<typeof page>, id: string) => {
  response.data.publications.nodes.push({
    id,
    autoPublish: true,
    supportsFuturePublishing: false,
    includedProducts: { nodes: [{ id: productId }], pageInfo: complete },
  });
  return response;
};
test('complete forward publication pagination retains every exact included product even with hasPreviousPage false', async () => {
  const first = page();
  first.data.publications.pageInfo = {
    hasNextPage: true,
    hasPreviousPage: false,
    endCursor: 'cursor-1',
  } as typeof first.data.publications.pageInfo;
  const last = addIncluded(page(), 'gid://shopify/Publication/304');
  last.data.publications.nodes.shift();
  const f = fixture([first, last]);
  const snapshot = (await f.port.snapshot(scope, productId)) as ProductAvailabilitySnapshotV2;
  expect(snapshot.configuredIntent.includedPublicationIds).toEqual([publicationId, 'gid://shopify/Publication/304']);
  expect(f.fetchImpl.mock.calls.map((c) => JSON.parse(String(c[1]?.body)).variables)).toEqual([
    { productId, productQuery: 'id:202', after: null },
    { productId, productQuery: 'id:202', after: 'cursor-1' },
  ]);
});

test('both ACK and settled read diagnostic timestamps are retained without tolerance', async () => {
  const restored = withMembership('ACTIVE', [publicationId], '2026-10-01T11:03:00Z');
  restored.updatedAt = '2026-10-01T11:03:01Z';
  const ack = withMembership('ACTIVE', [publicationId], '2026-10-01T11:03:00Z');
  ack.updatedAt = '2026-10-01T11:03:00Z';
  const f = fixture([
    page(),
    page(),
    update(),
    page(product('DRAFT', '2026-10-01T11:01:01Z')),
    page(product('DRAFT', '2026-10-01T11:02:00Z')),
    update(ack),
    page(restored),
  ]);
  const hold = await requireHeld(f);
  expect(hold).toMatchObject({
    acquisitionAcknowledgement: { providerUpdatedAt: '2026-10-01T11:01:00.000Z' },
    held: { providerUpdatedAt: '2026-10-01T11:01:01.000Z' },
  });
  const result = await f.port.restore(scope, hold, hold.held!);
  expect(result).toMatchObject({
    kind: 'RESTORED',
    acknowledgement: { providerUpdatedAt: '2026-10-01T11:03:00.000Z' },
    current: {
      providerUpdatedAt: '2026-10-01T11:03:01.000Z',
      effectiveVisibility: { publicationEvidence: [{ publishDate: '2026-10-01T11:03:00.000Z' }] },
    },
  });
  expect(f.writes().map((r) => r.variables)).toEqual([
    { product: { id: productId, status: 'DRAFT' } },
    { product: { id: productId, status: 'ACTIVE' } },
  ]);
});
test('metadata advance while held preserves the exact persisted held snapshot', async () => {
  const f = fixture([
    page(),
    page(),
    update(),
    page(product('DRAFT', '2026-10-01T11:01:00Z')),
    page(product('DRAFT', '2026-10-01T11:59:00Z')),
  ]);
  const hold = await requireHeld(f);
  const observed = await f.port.observe(scope, hold);
  expect(observed).toMatchObject({
    kind: 'HELD',
    hold: { held: hold.held },
    current: { providerUpdatedAt: '2026-10-01T11:59:00.000Z' },
  });
  expect(f.writes()).toHaveLength(1);
});
test('same timestamp does not hide changed configured intent', async () => {
  const changed = addIncluded(page(product('DRAFT', '2026-10-01T11:01:00Z')), 'gid://shopify/Publication/304');
  const f = fixture([page(), page(), update(), changed]);
  const before = (await f.port.snapshot(scope, productId)) as ProductAvailabilitySnapshotV2;
  expect((await f.port.acquire(scope, intent(before))).kind).toBe('CONFLICT');
  expect(f.writes()).toHaveLength(1);
});
test('ACK effective publication contradicting held-safe readback is conflict', async () => {
  const f = fixture([page(), page(), update(withMembership('DRAFT')), page(product('DRAFT'))]);
  const before = (await f.port.snapshot(scope, productId)) as ProductAvailabilitySnapshotV2;
  expect((await f.port.acquire(scope, intent(before))).kind).toBe('CONFLICT');
});
test('ACK staged publication evidence cannot be discarded when the final legacy view is empty', async () => {
  const staged = withMembership('DRAFT');
  staged.resourcePublications.nodes[0]!.isPublished = false;
  const f = fixture([page(), page(), update(staged), page(product('DRAFT'))]);
  const before = (await f.port.snapshot(scope, productId)) as ProductAvailabilitySnapshotV2;
  expect((await f.port.acquire(scope, intent(before))).kind).toBe('CONFLICT');
});
test('original DRAFT acquires and restores without a status mutation', async () => {
  const f = fixture([page(product('DRAFT')), page(product('DRAFT')), page(product('DRAFT'))]);
  const hold = await requireHeld(f);
  expect((await f.port.restore(scope, hold, hold.held!)).kind).toBe('RESTORED');
  expect(f.writes()).toHaveLength(0);
});
test.each(['ARCHIVED', 'UNLISTED'])('retains existing %s -> DRAFT -> original status policy', async (status) => {
  const original = product(status);
  original.resourcePublications.nodes = [];
  const f = fixture([
    page(original),
    page(original),
    update(),
    page(product('DRAFT')),
    page(product('DRAFT')),
    update(original),
    page(original),
  ]);
  const hold = await requireHeld(f);
  expect((await f.port.restore(scope, hold, hold.held!)).kind).toBe('RESTORED');
  expect(f.writes().map((r) => r.variables.product.status)).toEqual(['DRAFT', status]);
});
test('V2 and association emptiness cannot erase includedProducts intent', async () => {
  const response = Object.assign(page(), { association: [], resourcePublicationsV2: [] });
  const f = fixture([response]);
  const snapshot = (await f.port.snapshot(scope, productId)) as ProductAvailabilitySnapshotV2;
  expect(snapshot.configuredIntent.includedPublicationIds).toEqual([publicationId]);
  const query = JSON.parse(String(f.fetchImpl.mock.calls[0]![1]?.body)).query;
  expect(query).not.toContain('publication_ids');
  expect(query).not.toContain('resourcePublicationsV2');
});
test.each([
  'duplicate',
  'nested-truncated',
  'nested-other-product',
  'effective-truncated',
  'effective-outside-included',
  'missing-grant',
  'wrong-app',
  'errors-empty',
  'errors-null',
  'errors-false',
])('incomplete or inconsistent %s observation fails before any mutation', async (defect) => {
  const response = page();
  if (defect === 'duplicate') response.data.publications.nodes.push(response.data.publications.nodes[0]!);
  if (defect === 'nested-truncated')
    response.data.publications.nodes[0]!.includedProducts.pageInfo = { hasNextPage: true, hasPreviousPage: false };
  if (defect === 'nested-other-product')
    response.data.publications.nodes[0]!.includedProducts.nodes = [{ id: 'gid://shopify/Product/999' }];
  if (defect === 'effective-truncated')
    response.data.node.resourcePublications.pageInfo = { hasNextPage: true, hasPreviousPage: false };
  if (defect === 'effective-outside-included') response.data.publications.nodes = [];
  if (defect === 'missing-grant') response.data.currentAppInstallation.accessScopes = [];
  if (defect === 'wrong-app') response.data.currentAppInstallation.app.apiKey = 'b'.repeat(32);
  if (defect.startsWith('errors-'))
    Object.assign(response, { errors: defect === 'errors-empty' ? [] : defect === 'errors-null' ? null : false });
  const f = fixture([response]);
  await expect(f.port.snapshot(scope, productId)).rejects.toBeInstanceOf(Error);
  expect(f.writes()).toHaveLength(0);
});
test.each(['staged', 'future-capable'])(
  'explicit %s intent stays in evidence and fails closed before acquire',
  async (mode) => {
    const response = page();
    if (mode === 'staged') {
      response.data.node.resourcePublications.nodes[0]!.isPublished = false;
      response.data.node.resourcePublications.nodes[0]!.publishDate = '2026-10-02T11:00:00Z';
    } else response.data.publications.nodes[0]!.supportsFuturePublishing = true;
    const f = fixture([response, response]);
    const before = (await f.port.snapshot(scope, productId)) as ProductAvailabilitySnapshotV2;
    if (mode === 'staged')
      expect(before.configuredIntent.scheduled).toEqual([{ publicationId, publishDate: '2026-10-02T11:00:00.000Z' }]);
    else expect(before.configuredIntent.publicationSettings[0]!.supportsFuturePublishing).toBe(true);
    expect((await f.port.acquire(scope, intent(before))).kind).toBe('CONFLICT');
    expect(f.writes()).toHaveLength(0);
  },
);
test.each(['missing', 'extra'])('restore rejects %s effective publication membership', async (mode) => {
  const id = 'gid://shopify/Publication/304';
  const original = addIncluded(page(), id);
  const draft = addIncluded(page(product('DRAFT')), id);
  const after = withMembership('ACTIVE', mode === 'missing' ? [] : [publicationId, id]);
  const f = fixture([original, original, update(), draft, draft, update(after), addIncluded(page(after), id)]);
  const hold = await requireHeld(f);
  expect((await f.port.restore(scope, hold, hold.held!)).kind).toBe('CONFLICT');
  expect(f.writes()).toHaveLength(2);
});
test('lost restore ACK remains pending even when a later read matches original semantics; no replay', async () => {
  const f = fixture([
    page(),
    page(),
    update(),
    page(product('DRAFT')),
    page(product('DRAFT')),
    new Error('synthetic lost restore ACK'),
    page(),
  ]);
  const hold = await requireHeld(f);
  expect(await f.port.restore(scope, hold, hold.held!)).toMatchObject({
    kind: 'RESTORATION_PENDING',
    current: { state: 'available' },
  });
  await expect(f.port.restore(scope, hold, hold.held!)).rejects.toMatchObject({ kind: 'ambiguous_write' });
  expect(f.writes()).toHaveLength(2);
});
test('one snapshot deadline spans all pages and blocks a later request', async () => {
  let elapsed = 0;
  const first = page();
  first.data.publications.pageInfo = {
    hasNextPage: true,
    hasPreviousPage: false,
    endCursor: 'cursor-1',
  } as typeof first.data.publications.pageInfo;
  const last = addIncluded(page(), 'gid://shopify/Publication/304');
  last.data.publications.nodes.shift();
  const f = fixture(
    [
      () => {
        elapsed += 60;
        return new Response(JSON.stringify(first));
      },
      () => {
        elapsed += 60;
        return new Response(JSON.stringify(last));
      },
      page(),
    ],
    { now: () => new Date(now().getTime() + elapsed), timeoutMs: 100 },
  );
  await expect(f.port.snapshot(scope, productId)).rejects.toMatchObject({ kind: 'network_or_timeout' });
  expect(f.fetchImpl).toHaveBeenCalledTimes(2);
  await expect(f.port.snapshot(scope, productId)).resolves.toBeTruthy(); // settled read failure is quiescent; no late page is dispatched
});
test('a cursor cycle fails closed without a repeated page request', async () => {
  const first = page();
  first.data.publications.pageInfo = {
    hasNextPage: true,
    hasPreviousPage: false,
    endCursor: 'cycle',
  } as typeof first.data.publications.pageInfo;
  const second = addIncluded(page(), 'gid://shopify/Publication/304');
  second.data.publications.nodes.shift();
  second.data.publications.pageInfo = {
    hasNextPage: true,
    hasPreviousPage: false,
    endCursor: 'cycle',
  } as typeof second.data.publications.pageInfo;
  const f = fixture([first, second]);
  await expect(f.port.snapshot(scope, productId)).rejects.toMatchObject({ kind: 'provider_shape' });
  expect(f.fetchImpl).toHaveBeenCalledTimes(2);
});
test('unsettled timed-out transport is quarantined and cannot dispatch a later operation', async () => {
  let finish: ((value: Response) => void) | undefined;
  const f = fixture(
    [
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
      page(),
    ],
    { timeoutMs: 100 },
  );
  await expect(f.port.snapshot(scope, productId)).rejects.toMatchObject({ kind: 'network_or_timeout' });
  await expect(f.port.snapshot(scope, productId)).rejects.toMatchObject({ kind: 'ambiguous_write' });
  expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  finish!(new Response(JSON.stringify(page())));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(f.fetchImpl).toHaveBeenCalledTimes(1);
});

test('a settled ACK survives an incomplete final acquire read without granting hold ownership', async () => {
  const f = fixture([page(), page(), update(), new Error('synthetic final read unavailable')]);
  const before = (await f.port.snapshot(scope, productId)) as ProductAvailabilitySnapshotV2;
  expect(await f.port.acquire(scope, intent(before))).toMatchObject({
    kind: 'CONFLICT',
    current: null,
    acknowledgement: { providerUpdatedAt: '2026-10-01T11:01:00.000Z' },
  });
  await expect(f.port.acquire(scope, intent(before))).rejects.toMatchObject({ kind: 'ambiguous_write' });
  expect(f.writes()).toHaveLength(1);
});

test('the 100-page / 5000-item guard stops without dispatching page 101', async () => {
  const pages = Array.from({ length: 101 }, (_, i) => {
    const response = page();
    response.data.publications.nodes = Array.from({ length: 50 }, (_, j) => ({
      id: `gid://shopify/Publication/${100000 + i * 50 + j}`,
      autoPublish: false,
      supportsFuturePublishing: false,
      includedProducts: { nodes: [], pageInfo: complete },
    }));
    response.data.publications.pageInfo = {
      hasNextPage: true,
      hasPreviousPage: i > 0,
      endCursor: `cursor-${i}`,
    } as typeof response.data.publications.pageInfo;
    return response;
  });
  const f = fixture(pages, { timeoutMs: 5000 });
  await expect(f.port.snapshot(scope, productId)).rejects.toMatchObject({ kind: 'provider_shape' });
  expect(f.fetchImpl).toHaveBeenCalledTimes(100);
  expect(f.writes()).toHaveLength(0);
});
test('a body over the 128KiB bound is rejected before parsing/provider work can continue', async () => {
  const f = fixture([new Response(' '.repeat(128 * 1024 + 1))]);
  await expect(f.port.snapshot(scope, productId)).rejects.toMatchObject({ kind: 'provider_shape' });
  expect(f.fetchImpl).toHaveBeenCalledTimes(1);
});
