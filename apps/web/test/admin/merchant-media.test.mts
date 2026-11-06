import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  type ArtworkStorage,
  MerchantPreviewError,
  type MerchantPreviewRecord,
  type MerchantPreviewStore,
} from '@insignia/application';
import { createMerchantMediaService, MerchantMediaError } from '../../src/server/admin/merchant-media.ts';
import { handleMerchantMediaRequest } from '../../src/server/admin/merchant-media-http.ts';
import { adminActor, adminServices, unexpected } from './support/fixtures.mts';

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const product = 'gid://shopify/Product/111';
function fixture() {
  let now = new Date('2026-11-05T12:00:00Z');
  let generation = '1';
  let inspections = 0;
  const actor = adminActor({
    tenantShopId: 'media-shop',
    shop: 'media.myshopify.com',
    installationGeneration: '1',
    canRead: true,
    canEdit: true,
    expiresAtMs: +now + 30 * 86400000,
  });
  const rows = new Map<string, MerchantPreviewRecord>();
  const objects = new Map<string, Uint8Array>();
  const referenced = new Set<string>();
  const store: MerchantPreviewStore = {
    getForRevision: unexpected,
    selectCleanup: unexpected,
    markDeleting: unexpected,
    readDeleting: unexpected,
    finishDeleting: unexpected,
    async get(scope, id) {
      const row = rows.get(id);
      return row?.shopId === scope.shopId && row.installationGeneration === scope.installationGeneration ? row : null;
    },
    async prepare(scope, row) {
      if (scope.installationGeneration !== generation) throw new MerchantPreviewError('UNAVAILABLE');
      const prior = rows.get(row.assetId);
      if (prior && (prior.manifest?.sha256 !== row.manifest?.sha256 || prior.productId !== row.productId))
        throw new MerchantPreviewError('CONFLICT');
      rows.set(row.assetId, prior ?? row);
      return prior ?? row;
    },
    async beginCapture(_scope, id, claim) {
      const row = rows.get(id);
      if (row?.state !== 'PREPARING') return false;
      row.state = 'WRITING';
      row.claimId = claim;
      return true;
    },
    async finishCapture(_scope, id, claim) {
      const row = rows.get(id);
      assert.ok(row);
      assert.equal(row.claimId, claim);
      row.state = 'USABLE';
      row.claimId = null;
      return row;
    },
  };
  const storage: ArtworkStorage = {
    presignUpload: unexpected,
    async presignRead({ key, expiresAt }) {
      return `https://storage.example/${encodeURIComponent(key)}?expires=${expiresAt.toISOString()}`;
    },
    async putImmutable({ key, bytes }) {
      const old = objects.get(key);
      if (old && sha(old) !== sha(bytes)) throw new Error('Immutable key conflict');
      objects.set(key, Uint8Array.from(bytes));
    },
    async read({ key }) {
      const data = objects.get(key);
      if (!data) throw new Error('Missing fixture object');
      return Uint8Array.from(data);
    },
    async remove({ key }) {
      objects.delete(key);
    },
  };
  const input: Parameters<typeof createMerchantMediaService>[0] = {
    appOrigin: 'https://app.example',
    store,
    storage: async () => storage,
    now: () => new Date(now),
    current: async (a) => {
      if (a.installationGeneration !== generation || !a.canRead) throw new Error('Authorization changed');
    },
    product: async (_actor, id) => ({ id }),
    draftImages: async () => [...referenced],
    inspect: async (bytes) => {
      inspections++;
      return {
        version: 'm6-inspection-v1',
        originalSha256: sha(bytes),
        width: 100,
        height: 120,
        mimeType: 'image/png',
        previewMimeType: 'image/png',
        preview: png,
      };
    },
  };
  return {
    actor,
    input,
    service: createMerchantMediaService(input),
    rows,
    objects,
    referenced,
    inspections: () => inspections,
    advance: (days: number) => {
      now = new Date(+now + days * 86400000);
    },
    changeGeneration: () => {
      generation = '2';
    },
  };
}

test('private garment uploads use inspected dimensions, stable metadata and exact byte-bound retry identities', async () => {
  const f = fixture();
  const id = randomUUID();
  const result = await f.service.upload(f.actor, product, id, png);
  assert.deepEqual(result.image, {
    id: `upload_${id}`,
    url: `https://app.example/api/admin/products/111/media/upload_${id}`,
    width: 100,
    height: 120,
    alt: '',
  });
  assert.ok(result.previewUrl.startsWith('https://storage.example/'));
  assert.equal(Date.parse(result.expiresAt), Date.parse('2026-11-05T12:03:00Z'));
  assert.equal(new URL(result.image.url).search, '');
  assert.deepEqual(await f.service.upload(f.actor, product, id, png), result);
  assert.equal(f.inspections(), 1);
  assert.equal(f.objects.size, 2);
  await assert.rejects(f.service.upload(f.actor, product, id, Uint8Array.from([...png, 0])), /CONFLICT/);
  assert.equal(f.inspections(), 1);
  assert.deepEqual(await f.service.readOriginal(f.actor, product, result.image.id), png);
  const row = f.rows.get(id);
  assert.ok(row);
  f.objects.set(row.originalKey, Uint8Array.from([...png, 1]));
  await assert.rejects(f.service.readOriginal(f.actor, product, result.image.id), /CONFLICT/);
});

