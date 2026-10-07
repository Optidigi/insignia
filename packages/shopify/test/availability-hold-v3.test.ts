import type { AvailabilityScope } from '@insignia/application';
import { expect, test, vi } from 'vitest';
import { createShopifyAvailabilityHoldV3Port } from '../src/availability-hold-v3.js';

const scope: AvailabilityScope = {
  shopId: 'synthetic-shop',
  installationGeneration: '7',
  shopifyShopId: 'gid://shopify/Shop/101',
  appClientId: 'a'.repeat(32),
};
const productId = 'gid://shopify/Product/202',
  publicationId = 'gid://shopify/Publication/303';
const now = () => new Date('2026-10-07T12:00:00.000Z');
const complete = { hasNextPage: false, hasPreviousPage: false };
const identity = {
  shop: { id: scope.shopifyShopId },
  currentAppInstallation: {
    app: { apiKey: scope.appClientId },
    accessScopes: ['read_products', 'write_products', 'read_publications'].map((handle) => ({ handle })),
  },
};
const product = (status = 'ACTIVE') => ({
  __typename: 'Product',
  id: productId,
  status,
  updatedAt: '2026-10-07T11:00:00Z',
  publishedAt: null,
  onlineStoreUrl: null,
  resourcePublications: {
    nodes:
      status === 'ACTIVE'
        ? [{ publication: { id: publicationId }, isPublished: true, publishDate: '2026-10-07T10:00:00Z' }]
        : [],
    pageInfo: complete,
  },
});
const anchor = () => ({
  __typename: 'Publication',
  id: publicationId,
  autoPublish: true,
  supportsFuturePublishing: false,
  includedProducts: { nodes: [{ id: productId }], pageInfo: complete },
});
test('PR47 hidden effective Publication is qualified by direct anchor without generic discovery', async () => {
  const requests: { query: string; variables: Record<string, unknown> }[] = [];
  const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    requests.push(request);
    const data = request.query.includes('nodes(ids:')
      ? { ...identity, nodes: [anchor()] }
      : request.query.includes('publication(id:')
        ? { ...identity, publication: anchor() }
        : { ...identity, node: product(), publications: { nodes: [], pageInfo: { ...complete, endCursor: null } } };
    return new Response(JSON.stringify({ data }), { status: 200 });
  });
  const port = createShopifyAvailabilityHoldV3Port({
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
    now,
    timeoutMs: 10000,
  });
  const before = await port.snapshot(scope, productId);
  expect(before).toMatchObject({
    version: 'm5-product-availability-snapshot-v3',
    state: 'available',
    effectiveVisibility: { publishedPublicationIds: [publicationId] },
    effectiveAnchors: [
      { publicationId, resolved: true, productIncluded: true, autoPublish: true, supportsFuturePublishing: false },
    ],
  });
  expect(before).not.toHaveProperty('configuredIntent');
  expect(requests.every((r) => !r.query.includes('publications(') && !r.query.includes('catalogs('))).toBe(true);
});

test('acquire preserves the hidden anchor and accepts distinct ACK/readback updatedAt diagnostics', async () => {
  let state = 'ACTIVE',
    writes = 0;
  const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const r = JSON.parse(String(init?.body));
    if (r.query.startsWith('mutation')) {
      writes++;
      state = r.variables.product.status;
      return new Response(
        JSON.stringify({
          data: {
            productUpdate: {
              product: {
                ...product(state),
                updatedAt: '2026-10-07T11:00:01Z',
              },
              userErrors: [],
            },
          },
        }),
      );
    }
    return new Response(
      JSON.stringify({
        data: r.query.includes('publication(id:')
          ? { ...identity, publication: anchor() }
          : {
              ...identity,
              node: {
                ...product(state),
                updatedAt: state === 'DRAFT' ? '2026-10-07T11:00:02Z' : '2026-10-07T11:00:00Z',
              },
            },
      }),
    );
  });
  const port = createShopifyAvailabilityHoldV3Port({
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
    now,
    timeoutMs: 10000,
  });
  const before = await port.snapshot(scope, productId);
  if (before.version !== 'm5-product-availability-snapshot-v3') throw new Error('wrong snapshot');
  const result = await port.acquire(scope, {
    version: 'm5-availability-hold-v3',
    operationId: 'operation-v3-1',
    before,
    held: null,
  });
  expect(result.kind).toBe('HELD');
  expect(writes).toBe(1);
  if (result.kind !== 'HELD' || result.hold.version !== 'm5-availability-hold-v3') throw new Error('not held');
  expect(result.hold.held?.effectiveAnchors).toEqual(before.effectiveAnchors);
  expect(result.hold.held?.effectiveVisibility.publishedPublicationIds).toEqual([]);
  expect(result.hold.acquisitionAcknowledgement?.providerUpdatedAt).toBe('2026-10-07T11:00:01.000Z');
  expect(result.hold.held?.providerUpdatedAt).toBe('2026-10-07T11:00:02.000Z');
});

