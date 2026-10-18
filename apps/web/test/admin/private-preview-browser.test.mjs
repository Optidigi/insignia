import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
  'base64',
);

test('private Polaris preview omits credentials and referrer and cannot reveal a retired late image', {
  timeout: 15000,
}, async (t) => {
  const { outputFiles } = await build({
    stdin: {
      contents: `import { render } from 'preact'; import PrivatePreviewImage from './src/components/PrivatePreviewImage'; window.show = (src) => render(src ? <PrivatePreviewImage src={src} alt="Private proof" aspectRatio={2} /> : null, document.getElementById('root'));`,
      resolveDir: new URL('../../', import.meta.url).pathname,
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    jsxImportSource: 'preact',
  });
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.context().addCookies([
    {
      name: 'private-session',
      value: 'must-not-send',
      domain: 'private.example',
      path: '/',
      secure: true,
      sameSite: 'None',
    },
  ]);
  await page.route('http://preview.test/', (route) =>
    route.fulfill({ body: '<html><body><div id="root"></div></body></html>', contentType: 'text/html' }),
  );
  const requests = [];
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('https://private.example/**', async (route) => {
    requests.push(await route.request().allHeaders());
    if (route.request().url().endsWith('large.png')) {
      await route.fulfill({
        body: Buffer.alloc(2 * 1024 * 1024 + 1),
        contentType: 'image/png',
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
      return;
    }
    if (route.request().url().endsWith('late.png')) await blocked;
    await route
      .fulfill({ body: png, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' } })
      .catch(() => {});
  });
  await page.goto('http://preview.test/');
  await page.addScriptTag({
    content: await readFile(new URL('../fixtures/polaris-1.1.snapshot', import.meta.url), 'utf8'),
  });
  await page.addScriptTag({ content: outputFiles[0].text });
  await page.evaluate(() => {
    window.revoked = [];
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => {
      window.revoked.push(url);
      revoke(url);
    };
    window.show('https://private.example/first.png');
  });
  const image = page.getByRole('img', { name: 'Private proof', exact: true });
  await image.waitFor();
  const first = await page.locator('s-image').getAttribute('src');
  assert.match(first, /^blob:/);
  assert.equal(requests[0].cookie, undefined);
  assert.equal(requests[0].referer, undefined);
  await page.waitForFunction(
    () => document.querySelector('s-image')?.shadowRoot?.querySelector('img')?.naturalWidth === 1,
  );
  await page.evaluate(() => window.show('https://private.example/large.png'));
  await page.getByText('Artwork image unavailable.', { exact: true }).waitFor();
  assert.equal(await page.locator('s-image').count(), 0, 'Oversized bytes cannot become an image');
  const lateRequest = page.waitForRequest('https://private.example/late.png');
  await page.evaluate(() => window.show('https://private.example/late.png'));
  await lateRequest;
  await page.evaluate(() => window.show(null));
  release();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('s-image').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.revoked), [first]);
});
