import { describe, expect, it } from 'vitest';
import {
  createMerchantPreviewCapture,
  type MerchantPreviewCaptureInputs,
  type MerchantPreviewRecord,
  type MerchantPreviewStore,
} from './assets.js';

const scope = { shopId: 'shop-a', installationGeneration: '1', kind: 'merchant' as const };
const request = { assetId: 'ea49c7f9-e500-42bb-9c73-359c834b4ea0', productId: '42', imageRevisionId: 'product_42' };
const now = new Date('2026-10-15T02:00:00Z');
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const sha = '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6';
function fixture() {
  let row: MerchantPreviewRecord | null = null;
  let current = new Date(now);
  const calls: string[] = [],
    objects = new Map<string, Uint8Array>();
  const store: MerchantPreviewStore = {
    async get() {
      return row;
    },
    async prepare(_scope, input) {
      calls.push('prepare');
      row = structuredClone(input);
      return row;
    },
    async beginCapture(_scope, _id, claimId) {
      calls.push('begin');
      if (row?.state !== 'PREPARING') return false;
      row.state = 'WRITING';
      row.claimId = claimId;
      return true;
    },
    async finishCapture(_scope, _id, claimId) {
      calls.push('finish');
      if (!row || row.claimId !== claimId) throw Error('claim');
      row.state = 'USABLE';
      row.claimId = null;
      return row;
    },
    async selectCleanup() {
      return row && !['WRITING', 'DELETED'].includes(row.state) ? [row.assetId] : [];
    },
    async markDeleting() {
      if (!row || ['WRITING', 'DELETING', 'DELETED'].includes(row.state)) return null;
      row.state = 'DELETING';
      return row;
    },
    async readDeleting() {
      return row?.state === 'DELETING' ? row : null;
    },
    async finishDeleting() {
      calls.push('deleted');
      if (row) {
        row.state = 'DELETED';
        row.manifest = null;
      }
    },
  };
  const storage = {
    async putImmutable(input: { key: string; bytes: Uint8Array; contentType: string }) {
      calls.push(input.key.startsWith('originals/') ? 'put-original' : 'put-preview');
      objects.set(input.key, Uint8Array.from(input.bytes));
    },
    async read({ key }: { key: string; maxBytes: number }) {
      const bytes = objects.get(key);
      if (!bytes) throw Object.assign(Error('missing'), { code: 'NOT_FOUND' });
      return Uint8Array.from(bytes);
    },
    async remove({ key }: { key: string }) {
      calls.push('remove');
      objects.delete(key);
    },
  };
  const input: MerchantPreviewCaptureInputs = {
    store,
    storage,
    readImage: async () => Uint8Array.from(png),
    inspect: async () => ({
      version: 'm6-inspection-v1' as const,
      mimeType: 'image/png' as const,
      width: 100,
      height: 100,
      originalSha256: sha,
      preview: Uint8Array.from(png),
      previewMimeType: 'image/png' as const,
    }),
    clock: () => new Date(current),
  };
  return {
    input,
    calls,
    objects,
    row: () => row,
    setNow: (date: Date) => {
      current = date;
    },
  };
}
describe('merchant image capture', () => {
  it('records inspected identity before writing immutable original/PNG and settles only after both writes', async () => {
    const f = fixture();
    const result = await createMerchantPreviewCapture(f.input).capture(scope, request);
    expect(f.calls).toEqual(['prepare', 'begin', 'put-original', 'put-preview', 'finish']);
    expect(result).toMatchObject({
      ...request,
      shopId: 'shop-a',
      installationGeneration: '1',
      state: 'USABLE',
      claimId: null,
      collectedAt: now,
      abandonAt: new Date('2026-10-22T02:00:00Z'),
      manifest: { sha256: sha, previewSha256: sha, byteLength: 8, previewByteLength: 8 },
    });
    if (!result) throw Error('Expected capture');
    expect(f.objects.get(result.originalKey)).toEqual(png);
    expect(f.objects.get(result.previewKey)).toEqual(png);
  });
});