type Scenario = {
  ackNonEffective?: 'acquire' | 'restore' | 'compensate';
  ackTiming?: { phase: 'acquire' | 'restore' | 'compensate'; publishDate: string; isPublished: boolean };
  missingAfterRestore?: boolean;
  extraAfterRestore?: boolean;
  onlineAfterRestore?: boolean;
  unsupportedAfterRestore?: boolean;
  unsupportedBefore?: boolean;
  ambiguous?: 'acquire' | 'restore' | 'compensate';
  removedAfterAcquire?: boolean;
  futureCapable?: boolean;
};
function lifecycle(options: Scenario = {}) {
  let clock = options.ackTiming ? new Date('2026-10-07T12:09:54.968Z') : now();
  let state = 'ACTIVE',
    capabilityDrift = false,
    effectWhileHeld = false;
  const writes: string[] = [],
    requests: { query: string; variables: Record<string, unknown> }[] = [];
  const other = 'gid://shopify/Publication/304';
  const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const r = JSON.parse(String(init?.body));
    requests.push(r);
    if (r.query.startsWith('mutation')) {
      state = r.variables.product.status;
      writes.push(state);
      if (
        (writes.length === 1 && options.ambiguous === 'acquire') ||
        (writes.length === 2 && options.ambiguous === 'restore') ||
        (writes.length === 3 && options.ambiguous === 'compensate')
      )
        throw new Error('synthetic lost response');
      const timing = options.ackTiming;
      const timed = timing && writes.length === { acquire: 1, restore: 2, compensate: 3 }[timing.phase];
      if (timed) clock = new Date('2026-10-07T12:09:57.978Z');
      return new Response(
        JSON.stringify({
          data: {
            productUpdate: {
              product: {
                ...product(state),
                updatedAt: '2026-10-07T11:00:01Z',
                ...(timed
                  ? {
                      resourcePublications: {
                        nodes: [
                          ...product(state).resourcePublications.nodes,
                          {
                            publication: { id: other },
                            isPublished: timing.isPublished,
                            publishDate: timing.publishDate,
                          },
                        ],
                        pageInfo: complete,
                      },
                    }
                  : {}),
                ...((writes.length === 1 && options.ackNonEffective === 'acquire') ||
                (writes.length === 2 && options.ackNonEffective === 'restore') ||
                (writes.length === 3 && options.ackNonEffective === 'compensate')
                  ? {
                      resourcePublications: {
                        nodes: [
                          ...product(state).resourcePublications.nodes,
                          { publication: { id: other }, isPublished: false, publishDate: '2099-01-01T00:00:00Z' },
                        ],
                        pageInfo: complete,
                      },
                    }
                  : {}),
              },
              userErrors: [],
            },
          },
        }),
      );
    }
    const publication = {
      ...anchor(),
      id: r.variables.publicationId,
      autoPublish: !capabilityDrift,
      supportsFuturePublishing: options.futureCapable ?? false,
      ...(options.removedAfterAcquire && writes.length ? { includedProducts: { nodes: [], pageInfo: complete } } : {}),
    };
    const projected = product(state);
    if (options.missingAfterRestore && writes.includes('ACTIVE') && state === 'ACTIVE')
      projected.resourcePublications.nodes = [];
    if (options.extraAfterRestore && writes.includes('ACTIVE') && state === 'ACTIVE')
      projected.resourcePublications.nodes.push({
        publication: { id: other },
        isPublished: true,
        publishDate: '2026-10-07T11:30:00Z',
      });
    if (
      (options.unsupportedAfterRestore && writes.includes('ACTIVE') && state === 'ACTIVE') ||
      (options.unsupportedBefore && state === 'ACTIVE')
    )
      projected.resourcePublications.nodes.push({
        publication: { id: other },
        isPublished: false,
        publishDate: '2026-10-08T11:30:00Z',
      });
    if (effectWhileHeld && state === 'DRAFT')
      projected.resourcePublications.nodes = [
        { publication: { id: publicationId }, isPublished: true, publishDate: '2026-10-07T11:30:00Z' },
      ];
    const node = {
      ...projected,
      ...(options.onlineAfterRestore && writes.includes('ACTIVE') && state === 'ACTIVE'
        ? { publishedAt: '2026-10-07T11:30:00Z', onlineStoreUrl: 'https://synthetic.example/products/fixture' }
        : {}),
      updatedAt: '2026-10-07T11:00:02Z',
    };
    return new Response(
      JSON.stringify({
        data: r.query.includes('publication(id:') ? { ...identity, publication } : { ...identity, node },
      }),
    );
  });
  const config = {
    credentials: {
      acquire: async () => ({
        kind: 'usable' as const,
        shopDomain: 'synthetic.myshopify.com',
        accessToken: 'synthetic-token',
        accessExpiresAt: new Date('2099-01-01T00:00:00Z'),
      }),
    },
    isCurrent: async () => true,
    fetchImpl: fetchImpl as typeof fetch,
    now: () => clock,
    timeoutMs: 10000,
  };
  const port = createShopifyAvailabilityHoldV3Port(config);
  return {
    port,
    writes,
    requests,
    fresh: () => createShopifyAvailabilityHoldV3Port(config),
    driftCapabilities: () => {
      capabilityDrift = true;
    },
    appearEffective: () => {
      effectWhileHeld = true;
    },
  };
}
async function acquiredFixture(options: Scenario = {}) {
  const f = lifecycle(options),
    before = await f.port.snapshot(scope, productId);
  if (before.version !== 'm5-product-availability-snapshot-v3') throw new Error('wrong snapshot');
  const acquired = await f.port.acquire(scope, {
    version: 'm5-availability-hold-v3',
    operationId: 'fixture-v3',
    before,
    held: null,
  });
  if (acquired.kind !== 'HELD' || acquired.hold.version !== 'm5-availability-hold-v3') throw new Error('not held');
  const hold = {
    ...acquired.hold,
    restorationClaim: {
      version: 'm5-availability-restoration-claim-v3' as const,
      scope,
      operationId: 'fixture-v3',
      productId,
      restoreReserved: true as const,
      compensationReserved: true as const,
    },
  };
  return { ...f, hold, current: acquired.current };
}
test('restore returns exact original effective membership despite different diagnostic timestamps', async () => {
  const { port, writes } = lifecycle();
  const before = await port.snapshot(scope, productId);
  if (before.version !== 'm5-product-availability-snapshot-v3') throw new Error('wrong snapshot');
  const acquired = await port.acquire(scope, {
    version: 'm5-availability-hold-v3',
    operationId: 'restore-1',
    before,
    held: null,
  });
  if (acquired.kind !== 'HELD' || acquired.hold.version !== 'm5-availability-hold-v3') throw new Error('not held');
  const hold = {
    ...acquired.hold,
    restorationClaim: {
      version: 'm5-availability-restoration-claim-v3' as const,
      scope,
      operationId: 'restore-1',
      productId,
      restoreReserved: true as const,
      compensationReserved: true as const,
    },
  };
  const restored = await port.restore(scope, hold, acquired.current, () => true);
  expect(restored.kind).toBe('RESTORED');
  expect(restored.current?.version).toBe('m5-product-availability-snapshot-v3');
  expect(writes).toEqual(['DRAFT', 'ACTIVE']);
});

