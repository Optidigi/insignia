import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { chromium } from 'playwright';

const require = createRequire(new URL('../../../../frontend/admin/package.json', import.meta.url));
const { build } = require('esbuild');
const admin = new URL('../../../../frontend/admin/', import.meta.url).pathname;

// Bundle the actual component in memory: no shared build artifacts are changed.
async function fixture(t: import('node:test').TestContext) {
  const bundle = await build({
    stdin: {
      contents: `
      import { h, render } from 'preact';
      import Dialog from './examples/admin/support/placement-setup-copy-dialog.tsx';
      class Modal extends HTMLElement {
        onshow = null;
        showOverlay() { queueMicrotask(() => this.dispatchEvent(new Event('show'))); }
        hideOverlay() {}
      }
      customElements.define('s-modal', Modal);
      customElements.define('s-checkbox', class extends HTMLElement { checked = false; disabled = false; });
      const source = { id: 'source', title: 'Current editor source', images: [], methods: [], views: [
        { id: 'front', name: 'Front', imageUrl: '', imageWidth: 0, imageHeight: 0, placements: [] },
        { id: 'back', name: 'Back view', imageUrl: '', imageWidth: 0, imageHeight: 0, placements: [] }
      ] };
      const target = { id: 'target', title: 'Target', images: [], methods: [], views: [] };
      window.reads = []; window.writes = 0;
      const ports = { scope: () => null, reportStorage: null,
        loadCatalog: async () => [{ ...target, configured: false }],
        hydrate: (ids, signal) => new Promise((resolve, reject) => window.reads.push({
          signal, resolve: () => resolve([{ id: 'target', product: target }]), reject: () => reject(Error('old read'))
        })),
        inspect: product => ({ product, readiness: 'ready' }),
        save: async () => { window.writes++; }
      };
      window.openDialog = () => render(h(Dialog, { ports, source, onClose: () => render(null, document.body) }), document.body);
      window.openDialog();
    `,
      resolveDir: admin,
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    jsxImportSource: 'preact',
  });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('http://localhost/', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }),
  );
  await page.goto('http://localhost/');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const choose = page.locator('.placement-setup-copy__chooser');
  await choose.waitFor();
  const click = async (selector: string) => page.locator(selector).evaluate((el: HTMLElement) => el.click());
  const review = async () => click('s-button[slot="primary-action"]');
  const back = async () => click('s-button[slot="secondary-actions"]');
  await page.locator('s-checkbox[name="targetProducts"]').evaluate((el: any) => {
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  return { page, choose, click, review, back };
}

for (const settlement of ['resolve', 'reject'] as const) {
  test(`Back retires dispatched hydration; old ${settlement} cannot settle a newer Review`, async (t) => {
    const f = await fixture(t);
    await f.review();
    await f.page.waitForFunction(() => (window as any).reads.length === 1);
    await f.back();
    await f.choose.waitFor({ timeout: 1500 });
    assert.equal(await f.page.evaluate(() => (window as any).reads[0].signal.aborted), true);
    assert.equal(await f.page.locator('s-checkbox[name="targetProducts"]').evaluate((el: any) => el.checked), true);
    await f.review();
    await f.page.waitForFunction(() => (window as any).reads.length === 2);
    await f.page.evaluate((method) => (window as any).reads[0][method](), settlement);
    await f.page.waitForTimeout(100);
    assert.equal(await f.page.locator('.placement-setup-copy').getAttribute('aria-busy'), 'true');
    await f.page.evaluate(() => (window as any).reads[1].resolve());
    await f.page.locator('.placement-setup-copy__review').waitFor();
    assert.equal(await f.page.locator('.placement-setup-copy').getAttribute('aria-busy'), 'false');
    assert.equal(await f.page.evaluate(() => (window as any).writes), 0);
  });
}

test('Review failure returns to selected targets; retry retains view selection and editor source', async (t) => {
  const f = await fixture(t);
  await f.review();
  await f.page.waitForFunction(() => (window as any).reads.length === 1);
  await f.page.evaluate(() => (window as any).reads[0].resolve());
  const views = f.page.locator('s-checkbox[name="copySetupViews"]');
  await views.first().waitFor({ state: 'attached' });
  await views.nth(1).evaluate((el: any) => {
    el.checked = false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await f.back();
  await f.choose.waitFor();
  await f.review();
  await f.page.waitForFunction(() => (window as any).reads.length === 2);
  await f.page.evaluate(() => (window as any).reads[1].reject());
  await f.page.locator('s-banner[tone="critical"]').waitFor();
  await f.back();
  await f.choose.waitFor();
  assert.equal(await f.page.locator('s-checkbox[name="targetProducts"]').evaluate((el: any) => el.checked), true);
  await f.review();
  await f.page.waitForFunction(() => (window as any).reads.length === 3);
  await f.page.evaluate(() => (window as any).reads[2].resolve());
  await f.page.locator('.placement-setup-copy__review').waitFor();
  assert.equal(await views.nth(1).evaluate((el: any) => el.checked), false);
  assert.match(await f.page.locator('.placement-setup-copy').innerText(), /Current editor source/);
  assert.equal(await f.page.evaluate(() => (window as any).writes), 0);
});

test('Back then Cancel and reopen fences late hydration and gives the new modal a distinct identity', async (t) => {
  const f = await fixture(t);
  const id = await f.page.locator('s-modal').getAttribute('id');
  await f.review();
  await f.page.waitForFunction(() => (window as any).reads.length === 1);
  await f.back();
  await f.choose.waitFor();
  await f.back();
  await f.page.locator('s-modal').waitFor({ state: 'detached' });
  await f.page.evaluate(() => (window as any).openDialog());
  await f.choose.waitFor();
  assert.notEqual(await f.page.locator('s-modal').getAttribute('id'), id);
  await f.page.evaluate(() => (window as any).reads[0].reject());
  await f.page.waitForTimeout(100);
  await f.choose.waitFor();
  assert.equal(await f.page.locator('.placement-setup-copy').getAttribute('aria-busy'), 'false');
  assert.equal(await f.page.evaluate(() => (window as any).writes), 0);
});

for (const newerFails of [false, true]) {
  test(`retired hydration cannot replace newer ${newerFails ? 'error' : 'review results'}`, async (t) => {
    const f = await fixture(t);
    await f.review();
    await f.page.waitForFunction(() => (window as any).reads.length === 1);
    await f.back();
    await f.choose.waitFor();
    await f.review();
    await f.page.waitForFunction(() => (window as any).reads.length === 2);
    await f.page.evaluate((fails) => (window as any).reads[1][fails ? 'reject' : 'resolve'](), newerFails);
    const expected = f.page.locator(newerFails ? 's-banner[tone="critical"]' : '.placement-setup-copy__review');
    await expected.waitFor();
    const text = await expected.innerText();
    await f.page.evaluate((fails) => (window as any).reads[0][fails ? 'resolve' : 'reject'](), newerFails);
    await f.page.waitForTimeout(100);
    assert.equal(await expected.innerText(), text);
    assert.equal(await f.page.locator('.placement-setup-copy').getAttribute('aria-busy'), 'false');
    assert.equal(await f.page.evaluate(() => (window as any).writes), 0);
  });
}