it('reuses a settled capture without another read/write or a new staging deadline', async () => {
  const f = fixture(),
    service = createMerchantPreviewCapture(f.input);
  const first = await service.capture(scope, request);
  const before = [...f.calls];
  f.setNow(new Date('2026-11-01T00:00:00Z'));
  expect(await service.capture(scope, request)).toEqual(first);
  expect(f.calls).toEqual(before);
  expect(f.row()?.abandonAt).toEqual(new Date('2026-10-22T02:00:00Z'));
});

it('never replays or cleans an unresolved original write, even long after the staging budget', async () => {
  const f = fixture();
  const write = f.input.storage.putImmutable;
  f.input.storage.putImmutable = async (input) => {
    await write(input);
    throw Error('lost storage response');
  };
  const service = createMerchantPreviewCapture(f.input);
  await expect(service.capture(scope, request)).rejects.toThrow('lost storage response');
  expect(f.row()?.state).toBe('WRITING');
  expect(f.objects.size).toBe(1);
  const before = [...f.calls];
  await expect(service.capture(scope, request)).rejects.toMatchObject({ code: 'UNRESOLVED' });
  f.setNow(new Date('2027-01-01T00:00:00Z'));
  expect(await service.cleanup()).toBe(0);
  expect(f.calls).toEqual(before);
  expect(f.objects.size).toBe(1);
});

it('does not write storage if durable ownership or the one-use capture claim fails', async () => {
  for (const refusal of ['prepare', 'claim']) {
    const f = fixture();
    if (refusal === 'prepare')
      f.input.store.prepare = async () => {
        throw Error('inactive installation');
      };
    else f.input.store.beginCapture = async () => false;
    await expect(createMerchantPreviewCapture(f.input).capture(scope, request)).rejects.toThrow();
    expect(f.objects.size).toBe(0);
    expect(f.calls.some((v) => v.startsWith('put'))).toBe(false);
  }
});

