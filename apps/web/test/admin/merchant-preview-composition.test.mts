import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import type { MerchantPreviewRecord } from '@insignia/application';
import { createCatalogImageReader } from '@insignia/shopify';
import { createMerchantPublicationCapture } from '../../src/server/admin/merchant-previews.ts';
import { adminActor, required, unexpected } from './support/fixtures.mts';

const actor = adminActor({
  tenantShopId: 'preview-tenant',
  installationGeneration: '1',
  canRead: true,
  canEdit: true,
  expiresAtMs: Date.now() + 3600000,
});
const image = { revisionId: 'product_42', width: 10, height: 20 };
const request = {
  productId: 'gid://shopify/Product/42',
  configId: 'cfg',
  draftVersion: '2',
  idempotencyKey: 'publish-one',
  draft: {
    version: 'm5-merchant-draft-v1' as const,
    mode: 'optional' as const,
    shopCurrency: 'USD',
    methods: [],
    placements: [],
    productionOptions: [],
    pricingRules: [],
    geometry: {
      views: [
        { image, variantImages: [{ variantId: '7', image: { ...image, revisionId: 'variant_7' } }] },
        { image, variantImages: [] },
      ],
    },
  },
};
const source = Buffer.from('<svg width="10" height="20"/>');
const preview = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const digest = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
function fixture() {
  const rows = new Map<string, MerchantPreviewRecord>();
  const objects = new Map<string, Buffer>();
  let reads = 0;
  let inspections = 0;
  const input: Parameters<typeof createMerchantPublicationCapture>[0] = {
    store: {
      getForRevision: unexpected,
      selectCleanup: unexpected,
      markDeleting: unexpected,
      readDeleting: unexpected,
      finishDeleting: unexpected,
      get: async (_scope, id) => rows.get(id) ?? null,
      prepare: async (_scope, row) => {
        rows.set(row.assetId, row);
        return row;
      },
      beginCapture: async (_scope, id, claimId) => {
        const row = required(rows.get(id));
        row.state = 'WRITING';
        row.claimId = claimId;
        return true;
      },
      finishCapture: async (_scope, id) => {
        const row = required(rows.get(id));
        row.state = 'USABLE';
        row.claimId = null;
        return row;
      },
    },
    storage: async () => ({
      presignUpload: unexpected,
      presignRead: unexpected,
      putImmutable: async ({ key, bytes }) => {
        objects.set(key, Buffer.from(bytes));
      },
      read: async () => {
        throw Error('not used');
      },
      remove: async () => {
        throw Error('not used');
      },
    }),
    current: async () => {},
    readProduct: async (_actor, productId) => ({
      id: productId,
      title: 'Synthetic',
      status: 'ACTIVE',
      image: null,
      variants: [],
      variantsTruncated: false,
    }),
    readImage: async () => {
      reads++;
      return source;
    },
    inspect: async () => {
      inspections++;
      return {
        version: 'm6-inspection-v1',
        mimeType: 'image/svg+xml',
        width: 10,
        height: 20,
        originalSha256: digest(source),
        preview,
        previewMimeType: 'image/png',
      };
    },
  };
  return {
    input,
    rows,
    objects,
    get reads() {
      return reads;
    },
    get inspections() {
      return inspections;
    },
  };
}
test('publication captures each selected image once and reuses frozen assets for the exact command', async () => {
  const f = fixture();
  const capture = createMerchantPublicationCapture(f.input);
  const first = await capture(actor, request);
  assert.equal(first.length, 2);
  assert.equal(f.objects.size, 4);
  assert.equal(f.reads, 2);
  assert.deepEqual(await createMerchantPublicationCapture(f.input)(actor, request), first);
  assert.equal(f.inspections, 2);
  assert.match(required(first[0]).assetId, /^[a-f0-9-]{36}$/);
});

test('missing images stay unavailable; dimension changes reject before storing an asset', async () => {
  const missing = fixture();
  missing.input.readImage = async () => null;
  assert.deepEqual(await createMerchantPublicationCapture(missing.input)(actor, request), []);
  assert.equal(missing.rows.size, 0);
  assert.equal(missing.objects.size, 0);
  const changed = fixture();
  const inspect = changed.input.inspect;
  changed.input.inspect = async (bytes) => ({ ...(await inspect(bytes)), width: 11 });
  await assert.rejects(createMerchantPublicationCapture(changed.input)(actor, request), /dimensions changed/);
  assert.equal(changed.rows.size, 0);
  assert.equal(changed.objects.size, 0);
});

test('lost storage acknowledgement preserves the same unresolved command asset without repeating writes', async () => {
  const f = fixture();
  let writes = 0;
  f.input.storage = async () => ({
    presignUpload: unexpected,
    presignRead: unexpected,
    read: unexpected,
    remove: unexpected,
    putImmutable: async () => {
      writes++;
      throw Error('acknowledgement lost');
    },
  });
  const capture = createMerchantPublicationCapture(f.input);
  await assert.rejects(capture(actor, request));
  assert.equal(required([...f.rows.values()][0]).state, 'WRITING');
  await assert.rejects(createMerchantPublicationCapture(f.input)(actor, request), { code: 'UNRESOLVED' });
  assert.equal(writes, 2, 'both independent in-flight captures settle once; retry dispatches no writes');
});

