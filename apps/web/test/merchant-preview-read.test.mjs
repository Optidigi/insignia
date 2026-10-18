import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFrozenPreviewReader } from '../src/server/merchant-preview/read.ts';

const now = new Date('2026-10-15T05:00:00Z');
const scope = { shopId: 'tenant-a', installationGeneration: '1' };
const geometry = {
  version: 'm5-geometry-v1',
  views: [
    { id: 'front', image: { revisionId: 'product_42', width: 600, height: 800 }, variantImages: [], placements: [] },
  ],
  steps: [],
};
const row = {
  ...scope,
  assetId: 'ea49c7f9-e500-42bb-9c73-359c834b4ea0',
  productId: '42',
  imageRevisionId: 'product_42',
  state: 'USABLE',
  claimId: null,
  previewKey: 'previews/merchant-previews/tenant-a/1/ea49c7f9-e500-42bb-9c73-359c834b4ea0.png',
  manifest: { version: 'm6-inspection-v1', width: 600, height: 800 },
};
test('frozen preview reader signs only the exact revision-bound derivative without reading a current catalog', async () => {
  const reads = [],
    signs = [];
  const read = createFrozenPreviewReader({
    store: {
      async getForRevision(authority, target) {
        reads.push({ authority, target });
        return [row];
      },
    },
    storage: {
      async presignRead(input) {
        signs.push(input);
        return 'https://private.example/frozen.png';
      },
    },
    clock: () => now,
  });
  assert.deepEqual(await read(scope, { productId: '42', revisionId: 'revision-a', geometry }), {
    product_42: 'https://private.example/frozen.png',
  });
  assert.deepEqual(reads, [{ authority: scope, target: { productId: '42', revisionId: 'revision-a' } }]);
  assert.deepEqual(signs, [{ key: row.previewKey, expiresAt: new Date('2026-10-15T05:01:00Z') }]);
});

test('buyer configuration uses the server-selected immutable revision rather than current catalog image URLs', async () => {
  const { createBuyerServices } = await import('../src/server/buyer/service.ts');
  const seen = [];
  const services = createBuyerServices({
    core: {
      buyers: {},
      acceptedQuotes: {
        getEffective: async () => ({
          config: {
            revisionId: 'revision-a',
            revisionContentHash: 'a'.repeat(64),
            methods: [],
            placements: [],
            productionOptions: [],
          },
        }),
      },
      configs: {
        getRevisionGeometry: async () => ({ value: geometry }),
        getRevisionPresentation: async () => ({ labels: {} }),
      },
    },
    guest: { resolve: async () => ({ ...scope, productId: '42' }) },
    catalog: async () => ({
      variants: [{ id: '7', label: 'Blue', available: true }],
      imageUrls: { product_42: 'https://cdn.example/current-changed.png' },
    }),
    configurationReady: async () => {},
    ports: () => {
      throw Error('No quote write in read');
    },
    previewImages: async (authority, target) => {
      seen.push({ authority, target });
      return { product_42: 'https://private.example/frozen.png' };
    },
  });
  const config = await services.config(new Request('https://app.example/config'));
  assert.deepEqual(config.imageUrls, { product_42: 'https://private.example/frozen.png' });
  assert.equal(seen[0].target.revisionId, 'revision-a');
  assert.deepEqual(seen[0].target.geometry, geometry);
  assert.equal(config.variants[0].id, '7');
});

