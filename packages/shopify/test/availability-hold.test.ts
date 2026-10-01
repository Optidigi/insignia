import type { AvailabilityHold, AvailabilityScope, ProductAvailabilitySnapshot } from '@insignia/application';
import { expect, test, vi } from 'vitest';
import { createShopifyAvailabilityHoldPort } from '../src/availability-hold.js';
import type { AdminCredentialAcquire } from '../src/contextual-pricing.js';

const scope: AvailabilityScope = {
  shopId: 'synthetic-shop',
  installationGeneration: '7',
  shopifyShopId: 'gid://shopify/Shop/101',
  appClientId: 'a'.repeat(32),
};
const productId = 'gid://shopify/Product/202';
const clock = () => new Date('2026-10-01T12:00:00.000Z');
const version = '2026-10-01T11:00:00.000Z';
const heldVersion = '2026-10-01T11:01:00.000Z';
const product = (status = 'ACTIVE', updatedAt = version) => ({
  __typename: 'Product',
  id: productId,
  status,
  updatedAt,
  publishedAt: null,
  onlineStoreUrl: null,
  resourcePublications: {
    nodes: [
      { publication: { id: 'gid://shopify/Publication/303' }, isPublished: true, publishDate: '2026-09-30T11:00:00Z' },
    ],
    pageInfo: { hasNextPage: false, hasPreviousPage: false },
  },
  unpublishedPublications: {
    nodes: [{ id: 'gid://shopify/Publication/304' }],
    pageInfo: { hasNextPage: false, hasPreviousPage: false },
  },
});
const identity = {
  shop: { id: scope.shopifyShopId },
  currentAppInstallation: {
    app: { apiKey: scope.appClientId },
    accessScopes: [{ handle: 'read_products' }, { handle: 'write_products' }],
  },
};
const read = (node: unknown = product()) => ({ data: { ...identity, node } });
const update = (node: unknown = product('DRAFT', heldVersion)) => ({
  data: { productUpdate: { product: node, userErrors: [] } },
});
type Step = unknown | Error | Response | (() => Promise<Response>);
function fixture(steps: Step[], now = clock) {
  const queue = [...steps];
  const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    if (!queue.length) throw new Error('synthetic response queue exhausted');
    const step = queue.shift();
    if (step instanceof Error) throw step;
    if (typeof step === 'function') return step();
    return step instanceof Response ? step : new Response(JSON.stringify(step), { status: 200 });
  });
  const acquire = vi.fn(
    async (): Promise<AdminCredentialAcquire> => ({
      kind: 'usable' as const,
      shopDomain: 'synthetic.myshopify.com',
      accessToken: 'synthetic-token',
      accessExpiresAt: new Date('2099-01-01T00:00:00Z'),
    }),
  );
  const isCurrent = vi.fn(async (_scope: AvailabilityScope) => true);
  const port = createShopifyAvailabilityHoldPort({
    credentials: { acquire },
    isCurrent,
    fetchImpl: fetchImpl as typeof fetch,
    now,
    timeoutMs: 100,
  });
  const writes = () =>
    fetchImpl.mock.calls
      .map((call) => JSON.parse(String(call[1]?.body)))
      .filter((request) => request.query.startsWith('mutation'));
  return { port, fetchImpl, acquire, isCurrent, writes };
}

test('an exact ACTIVE snapshot acquires DRAFT and restores only the original status after exact readback', async () => {
  const f = fixture([
    read(),
    read(),
    update(),
    read(product('DRAFT', heldVersion)),
    read(product('DRAFT', heldVersion)),
    update(product('ACTIVE', '2026-10-01T11:02:00Z')),
    read(product('ACTIVE', '2026-10-01T11:02:00Z')),
  ]);
  const before = await f.port.snapshot(scope, productId);
  const intent: AvailabilityHold = { version: 'm5-availability-hold-v1', operationId: 'op-1', before, held: null };
  const acquired = await f.port.acquire(scope, intent);
  expect(acquired.kind).toBe('HELD');
  if (acquired.kind !== 'HELD') throw new Error('expected held');
  expect(acquired.hold.before).toEqual(before);
  expect(acquired.current).toMatchObject({ productId, state: 'unavailable', providerVersion: heldVersion });
  expect(await f.port.restore(scope, acquired.hold, acquired.current)).toMatchObject({
    kind: 'RESTORED',
    current: { state: 'available' },
  });
  expect(f.writes().map((request) => request.variables)).toEqual([
    { product: { id: productId, status: 'DRAFT' } },
    { product: { id: productId, status: 'ACTIVE' } },
  ]);
});

test('an acknowledged hold with unavailable readback reports an ambiguous write for journal recovery', async () => {
  const f = fixture([read(), read(), update(), new Error('synthetic lost readback')]);
  const before = await f.port.snapshot(scope, productId);
  await expect(
    f.port.acquire(scope, {
      version: 'm5-availability-hold-v1',
      operationId: 'op-1',
      before,
      held: null,
    }),
  ).rejects.toMatchObject({ kind: 'ambiguous_write' });
  expect(f.writes()).toHaveLength(1);
});

const intent = (before: ProductAvailabilitySnapshot): AvailabilityHold => ({
  version: 'm5-availability-hold-v1',
  operationId: 'op-1',
  before,
  held: null,
});
async function owned(f: ReturnType<typeof fixture>) {
  const before = await f.port.snapshot(scope, productId);
  const result = await f.port.acquire(scope, intent(before));
  if (result.kind !== 'HELD') throw new Error('fixture did not acquire');
  return result;
}