test('private image hydration denies foreign products/tenants, stale generations and abandoned payloads', async () => {
  const f = fixture();
  const id = randomUUID();
  const image = (await f.service.upload(f.actor, product, id, png)).image.id;
  await assert.rejects(f.service.read(f.actor, 'gid://shopify/Product/222', [image]), /NOT_FOUND/);
  await assert.rejects(f.service.read({ ...f.actor, tenantShopId: 'foreign-shop' }, product, [image]), /NOT_FOUND/);
  f.advance(8);
  await assert.rejects(f.service.read(f.actor, product, [image]), /NOT_FOUND/);
  f.referenced.add(image);
  assert.equal((await f.service.read(f.actor, product, [image])).media[0]?.image.id, image);
  f.changeGeneration();
  await assert.rejects(f.service.read(f.actor, product, [image]), /Authorization changed/);
});

test('an authority change during inspection dispatches no storage writes', async () => {
  const f = fixture();
  const inspect = f.input.inspect;
  f.input.inspect = async (bytes) => {
    const value = await inspect(bytes);
    f.changeGeneration();
    return value;
  };
  await assert.rejects(f.service.upload(f.actor, product, randomUUID(), png), /Authorization changed/);
  assert.equal(f.objects.size, 0);
  assert.equal(f.rows.size, 0);
});

test('media HTTP requires verified product staff permission, same-origin writes and a truly bounded PNG body', async () => {
  const f = fixture();
  const services = adminServices({
    appOrigin: 'https://app.example',
    authenticate: async () => f.actor,
    media: f.service,
  });
  const request = (headers: Record<string, string> = {}, bytes: Uint8Array = png) =>
    new Request('https://app.example/api/admin/products/111/media', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer synthetic',
        Origin: 'https://app.example',
        'Content-Type': 'image/png',
        'Idempotency-Key': randomUUID(),
        'X-Insignia-Setup-Authority': 'a'.repeat(64),
        ...headers,
      },
      body: Buffer.from(bytes),
    });
  assert.equal((await handleMerchantMediaRequest(request({ Authorization: '' }), services, product)).status, 401);
  assert.equal(
    (await handleMerchantMediaRequest(request({ 'X-Insignia-Setup-Authority': '' }), services, product)).status,
    422,
  );
  assert.equal(
    (await handleMerchantMediaRequest(request({ Origin: 'https://evil.example' }), services, product)).status,
    403,
  );
  assert.equal(
    (await handleMerchantMediaRequest(request({ 'Content-Type': 'image/webp' }), services, product)).status,
    422,
  );
  assert.equal(
    (
      await handleMerchantMediaRequest(
        request({ 'Content-Length': '1' }, new Uint8Array(5 * 1024 * 1024 + 1)),
        services,
        product,
      )
    ).status,
    422,
  );
  assert.equal(f.rows.size, 0);
  const good = await handleMerchantMediaRequest(request(), services, product);
  assert.equal(good.status, 200);
  assert.equal(good.headers.get('Cache-Control'), 'private, no-store');
  const result = await good.json();
  const read = new Request(`https://app.example/api/admin/products/111/media?ids=${result.image.id}`, {
    headers: { Authorization: 'Bearer synthetic' },
  });
  assert.equal((await handleMerchantMediaRequest(read, services, product)).status, 200);
});

test('lost private-storage acknowledgement preserves unresolved upload custody without redispatching writes', async () => {
  const f = fixture();
  const storage = await f.input.storage();
  let writes = 0;
  f.input.storage = async () => ({
    ...storage,
    putImmutable: async (input) => {
      writes++;
      await storage.putImmutable(input);
      throw new Error('Lost storage acknowledgement');
    },
  });
  const id = randomUUID();
  await assert.rejects(f.service.upload(f.actor, product, id, png), /Lost storage acknowledgement/);
  assert.equal(f.rows.get(id)?.state, 'WRITING');
  await assert.rejects(f.service.upload(f.actor, product, id, png), /UNRESOLVED/);
  assert.equal(writes, 1);
});

test('a frozen media intent cannot move into a different authoring authority during token retry', async () => {
  const f = fixture();
  const current = f.input.current;
  f.input.current = async (actor, expectedAuthority) => {
    await current(actor);
    if (expectedAuthority !== 'a'.repeat(64)) throw new MerchantMediaError('AUTHORITY_CHANGED');
  };
  await assert.rejects(f.service.upload(f.actor, product, randomUUID(), png, 'b'.repeat(64)), /AUTHORITY_CHANGED/);
  assert.equal(f.rows.size, 0);
  assert.equal(f.objects.size, 0);
  const id = randomUUID();
  assert.equal((await f.service.upload(f.actor, product, id, png, 'a'.repeat(64))).image.id, `upload_${id}`);
});

test('session expiry after inspection cannot dispatch private object writes', async () => {
  const f = fixture();
  const inspect = f.input.inspect;
  const actor = { ...f.actor };
  f.input.inspect = async (bytes) => {
    const value = await inspect(bytes);
    actor.expiresAtMs = Date.parse('2026-11-05T11:59:59Z');
    return value;
  };
  await assert.rejects(f.service.upload(actor, product, randomUUID(), png), /NOT_FOUND/);
  assert.equal(f.rows.size, 0);
  assert.equal(f.objects.size, 0);
});