test('merchant purchase projection reads the purchased revision and caps URLs at its private payload deadline', async () => {
  const { createPurchaseServices } = await import('../src/server/purchase/service.ts');
  const seen = [];
  const historicalGeometry = structuredClone(geometry);
  historicalGeometry.views[0].variantImages = [
    { variantId: 'variant_7', image: { revisionId: 'product_42', width: 600, height: 800 } },
  ];
  const purchase = {
    purchaseId: 'd841ee12-2075-4101-b3bc-429ad31a4059',
    orderId: 'gid://shopify/Order/1',
    orderCreatedAt: now.toISOString(),
    isTest: true,
    currency: 'USD',
    originalTotalMinor: '100',
    firstPaidAt: null,
    artworkVersion: 0,
    artworkState: 'PENDING_ARTWORK',
    refunds: [],
    artworkEvents: [],
    observations: [],
    bindings: [
      {
        lines: [],
        payloadExpiresAt: '2026-10-15T05:00:30Z',
        designPayload: {
          request: {
            groups: [
              {
                group: {
                  productId: '42',
                  configRevisionId: 'revision-a',
                  variants: [{ variantId: '7', quantity: 1 }],
                  design: { placements: [] },
                },
              },
            ],
          },
          revisions: [{ revisionId: 'revision-a', geometry: { value: historicalGeometry }, presentation: null }],
        },
      },
    ],
  };
  const services = createPurchaseServices({
    core: { purchases: { get: async () => purchase } },
    appOrigin: 'https://app.example',
    authenticate: async () => null,
    clock: () => now,
    previewImages: async (authority, target) => {
      seen.push({ authority, target });
      return { product_42: 'https://private.example/purchased.png' };
    },
  });
  const view = await services.get(
    {
      tenantShopId: 'tenant-a',
      installationGeneration: '1',
      expiresAtMs: now.getTime() + 60_000,
      canReadOrders: true,
      canReadArtwork: true,
    },
    purchase.purchaseId,
  );
  assert.deepEqual(view.groups[0].imageUrls, { product_42: 'https://private.example/purchased.png' });
  assert.equal(seen[0].target.revisionId, 'revision-a');
  assert.equal(seen[0].target.retainUntil.toISOString(), '2026-10-15T05:00:30.000Z');
  assert.deepEqual(seen[0].authority, { ...scope, kind: 'merchant' });
  assert.equal(view.groups[0].geometry.views[0].variantImages[0].variantId, '7');
  assert.equal(
    historicalGeometry.views[0].variantImages[0].variantId,
    'variant_7',
    'stored snapshot remains unchanged',
  );
});

test('missing, mismatched and unavailable frozen images remain absent instead of borrowing live imagery or object keys', async () => {
  for (const change of [
    { shopId: 'other' },
    { installationGeneration: '2' },
    { productId: '99' },
    { state: 'WRITING' },
    { state: 'DELETING' },
    { claimId: 'unresolved' },
    { manifest: null },
    { previewKey: 'previews/customer-private.png' },
    { imageRevisionId: 'variant_7' },
    { manifest: { ...row.manifest, width: 601 } },
  ]) {
    let signs = 0;
    const read = createFrozenPreviewReader({
      store: { getForRevision: async () => [{ ...row, ...change }] },
      storage: {
        presignRead: async () => {
          signs++;
          return 'https://private.example/forbidden.png';
        },
      },
      clock: () => now,
    });
    assert.deepEqual(await read(scope, { productId: '42', revisionId: 'revision-a', geometry }), {});
    assert.equal(signs, 0);
  }
  const read = createFrozenPreviewReader({
    store: { getForRevision: async () => [row] },
    storage: {
      presignRead: async () => {
        throw Error('Storage unavailable');
      },
    },
    clock: () => now,
  });
  assert.deepEqual(await read(scope, { productId: '42', revisionId: 'revision-a', geometry }), {});
});

test('preview links cannot extend the retained purchase payload lifetime and expired payloads perform no lookup', async () => {
  let lookups = 0;
  const signed = [];
  const read = createFrozenPreviewReader({
    store: {
      getForRevision: async () => {
        lookups++;
        return [row];
      },
    },
    storage: {
      presignRead: async (input) => {
        signed.push(input);
        return 'https://private.example/frozen.png';
      },
    },
    clock: () => now,
  });
  await read(scope, { productId: '42', revisionId: 'revision-a', geometry, retainUntil: new Date(+now + 30000) });
  assert.equal(signed[0].expiresAt.toISOString(), '2026-10-15T05:00:30.000Z');
  assert.deepEqual(await read(scope, { productId: '42', revisionId: 'revision-a', geometry, retainUntil: now }), {});
  assert.equal(lookups, 1);
});