test.each(['ACTIVE', 'ARCHIVED', 'DRAFT', 'UNLISTED'])(
  'retains and restores original %s with no unnecessary DRAFT write',
  async (status) => {
    const p = product(status);
    const restored = product(status, '2026-10-01T11:02:00Z');
    const steps =
      status === 'DRAFT'
        ? [read(p), read(p), read(p)]
        : [
            read(p),
            read(p),
            update(),
            read(product('DRAFT', heldVersion)),
            read(product('DRAFT', heldVersion)),
            update(restored),
            read(restored),
          ];
    const f = fixture(steps);
    const acquired = await owned(f);
    expect(acquired.hold.before.state).toBe(
      { ACTIVE: 'available', ARCHIVED: 'archived', DRAFT: 'unavailable', UNLISTED: 'unlisted' }[status],
    );
    expect(await f.port.restore(scope, acquired.hold, acquired.current)).toMatchObject({
      kind: 'RESTORED',
      current: { state: acquired.hold.before.state },
    });
    expect(f.writes().map((w) => w.variables.product.status)).toEqual(status === 'DRAFT' ? [] : ['DRAFT', status]);
  },
);

test.each([new Error('synthetic lost response'), new Response(null, { status: 503 })])(
  'ambiguous acquisition reads once and retains operator hold for unattributable DRAFT',
  async (lost) => {
    const f = fixture([read(), read(), lost, read(product('DRAFT', heldVersion)), read(product('DRAFT', heldVersion))]);
    const hold = intent(await f.port.snapshot(scope, productId));
    expect(await f.port.acquire(scope, hold)).toMatchObject({ kind: 'CONFLICT', current: { state: 'unavailable' } });
    expect(await f.port.observe(scope, hold)).toMatchObject({ kind: 'CONFLICT', current: { state: 'unavailable' } });
    expect(hold.held).toBeNull();
    expect(f.writes()).toHaveLength(1);
  },
);

test('an ambiguous acquire with unchanged prestate is NOT_HELD; observation never repeats the write', async () => {
  const f = fixture([read(), read(), new Error('lost response'), read(), read()]);
  const hold = intent(await f.port.snapshot(scope, productId));
  expect(await f.port.acquire(scope, hold)).toMatchObject({ kind: 'NOT_HELD' });
  expect(await f.port.observe(scope, hold)).toMatchObject({ kind: 'NOT_HELD' });
  expect(f.writes()).toHaveLength(1);
});

test('restart observation recognizes the exact persisted held state without another mutation', async () => {
  const f = fixture([
    read(),
    read(),
    update(),
    read(product('DRAFT', heldVersion)),
    read(product('DRAFT', heldVersion)),
    read(product('DRAFT', heldVersion)),
  ]);
  const acquired = await owned(f);
  const restarted = JSON.parse(JSON.stringify(acquired.hold)) as AvailabilityHold;
  expect(await f.port.observe(scope, restarted)).toMatchObject({ kind: 'HELD' });
  expect(await f.port.acquire(scope, restarted)).toMatchObject({ kind: 'HELD' });
  expect(f.writes()).toHaveLength(1);
});

test('an unchanged original DRAFT intent is safely recognized without mutation evidence', async () => {
  const p = product('DRAFT');
  const f = fixture([read(p), read(p), read(p)]);
  const hold = intent(await f.port.snapshot(scope, productId));
  const result = await f.port.observe(scope, hold);
  expect(result).toMatchObject({ kind: 'HELD', hold: { held: { providerVersion: version } } });
  expect(await f.port.restore(scope, hold, hold.before)).toMatchObject({ kind: 'RESTORED' });
  expect(f.writes()).toHaveLength(0);
});

