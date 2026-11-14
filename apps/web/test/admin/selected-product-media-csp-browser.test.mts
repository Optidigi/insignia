import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { record, required } from './support/fixtures.mts';

test('picker-prepared data images upload and preview through the same origin under the product CSP', async (t) => {
  const bundle = await build({
    entryPoints: [
      new URL('../../../../frontend/admin/src/islands/selected-product-media.ts', import.meta.url).pathname,
    ],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
  });
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
    'base64',
  );
  const previews: { path: string; authorization: string | undefined }[] = [];
  const script = `import { createSelectedProductMedia } from '/helper.js';
    window.shopify = { idToken: async () => 'synthetic-session-token' };
    window.result = (async () => {
      const violations = [];
      document.addEventListener('securitypolicyviolation', event => {
        if (event.effectiveDirective === 'connect-src') violations.push(event.effectiveDirective);
      });
      const bitmap = await createImageBitmap(await (await fetch('/pixel.png')).blob());
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close();
      const prepared = { id: '11111111-1111-4111-8111-111111111111',
        url: canvas.toDataURL('image/webp', 0.85), width: 1, height: 1, alt: 'Product photo' };
      const writes = [];
      const media = createSelectedProductMedia('gid://shopify/Product/111', 'a'.repeat(64), {
        request: async (path, init) => {
          writes.push({ path, type: init.body.type, size: init.body.size,
            key: new Headers(init.headers).get('Idempotency-Key') });
          return { image: { id: 'upload_' + prepared.id, url: location.origin + '/owned-photo', width: 1, height: 1, alt: '' },
            previewUrl: 'https://private-storage.example/preview.png', expiresAt: new Date(Date.now() + 60000).toISOString() };
        }
      });
      try {
        const image = await media.upload(prepared);
        return { ok: true, imageId: image.id, preview: image.url.slice(0, 5), writes, violations };
      } catch (error) {
        return { ok: false, error: error.message, writes, violations };
      } finally { media.dispose(); }
    })();`;
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture').pathname;
    const preview = path.endsWith('/preview');
    if (preview) previews.push({ path, authorization: request.headers.authorization });
    response.setHeader(
      'Content-Type',
      path.endsWith('.js') ? 'text/javascript' : path.endsWith('.png') || preview ? 'image/png' : 'text/html',
    );
    // The real editor permits data images in img-src, not data requests in connect-src.
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' data: blob:",
    );
    response.end(
      path === '/helper.js'
        ? required(bundle.outputFiles[0]).text
        : path === '/run.js'
          ? script
          : path.endsWith('.png') || preview
            ? pixel
            : '<!doctype html><script type="module" src="/run.js"></script>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.waitForFunction(() => 'result' in window);
  const result = record(await page.evaluate(() => Reflect.get(window, 'result')));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.violations, []);
  assert(Array.isArray(result.writes));
  assert.equal(result.writes.length, 1);
  const write = record(result.writes[0]);
  assert.equal(write.type, 'image/png');
  assert(typeof write.size === 'number' && write.size > 8);
  assert.equal(write.key, '11111111-1111-4111-8111-111111111111');
  assert.equal(write.path, '/api/admin/products/111/media');
  assert.equal(result.imageId, 'upload_11111111-1111-4111-8111-111111111111');
  assert.equal(result.preview, 'blob:');
  assert.deepEqual(previews, [
    {
      path: '/api/admin/products/111/media/upload_11111111-1111-4111-8111-111111111111/preview',
      authorization: 'Bearer synthetic-session-token',
    },
  ]);
});