test('settled active restore with missing membership is compensated once and never restored again', async () => {
  const { port, writes } = lifecycle({ missingAfterRestore: true });
  const before = await port.snapshot(scope, productId);
  if (before.version !== 'm5-product-availability-snapshot-v3') throw new Error('wrong snapshot');
  const acquired = await port.acquire(scope, {
    version: 'm5-availability-hold-v3',
    operationId: 'compensate-1',
    before,
    held: null,
  });
  if (acquired.kind !== 'HELD' || acquired.hold.version !== 'm5-availability-hold-v3') throw new Error('not held');
  const hold = {
    ...acquired.hold,
    restorationClaim: {
      version: 'm5-availability-restoration-claim-v3' as const,
      scope,
      operationId: 'compensate-1',
      productId,
      restoreReserved: true as const,
      compensationReserved: true as const,
    },
  };
  const result = await port.restore(scope, hold, acquired.current, () => true);
  expect(result.kind).toBe('REHELD_CONFLICT');
  if (result.current?.version !== 'm5-product-availability-snapshot-v3' || !('compensation' in result))
    throw new Error('no audit');
  expect(result.current.state).toBe('unavailable');
  expect(result.compensation?.mismatch).toContain('effective_publication_ids');
  expect(result.compensation?.restored.state).toBe('available');
  expect(result.compensation?.acknowledgement?.state).toBe('unavailable');
  expect(writes).toEqual(['DRAFT', 'ACTIVE', 'DRAFT']);
  await expect(port.restore(scope, hold, acquired.current, () => true)).rejects.toMatchObject({
    kind: 'ambiguous_write',
  });
  expect(writes).toEqual(['DRAFT', 'ACTIVE', 'DRAFT']);
});

