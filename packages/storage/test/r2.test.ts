import { describe, expect, it } from 'vitest';
import { createR2ArtworkStorage } from '../src/index.js';

const now = new Date('2026-10-12T12:00:00Z');
const config = {
  endpoint: 'https://01234567890123456789012345678901.r2.cloudflarestorage.com',
  bucket: 'private-artwork',
  prefix: 'm6',
  accessKeyId: 'local-test-key',
  secretAccessKey: 'local-test-secret',
  clock: () => now,
};
describe('private artwork storage', () => {
  it('issues a five-minute MIME-pinned upload only inside quarantine', async () => {
    const storage = createR2ArtworkStorage(config);
    const grant = await storage.presignUpload({
      key: 'quarantine/shop/session',
      contentType: 'image/png',
      byteLength: 3,
      expiresAt: new Date(now.getTime() + 300_000),
    });
    const url = new URL(grant.url);
    expect(url.pathname).toBe('/private-artwork/m6/quarantine/shop/session');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    expect(grant.headers).toEqual({ 'content-type': 'image/png' });
    await expect(
      storage.presignUpload({
        key: 'originals/shop/revision',
        contentType: 'image/png',
        byteLength: 3,
        expiresAt: new Date(now.getTime() + 300_000),
      }),
    ).rejects.toThrow();
  });
});

it('rejects expiry, key escape, unsafe inline originals and remote endpoints', async () => {
  const storage = createR2ArtworkStorage(config);
  for (const key of [
    '',
    '../quarantine/a',
    'quarantine/../originals/a',
    'quarantine//a',
    'quarantine/a?x=1',
    'quarantine/%2e%2e/a',
    'https://evil/a',
  ]) {
    await expect(
      storage.presignUpload({
        key,
        contentType: 'image/png',
        byteLength: 3,
        expiresAt: new Date(now.getTime() + 60_000),
      }),
    ).rejects.toThrow();
  }
  for (const ms of [0, -1000, 301_000])
    await expect(
      storage.presignUpload({
        key: 'quarantine/a',
        contentType: 'image/png',
        byteLength: 3,
        expiresAt: new Date(now.getTime() + ms),
      }),
    ).rejects.toThrow();
  await expect(
    storage.presignRead({ key: 'originals/a', expiresAt: new Date(now.getTime() + 60_000) }),
  ).rejects.toThrow();
  await expect(
    storage.presignRead({ key: 'previews/a.svg', expiresAt: new Date(now.getTime() + 60_000) }),
  ).rejects.toThrow();
  expect(() => createR2ArtworkStorage({ ...config, endpoint: 'https://evil.example' })).toThrow();
});

it('issues attachment-only original and safe raster URLs with response MIME pinned', async () => {
  const storage = createR2ArtworkStorage(config);
  const original = new URL(
    await storage.presignRead({
      key: 'originals/a.svg',
      expiresAt: new Date(now.getTime() + 60_000),
      downloadFilename: 'artwork.svg',
    }),
  );
  expect(original.searchParams.get('response-content-type')).toBe('application/octet-stream');
  expect(original.searchParams.get('response-content-disposition')).toBe('attachment; filename="artwork.svg"');
  const preview = new URL(
    await storage.presignRead({ key: 'previews/a.png', expiresAt: new Date(now.getTime() + 60_000) }),
  );
  expect(preview.searchParams.get('response-content-type')).toBe('image/png');
});

it.each([undefined, '1', '100'])(
  'bounds streamed bytes despite declared length %s and cancels overrun',
  async (length) => {
    let cancelled = false;
    const storage = createR2ArtworkStorage({
      ...config,
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 3]));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: length ? { 'content-length': length } : {} },
        ),
    });
    await expect(storage.read({ key: 'quarantine/a', maxBytes: 2 })).rejects.toMatchObject({ code: 'TOO_LARGE' });
    expect(cancelled).toBe(true);
  },
);

it('reconciles an uncertain immutable write by actual bytes without redispatch', async () => {
  let puts = 0;
  const storage = createR2ArtworkStorage({
    ...config,
    fetchImpl: async (input) => {
      const request = input as Request;
      if (request.method === 'PUT') {
        puts++;
        throw new Error('lost acknowledgment');
      }
      return new Response(new Uint8Array([1, 2, 3]));
    },
  });
  await storage.putImmutable({ key: 'originals/a', bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' });
  expect(puts).toBe(1);
});

it('keeps unresolved writes unresolved if readback is unavailable', async () => {
  const storage = createR2ArtworkStorage({
    ...config,
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  await expect(
    storage.putImmutable({ key: 'originals/a', bytes: new Uint8Array([1]), contentType: 'image/png' }),
  ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
});

it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 5 * 1024 * 1024 + 1])(
  'does not issue an upload grant for invalid byte length %s',
  async (byteLength) => {
    await expect(
      createR2ArtworkStorage(config).presignUpload({
        key: 'quarantine/shop/session',
        contentType: 'image/png',
        byteLength,
        expiresAt: new Date(now.getTime() + 60_000),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  },
);