const changedProducts = [
  ['merchant status', product('ACTIVE', '2026-10-01T11:03:00Z')],
  ['same DRAFT with new version', product('DRAFT', '2026-10-01T11:03:00Z')],
  [
    'publication membership with same status/version',
    {
      ...product('DRAFT', heldVersion),
      resourcePublications: { nodes: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
    },
  ],
  [
    'scheduled publication date with same status/version',
    {
      ...product('DRAFT', heldVersion),
      resourcePublications: {
        ...product().resourcePublications,
        nodes: [{ ...product().resourcePublications.nodes[0], publishDate: '2026-10-02T11:00:00Z' }],
      },
    },
  ],
  [
    'publication visibility flag with same status/version',
    {
      ...product('DRAFT', heldVersion),
      resourcePublications: {
        ...product().resourcePublications,
        nodes: [{ ...product().resourcePublications.nodes[0], isPublished: false }],
      },
    },
  ],
  [
    'unpublished membership with same status/version',
    { ...product('DRAFT', heldVersion), unpublishedPublications: { ...product().unpublishedPublications, nodes: [] } },
  ],
  ['publishedAt with same status/version', { ...product('DRAFT', heldVersion), publishedAt: '2026-10-01T11:00:00Z' }],
  [
    'onlineStoreUrl with same status/version',
    { ...product('DRAFT', heldVersion), onlineStoreUrl: 'https://synthetic.example/products/test' },
  ],
] as const;
test.each(changedProducts)('observe and restore refuse %s without overwriting drift', async (_name, changed) => {
  const f = fixture([read(), read(), update(), read(product('DRAFT', heldVersion)), read(changed), read(changed)]);
  const acquired = await owned(f);
  expect(await f.port.observe(scope, acquired.hold)).toMatchObject({ kind: 'CONFLICT' });
  expect(await f.port.restore(scope, acquired.hold, acquired.current)).toMatchObject({ kind: 'CONFLICT' });
  expect(f.writes()).toHaveLength(1);
});

test('acquire refuses stale before-version and visibility evidence', async () => {
  for (const changed of [
    product('ACTIVE', heldVersion),
    { ...product(), onlineStoreUrl: 'https://synthetic.example/products/new' },
  ]) {
    const f = fixture([read(), read(changed)]);
    const hold = intent(await f.port.snapshot(scope, productId));
    expect(await f.port.acquire(scope, hold)).toMatchObject({ kind: 'CONFLICT' });
    expect(f.writes()).toHaveLength(0);
  }
});

test.each(['version', 'publication'])(
  'acquire refuses %s drift between mutation acknowledgment and readback',
  async (change) => {
    const changed = change === 'version' ? product('DRAFT', '2026-10-01T11:03:00Z') : changedProducts[2][1];
    const f = fixture([read(), read(), update(), read(changed)]);
    const hold = intent(await f.port.snapshot(scope, productId));
    expect(await f.port.acquire(scope, hold)).toMatchObject({ kind: 'CONFLICT' });
    expect(f.writes()).toHaveLength(1);
  },
);

test('acquire refuses publication drift already reflected in update response', async () => {
  const changed = changedProducts[2][1];
  const f = fixture([read(), read(), update(changed), read(changed)]);
  const hold = intent(await f.port.snapshot(scope, productId));
  expect(await f.port.acquire(scope, hold)).toMatchObject({ kind: 'CONFLICT' });
});

test('restore refuses caller expected-state drift even when remote hold remains intact', async () => {
  const f = fixture([
    read(),
    read(),
    update(),
    read(product('DRAFT', heldVersion)),
    read(product('DRAFT', heldVersion)),
  ]);
  const acquired = await owned(f);
  expect(
    await f.port.restore(scope, acquired.hold, { ...acquired.current, visibilityDigest: 'f'.repeat(64) }),
  ).toMatchObject({ kind: 'CONFLICT' });
  expect(f.writes()).toHaveLength(1);
});

test('restore never attributes an arbitrary DRAFT to an intent with no held evidence', async () => {
  const f = fixture([read(), read(product('DRAFT', heldVersion))]);
  const before = await f.port.snapshot(scope, productId);
  expect(
    await f.port.restore(scope, intent(before), { ...before, state: 'unavailable', providerVersion: heldVersion }),
  ).toMatchObject({ kind: 'CONFLICT' });
  expect(f.writes()).toHaveLength(0);
});

test.each([new Error('synthetic lost response'), new Response(null, { status: 503 })])(
  'lost restore response remains unresolved despite original-state readback',
  async (lost) => {
    const f = fixture([
      read(),
      read(),
      update(),
      read(product('DRAFT', heldVersion)),
      read(product('DRAFT', heldVersion)),
      lost,
      read(product('ACTIVE', '2026-10-01T11:02:00Z')),
    ]);
    const acquired = await owned(f);
    expect(await f.port.restore(scope, acquired.hold, acquired.current)).toMatchObject({
      kind: 'RESTORATION_PENDING',
      current: { state: 'available' },
    });
    expect(f.writes()).toHaveLength(2);
  },
);

test.each(['held', 'unreadable', 'drift'])('ambiguous restore leaves %s explicit and does not retry', async (kind) => {
  const after =
    kind === 'held'
      ? read(product('DRAFT', heldVersion))
      : kind === 'unreadable'
        ? new Error('synthetic readback loss')
        : read(product('ARCHIVED', '2026-10-01T11:03:00Z'));
  const f = fixture([
    read(),
    read(),
    update(),
    read(product('DRAFT', heldVersion)),
    read(product('DRAFT', heldVersion)),
    new Error('lost restore'),
    after,
  ]);
  const acquired = await owned(f);
  expect(await f.port.restore(scope, acquired.hold, acquired.current)).toMatchObject({
    kind: kind === 'drift' ? 'CONFLICT' : 'RESTORATION_PENDING',
  });
  expect(f.writes()).toHaveLength(2);
});

test('unchanged readback does not settle a still-in-flight restoration HTTP request', async () => {
  let complete!: (response: Response) => void;
  let settled = false;
  const inFlight = () =>
    new Promise<Response>((resolve) => {
      complete = resolve;
    }).then((value) => {
      settled = true;
      return value;
    });
  const f = fixture([
    read(),
    read(),
    update(),
    read(product('DRAFT', heldVersion)),
    read(product('DRAFT', heldVersion)),
    inFlight,
    read(product('DRAFT', heldVersion)),
  ]);
  const acquired = await owned(f);
  expect(await f.port.restore(scope, acquired.hold, acquired.current)).toMatchObject({
    kind: 'RESTORATION_PENDING',
    current: { state: 'unavailable' },
  });
  expect(settled).toBe(false);
  expect(f.writes()).toHaveLength(2);
  complete(new Response(JSON.stringify(update(product('ACTIVE', '2026-10-01T11:02:00Z'))), { status: 200 }));
  await Promise.resolve();
  expect(f.writes()).toHaveLength(2);
});

test('independent original-state change does not settle an outstanding restoration', async () => {
  let complete!: (response: Response) => void;
  let settled = false;
  const oldRequest = () =>
    new Promise<Response>((resolve) => {
      complete = resolve;
    }).then((value) => {
      settled = true;
      return value;
    });
  const f = fixture([
    read(),
    read(),
    update(),
    read(product('DRAFT', heldVersion)),
    read(product('DRAFT', heldVersion)),
    oldRequest,
    read(product('ACTIVE', '2026-10-01T11:02:00Z')),
  ]);
  const acquired = await owned(f);
  expect(await f.port.restore(scope, acquired.hold, acquired.current)).toMatchObject({
    kind: 'RESTORATION_PENDING',
    current: { state: 'available' },
  });
  expect(settled).toBe(false);
  expect(f.writes()).toHaveLength(2);
  complete(new Response(JSON.stringify(update(product('ACTIVE', '2026-10-01T11:03:00Z'))), { status: 200 }));
  await Promise.resolve();
  expect(f.writes()).toHaveLength(2);
});

test('acknowledged restoration still requires exact mutation version readback', async () => {
  const f = fixture([
    read(),
    read(),
    update(),
    read(product('DRAFT', heldVersion)),
    read(product('DRAFT', heldVersion)),
    update(product('ACTIVE', '2026-10-01T11:02:00Z')),
    read(product('ACTIVE', '2026-10-01T11:03:00Z')),
  ]);
  const acquired = await owned(f);
  expect(await f.port.restore(scope, acquired.hold, acquired.current)).toMatchObject({ kind: 'CONFLICT' });
});

test('exact original visibility is required after restoration even if the status matches', async () => {
  const changed = { ...product('ACTIVE', '2026-10-01T11:02:00Z'), publishedAt: '2026-10-01T11:02:00Z' };
  const f = fixture([
    read(),
    read(),
    update(),
    read(product('DRAFT', heldVersion)),
    read(product('DRAFT', heldVersion)),
    update(changed),
    read(changed),
  ]);
  const acquired = await owned(f);
  expect(await f.port.restore(scope, acquired.hold, acquired.current)).toMatchObject({ kind: 'CONFLICT' });
});

test('visibility digest normalizes connection ordering and provider timestamp spelling', async () => {
  const p = product();
  p.resourcePublications.nodes.push({
    publication: { id: 'gid://shopify/Publication/305' },
    isPublished: false,
    publishDate: '2026-10-02T11:00:00Z',
  });
  const reordered = {
    ...p,
    updatedAt: '2026-10-01T11:00:00Z',
    resourcePublications: {
      ...p.resourcePublications,
      nodes: [...p.resourcePublications.nodes]
        .reverse()
        .map((n) => ({ ...n, publishDate: n.publishDate.replace('Z', '.000Z') })),
    },
  };
  const f = fixture([read(p), read(reordered)]);
  const a = await f.port.snapshot(scope, productId);
  expect(await f.port.snapshot(scope, productId)).toEqual(a);
  expect(a.scope).toEqual(scope);
  expect(a.observedAt).toBe('2026-10-01T12:00:00.000Z');
});

test('ResourcePublication.publishDate is non-null in the supported schema', async () => {
  const p = product();
  const malformed = {
    ...p,
    resourcePublications: {
      ...p.resourcePublications,
      nodes: [{ ...p.resourcePublications.nodes[0], publishDate: null }],
    },
  };
  await expect(fixture([read(malformed)]).port.snapshot(scope, productId)).rejects.toMatchObject({
    kind: 'provider_shape',
  });
});

test('malformed GraphQL error entries are provider shape failures', async () => {
  await expect(fixture([{ errors: [null] }]).port.snapshot(scope, productId)).rejects.toMatchObject({
    kind: 'provider_shape',
  });
});

test('a journaled before snapshot from the future is rejected before any HTTP dispatch', async () => {
  const f = fixture([read()]);
  const hold = intent(await f.port.snapshot(scope, productId));
  const bad = { ...hold, before: { ...hold.before, observedAt: '2026-10-01T13:00:00.000Z' } };
  await expect(f.port.acquire(scope, bad)).rejects.toMatchObject({ kind: 'invalid_request' });
  expect(f.fetchImpl).toHaveBeenCalledTimes(1);
});

const malformedProducts: readonly [string, unknown][] = [
  ['null product', null],
  ['unknown status', { ...product(), status: 'UNSUPPORTED_SYNTHETIC_STATUS' }],
  ['missing version', { ...product(), updatedAt: undefined }],
  ['impossible date', { ...product(), updatedAt: '2026-02-30T11:00:00Z' }],
  ['future version', { ...product(), updatedAt: '2026-10-01T13:00:00Z' }],
  ['missing publishedAt', { ...product(), publishedAt: undefined }],
  ['missing onlineStoreUrl', { ...product(), onlineStoreUrl: undefined }],
  [
    'unsafe onlineStoreUrl',
    { ...product(), onlineStoreUrl: 'https://user:synthetic@synthetic.example/products/x?token=synthetic' },
  ],
  [
    'publication truncation',
    {
      ...product(),
      resourcePublications: {
        ...product().resourcePublications,
        pageInfo: { hasNextPage: true, hasPreviousPage: false },
      },
    },
  ],
  [
    'unpublished truncation',
    {
      ...product(),
      unpublishedPublications: {
        ...product().unpublishedPublications,
        pageInfo: { hasNextPage: true, hasPreviousPage: false },
      },
    },
  ],
  [
    'previous-page truncation',
    {
      ...product(),
      resourcePublications: {
        ...product().resourcePublications,
        pageInfo: { hasNextPage: false, hasPreviousPage: true },
      },
    },
  ],
  ['missing pagination evidence', { ...product(), resourcePublications: { nodes: [] } }],
  [
    'duplicate publication',
    {
      ...product(),
      resourcePublications: {
        ...product().resourcePublications,
        nodes: [product().resourcePublications.nodes[0], product().resourcePublications.nodes[0]],
      },
    },
  ],
  [
    'wrong publication id type',
    { ...product(), unpublishedPublications: { ...product().unpublishedPublications, nodes: [{ id: productId }] } },
  ],
  [
    'oversize connection',
    {
      ...product(),
      unpublishedPublications: {
        ...product().unpublishedPublications,
        nodes: Array.from({ length: 251 }, (_, i) => ({ id: `gid://shopify/Publication/${i + 1}` })),
      },
    },
  ],
  [
    'malformed visibility',
    {
      ...product(),
      resourcePublications: {
        ...product().resourcePublications,
        nodes: [{ ...product().resourcePublications.nodes[0], isPublished: 'true' }],
      },
    },
  ],
];
test.each(malformedProducts)('malformed before/acquire/observe: %s cannot supply evidence', async (_name, bad) => {
  const beforeCase = fixture([{ data: { ...identity, node: bad } }]);
  await expect(beforeCase.port.snapshot(scope, productId)).rejects.toMatchObject({ kind: 'provider_shape' });
  const acquireCase = fixture([read(), read(), { data: { productUpdate: { product: bad, userErrors: [] } } }]);
  const hold = intent(await acquireCase.port.snapshot(scope, productId));
  await expect(acquireCase.port.acquire(scope, hold)).rejects.toMatchObject({
    kind: _name === 'future version' ? 'readback_mismatch' : 'provider_shape',
  });
  expect(acquireCase.writes()).toHaveLength(1);
  const observeCase = fixture([read(), { data: { ...identity, node: bad } }]);
  const observedHold = intent(await observeCase.port.snapshot(scope, productId));
  await expect(observeCase.port.observe(scope, observedHold)).rejects.toMatchObject({ kind: 'provider_shape' });
  expect(observeCase.writes()).toHaveLength(0);
});

test.each([
  ['wrong shop', { ...identity, shop: { id: 'gid://shopify/Shop/999' } }, product()],
  [
    'wrong app',
    { ...identity, currentAppInstallation: { ...identity.currentAppInstallation, app: { apiKey: 'b'.repeat(32) } } },
    product(),
  ],
  ['wrong product', identity, { ...product(), id: 'gid://shopify/Product/999' }],
  ['wrong node type', identity, { ...product(), __typename: 'ProductVariant' }],
])('remote %s is rejected independently of credentials', async (_name, remoteIdentity, node) => {
  const f = fixture([{ data: { ...remoteIdentity, node } }]);
  await expect(f.port.snapshot(scope, productId)).rejects.toMatchObject({ kind: 'owner_mismatch' });
  expect(f.writes()).toHaveLength(0);
});

test('wrong product in mutation acknowledgment cannot establish hold ownership', async () => {
  const f = fixture([read(), read(), update({ ...product('DRAFT', heldVersion), id: 'gid://shopify/Product/999' })]);
  const hold = intent(await f.port.snapshot(scope, productId));
  await expect(f.port.acquire(scope, hold)).rejects.toMatchObject({ kind: 'owner_mismatch' });
  expect(f.writes()).toHaveLength(1);
});

test.each(['shopId', 'installationGeneration', 'shopifyShopId', 'appClientId'] as const)(
  'a hold from another %s is rejected before dispatch at every seam',
  async (field) => {
    const f = fixture([read()]);
    const hold = intent(await f.port.snapshot(scope, productId));
    const changed = {
      ...scope,
      [field]: {
        shopId: 'other-shop',
        installationGeneration: '8',
        shopifyShopId: 'gid://shopify/Shop/999',
        appClientId: 'b'.repeat(32),
      }[field],
    };
    await expect(f.port.acquire(changed, hold)).rejects.toMatchObject({ kind: 'invalid_request' });
    await expect(f.port.observe(changed, hold)).rejects.toMatchObject({ kind: 'invalid_request' });
    await expect(f.port.restore(changed, hold, hold.before)).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  },
);

test('invalid hold/snapshot binding and malformed input are rejected without provider reads', async () => {
  const f = fixture([read()]);
  const hold = intent(await f.port.snapshot(scope, productId));
  for (const bad of [
    { ...hold, version: 'wrong' },
    { ...hold, operationId: '' },
    { ...hold, before: { ...hold.before, productId: 'not-a-product' } },
    { ...hold, before: { ...hold.before, providerVersion: 'not-a-date' } },
    { ...hold, before: { ...hold.before, visibilityDigest: 'not-a-digest' } },
    { ...hold, held: { ...hold.before, state: 'available' } },
    { ...hold, held: { ...hold.before, productId: 'gid://shopify/Product/999', state: 'unavailable' } },
  ])
    await expect(f.port.acquire(scope, bad as AvailabilityHold)).rejects.toMatchObject({ kind: 'invalid_request' });
  expect(f.fetchImpl).toHaveBeenCalledTimes(1);
});

test.each(['missing', 'inactive', 'reauth_required', 'temporarily_unavailable'] as const)(
  'credential %s is classified before a request',
  async (kind) => {
    const fetchImpl = vi.fn();
    const port = createShopifyAvailabilityHoldPort({
      credentials: { acquire: async () => ({ kind }) },
      isCurrent: async () => true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: clock,
    });
    await expect(port.snapshot(scope, productId)).rejects.toMatchObject({
      kind: {
        missing: 'credential_missing',
        inactive: 'credential_inactive',
        reauth_required: 'reauth_required',
        temporarily_unavailable: 'provider_unavailable',
      }[kind],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  },
);

test('trusted current check independently blocks inactive/reinstalled generations', async () => {
  const f = fixture([read()]);
  f.isCurrent.mockResolvedValue(false);
  await expect(f.port.snapshot(scope, productId)).rejects.toMatchObject({ kind: 'credential_inactive' });
  expect(f.fetchImpl).not.toHaveBeenCalled();
  expect(f.acquire).not.toHaveBeenCalled();
});

test('post-read credential/current fencing rejects a generation revoked during readback', async () => {
  const f = fixture([read()]);
  f.isCurrent.mockImplementation(async () => f.fetchImpl.mock.calls.length === 0);
  await expect(f.port.snapshot(scope, productId)).rejects.toMatchObject({ kind: 'credential_inactive' });
  expect(f.fetchImpl).toHaveBeenCalledTimes(1);
});

test('mutation dispatch is fenced after the before read, and no post-revocation write occurs', async () => {
  const f = fixture([read(), read()]);
  const hold = intent(await f.port.snapshot(scope, productId));
  // Two current checks before/after each request, plus current check before token
  // resolution. Revoke at the mutation's first independent credential acquisition.
  f.acquire.mockImplementation(async () => {
    if (f.fetchImpl.mock.calls.length === 2) return { kind: 'inactive' };
    return {
      kind: 'usable',
      shopDomain: 'synthetic.myshopify.com',
      accessToken: 'synthetic-token',
      accessExpiresAt: new Date('2099-01-01T00:00:00Z'),
    };
  });
  await expect(f.port.acquire(scope, hold)).rejects.toMatchObject({ kind: 'credential_inactive' });
  expect(f.writes()).toHaveLength(0);
});

test('a generation revoked during mutation cannot yield held evidence or perform readback', async () => {
  const f = fixture([read(), read(), update()]);
  const hold = intent(await f.port.snapshot(scope, productId));
  f.isCurrent.mockImplementation(async () => f.writes().length === 0);
  await expect(f.port.acquire(scope, hold)).rejects.toMatchObject({ kind: 'credential_inactive' });
  expect(f.writes()).toHaveLength(1);
  expect(f.fetchImpl).toHaveBeenCalledTimes(3);
});

test('a reinstalled tenant cannot observe or restore previously owned hold', async () => {
  const f = fixture([read(), read(), update(), read(product('DRAFT', heldVersion))]);
  const acquired = await owned(f);
  f.isCurrent.mockResolvedValue(false);
  await expect(f.port.observe(scope, acquired.hold)).rejects.toMatchObject({ kind: 'credential_inactive' });
  await expect(f.port.restore(scope, acquired.hold, acquired.current)).rejects.toMatchObject({
    kind: 'credential_inactive',
  });
  expect(f.writes()).toHaveLength(1);
});

test('missing write scope cannot dispatch a mutation even when the before snapshot is correct', async () => {
  const noWrite = {
    ...identity,
    currentAppInstallation: { ...identity.currentAppInstallation, accessScopes: [{ handle: 'read_products' }] },
  };
  const f = fixture([read(), { data: { ...noWrite, node: product() } }]);
  const hold = intent(await f.port.snapshot(scope, productId));
  await expect(f.port.acquire(scope, hold)).rejects.toMatchObject({ kind: 'forbidden' });
  expect(f.writes()).toHaveLength(0);
});

test.each([
  [401, 'unauthorized'],
  [403, 'forbidden'],
  [429, 'throttled'],
  [503, 'provider_unavailable'],
  [400, 'graphql_error'],
])('HTTP %s is a sanitized %s at the read boundary', async (status, kind) => {
  const f = fixture([new Response('synthetic-private-detail', { status: status as number })]);
  await expect(f.port.snapshot(scope, productId)).rejects.toMatchObject({ kind });
});

test.each([
  ['THROTTLED', 'throttled'],
  ['MAX_COST_EXCEEDED', 'throttled'],
  ['ACCESS_DENIED', 'forbidden'],
  ['OTHER', 'graphql_error'],
])('GraphQL %s is normalized to %s', async (code, kind) => {
  const f = fixture([{ errors: [{ message: 'synthetic-private-detail', extensions: { code } }] }]);
  await expect(f.port.snapshot(scope, productId)).rejects.toMatchObject({ kind });
});

test('429 on mutation is never automatically retried', async () => {
  const f = fixture([read(), read(), new Response(null, { status: 429 })]);
  const hold = intent(await f.port.snapshot(scope, productId));
  await expect(f.port.acquire(scope, hold)).rejects.toMatchObject({ kind: 'throttled' });
  expect(f.writes()).toHaveLength(1);
});

test('valid mutation user errors are typed and never expose provider messages', async () => {
  const f = fixture([
    read(),
    read(),
    {
      data: {
        productUpdate: { product: null, userErrors: [{ field: ['status'], message: 'synthetic-private-detail' }] },
      },
    },
  ]);
  const hold = intent(await f.port.snapshot(scope, productId));
  await expect(f.port.acquire(scope, hold)).rejects.toMatchObject({
    kind: 'user_error',
    message: 'Shopify availability hold failed: user_error',
  });
  expect(f.writes()).toHaveLength(1);
});

test.each([
  { data: {} },
  { data: { productUpdate: { product: product('DRAFT', heldVersion) } } },
  { data: { productUpdate: { product: product('DRAFT', heldVersion), userErrors: [null] } } },
  { data: { productUpdate: { product: product('DRAFT', heldVersion), userErrors: 'bad' } } },
])('malformed mutation envelope is typed and never establishes ownership', async (body) => {
  const f = fixture([read(), read(), body]);
  const hold = intent(await f.port.snapshot(scope, productId));
  await expect(f.port.acquire(scope, hold)).rejects.toMatchObject({ kind: 'provider_shape' });
  expect(f.writes()).toHaveLength(1);
});

test('a mutation acknowledging ACTIVE instead of requested DRAFT cannot establish ownership', async () => {
  const f = fixture([read(), read(), update(product('ACTIVE', heldVersion))]);
  const hold = intent(await f.port.snapshot(scope, productId));
  await expect(f.port.acquire(scope, hold)).rejects.toMatchObject({ kind: 'readback_mismatch' });
});

test.each([
  new Response('{', { status: 200 }),
  new Response('x'.repeat(128 * 1024 + 1), { status: 200 }),
  new Response(JSON.stringify(null), { status: 200 }),
])('malformed or oversized body cannot supply availability evidence', async (response) => {
  await expect(fixture([response]).port.snapshot(scope, productId)).rejects.toMatchObject({ kind: 'provider_shape' });
});

test('hard deadline covers stalled body and fetch even if AbortSignal is ignored', async () => {
  for (const stalled of [
    () => new Promise<Response>(() => {}),
    async () => new Response(new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}) })),
  ])
    await expect(fixture([stalled]).port.snapshot(scope, productId)).rejects.toMatchObject({
      kind: 'network_or_timeout',
    });
});

