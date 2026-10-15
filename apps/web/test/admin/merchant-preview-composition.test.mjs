import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createMerchantPublicationCapture } from '../../src/server/admin/merchant-previews.ts';

const actor = {
  tenantShopId: 'preview-tenant',
  installationGeneration: '1',
  canRead: true,
  canEdit: true,
  expiresAtMs: Date.now() + 3600000,
};
const image = { revisionId: 'product_42', width: 10, height: 20 };
const request = {
  productId: 'gid://shopify/Product/42',
  configId: 'cfg',
  draftVersion: '2',
  idempotencyKey: 'publish-one',
  draft: {
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
const digest = (b) => createHash('sha256').update(b).digest('hex');
function fixture() {
  const rows = new Map();
  const objects = new Map();
  let reads = 0;
  let inspections = 0;
  const input = {
    store: {
      get: async (_scope, id) => rows.get(id) ?? null,
      prepare: async (_scope, row) => {
        rows.set(row.assetId, row);
        return row;
      },
      beginCapture: async (_scope, id, claimId) => {
        const row = rows.get(id);
        row.state = 'WRITING';
        row.claimId = claimId;
        return true;
      },
      finishCapture: async (_scope, id) => {
        const row = rows.get(id);
        row.state = 'USABLE';
        row.claimId = null;
        return row;
      },
    },
    storage: async () => ({
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
    readProduct: async (_actor, productId) => ({ id: productId }),
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
  assert.match(first[0].assetId, /^[a-f0-9-]{36}$/);
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
    putImmutable: async () => {
      writes++;
      throw Error('acknowledgement lost');
    },
  });
  const capture = createMerchantPublicationCapture(f.input);
  await assert.rejects(capture(actor, request));
  assert.equal([...f.rows.values()][0].state, 'WRITING');
  await assert.rejects(createMerchantPublicationCapture(f.input)(actor, request), { code: 'UNRESOLVED' });
  assert.equal(writes, 1);
});

test('authorization changes and conflicting geometry never dispatch capture writes', async () => {
  const f = fixture();
  await assert.rejects(
    createMerchantPublicationCapture(f.input)({ ...actor, canEdit: false }, request),
    /authorization/,
  );
  const conflict = structuredClone(request);
  conflict.draft.geometry.views[1].image = { ...conflict.draft.geometry.views[1].image, width: 11 };
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