it('requires merchant scope and trustworthy inspection before creating custody or writing objects', async () => {
  const guest = fixture();
  await expect(
    createMerchantPreviewCapture(guest.input).capture({ ...scope, kind: 'guest' as 'merchant' }, request),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(guest.calls).toEqual([]);
  for (const change of [
    { originalSha256: '0'.repeat(64) },
    { width: 0 },
    { width: 12001 },
    { width: 10000, height: 10000 },
    { preview: Uint8Array.from([1, 2, 3]) },
  ]) {
    const f = fixture(),
      inspect = f.input.inspect;
    f.input.inspect = async (bytes) => ({ ...(await inspect(bytes)), ...change });
    await expect(createMerchantPreviewCapture(f.input).capture(scope, request)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    expect(f.calls).toEqual([]);
    expect(f.objects.size).toBe(0);
  }
  const missing = fixture();
  missing.input.readImage = async () => null;
  expect(await createMerchantPreviewCapture(missing.input).capture(scope, request)).toBeNull();
  expect(missing.calls).toEqual([]);
});

it('freezes original and safe preview bytes across inspection and durable preparation awaits', async () => {
  const f = fixture(),
    original = Uint8Array.from(png),
    preview = Uint8Array.from(png);
  f.input.readImage = async () => original;
  f.input.inspect = async (bytes) => {
    bytes.fill(0);
    return {
      version: 'm6-inspection-v1',
      mimeType: 'image/png',
      width: 100,
      height: 100,
      originalSha256: sha,
      preview,
      previewMimeType: 'image/png',
    };
  };
  const prepare = f.input.store.prepare;
  f.input.store.prepare = async (scope, row) => {
    original.fill(0);
    preview.fill(0);
    return prepare(scope, row);
  };
  const result = await createMerchantPreviewCapture(f.input).capture(scope, request);
  if (!result) throw Error('capture missing');
  expect(f.objects.get(result.originalKey)).toEqual(png);
  expect(f.objects.get(result.previewKey)).toEqual(png);
});

it('settles an acknowledged capture retired by generation drift and cleans only verified owned bytes', async () => {
  const f = fixture(),
    finish = f.input.store.finishCapture;
  f.input.store.finishCapture = async (...args) => {
    const row = await finish(...args);
    row.state = 'RETIRED';
    return row;
  };
  const service = createMerchantPreviewCapture(f.input);
  await expect(service.capture(scope, request)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(f.row()?.state).toBe('RETIRED');
  expect(f.objects.size).toBe(2);
  expect(await service.cleanup()).toBe(1);
  expect(f.objects.size).toBe(0);
  expect(f.row()).toMatchObject({ state: 'DELETED', manifest: null });
});

it('reconciles an uncertain DELETE only through absence and never repeats a mutation', async () => {
  const f = fixture(),
    service = createMerchantPreviewCapture(f.input);
  await service.capture(scope, request);
  const remove = f.input.storage.remove;
  f.input.storage.remove = async (input) => {
    await remove(input);
    throw Error('lost delete response');
  };
  await expect(service.cleanup()).rejects.toThrow('lost delete response');
  expect(f.row()?.state).toBe('DELETING');
  const before = [...f.calls];
  await expect(service.cleanup()).rejects.toMatchObject({ code: 'UNRESOLVED' });
  expect(f.calls).toEqual(before);
  // Independent provider settlement is simulated at this explicit storage boundary.
  f.objects.clear();
  expect(await service.cleanup()).toBe(1);
  expect(f.calls.filter((v) => v === 'remove')).toHaveLength(1);
  expect(f.row()?.state).toBe('DELETED');
});

it('does not delete mismatched object bytes or accept a DELETE acknowledgment as physical absence', async () => {
  const mismatched = fixture(),
    a = createMerchantPreviewCapture(mismatched.input);
  const row = await a.capture(scope, request);
  if (!row) throw Error('capture missing');
  mismatched.objects.set(row.originalKey, Uint8Array.from([1, 2]));
  await expect(a.cleanup()).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(mismatched.calls).not.toContain('remove');
  const retained = fixture(),
    b = createMerchantPreviewCapture(retained.input);
  await b.capture(scope, request);
  retained.input.storage.remove = async () => {
    retained.calls.push('remove');
  };
  await expect(b.cleanup()).rejects.toMatchObject({ code: 'UNRESOLVED' });
  expect(retained.calls).not.toContain('deleted');
  expect(retained.row()?.state).toBe('DELETING');
});

it('cleanup reporting preserves unresolved custody while continuing unrelated due assets', async () => {
  const blocked = fixture(),
    due = fixture();
  await createMerchantPreviewCapture(blocked.input).capture(scope, request);
  const second = { ...request, assetId: 'c386ec26-eb34-4c57-8dab-f80d29f3ff91' };
  await createMerchantPreviewCapture(due.input).capture(scope, second);
  const row = blocked.row();
  if (!row) throw Error('missing');
  row.state = 'DELETING'; // Explicit store-boundary double: a previous ambiguous deletion still has objects.
  const choose = (id: string) => (id === request.assetId ? blocked : due);
  const errors: string[] = [];
  const cleanup = createMerchantPreviewCapture({
    ...blocked.input,
    onCleanupError: (code) => {
      errors.push(code);
    },
    store: {
      ...blocked.input.store,
      selectCleanup: async () => [request.assetId, second.assetId],
      markDeleting: (id, at) => choose(id).input.store.markDeleting(id, at),
      readDeleting: (id) => choose(id).input.store.readDeleting(id),
      finishDeleting: (id, at) => choose(id).input.store.finishDeleting(id, at),
    },
    storage: {
      ...blocked.input.storage,
      read: (input) => (input.key.includes(second.assetId) ? due : blocked).input.storage.read(input),
      remove: (input) => (input.key.includes(second.assetId) ? due : blocked).input.storage.remove(input),
    },
  });
  expect(await cleanup.cleanup()).toBe(1);
  expect(errors).toEqual(['MERCHANT_PREVIEW_CLEANUP_UNAVAILABLE']);
  expect(blocked.row()?.state).toBe('DELETING');
  expect(blocked.calls).not.toContain('remove');
  expect(due.row()?.state).toBe('DELETED');
  expect(due.objects.size).toBe(0);
});