test('a historical revision without captured bindings stays unavailable and never requests a storage URL', async () => {
  const read = createFrozenPreviewReader({
    store: { getForRevision: async () => [] },
    storage: {
      presignRead: async () => {
        throw Error('No image authority');
      },
    },
    clock: () => now,
  });
  assert.deepEqual(await read(scope, { productId: '42', revisionId: 'old-without-capture', geometry }), {});
});

test('an optional preview lookup failure degrades through buyer and purchase projections without changing their authority', async () => {
  const { createBuyerServices } = await import('../src/server/buyer/service.ts');
  const { createPurchaseServices } = await import('../src/server/purchase/service.ts');
  const previewImages = createFrozenPreviewReader({
    store: {
      getForRevision: async () => {
        throw Error('Preview read unavailable');
      },
    },
    storage: {
      presignRead: async () => {
        throw Error('No storage authority obtained');
      },
    },
    clock: () => now,
  });
  const buyer = createBuyerServices({
    core: {
      buyers: {},
      acceptedQuotes: {
        getEffective: async () => ({
          config: {
            revisionId: 'revision-a',
            revisionContentHash: 'a'.repeat(64),
            methods: [],
            placements: [],
            productionOptions: [],
          },
        }),
      },
      configs: {
        getRevisionGeometry: async () => ({ value: geometry }),
        getRevisionPresentation: async () => ({ labels: {} }),
      },
    },
    guest: { resolve: async () => ({ ...scope, productId: '42' }) },
    catalog: async () => ({
      variants: [{ id: '7', label: 'Blue', available: true }],
      imageUrls: { product_42: 'https://cdn.example/current.png' },
    }),
    configurationReady: async () => {},
    ports: () => {
      throw Error('No quote write');
    },
    previewImages,
  });
  const config = await buyer.config(new Request('https://app.example/config'));
  assert.equal(config.ready, true);
  assert.deepEqual(config.imageUrls, {});
  const purchase = createPurchaseServices({
    core: {
      purchases: {
        get: async () => ({
          purchaseId: 'd841ee12-2075-4101-b3bc-429ad31a4059',
          orderId: 'gid://shopify/Order/1',
          orderCreatedAt: now.toISOString(),
          isTest: true,
          currency: 'USD',
          originalTotalMinor: '100',
          firstPaidAt: null,
          artworkVersion: 0,
          artworkState: 'PENDING_ARTWORK',
          refunds: [],
          artworkEvents: [],
          observations: [],
          bindings: [
            {
              lines: [],
              payloadExpiresAt: '2026-10-15T05:00:30Z',
              designPayload: {
                request: {
                  groups: [
                    {
                      group: {
                        productId: '42',
                        configRevisionId: 'revision-a',
                        variants: [{ variantId: '7', quantity: 1 }],
                        design: { placements: [] },
                      },
                    },
                  ],
                },
                revisions: [{ revisionId: 'revision-a', geometry: { value: geometry }, presentation: null }],
              },
            },
          ],
        }),
      },
    },
    appOrigin: 'https://app.example',
    authenticate: async () => null,
    previewImages,
    clock: () => now,
  });
  const view = await purchase.get(
    {
      tenantShopId: 'tenant-a',
      installationGeneration: '1',
      expiresAtMs: now.getTime() + 60_000,
      canReadOrders: true,
      canReadArtwork: true,
    },
    'd841ee12-2075-4101-b3bc-429ad31a4059',
  );
  assert.deepEqual(view.groups[0].imageUrls, {});
  assert.equal(view.originalTotalMinor, '100');
});
