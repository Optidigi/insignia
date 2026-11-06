import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('native heading is exported after both reveal and Bridge readiness, and a retired route cannot export later', async (t) => {
  const built = await build({
    stdin: {
      contents: `import{h,render}from'preact';import{useAdminPageReady}from'./src/shared/admin-page-ready';function Fixture(){useAdminPageReady(true);return null}window.unmount=()=>render(null,document.getElementById('root'));render(h(Fixture,{}),document.getElementById('root'));`,
      resolveDir: new URL('../../../../frontend/admin/', import.meta.url).pathname,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
  });
  const script = built.outputFiles[0];
  assert(script);
  const html = `<!doctype html><s-page heading="First"></s-page><div id="root"></div><script>window.headingUpdates=[];window.shopify={ready:new Promise(r=>window.releaseBridge=r)};new MutationObserver(records=>{for(const record of records)window.headingUpdates.push(record.target.getAttribute('heading'))}).observe(document,{attributes:true,subtree:true,attributeFilter:['heading']});</script><script>${script.text}</script>`;
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(html);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  assert(address && typeof address !== 'string');
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  t.after(async () => {
    try {
      await browser?.close();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    }
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(3000);
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.evaluate(() => {
    document.documentElement.dataset.adminReady = 'true';
    document.dispatchEvent(new Event('insignia:admin-revealed'));
  });
  assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'headingUpdates')), []);
  await page.evaluate(() => Reflect.get(window, 'releaseBridge')());
  await page.waitForFunction(() => Reflect.get(window, 'headingUpdates').length === 1);
  assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'headingUpdates')), ['First']);
  assert.equal(await page.locator('s-page').getAttribute('heading'), 'First');
  await page.reload();
  await page.evaluate(() => Reflect.get(window, 'releaseBridge')());
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  assert.deepEqual(
    await page.evaluate(() => Reflect.get(window, 'headingUpdates')),
    [],
    'Bridge readiness alone must not export an unrevealed route',
  );
  await page.evaluate(() => {
    document.documentElement.dataset.adminReady = 'true';
    document.dispatchEvent(new Event('insignia:admin-revealed'));
    document.dispatchEvent(new Event('insignia:admin-revealed'));
  });
  await page.waitForFunction(() => Reflect.get(window, 'headingUpdates').length === 1);
  assert.deepEqual(
    await page.evaluate(() => Reflect.get(window, 'headingUpdates')),
    ['First'],
    'repeated reveal signals produce one native export',
  );
  await page.reload();
  await page.evaluate(() => {
    document.documentElement.dataset.adminReady = 'true';
    document.dispatchEvent(new Event('insignia:admin-revealed'));
    Reflect.get(window, 'unmount')();
    document.querySelector('s-page')?.remove();
    const next = document.createElement('s-page');
    next.setAttribute('heading', 'Second');
    document.body.append(next);
    Reflect.get(window, 'headingUpdates').length = 0;
    Reflect.get(window, 'releaseBridge')();
  });
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  assert.deepEqual(
    await page.evaluate(() => Reflect.get(window, 'headingUpdates')),
    [],
    'retired readiness cannot overwrite the next route header',
  );
});