test('credential resolution is deadline bounded and a late result cannot dispatch a request', async () => {
  const f = fixture([read()]);
  let finish: (() => void) | undefined;
  f.acquire.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () =>
          resolve({
            kind: 'usable',
            shopDomain: 'synthetic.myshopify.com',
            accessToken: 'synthetic-token',
            accessExpiresAt: new Date('2099-01-01T00:00:00Z'),
          });
      }),
  );
  await expect(f.port.snapshot(scope, productId)).rejects.toMatchObject({ kind: 'network_or_timeout' });
  finish?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(f.fetchImpl).not.toHaveBeenCalled();
});

test('HTTP uses only the fenced synthetic credential at the pinned endpoint', async () => {
  const f = fixture([read()]);
  await f.port.snapshot(scope, productId);
  expect(f.acquire).toHaveBeenCalledWith({
    shopId: scope.shopId,
    installationGeneration: scope.installationGeneration,
  });
  expect(f.isCurrent).toHaveBeenCalledWith(scope);
  const [url, init] = f.fetchImpl.mock.calls[0] ?? [];
  expect(url).toBe('https://synthetic.myshopify.com/admin/api/2026-07/graphql.json');
  expect(init).toMatchObject({
    method: 'POST',
    redirect: 'error',
    headers: { 'x-shopify-access-token': 'synthetic-token' },
  });
  const request = JSON.parse(String(init?.body));
  expect(request.variables).toEqual({ productId });
  expect(request.query).toContain('resourcePublications(first: 250, onlyPublished: false)');
  expect(request.query).toContain('hasNextPage hasPreviousPage');
});

