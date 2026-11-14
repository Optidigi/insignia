import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { type TestContext, test } from 'node:test';
import { fixture } from './support/selected-browser.mts';

// Scope: real built UI/client/Polaris in an isolated browser with synthetic provider HTTP. The preview read-back is
// blocked the way a missing bucket CORS rule blocks it: the media POST succeeds, then the browser's GET fails.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
  'base64',
);

async function pickerFixture(t: TestContext, options: { conflictOnPost?: number } = {}) {
  const f = await fixture(t);
  const posts: { key: string | null; digest: string }[] = [];
  const stored = new Set<string>();
  const state = { previewReads: 0 };
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
    if (posts.length === options.conflictOnPost)
      return route.fulfill({
        status: 409,
        json: { error: 'Upload identity already belongs to different image bytes' },
      });
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
    state.previewReads += 1;
    if (state.previewReads === 1) return route.abort('failed');
    return route.fulfill({ body: png, contentType: 'image/png' });
  });
  await f.open();
  await f.page.getByRole('button', { name: 'Add view', exact: true }).click();
  const input = f.page.locator('s-drop-zone input[type=file]');
  await input.waitFor({ state: 'attached' });
  const directory = new URL(
    `../../../../.m1-artifacts/selected-product-browser/upload-${Date.now()}/`,
    import.meta.url,
  );
  await mkdir(directory, { recursive: true });
  const file = new URL('front.png', directory).pathname;
  await writeFile(file, png);
  const banner = f.page.locator('.placement-image-picker s-banner[tone="critical"]');
  const settled = () =>
    f.page.waitForFunction(
      () => document.querySelector('.placement-image-picker')?.getAttribute('aria-busy') === 'false',
    );
  return { f, posts, stored, state, input, file, banner, settled };
}

test('a stored photo whose preview cannot be read says so, and retrying the same file stores no second media row', {
  timeout: 45000,
}, async (t) => {
  const { f, posts, stored, state, input, file, banner, settled } = await pickerFixture(t);

  await input.setInputFiles(file);
  await banner.waitFor();
  assert.match(await banner.innerText(), /was uploaded, but its preview could not be loaded/);
  assert.doesNotMatch(await banner.innerText(), /could not be processed/);

  await input.setInputFiles(file);
  await f.page.waitForFunction(() => {
    const picker = document.querySelector('.placement-image-picker');
    return picker?.getAttribute('aria-busy') === 'false' && !picker.querySelector('s-banner[tone="critical"]');
  });
  await settled();
  assert.equal(posts.length, 2);
  assert.equal(state.previewReads, 2);
  assert.equal(posts[0]?.key, posts[1]?.key, 'a retry of the same file reuses its idempotency key');
  assert.equal(posts[0]?.digest, posts[1]?.digest);
  assert.equal(stored.size, 1, 'one stored media row');
});

test('a remembered upload identity is dropped when the retry fails for any other reason', {
  timeout: 45000,
}, async (t) => {
  const { posts, input, file, banner, settled } = await pickerFixture(t, { conflictOnPost: 2 });

  await input.setInputFiles(file);
  await banner.waitFor();
  assert.match(await banner.innerText(), /was uploaded, but its preview could not be loaded/);

  await input.setInputFiles(file); // The server refuses the reused identity (409).
  await settled();
  assert.match(await banner.innerText(), /could not be processed/);

  await input.setInputFiles(file);
  await settled();
  assert.equal(posts.length, 3);
  assert.equal(posts[0]?.key, posts[1]?.key);
  assert.notEqual(posts[2]?.key, posts[1]?.key, 'after a refusal the next attempt gets a fresh upload identity');
  assert.equal(await banner.count(), 0);
});