test.each(['extraAfterRestore', 'onlineAfterRestore', 'unsupportedAfterRestore'] as const)(
  'settled %s mismatch reholds exactly once',
  async (scenario) => {
    const f = await acquiredFixture({ [scenario]: true });
    const result = await f.port.restore(scope, f.hold, f.current, () => true);
    expect(result.kind).toBe('REHELD_CONFLICT');
    expect(f.writes).toEqual(['DRAFT', 'ACTIVE', 'DRAFT']);
    expect(result.current?.state).toBe('unavailable');
  },
);
test('lost restore ACK never compensates or retries even when provider status became ACTIVE', async () => {
  const f = await acquiredFixture({ ambiguous: 'restore' });
  const result = await f.port.restore(scope, f.hold, f.current, () => true);
  expect(result.kind).toBe('RESTORATION_PENDING');
  expect(result.current).toBeNull();
  expect(f.writes).toEqual(['DRAFT', 'ACTIVE']);
  const count = f.requests.length;
  await expect(f.port.restore(scope, f.hold, f.current, () => true)).rejects.toMatchObject({ kind: 'ambiguous_write' });
  expect(f.requests).toHaveLength(count);
});
test('lost compensation ACK preserves restore audit and returns pending without retry', async () => {
  const f = await acquiredFixture({ missingAfterRestore: true, ambiguous: 'compensate' });
  const result = await f.port.restore(scope, f.hold, f.current, () => true);
  expect(result.kind).toBe('RESTORATION_PENDING');
  expect(f.writes).toEqual(['DRAFT', 'ACTIVE', 'DRAFT']);
  if (!('compensation' in result)) throw new Error('missing compensation audit');
  expect(result.compensation?.restoreAcknowledgement.state).toBe('available');
  expect(result.compensation?.acknowledgement).toBeNull();
});
test('lost acquisition is unattributable and adapter is quarantined without another observation', async () => {
  const f = lifecycle({ ambiguous: 'acquire' }),
    before = await f.port.snapshot(scope, productId);
  if (before.version !== 'm5-product-availability-snapshot-v3') throw new Error('wrong snapshot');
  const hold = { version: 'm5-availability-hold-v3' as const, operationId: 'lost-acquire', before, held: null };
  await expect(f.port.acquire(scope, hold)).rejects.toMatchObject({ kind: 'ambiguous_write' });
  const count = f.requests.length;
  await expect(f.port.acquire(scope, hold)).rejects.toMatchObject({ kind: 'ambiguous_write' });
  expect(f.requests).toHaveLength(count);
  expect(f.writes).toEqual(['DRAFT']);
});
test('unsupported legacy false prestate blocks acquire with zero status writes', async () => {
  const f = lifecycle({ unsupportedBefore: true }),
    before = await f.port.snapshot(scope, productId);
  if (before.version !== 'm5-product-availability-snapshot-v3') throw new Error('wrong snapshot');
  expect(
    (await f.port.acquire(scope, { version: 'm5-availability-hold-v3', operationId: 'scheduled', before, held: null }))
      .kind,
  ).toBe('CONFLICT');
  expect(f.writes).toEqual([]);
});
test('removed original inclusion after ACK conflicts without another mutation', async () => {
  const f = lifecycle({ removedAfterAcquire: true }),
    before = await f.port.snapshot(scope, productId);
  if (before.version !== 'm5-product-availability-snapshot-v3') throw new Error('wrong snapshot');
  expect(
    (await f.port.acquire(scope, { version: 'm5-availability-hold-v3', operationId: 'removed', before, held: null }))
      .kind,
  ).toBe('CONFLICT');
  expect(f.writes).toEqual(['DRAFT']);
});
test.each(['capability', 'effective'] as const)('held %s drift is conflict and never restored', async (kind) => {
  const f = await acquiredFixture();
  if (kind === 'capability') f.driftCapabilities();
  else f.appearEffective();
  expect((await f.port.observe(scope, f.hold)).kind).toBe('CONFLICT');
  expect((await f.port.restore(scope, f.hold, f.current, () => true)).kind).toBe('CONFLICT');
  expect(f.writes).toEqual(['DRAFT']);
});
test('fresh process observes exact persisted hold and unscheduled future-capable anchors restore', async () => {
  const f = await acquiredFixture({ futureCapable: true });
  const fresh = f.fresh(),
    persisted = JSON.parse(JSON.stringify(f.hold));
  const observed = await fresh.observe(scope, persisted);
  expect(observed.kind).toBe('HELD');
  if (observed.kind !== 'HELD') throw new Error('not held');
  expect((await fresh.restore(scope, persisted, observed.current, () => true)).kind).toBe('RESTORED');
  expect(f.writes).toEqual(['DRAFT', 'ACTIVE']);
});
test('missing durable restore claim or denied dispatch fence produces no restore mutation', async () => {
  const f = await acquiredFixture();
  const { restorationClaim: _, ...unclaimed } = f.hold;
  await expect(f.port.restore(scope, unclaimed, f.current, () => true)).rejects.toMatchObject({
    kind: 'invalid_request',
  });
  expect((await f.port.restore(scope, f.hold, f.current, () => false)).kind).toBe('NOT_DISPATCHED');
  expect(f.writes).toEqual(['DRAFT']);
});

