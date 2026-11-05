import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSelectedProductMedia } from '../../src/islands/selected-product-media.ts';

const id = 'upload_11111111-1111-4111-8111-111111111111';
const image = { id, url: `https://insignia.test/api/admin/products/111/media/${id}`, width: 10, height: 10, alt: '' };
const descriptor = {
  image,
  previewUrl: 'https://private.test/preview.png',
  expiresAt: new Date(Date.now() + 60000).toISOString(),
};
function latch<T>() {
  let release: (value: T) => void = () => {
    throw new Error('Uninitialized latch');
  };
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
test('disposing while authenticated media metadata is pending aborts it and never reads private image bytes', async () => {
  const metadata = latch<unknown>();
  let reads = 0;
  let signal: AbortSignal | null | undefined;
  const media = createSelectedProductMedia('gid://shopify/Product/111', 'a'.repeat(64), {
    request: async (_path, init) => {
      signal = init?.signal;
      return metadata.promise;
    },
    fetchImpl: async () => {
      reads++;
      return new Response(new Blob(['image']), { headers: { 'Content-Type': 'image/png' } });
    },
  });
  const pending = media.hydrate([image]);
  media.dispose();
  metadata.release({ media: [descriptor] });
  await assert.rejects(pending, /abort|context|available/i);
  assert.equal(signal?.aborted, true);
  assert.equal(reads, 0);
});
test('disposing after private response headers rejects late body bytes before publishing a blob URL', async () => {
  const began = latch<void>();
  const body = latch<Uint8Array>();
  let signal: AbortSignal | null | undefined;
  const media = createSelectedProductMedia('gid://shopify/Product/111', 'a'.repeat(64), {
    request: async () => ({ media: [descriptor] }),
    fetchImpl: async (_url, init) => {
      signal = init?.signal;
      return new Response(
        new ReadableStream({
          async start(controller) {
            began.release();
            controller.enqueue(await body.promise);
            controller.close();
          },
        }),
        { headers: { 'Content-Type': 'image/png' } },
      );
    },
  });
  const pending = media.hydrate([image]);
  await began.promise;
  media.dispose();
  body.release(new Uint8Array([1, 2, 3]));
  await assert.rejects(pending, /abort|context|available/i);
  assert.equal(signal?.aborted, true);
  assert.throws(
    () => media.display({ id: '111', title: 'Shirt', images: [image], methods: [], views: [] }),
    /abort|context|available/i,
  );
});
test('owned media is canonicalized while active and all private blob access is revoked on dispose', async () => {
  let requests = 0;
  const media = createSelectedProductMedia('gid://shopify/Product/111', 'a'.repeat(64), {
    request: async () => {
      requests++;
      return { media: [descriptor] };
    },
    fetchImpl: async () => new Response(new Blob(['preview']), { headers: { 'Content-Type': 'image/png' } }),
  });
  const [preview] = await media.hydrate([image]);
  assert(preview);
  assert.match(preview.url, /^blob:/);
  assert.equal(requests, 1);
  assert.equal((await fetch(preview.url)).ok, true);
  assert.equal(
    media.canonical({ id: '111', title: 'Shirt', images: [preview], views: [], methods: [] }).images[0]?.url,
    image.url,
  );
  media.dispose();
  await assert.rejects(fetch(preview.url));
  await assert.rejects(media.hydrate([image]), /abort|context|available/i);
});
test('all JSON ownership requests use the caller denial boundary and preserve its403', async () => {
  let denied = 0;
  let fetched = 0;
  const error = Object.assign(new Error('Permission revoked'), { status: 403 });
  const media = createSelectedProductMedia('gid://shopify/Product/111', 'a'.repeat(64), {
    request: async () => {
      denied++;
      throw error;
    },
    fetchImpl: async () => {
      fetched++;
      throw new Error('Must not read private pixels');
    },
  });
  await assert.rejects(media.hydrate([image]), (candidate) => candidate === error);
  assert.equal(denied, 1);
  assert.equal(fetched, 0);
  media.dispose();
});