test('hard mutation timeout still observes once and cannot attribute DRAFT or retry', async () => {
  const f = fixture([read(), read(), () => new Promise<Response>(() => {}), read(product('DRAFT', heldVersion))]);
  const hold = intent(await f.port.snapshot(scope, productId));
  expect(await f.port.acquire(scope, hold)).toMatchObject({ kind: 'CONFLICT', current: { state: 'unavailable' } });
  expect(f.writes()).toHaveLength(1);
});

test('lost acquisition and failed recovery read report ambiguous_write', async () => {
  const f = fixture([read(), read(), new Error('lost mutation response'), new Error('lost recovery response')]);
  const hold = intent(await f.port.snapshot(scope, productId));
  await expect(f.port.acquire(scope, hold)).rejects.toMatchObject({ kind: 'ambiguous_write' });
  expect(f.writes()).toHaveLength(1);
});

test('a successful restoration acknowledgment with throttled readback remains pending', async () => {
  const f = fixture([
    read(),
    read(),
    update(),
    read(product('DRAFT', heldVersion)),
    read(product('DRAFT', heldVersion)),
    update(product('ACTIVE', '2026-10-01T11:02:00Z')),
    new Response(null, { status: 429 }),
  ]);
  const acquired = await owned(f);
  expect(await f.port.restore(scope, acquired.hold, acquired.current)).toEqual({
    kind: 'RESTORATION_PENDING',
    current: null,
  });
  expect(f.writes()).toHaveLength(2);
});

