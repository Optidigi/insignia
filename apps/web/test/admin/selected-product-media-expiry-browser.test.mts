import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { record, required } from './support/fixtures.mts';

// Scope: the real built preview-media module in an isolated browser against a local stand-in for the presigned
// storage URL. Not a native R2 observation.

const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
  'base64',
);

const harness = `
import { createSelectedProductMedia } from '/helper.js';
const id = 'upload_11111111-1111-4111-8111-111111111111';
const image = { id, url: location.origin + '/api/admin/products/111/media/' + id, width: 1, height: 1, alt: '' };
const hour = 3600 * 1000;
/** Run one hydration. \`previews\` lists the preview path each successive descriptor request returns. */
window.scenario = async (previews, expiresAt) => {
  const requests = [];
  const media = createSelectedProductMedia('gid://shopify/Product/111', 'a'.repeat(64), {
    request: async (path) => {
      requests.push(path);
      const preview = previews[Math.min(requests.length - 1, previews.length - 1)];
      return { media: [{ image, previewUrl: location.origin + preview, expiresAt }] };
    },
  });
  let outcome;
  try {
    const hydrated = await media.hydrate([image]);
    outcome = { ok: true, blob: hydrated[0].url.startsWith('blob:') };
  } catch (error) {
    outcome = { ok: false, message: String(error.message) };
  }
  media.dispose();
  return { requests: requests.length, ...outcome };
};
const names = ['a', 'b', 'c'].map((letter) => 'upload_' + letter.repeat(8) + '-1111-4111-8111-111111111111');
const images = names.map((name) => ({ ...image, id: name, url: location.origin + '/api/admin/products/111/media/' + name }));
/** Three photos whose first descriptors are all refused: they must be re-described together. */
window.batch = async () => {
  const requests = [];
  const media = createSelectedProductMedia('gid://shopify/Product/111', 'a'.repeat(64), {
    request: async (path) => {
      requests.push(path);
      const preview = requests.length === 1 ? '/p/expired.png' : '/p/ok.png';
      return { media: images.map((entry) => ({ image: entry, previewUrl: location.origin + preview + '?' + entry.id, expiresAt: new Date(Date.now() + 180000).toISOString() })) };
    },
  });
  const hydrated = await media.hydrate(images);
  media.dispose();
  return { requests: requests.length, loaded: hydrated.filter((entry) => entry.url.startsWith('blob:')).length };
};
/** A preview that never answers: a disposed editor (abort) or the 10 s read deadline (timeout) is not a refusal. */
window.stalled = async (mode) => {
  let requests = 0;
  const media = createSelectedProductMedia('gid://shopify/Product/111', 'a'.repeat(64), {
    request: async () => {
      requests++;
      return { media: [{ image, previewUrl: location.origin + '/p/hang.png', expiresAt: new Date(Date.now() + 180000).toISOString() }] };
    },
  });
  const pending = media.hydrate([image]).then(() => null, (error) => error);
  if (mode === 'abort') {
    await new Promise((resolve) => setTimeout(resolve, 300));
    media.dispose();
  }
  const error = await pending;
  media.dispose();
  return { requests, failed: !!error, name: error?.name ?? null };
};
window.past = () => new Date(Date.now() - hour).toISOString();
window.future = () => new Date(Date.now() + 180000).toISOString();
`;

test('preview media follows the storage provider, not the browser clock', { timeout: 60000 }, async (t) => {
  const bundled = await build({
    entryPoints: [
      new URL('../../../../frontend/admin/src/islands/selected-product-media.ts', import.meta.url).pathname,
    ],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
  });
  const source = required(bundled.outputFiles[0]);
  const hits: Record<string, number> = {};
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture').pathname;
    hits[path] = (hits[path] ?? 0) + 1;
    if (path === '/helper.js') {
      response.setHeader('Content-Type', 'text/javascript');
      return response.end(source.text);
    }
    if (path === '/') {
      response.setHeader('Content-Type', 'text/html');
      return response.end(`<!doctype html><script type="module">${harness}</script>`);
    }
    // An expired presigned URL is refused by the storage provider.
    if (path === '/p/expired.png') {
      response.statusCode = 403;
      return response.end('<Error><Code>AccessDenied</Code></Error>');
    }
    if (path === '/p/hang.png') return;
    // A refusal that carries no cross-origin permission surfaces in the browser as a failed fetch.
    if (path === '/p/dropped.png') return request.socket.destroy();
    response.setHeader('Content-Type', 'image/png');
    response.end(pixel);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.waitForFunction(() => typeof Reflect.get(window, 'scenario') === 'function');
  const run = async (previews: string[], when: 'past' | 'future') =>
    record(
      await page.evaluate(([list, expiry]) => Reflect.get(window, 'scenario')(list, Reflect.get(window, expiry)()), [
        previews,
        when,
      ] as const),
    );

  // A descriptor that is "expired" by the browser clock (a fast clock) but still valid at the provider loads at once.
  const skewed = await run(['/p/ok.png'], 'past');
  assert.deepEqual(skewed, { requests: 1, ok: true, blob: true });
  assert.equal(hits['/p/ok.png'], 1);

  // A URL the provider refuses is replaced once by a fresh descriptor of the same photo.
  const refreshed = await run(['/p/expired.png', '/p/ok.png'], 'future');
  assert.deepEqual(refreshed, { requests: 2, ok: true, blob: true });
  assert.equal(hits['/p/expired.png'], 1);

  // Also when the refusal reaches the browser only as a failed fetch.
  const dropped = await run(['/p/dropped.png', '/p/ok.png'], 'past');
  assert.deepEqual(dropped, { requests: 2, ok: true, blob: true });

  // A second refusal is final: one refresh, no loop.
  const refused = await run(['/p/expired.png'], 'future');
  assert.equal(refused.ok, false);
  assert.equal(refused.requests, 2);
  assert.equal(hits['/p/expired.png'], 3);

  // Several refused photos are re-described in one request, not one per photo.
  const batch = record(await page.evaluate(() => Reflect.get(window, 'batch')()));
  assert.deepEqual(batch, { requests: 2, loaded: 3 });

  // An abort (the editor went away) and the read deadline are not refusals: no second descriptor request.
  const aborted = record(await page.evaluate(() => Reflect.get(window, 'stalled')('abort')));
  assert.deepEqual(aborted, { requests: 1, failed: true, name: 'AbortError' });
  const timedOut = record(await page.evaluate(() => Reflect.get(window, 'stalled')('timeout')));
  assert.deepEqual(timedOut, { requests: 1, failed: true, name: 'TimeoutError' });
});
