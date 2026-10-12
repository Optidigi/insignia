import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('preview lease expiry retains artwork, permits retry without reupload, and clears on permission loss', {
  timeout: 15000,
}, async (t) => {
  const { outputFiles } = await build({
    stdin: {
      contents: `import { render } from 'preact'; import ArtworkUpload from './src/islands/ArtworkUpload';
        render(<ArtworkUpload api={window.artworkApi} onPreview={p => window.previews.push(p)} onAssetChange={a => window.assets.push(a)} />, document.body);`,
      resolveDir: new URL('../../', import.meta.url).pathname,
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    jsxImportSource: 'preact',
  });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('http://artwork.test/', (route) =>
    route.fulfill({ body: '<html><body></body></html>', contentType: 'text/html' }),
  );
  await page.goto('http://artwork.test/');
  await page.clock.install();
  await page.evaluate(() => {
    window.previews = [];
    window.assets = [];
    window.calls = [];
    window.previewReads = 0;
    window.denied = false;
    window.fetch = async () => new Response(null, { status: 200 });
    window.artworkApi = async (path) => {
      window.calls.push(path);
      if (window.denied) throw Object.assign(new Error('Permission removed'), { status: 403 });
      if (path === '/api/artwork')
        return { assetId: 'stable-asset', upload: { url: 'https://private.example/q', headers: {} } };
      if (path.endsWith('/status'))
        return {
          state: 'USABLE',
          expiresAt: new Date(Date.now() + (window.shortAsset ? 1000 : 7 * 86400000)).toISOString(),
        };
      if (path.endsWith('/preview')) {
        if (++window.previewReads === 2)
          throw Object.assign(new Error('Preview temporarily unavailable'), { status: 503 });
        return {
          url: `https://private.example/preview-${window.previewReads}.png`,
          width: 10,
          height: 10,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        };
      }
      return {};
    };
  });
  await page.addScriptTag({ content: outputFiles[0].text });
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await page.getByRole('img', { name: 'Verified artwork preview' }).waitFor();
  await page.clock.fastForward(61000);
  await page.getByText('Preview temporarily unavailable').waitFor();
  assert.equal(await page.getByRole('img').count(), 0, 'expired URL must leave the display');
  assert.equal(
    await page.evaluate(() => window.assets.at(-1)?.assetId),
    'stable-asset',
    'derivative failure must preserve stable selection metadata',
  );
  assert.equal(await page.getByRole('button', { name: 'Prepare original download' }).count(), 1);
  await page.getByRole('button', { name: 'Retry artwork preview' }).click();
  await page.getByText('Artwork preview renewed.').waitFor();
  assert.equal(await page.getByRole('img').getAttribute('src'), 'https://private.example/preview-3.png');
  assert.equal(await page.evaluate(() => window.calls.filter((p) => p === '/api/artwork').length), 1);
  assert.deepEqual(await page.evaluate(() => window.previews.filter(Boolean).map((p) => p.assetId)), [
    'stable-asset',
    'stable-asset',
  ]);
  await page.evaluate(() => {
    window.denied = true;
  });
  await page.clock.fastForward(61000);
  await page.getByText('Permission removed').waitFor();
  assert.equal(await page.getByRole('img').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Prepare original download' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Retry artwork preview' }).count(), 0);
  assert.equal(await page.evaluate(() => window.assets.at(-1)), null);
  await page.evaluate(() => {
    window.denied = false;
    window.shortAsset = true;
  });
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'second.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await page.getByRole('img').waitFor();
  await page.clock.fastForward(1100);
  await page.getByText('Artwork expired. Upload it again.').waitFor();
  assert.equal(await page.getByRole('img').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Prepare original download' }).count(), 0);
  assert.equal(await page.evaluate(() => window.assets.at(-1)), null);
});