test('restoration user errors retain the hold, without automatic retry', async () => {
  const f = fixture([
    read(),
    read(),
    update(),
    read(product('DRAFT', heldVersion)),
    read(product('DRAFT', heldVersion)),
    { data: { productUpdate: { product: null, userErrors: [{ field: ['status'], message: 'synthetic rejection' }] } } },
  ]);
  const acquired = await owned(f);
  await expect(f.port.restore(scope, acquired.hold, acquired.current)).rejects.toMatchObject({ kind: 'user_error' });
  expect(f.writes()).toHaveLength(2);
});

test('rotation of credentials during an HTTP response fences the read result', async () => {
  const f = fixture([read()]);
  f.acquire.mockImplementation(async () => ({
    kind: 'usable',
    shopDomain: 'synthetic.myshopify.com',
    accessToken: f.fetchImpl.mock.calls.length === 0 ? 'synthetic-token' : 'synthetic-rotated-token',
    accessExpiresAt: new Date('2099-01-01T00:00:00Z'),
  }));
  await expect(f.port.snapshot(scope, productId)).rejects.toMatchObject({ kind: 'credential_inactive' });
});

test.each([
  { shopDomain: 'outside.example' },
  { accessToken: '' },
  { accessToken: 'synthetic\nheader' },
  { accessToken: 's'.repeat(8193) },
  { accessExpiresAt: new Date('invalid') },
  { accessExpiresAt: new Date('2026-10-01T12:00:30Z') },
])('invalid, expired, or nearly expired credential never dispatches a request', async (change) => {
  const f = fixture([read()]);
  f.acquire.mockResolvedValue({
    kind: 'usable',
    shopDomain: 'synthetic.myshopify.com',
    accessToken: 'synthetic-token',
    accessExpiresAt: new Date('2099-01-01T00:00:00Z'),
    ...change,
  });
  await expect(f.port.snapshot(scope, productId)).rejects.toMatchObject({ kind: 'credential_inactive' });
  expect(f.fetchImpl).not.toHaveBeenCalled();
});