test('authorization changes and conflicting geometry never dispatch capture writes', async () => {
  const f = fixture();
  await assert.rejects(
    createMerchantPublicationCapture(f.input)({ ...actor, canEdit: false }, request),
    /authorization/,
  );
  const conflict = structuredClone(request);
  required(conflict.draft.geometry.views[1]).image = { ...required(conflict.draft.geometry.views[1]).image, width: 11 };
  await assert.rejects(createMerchantPublicationCapture(f.input)(actor, conflict), /dimensions conflict/);
  const read = f.input.readImage;
  f.input.readImage = async (...args) => {
    const bytes = await read(...args);
    f.input.current = async () => {
      throw Error('generation changed');
    };
    return bytes;
  };
  await assert.rejects(createMerchantPublicationCapture(f.input)(actor, request), /generation changed/);
  assert.equal(f.rows.size, 0);
  assert.equal(f.objects.size, 0);
});

test('gallery publication captures only authenticated product-owned gallery bytes and rejects forged image references', async () => {
  const f = fixture();
  const owned = {
    id: request.productId,
    title: 'Synthetic',
    status: 'ACTIVE' as const,
    image: null,
    variants: [],
    variantsTruncated: false,
    images: [
      {
        revisionId: 'image_12',
        image: { url: 'https://cdn.shopify.com/gallery.svg', alt: null, width: 10, height: 20 },
      },
    ],
  };
  const reader = createCatalogImageReader({
    lookup: async () => [{ address: '104.16.1.1', family: 4 }],
    request: (_url, _options, callback) => {
      const pending = new EventEmitter() as ClientRequest;
      pending.end = () => {
        const response = Readable.from([source]) as IncomingMessage;
        response.statusCode = 200;
        response.headers = { 'content-type': 'image/svg+xml', 'content-length': String(source.length) };
        Object.defineProperty(response, 'complete', { value: true });
        callback(response);
        return pending;
      };
      return pending;
    },
  });
  f.input.readProduct = async () => owned;
  f.input.readImage = async (product, revisionId) => (await reader.read(product, revisionId))?.bytes ?? null;
  const gallery = {
    ...request,
    draft: {
      ...request.draft,
      geometry: { views: [{ image: { ...image, revisionId: 'image_12' }, variantImages: [] }] },
    },
  };
  const captured = await createMerchantPublicationCapture(f.input)(actor, gallery);
  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.imageRevisionId, 'image_12');
  assert.equal(f.objects.size, 2);
  const forged = {
    ...gallery,
    draft: {
      ...gallery.draft,
      geometry: { views: [{ image: { ...image, revisionId: 'image_13' }, variantImages: [] }] },
    },
  };
  await assert.rejects(createMerchantPublicationCapture(f.input)(actor, forged), /INVALID_REFERENCE/);
  assert.equal(f.objects.size, 2);
});

test('rich products capture a bounded group of independent photos together and retain deterministic ordering', async () => {
  const f = fixture();
  const gates = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  let reads = 0;
  let inspecting = 0,
    maxInspecting = 0;
  const inspect = f.input.inspect;
  f.input.inspect = async (bytes) => {
    inspecting++;
    maxInspecting = Math.max(maxInspecting, inspecting);
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      return await inspect(bytes);
    } finally {
      inspecting--;
    }
  };
  f.input.readImage = async () => {
    if (++reads === 3) started.resolve();
    await gates.promise;
    return source;
  };
  const rich = {
    ...request,
    draft: {
      ...request.draft,
      geometry: {
        views: Array.from({ length: 7 }, (_, i) => ({
          image: { ...image, revisionId: `image_${i + 1}` },
          variantImages: [],
        })),
      },
    },
  };
  const pending = createMerchantPublicationCapture(f.input)(actor, rich);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      started.promise,
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => reject(Error('Independent photo reads remained serial')), 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  assert.equal(reads, 3);
  gates.resolve();
  const bindings = await pending;
  assert.deepEqual(
    bindings.map((binding) => binding.imageRevisionId),
    Array.from({ length: 7 }, (_, i) => `image_${i + 1}`),
  );
  assert.equal(f.inspections, 7);
  assert.equal(maxInspecting, 1, 'the native private host has one inspection slot');
  assert.deepEqual(await createMerchantPublicationCapture(f.input)(actor, rich), bindings);
  assert.equal(reads, 7);
});

test('a failed photo group drains started captures and never starts the next group', async () => {
  const f = fixture();
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  let reads = 0;
  f.input.readImage = async (_product, id) => {
    reads++;
    if (reads === 3) started.resolve();
    if (id === 'image_1') throw Error('photo unavailable');
    await gate.promise;
    return source;
  };
  const rich = {
    ...request,
    draft: {
      ...request.draft,
      geometry: {
        views: Array.from({ length: 7 }, (_, i) => ({
          image: { ...image, revisionId: `image_${i + 1}` },
          variantImages: [],
        })),
      },
    },
  };
  let settled = false;
  const captured = createMerchantPublicationCapture(f.input)(actor, rich).finally(() => {
    settled = true;
  });
  const rejected = assert.rejects(captured, /photo unavailable/);
  await started.promise;
  assert.equal(settled, false, 'failure must not leave sibling captures running after returning');
  assert.equal(reads, 3);
  gate.resolve();
  await rejected;
  assert.equal(reads, 3);
  assert.equal(f.rows.size, 2);
  assert.ok([...f.rows.values()].every((row) => row.state === 'USABLE'));
});
