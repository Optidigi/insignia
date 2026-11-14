import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { fixture } from './support/selected-browser.mts';

// Scope: real built UI/client/Polaris in an isolated browser with synthetic provider HTTP. The preview read-back is
// blocked the way a missing bucket CORS rule blocks it: the media POST succeeds, then the browser's GET fails.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
  'base64',
);

test('a stored photo whose preview cannot be read says so, and retrying the same file stores no second media row', {
  timeout: 45000,
}, async (t) => {
  const f = await fixture(t);
  const posts: { key: string | null; digest: string }[] = [];
  const stored = new Set<string>();
  let previewReads = 0;
  await f.page.route('**/api/admin/products/111/media', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') return route.fulfill({ status: 404, json: { error: 'No synthetic endpoint' } });
    const key = request.headers()['idempotency-key'] ?? null;
    posts.push({
      key,
      digest: createHash('sha256')
        .update(request.postDataBuffer() ?? '')
        .digest('hex'),
    });
    assert.ok(key);
    stored.add(key);
    return route.fulfill({
      status: 201,
      json: {
        image: {
          id: `upload_${key}`,
          url: `${f.base}/api/admin/products/111/media/upload_${key}`,
          width: 1,
          height: 1,
          alt: '',
        },
        previewUrl: `${f.base}/synthetic-private-preview.png`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
  });
  await f.page.route('**/synthetic-private-preview.png', (route) => {
    previewReads += 1;
    if (previewReads === 1) return route.abort('failed');
    return route.fulfill({ body: png, contentType: 'image/png' });
  });
  await f.open();
  await f.page.getByRole('button', { name: 'Add view', exact: true }).click();
  const input = f.page.locator('s-drop-zone input[type=file]');
  await input.waitFor({ state: 'attached' });
  const file = { name: 'front.png', mimeType: 'image/png', buffer: png };

  await input.setInputFiles(file);
  const banner = f.page.locator('.placement-image-picker s-banner[tone="critical"]');
  await banner.waitFor();
  assert.match(await banner.innerText(), /was uploaded, but its preview could not be loaded/);
  assert.doesNotMatch(await banner.innerText(), /could not be processed/);

  await input.setInputFiles(file);
  await f.page.waitForFunction(() => {
    const picker = document.querySelector('.placement-image-picker');
    return picker?.getAttribute('aria-busy') === 'false' && !picker.querySelector('s-banner[tone="critical"]');
  });
  assert.equal(posts.length, 2);
  assert.equal(previewReads, 2);
  assert.equal(posts[0]?.key, posts[1]?.key, 'a retry of the same file reuses its idempotency key');
  assert.equal(posts[0]?.digest, posts[1]?.digest);
  assert.equal(stored.size, 1, 'one stored media row');
});