test('hard deadline covers the trusted current check as well as credentials and HTTP', async () => {
  const f = fixture([read()]);
  f.isCurrent.mockImplementation(() => new Promise<boolean>(() => {}));
  await expect(f.port.snapshot(scope, productId)).rejects.toMatchObject({ kind: 'network_or_timeout' });
  expect(f.fetchImpl).not.toHaveBeenCalled();
});

test('invalid factory inputs and identifiers fail before credential access', async () => {
  const f = fixture([]);
  for (const timeoutMs of [0, 99, 30_001, Number.NaN])
    expect(() =>
      createShopifyAvailabilityHoldPort({
        credentials: { acquire: f.acquire },
        isCurrent: f.isCurrent,
        timeoutMs,
      }),
    ).toThrowError(/invalid_request/);
  expect(() => createShopifyAvailabilityHoldPort({ credentials: { acquire: f.acquire } } as never)).toThrowError(
    /invalid_request/,
  );
  for (const target of [
    { ...scope, installationGeneration: '0' },
    { ...scope, shopifyShopId: productId },
    { ...scope, appClientId: '' },
    { ...scope, shopId: '' },
  ])
    await expect(f.port.snapshot(target, productId)).rejects.toMatchObject({ kind: 'invalid_request' });
  await expect(f.port.snapshot(scope, 'not-a-product')).rejects.toMatchObject({ kind: 'invalid_request' });
  expect(f.acquire).not.toHaveBeenCalled();
  expect(f.fetchImpl).not.toHaveBeenCalled();
});

test('held evidence with no provider version advancement cannot claim a status-changing acquire', async () => {
  const f = fixture([read()]);
  const before = await f.port.snapshot(scope, productId);
  const hold = { ...intent(before), held: { ...before, state: 'unavailable' as const } };
  await expect(f.port.observe(scope, hold)).rejects.toMatchObject({ kind: 'invalid_request' });
  expect(f.fetchImpl).toHaveBeenCalledTimes(1);
});

test('a snapshot retains only the authoritative scope fields', async () => {
  const f = fixture([read()]);
  const result = await f.port.snapshot({ ...scope, auxiliary: 'synthetic-extra' } as AvailabilityScope, productId);
  expect(result.scope).toEqual(scope);
});

test('status-dependent Online Store URL can disappear under DRAFT and is exactly restored', async () => {
  const original = {
    ...product(),
    publishedAt: '2026-09-30T11:00:00Z',
    onlineStoreUrl: 'https://synthetic.example/products/test',
  };
  const draft = { ...original, status: 'DRAFT', updatedAt: heldVersion, onlineStoreUrl: null };
  const restored = { ...original, updatedAt: '2026-10-01T11:02:00Z' };
  const f = fixture([
    read(original),
    read(original),
    update(draft),
    read(draft),
    read(draft),
    update(restored),
    read(restored),
  ]);
  const acquired = await owned(f);
  expect(acquired.hold.held?.visibilityDigest).not.toBe(acquired.hold.before.visibilityDigest);
  expect(await f.port.restore(scope, acquired.hold, acquired.current)).toMatchObject({
    kind: 'RESTORED',
    current: {
      visibilityDigest: acquired.hold.before.visibilityDigest,
    },
  });
});