test('held non-DRAFT intent without an acquisition ACK cannot be adopted after restart', async () => {
  const f = await acquiredFixture();
  const { acquisitionAcknowledgement: _, ...unattributed } = f.hold;
  const calls = f.requests.length;
  await expect(f.fresh().observe(scope, unattributed)).rejects.toMatchObject({ kind: 'invalid_request' });
  expect(f.requests).toHaveLength(calls);
});

const credentials = {
  acquire: async () => ({
    kind: 'usable' as const,
    shopDomain: 'synthetic.myshopify.com',
    accessToken: 'synthetic-token',
    accessExpiresAt: new Date('2099-01-01T00:00:00Z'),
  }),
};
test.each([
  null,
  { ...anchor(), id: 'gid://shopify/Publication/999' },
  { ...anchor(), includedProducts: { nodes: [], pageInfo: complete } },
  { ...anchor(), includedProducts: { nodes: [{ id: productId }, { id: productId }], pageInfo: complete } },
  { ...anchor(), includedProducts: { nodes: [{ id: productId }], pageInfo: { ...complete, hasNextPage: true } } },
  { ...anchor(), includedProducts: { nodes: [{ id: productId }], pageInfo: { ...complete, hasPreviousPage: true } } },
  { ...anchor(), autoPublish: 'true' },
  { ...anchor(), supportsFuturePublishing: null },
])('unqualified exact anchor fails closed before any mutation %#', async (publication) => {
  const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const r = JSON.parse(String(init?.body));
    expect(r.query).not.toMatch(/^mutation/);
    return Response.json({
      data: r.query.includes('publication(id:') ? { ...identity, publication } : { ...identity, node: product() },
    });
  });
  const port = createShopifyAvailabilityHoldV3Port({
    credentials,
    isCurrent: async () => true,
    fetchImpl: fetchImpl as typeof fetch,
    now,
  });
  await expect(port.snapshot(scope, productId)).rejects.toBeInstanceOf(Error);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