// Deterministic payload capture and delivery, not sleeps or live provider calls.
function timedRead(delayPoint: 'fetch' | 'body' | 'credential', delayMs: number, updatedAt = version) {
  let at = clock().getTime();
  let acquisitions = 0;
  const payload = JSON.stringify(read(product('DRAFT', updatedAt)));
  const bytes = new TextEncoder().encode(payload);
  const port = createShopifyAvailabilityHoldPort({
    now: () => new Date(at),
    timeoutMs: 8000,
    isCurrent: async () => true,
    credentials: {
      acquire: async () => {
        if (++acquisitions === 2 && delayPoint === 'credential') at += delayMs;
        return {
          kind: 'usable',
          shopDomain: 'synthetic.myshopify.com',
          accessToken: 'synthetic-token',
          accessExpiresAt: new Date('2099-01-01T00:00:00Z'),
        };
      },
    },
    fetchImpl: (async () => {
      if (delayPoint === 'fetch') at += delayMs;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
          },
          pull(controller) {
            if (delayPoint === 'body') at += delayMs;
            controller.close();
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch,
  });
  return { port, now: () => new Date(at) };
}

test.each(['fetch', 'body', 'credential'] as const)('R1 %s delay cannot renew observation authority', async (point) => {
  const f = timedRead(point, 2000);
  const snapshot = await f.port.snapshot(scope, productId);
  expect(snapshot.observedAt).toBe('2026-10-01T12:00:00.000Z');
  expect(snapshot).toMatchObject({ receivedAt: '2026-10-01T12:00:02.000Z' });
  expect(f.now().getTime() - Date.parse(snapshot.observedAt)).toBe(2000);
});

test.each([0, 999, 1000])('R1 within-budget observation preserves exact origin at %s ms', async (delay) => {
  const f = timedRead('fetch', delay);
  const snapshot = await f.port.snapshot(scope, productId);
  expect(snapshot.observedAt).toBe(clock().toISOString());
  expect(f.now().getTime() - Date.parse(snapshot.observedAt)).toBe(delay);
});

test('R1 a legitimate provider version generated during request is not future of receipt', async () => {
  const f = timedRead('fetch', 1000, '2026-10-01T12:00:00.500Z');
  expect(await f.port.snapshot(scope, productId)).toMatchObject({
    observedAt: '2026-10-01T12:00:00.000Z',
    receivedAt: '2026-10-01T12:00:01.000Z',
    providerVersion: '2026-10-01T12:00:00.500Z',
  });
});

test('R1 provider future of receipt and reversed observation clock are rejected', async () => {
  await expect(
    timedRead('fetch', 1000, '2026-10-01T12:00:01.001Z').port.snapshot(scope, productId),
  ).rejects.toMatchObject({ kind: 'provider_shape' });
  await expect(timedRead('fetch', -1).port.snapshot(scope, productId)).rejects.toMatchObject({
    kind: 'invalid_request',
  });
});

test('R2 a merchant UNLISTED status change while held conflicts without a visibility-broadening restore', async () => {
  const f = fixture([
    read(product('UNLISTED')),
    read(product('UNLISTED')),
    update(),
    read(product('DRAFT', heldVersion)),
    read(product('ACTIVE', '2026-10-01T11:02:00Z')),
  ]);
  const acquired = await owned(f);
  expect(await f.port.restore(scope, acquired.hold, acquired.current)).toMatchObject({
    kind: 'CONFLICT',
    current: { state: 'available' },
  });
  expect(f.writes().map((w) => w.variables.product.status)).toEqual(['DRAFT']);
});

test('R1 mid-request provider version survives journal validation and observe origin remains conservative', async () => {
  const f = timedRead('fetch', 1000, '2026-10-01T12:00:00.500Z');
  const before = await f.port.snapshot(scope, productId);
  const held = await f.port.acquire(scope, intent(before));
  expect(held.kind).toBe('HELD');
  if (held.kind !== 'HELD') throw new Error('expected held');
  const observed = await f.port.observe(scope, held.hold);
  expect(observed.kind).toBe('HELD');
  expect(f.now().getTime() - Date.parse(observed.current.observedAt)).toBe(1000);
});

test('R1 acquisition and restoration allow provider versions generated inside a request', async () => {
  let at = clock().getTime();
  const during = (status: string) => async () => {
    at += 500;
    return new Response(JSON.stringify(update(product(status, new Date(at).toISOString()))), { status: 200 });
  };
  const draftAt = '2026-10-01T12:00:00.500Z',
    restoredAt = '2026-10-01T12:00:01.000Z';
  const f = fixture(
    [
      read(),
      read(),
      during('DRAFT'),
      read(product('DRAFT', draftAt)),
      read(product('DRAFT', draftAt)),
      during('ACTIVE'),
      read(product('ACTIVE', restoredAt)),
    ],
    () => new Date(at),
  );
  const acquired = await owned(f);
  expect(acquired.current).toMatchObject({ providerVersion: draftAt, observedAt: draftAt, receivedAt: draftAt });
  expect(await f.port.restore(scope, acquired.hold, acquired.current)).toMatchObject({
    kind: 'RESTORED',
    current: { state: 'available', providerVersion: restoredAt },
  });
  expect(f.writes().map((w) => w.variables.product.status)).toEqual(['DRAFT', 'ACTIVE']);
});

test.each(['2026-10-01T11:59:59.999Z', 'not-a-date', '2026-10-01T13:00:00.000Z'])(
  'R1 malformed/reversed/future receipt %s rejects a held journal before dispatch',
  async (receivedAt) => {
    const f = fixture([read()]);
    const before = await f.port.snapshot(scope, productId);
    await expect(f.port.acquire(scope, intent({ ...before, receivedAt }))).rejects.toMatchObject({
      kind: 'invalid_request',
    });
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  },
);