test('65 effective IDs exceed the engineering anchor guard before direct queries or mutation', async () => {
  const node = {
    ...product(),
    resourcePublications: {
      nodes: Array.from({ length: 65 }, (_, i) => ({
        publication: { id: `gid://shopify/Publication/${100 + i}` },
        isPublished: true,
        publishDate: '2026-10-07T10:00:00Z',
      })),
      pageInfo: complete,
    },
  };
  const fetchImpl = vi.fn(async () => Response.json({ data: { ...identity, node } }));
  const port = createShopifyAvailabilityHoldV3Port({
    credentials,
    isCurrent: async () => true,
    fetchImpl: fetchImpl as typeof fetch,
    now,
  });
  await expect(port.snapshot(scope, productId)).rejects.toMatchObject({ kind: 'provider_shape' });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
test.each(['shop', 'app', 'grants'] as const)(
  'wrong current %s identity rejects before direct resolution',
  async (change) => {
    const data = { ...structuredClone(identity), node: product() };
    if (change === 'shop') data.shop.id = 'gid://shopify/Shop/999';
    else if (change === 'app') data.currentAppInstallation.app.apiKey = 'b'.repeat(32);
    else data.currentAppInstallation.accessScopes = [];
    const fetchImpl = vi.fn(async () => Response.json({ data }));
    const port = createShopifyAvailabilityHoldV3Port({
      credentials,
      isCurrent: async () => true,
      fetchImpl: fetchImpl as typeof fetch,
      now,
    });
    await expect(port.snapshot(scope, productId)).rejects.toMatchObject({
      kind: change === 'grants' ? 'forbidden' : 'owner_mismatch',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  },
);
test('one high-level deadline expires before a slow response and permanently quarantines the adapter', async () => {
  let outbound = 0;
  const port = createShopifyAvailabilityHoldV3Port({
    credentials,
    isCurrent: async () => true,
    now,
    timeoutMs: 100,
    fetchImpl: (async () => {
      outbound++;
      await new Promise((r) => setTimeout(r, 150));
      return Response.json({ data: { ...identity, node: product() } });
    }) as typeof fetch,
  });
  await expect(port.snapshot(scope, productId)).rejects.toMatchObject({ kind: 'network_or_timeout' });
  await expect(port.snapshot(scope, productId)).rejects.toMatchObject({ kind: 'ambiguous_write' });
  await new Promise((r) => setTimeout(r, 160));
  expect(outbound).toBe(1);
});
test('expired credential preparation never reaches the external transport even when it later resolves', async () => {
  const fetchImpl = vi.fn(async () => Response.json({ data: { ...identity, node: product() } }));
  const port = createShopifyAvailabilityHoldV3Port({
    credentials: {
      acquire: async () => {
        await new Promise((r) => setTimeout(r, 150));
        return credentials.acquire();
      },
    },
    isCurrent: async () => true,
    now,
    timeoutMs: 100,
    fetchImpl: fetchImpl as typeof fetch,
  });
  await expect(port.snapshot(scope, productId)).rejects.toMatchObject({ kind: 'network_or_timeout' });
  await new Promise((r) => setTimeout(r, 160));
  expect(fetchImpl).not.toHaveBeenCalled();
});
test('oversized provider body fails closed under the same operation budget', async () => {
  const fetchImpl = vi.fn(async () => new Response(' '.repeat(128 * 1024 + 1)));
  const port = createShopifyAvailabilityHoldV3Port({
    credentials,
    isCurrent: async () => true,
    now,
    fetchImpl: fetchImpl as typeof fetch,
  });
  await expect(port.snapshot(scope, productId)).rejects.toMatchObject({ kind: 'provider_shape' });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
test('original exact DRAFT needs no acquire or restore mutation', async () => {
  const fetchImpl = vi.fn(async () => Response.json({ data: { ...identity, node: product('DRAFT') } }));
  const port = createShopifyAvailabilityHoldV3Port({
    credentials,
    isCurrent: async () => true,
    now,
    fetchImpl: fetchImpl as typeof fetch,
  });
  const before = await port.snapshot(scope, productId);
  if (before.version !== 'm5-product-availability-snapshot-v3') throw new Error('wrong version');
  const result = await port.acquire(scope, {
    version: 'm5-availability-hold-v3',
    operationId: 'draft',
    before,
    held: null,
  });
  if (result.kind !== 'HELD') throw new Error('not held');
  expect((await port.restore(scope, result.hold, result.current)).kind).toBe('RESTORED');
  expect(fetchImpl.mock.calls.every((call) => !String(call[1]?.body).includes('mutation '))).toBe(true);
});

test('quiescent wall-clock deadline expiry also denies every later provider request', async () => {
  let clock = now();
  const fetchImpl = vi.fn(async () => Response.json({ data: { ...identity, node: product() } }));
  const port = createShopifyAvailabilityHoldV3Port({
    now: () => clock,
    timeoutMs: 1000,
    isCurrent: async () => true,
    fetchImpl: fetchImpl as typeof fetch,
    credentials: {
      acquire: async () => {
        clock = new Date(clock.getTime() + 1001);
        return credentials.acquire();
      },
    },
  });
  await expect(port.snapshot(scope, productId)).rejects.toMatchObject({ kind: 'network_or_timeout' });
  await expect(port.snapshot(scope, productId)).rejects.toMatchObject({ kind: 'ambiguous_write' });
  expect(fetchImpl).not.toHaveBeenCalled();
});

for (const phase of ['acquire', 'restore'] as const) {
  test(`ACK-only unsupported legacy false evidence during ${phase} blocks success while retaining the settled receipt`, async () => {
    const f = lifecycle({ ackNonEffective: phase });
    const before = await f.port.snapshot(scope, productId);
    if (before.version !== 'm5-product-availability-snapshot-v3') throw new Error('wrong version');
    const acquired = await f.port.acquire(scope, {
      version: 'm5-availability-hold-v3',
      operationId: 'ack-schedule',
      before,
      held: null,
    });
    if (phase === 'acquire') {
      expect(acquired.kind).toBe('CONFLICT');
      if (acquired.kind !== 'CONFLICT') throw new Error('expected conflict');
      expect(acquired.acknowledgement?.effectiveVisibility.publicationEvidence.some((p) => !p.isPublished)).toBe(true);
      expect(f.writes).toEqual(['DRAFT']);
    } else {
      if (acquired.kind !== 'HELD' || acquired.hold.version !== 'm5-availability-hold-v3') throw new Error('not held');
      const hold = {
        ...acquired.hold,
        restorationClaim: {
          version: 'm5-availability-restoration-claim-v3' as const,
          operationId: 'ack-schedule',
          scope,
          productId,
          restoreReserved: true as const,
          compensationReserved: true as const,
        },
      };
      const restored = await f.port.restore(scope, hold, acquired.current, () => true);
      expect(restored.kind).toBe('CONFLICT');
      expect(restored.acknowledgement?.effectiveVisibility.publicationEvidence.some((p) => !p.isPublished)).toBe(true);
      expect(restored.compensation).toBeUndefined();
      expect(f.writes).toEqual(['DRAFT', 'ACTIVE']);
    }
  });
}
test('ACK-only unsupported legacy false evidence during compensation retains pending audit rather than claiming qualified rehold', async () => {
  const f = await acquiredFixture({ missingAfterRestore: true, ackNonEffective: 'compensate' });
  const result = await f.port.restore(scope, f.hold, f.current, () => true);
  expect(result.kind).toBe('RESTORATION_PENDING');
  expect(
    result.compensation?.acknowledgement?.effectiveVisibility.publicationEvidence.some((p) => !p.isPublished),
  ).toBe(true);
  expect(f.writes).toEqual(['DRAFT', 'ACTIVE', 'DRAFT']);
});

test('a persisted HELD record cannot adopt unsupported legacy false acquisition ACK evidence on a fresh adapter', async () => {
  const f = await acquiredFixture();
  const ack = f.hold.acquisitionAcknowledgement;
  if (!ack) throw new Error('missing acquisition ACK');
  const hold = {
    ...f.hold,
    acquisitionAcknowledgement: {
      ...ack,
      effectiveVisibility: {
        ...ack.effectiveVisibility,
        publicationEvidence: [
          ...ack.effectiveVisibility.publicationEvidence,
          {
            publicationId: 'gid://shopify/Publication/999',
            isPublished: false,
            publishDate: '2099-01-01T00:00:00.000Z',
          },
        ],
      },
    },
  };
  const requests = f.requests.length;
  await expect(f.fresh().observe(scope, hold)).rejects.toMatchObject({ kind: 'invalid_request' });
  await expect(f.fresh().restore(scope, hold, f.current, () => true)).rejects.toMatchObject({
    kind: 'invalid_request',
  });
  expect(f.requests).toHaveLength(requests);
  expect(f.writes).toEqual(['DRAFT']);
});

test('an unsupported legacy false original in persisted HELD state blocks fresh observe and restore before transport', async () => {
  const f = await acquiredFixture();
  const unsupported = {
    publicationId: 'gid://shopify/Publication/999',
    isPublished: false,
    publishDate: '2099-01-01T00:00:00.000Z',
  };
  const hold = {
    ...f.hold,
    before: {
      ...f.hold.before,
      effectiveVisibility: {
        ...f.hold.before.effectiveVisibility,
        publicationEvidence: [...f.hold.before.effectiveVisibility.publicationEvidence, unsupported],
      },
      visibleScheduledOrStaged: [unsupported],
    },
  };
  const requests = f.requests.length;
  await expect(f.fresh().observe(scope, hold)).rejects.toMatchObject({ kind: 'invalid_request' });
  await expect(f.fresh().restore(scope, hold, f.current, () => true)).rejects.toMatchObject({
    kind: 'invalid_request',
  });
  expect(f.requests).toHaveLength(requests);
  expect(f.writes).toEqual(['DRAFT']);
});

test('persisted original DRAFT must itself be held-safe before no-write restore can be attributed', async () => {
  const f = await acquiredFixture();
  const hold = { ...f.hold, before: { ...f.hold.before, state: 'unavailable' as const } };
  const requests = f.requests.length;
  await expect(f.fresh().observe(scope, hold)).rejects.toMatchObject({ kind: 'invalid_request' });
  await expect(f.fresh().restore(scope, hold, f.current, () => true)).rejects.toMatchObject({
    kind: 'invalid_request',
  });
  expect(f.requests).toHaveLength(requests);
  expect(f.writes).toEqual(['DRAFT']);
});

test('a retained acquisition ACK without an owned held receipt cannot recreate acquisition on a fresh port', async () => {
  const f = await acquiredFixture();
  const requests = f.requests.length;
  const result = await f.fresh().acquire(scope, { ...f.hold, held: null });
  expect(result).toEqual({ kind: 'CONFLICT', current: null, acknowledgement: f.hold.acquisitionAcknowledgement });
  expect(f.requests).toHaveLength(requests);
  expect(f.writes).toEqual(['DRAFT']);
});

for (const unsupportedAck of [false, true]) {
  test(`unheld original DRAFT with retained ${unsupportedAck ? 'unsupported legacy false' : 'qualified'} ACK cannot regain authority`, async () => {
    const f = await acquiredFixture();
    const ack = f.hold.acquisitionAcknowledgement;
    if (!ack) throw new Error('expected ACK');
    const hold = {
      ...f.hold,
      before: f.current,
      held: null,
      acquisitionAcknowledgement: unsupportedAck
        ? {
            ...ack,
            effectiveVisibility: {
              ...ack.effectiveVisibility,
              publicationEvidence: [
                {
                  publicationId: 'gid://shopify/Publication/999',
                  isPublished: false,
                  publishDate: '2099-01-01T00:00:00.000Z',
                },
              ],
            },
          }
        : ack,
    };
    const requests = f.requests.length;
    expect(await f.fresh().observe(scope, hold)).toEqual({
      kind: 'CONFLICT',
      current: null,
      acknowledgement: hold.acquisitionAcknowledgement,
    });
    expect(await f.fresh().restore(scope, hold, hold.before)).toEqual({
      kind: 'CONFLICT',
      current: null,
      acknowledgement: hold.acquisitionAcknowledgement,
    });
    expect(f.requests).toHaveLength(requests);
    expect(f.writes).toEqual(['DRAFT']);
  });
}

for (const [publishDate, blocking] of [
  ['2026-10-07T12:09:56.000Z', false],
  ['2026-10-07T12:09:57.978Z', false],
  ['2026-10-07T12:09:57.979Z', true],
] as const) {
  test(`production snapshot classifies publication ${publishDate} at completed receipt`, async () => {
    let clock = new Date('2026-10-07T12:09:54.968Z');
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      const node = product();
      node.resourcePublications.nodes[0]!.publishDate = publishDate;
      clock = new Date('2026-10-07T12:09:57.978Z');
      return Response.json({
        data: request.query.includes('publication(id:')
          ? { ...identity, publication: anchor() }
          : { ...identity, node },
      });
    });
    const port = createShopifyAvailabilityHoldV3Port({
      credentials,
      isCurrent: async () => true,
      fetchImpl: fetchImpl as typeof fetch,
      now: () => clock,
    });
    const current = await port.snapshot(scope, productId);
    if (current.version !== 'm5-product-availability-snapshot-v3') throw new Error('wrong version');
    expect(current.observedAt).toBe('2026-10-07T12:09:54.968Z');
    expect(current.receivedAt).toBe('2026-10-07T12:09:57.978Z');
    expect(current.visibleScheduledOrStaged).toHaveLength(blocking ? 1 : 0);
    expect(fetchImpl.mock.calls.every((call) => !String(call[1]?.body).includes('mutation '))).toBe(true);
  });
}

for (const phase of ['acquire', 'restore', 'compensate'] as const) {
  for (const control of [
    { name: 'canonical interval', publishDate: '2026-10-07T12:09:56.000Z', isPublished: true, qualified: true },
    { name: 'exact completion equality', publishDate: '2026-10-07T12:09:57.978Z', isPublished: true, qualified: true },
    { name: 'genuine future', publishDate: '2026-10-07T12:09:57.979Z', isPublished: true, qualified: false },
    {
      name: 'legacy false unsupported non-effective record',
      publishDate: '2026-10-07T12:09:56.000Z',
      isPublished: false,
      qualified: false,
    },
  ]) {
    test(`${phase} ACK completed timing: ${control.name}`, async () => {
      const options = {
        ackTiming: { phase, publishDate: control.publishDate, isPublished: control.isPublished },
        missingAfterRestore: phase === 'compensate',
      };
      if (phase === 'acquire') {
        const f = lifecycle(options);
        const before = await f.port.snapshot(scope, productId);
        if (before.version !== 'm5-product-availability-snapshot-v3') throw new Error('wrong version');
        const acquired = await f.port.acquire(scope, {
          version: 'm5-availability-hold-v3',
          operationId: 'timed-acquire',
          before,
          held: null,
        });
        expect(acquired.kind).toBe(control.qualified ? 'HELD' : 'CONFLICT');
        expect(f.writes).toEqual(['DRAFT']);
      } else {
        const f = await acquiredFixture(options);
        const restored = await f.port.restore(scope, f.hold, f.current, () => true);
        expect(restored.kind).toBe(
          phase === 'restore'
            ? control.qualified
              ? 'RESTORED'
              : 'CONFLICT'
            : control.qualified
              ? 'REHELD_CONFLICT'
              : 'RESTORATION_PENDING',
        );
        expect(f.writes).toEqual(phase === 'restore' ? ['DRAFT', 'ACTIVE'] : ['DRAFT', 'ACTIVE', 'DRAFT']);
        if (phase === 'restore') expect(restored.compensation).toBeUndefined();
      }
    });
  }
}
