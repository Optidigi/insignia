import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { validatePublishedConfig } from '@insignia/domain';
import { chromium } from 'playwright';

const polarisUrl = 'https://cdn.shopify.com/shopifycloud/polaris-1.1.js';
const polarisSha = '912455ad068713e7595f5a506fb7433a078554c327cf0fd30ce86ccb214818fe';
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const id = 'gid://shopify/Product/111';
const variant = 'gid://shopify/ProductVariant/11';
const rect = { centerX: 0.5, centerY: 0.5, width: 0.3, height: 0.3 };
function draft() {
  return {
    version: 'm5-merchant-draft-v1',
    mode: 'optional',
    shopCurrency: 'USD',
    methods: [{ id: 'print' }],
    placements: [
      { id: 'front', allowedMethodIds: ['print'], allowedStepIds: ['small', 'large'], logoLaterAllowed: true },
    ],
    productionOptions: [],
    pricingRules: [],
    geometry: {
      version: 'm5-geometry-v1',
      views: [
        {
          id: 'front-view',
          image: { revisionId: 'product_111', width: 1, height: 1 },
          variantImages: [{ variantId: 'variant_11', image: { revisionId: 'variant_11', width: 1, height: 1 } }],
          placements: [
            {
              id: 'front',
              rect,
              variantOverrides: [
                { variantId: 'variant_11', rect: { ...rect, centerX: 0.4, centerY: 0.4, width: 0.2, height: 0.2 } },
              ],
            },
          ],
        },
        {
          id: 'back-view',
          image: { revisionId: 'product_111', width: 1, height: 1 },
          variantImages: [],
          placements: [{ id: 'front', rect: { ...rect, centerY: 0.6 } }],
        },
      ],
      steps: [
        { id: 'small', widthFraction: 0.5, heightFraction: 0.5 },
        { id: 'large', widthFraction: 0.8, heightFraction: 0.8 },
      ],
    },
  };
}
function response(config) {
  return {
    product: {
      id,
      title: 'Synthetic shirt',
      status: 'ACTIVE',
      imageUrl: png,
      variants: [{ id: variant, title: 'Blue', imageUrl: png, selectedOptions: [] }],
    },
    config: {
      configId: 'config-1',
      draftVersion: '1',
      draft: config,
      publication: {
        state: 'DRAFT',
        revisionId: null,
        activeRevisionId: null,
        reason: null,
        requiresAllChannelHold: null,
        functionReadiness: null,
      },
      publishEligibility: { allowed: false, reason: 'Synthetic policy unavailable' },
    },
  };
}
async function startServer() {
  const port = 45000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [new URL('../../dist/server/entry.mjs', import.meta.url).pathname], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
  });
  const exited = new Promise((resolve) => child.once('close', resolve));
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100 && child.exitCode === null; i++) {
    try {
      if ((await fetch(base + '/live')).ok) return { base, child, exited };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill('SIGTERM');
  await exited;
  throw new Error('Web server did not start');
}
test('real browser editor syncs typed view, variant and step controls with direct Konva canvas and saved draft', {
  timeout: 45000,
}, async () => {
  const source = await readFile(new URL('../fixtures/polaris-1.1.snapshot', import.meta.url));
  assert.equal(createHash('sha256').update(source).digest('hex'), polarisSha);
  const server = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1120, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('requestfailed', (request) => {
      if (!request.url().includes('/static/fonts/')) errors.push('request: ' + request.url());
    });
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('Loading the font'))
        errors.push('console: ' + message.text());
    });
    await page.addInitScript(() => {
      window.shopify = {
        idToken: async () => {
          window.__tokenCount = (window.__tokenCount || 0) + 1;
          return 'synthetic-staff-token';
        },
      };
    });
    await page.route(polarisUrl, (route) => route.fulfill({ body: source, contentType: 'text/javascript' }));
    await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
      route.fulfill({ body: '', contentType: 'text/javascript' }),
    );
    let saved;
    let current = draft();
    await page.route('**/api/admin/products/111/config', async (route) => {
      const request = route.request();
      if (request.headers().authorization !== 'Bearer synthetic-staff-token')
        return route.fulfill({ status: 401, json: { error: 'Missing synthetic staff token' } });
      if (request.method() === 'GET') return route.fulfill({ json: response(current) });
      if (request.method() !== 'PUT') return route.fulfill({ status: 405 });
      saved = request.postDataJSON();
      current = saved.draft;
      return route.fulfill({ json: { kind: 'saved', draftVersion: '2' } });
    });
    const opened = await page.goto(server.base + '/admin/products/111/config');
    assert.equal(opened?.status(), 200);
    await page.getByText('Draft version 1').waitFor({ timeout: 5000 });
    await page.waitForFunction(() => document.querySelector('#insignia-visualizer canvas'));
    assert.ok((await page.locator('#insignia-visualizer canvas').count()) >= 3);
    const captureDir = new URL('../../../../docs/delivery/evidence/m5-001-admin-browser/', import.meta.url);
    if (process.env.M5_CAPTURE_BROWSER === '1') {
      await mkdir(captureDir, { recursive: true });
      await page.screenshot({ path: new URL('editor-initial.png', captureDir).pathname, fullPage: true });
    }
    const pixels = async (index) =>
      createHash('sha256')
        .update(
          await page
            .locator('#insignia-visualizer canvas')
            .nth(index)
            .evaluate((canvas) => canvas.toDataURL()),
        )
        .digest('hex');
    const frontPixels = await pixels(2);
    const initialImagePixels = await pixels(0);
    const viewSelect = page.locator('select').nth(1);
    await viewSelect.selectOption('back-view');
    assert.equal(await viewSelect.inputValue(), 'back-view');
    await page.waitForTimeout(100);
    assert.notEqual(await pixels(2), frontPixels, 'View must change Konva placement pixels');
    await viewSelect.selectOption('front-view');
    await page.waitForTimeout(100);
    assert.equal(await pixels(0), initialImagePixels, 'Cached image must remain in the initial and reprojected canvas');
    const variantSelect = page.locator('select').nth(2);
    await variantSelect.selectOption('variant_11');
    assert.equal(await variantSelect.inputValue(), 'variant_11');
    await page.waitForTimeout(100);
    assert.notEqual(await pixels(2), frontPixels, 'Variant override must change Konva placement pixels');
    await page.locator('select').nth(3).selectOption('front');
    await page.locator('select').nth(4).selectOption('small');
    await page.waitForTimeout(100);
    const smallPixels = await pixels(1);
    await page.locator('select').nth(4).selectOption('large');
    await page.waitForTimeout(100);
    assert.notEqual(await pixels(1), smallPixels, 'Size step must change Konva artwork pixels');
    assert.equal(Number(await page.getByLabel('centerX').inputValue()), 0.4);
    await page.waitForFunction(
      () => document.querySelector('#insignia-visualizer')?.querySelectorAll('canvas').length >= 3,
    );
    const stage = page.locator('#insignia-visualizer .konvajs-content');
    await stage.scrollIntoViewIfNeeded();
    const box = await stage.boundingBox();
    assert.ok(box && box.width > 200 && box.height > 200);
    const x = box.x + box.width / 2 - 42;
    const y = box.y + box.height / 2 - 42;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 25, y + 15, { steps: 8 });
    await page.mouse.up();
    await page.getByLabel('centerX').waitFor();
    const moved = Number(await page.getByLabel('centerX').inputValue());
    assert.ok(moved > 0.4 && moved < 0.6, 'Konva drag must update the typed placement field: ' + moved);
    await page.getByRole('button', { name: 'Add fixed price' }).click();
    assert.equal(await page.getByLabel('Role').inputValue(), 'setup');
    assert.deepEqual(JSON.parse(await page.getByLabel('Scope').inputValue()), { kind: 'general' });
    await page.getByLabel('Role').selectOption('unit');
    assert.deepEqual(JSON.parse(await page.getByLabel('Scope').inputValue()), { kind: 'method', methodId: 'print' });
    await page
      .locator('select')
      .filter({ has: page.locator('option[value="allUnits"]') })
      .selectOption('allUnits');
    await page.getByRole('button', { name: 'Add quantity tier' }).click();
    await page.getByLabel('Minimum quantity').last().fill('12');
    await page.getByLabel('Shop amount (USD)').first().fill('4.500');
    await page.getByLabel('Shop amount (USD)').last().fill('3.000');
    await page.getByRole('button', { name: 'Add presentment override' }).first().click();
    await page.getByLabel('Presentment currency').fill('EUR');
    await page.getByLabel('Presentment amount').fill('4.000');
    if (process.env.M5_CAPTURE_BROWSER === '1')
      await page.screenshot({ path: new URL('editor-edited.png', captureDir).pathname, fullPage: true });
    assert.equal(
      await page.evaluate(() => {
        const element = customElements.get('s-button');
        const button = [...document.querySelectorAll('s-button')].find((item) => item.textContent === 'Save draft');
        return !!(button && element && button instanceof element && button.shadowRoot);
      }),
      true,
    );
    await page.locator('s-button').filter({ hasText: 'Save draft' }).click({ timeout: 5000 });
    await page.getByText('Draft saved.').waitFor({ timeout: 5000 });
    assert.equal(saved.draft.version, 'm5-merchant-draft-v1');
    assert.doesNotThrow(() =>
      validatePublishedConfig({
        version: 'm2-published-config-v1',
        shopId: 'shop_1',
        productId: 'product_111',
        revisionId: 'revision_1',
        revisionContentHash: 'a'.repeat(64),
        shopCurrency: saved.draft.shopCurrency,
        methods: saved.draft.methods,
        placements: saved.draft.placements,
        productionOptions: saved.draft.productionOptions,
        pricingRules: saved.draft.pricingRules,
      }),
    );
    assert.equal(saved.draft.pricingRules[0].rate.tiers[1].minQuantity, 12);
    assert.ok(saved.draft.geometry.views[0].placements[0].variantOverrides[0].rect.centerX > 0.4);
    assert.ok((await page.evaluate(() => window.__tokenCount)) >= 2);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    server.child.kill('SIGTERM');
    await server.exited;
  }
});

test('mobile deep link, cookie-free reload, interrupted save, stale conflict, and missing Polaris control', {
  timeout: 45000,
}, async () => {
  const source = await readFile(new URL('../fixtures/polaris-1.1.snapshot', import.meta.url));
  const server = await startServer();
  let browser;
  try {
    const html = await (await fetch(server.base + '/admin/products/111/config')).text();
    assert.ok(!html.includes('Synthetic shirt') && !html.includes('synthetic-staff-token'));
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    let tokenCalls = 0;
    let writes = 0;
    let readCalls = 0;
    let mode = 'lost';
    let current = draft();
    let version = '1';
    let firstKey;
    let uncertainKey;
    let uncertainBody;
    await page.addInitScript(() => {
      window.shopify = { idToken: async () => 'synthetic-mobile-token' };
    });
    await page.route(polarisUrl, (route) => route.fulfill({ body: source, contentType: 'text/javascript' }));
    await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
      route.fulfill({ body: '', contentType: 'text/javascript' }),
    );
    await page.route('**/api/admin/products/111/config', async (route) => {
      const request = route.request();
      assert.equal(request.headers().authorization, 'Bearer synthetic-mobile-token');
      assert.equal(request.headers().cookie, undefined, 'Browser transport must not require cookies');
      tokenCalls++;
      if (request.method() === 'GET') {
        readCalls++;
        const body = response(current);
        body.config.draftVersion = version;
        return route.fulfill({ json: body });
      }
      assert.equal(request.method(), 'PUT');
      writes++;
      const body = request.postDataJSON();
      if (!firstKey) firstKey = request.headers()['idempotency-key'];
      if (mode === 'lost') {
        current = JSON.parse(JSON.stringify(body.draft));
        version = '2';
        return route.abort('failed');
      }
      if (mode === 'uncertain') {
        uncertainKey = request.headers()['idempotency-key'];
        uncertainBody = body;
        return route.abort('failed');
      }
      if (mode === 'retry') {
        assert.equal(request.headers()['idempotency-key'], uncertainKey);
        assert.deepEqual(body, uncertainBody);
        current = body.draft;
        version = '4';
        return route.fulfill({ json: { kind: 'saved', draftVersion: version } });
      }
      if (mode === 'denied') return route.fulfill({ status: 403, json: { message: 'Synthetic permission denied' } });
      if (mode === 'invalid') return route.fulfill({ status: 422, json: { message: 'Synthetic draft invalid' } });
      current = { ...draft(), mode: 'required' };
      version = '3';
      return route.fulfill({ status: 409, json: { error: 'stale draft version' } });
    });
    await page.goto(server.base + '/admin/products/111/config?id_token=synthetic-url-token');
    await page.getByText('Draft version 1').waitFor();
    assert.ok(!(await page.url()).includes('id_token='), 'Launch token must be removed from URL');
    await page.getByLabel('Method name').fill('  Screen print  ');
    await page.getByLabel('Customization mode').selectOption('required');
    await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
    await page.getByText('Draft saved; verified after an interrupted response.').waitFor();
    assert.equal(writes, 1);
    assert.equal(current.mode, 'required');
    assert.equal(current.labels.methods.print, 'Screen print');
    assert.ok(firstKey && firstKey.length > 10);
    mode = 'conflict';
    await page.getByLabel('Customization mode').selectOption('optional');
    await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
    await page.getByText('Another editor changed this draft. Review the latest version.').waitFor();
    assert.equal(writes, 2);
    await page.locator('s-button').filter({ hasText: 'Review latest saved draft' }).click();
    await page.getByText('Draft version 3').waitFor();
    await page.reload();
    await page.getByText('Draft version 3').waitFor();
    mode = 'uncertain';
    await page.getByLabel('Customization mode').selectOption('optional');
    const beforeHiddenRead = readCalls;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(100);
    assert.equal(readCalls, beforeHiddenRead, 'Returning to a dirty editor must not discard unsaved work');
    assert.equal(await page.getByLabel('Customization mode').inputValue(), 'optional');
    await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
    await page.getByText('Save result is uncertain. Retry the exact request or reload.').waitFor();
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(100);
    assert.equal(await page.locator('s-button').filter({ hasText: 'Retry exact save' }).count(), 1);
    mode = 'retry';
    await page.locator('s-button').filter({ hasText: 'Retry exact save' }).click();
    await page.getByText('Draft saved.').waitFor();
    assert.equal(writes, 4);
    assert.equal(current.mode, 'optional');
    mode = 'denied';
    await page.getByLabel('Customization mode').selectOption('required');
    await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
    await page.getByText('Synthetic permission denied').waitFor();
    assert.equal(await page.locator('s-button').filter({ hasText: 'Retry exact save' }).count(), 0);
    mode = 'invalid';
    await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
    await page.getByText('Synthetic draft invalid').waitFor();
    assert.equal(await page.locator('s-button').filter({ hasText: 'Retry exact save' }).count(), 0);
    assert.ok(readCalls >= 4 && tokenCalls >= 5);
    assert.deepEqual(await context.cookies(), []);

    const missingPage = await context.newPage();
    await missingPage.addInitScript(() => {
      window.shopify = { idToken: async () => 'synthetic-mobile-token' };
    });
    await missingPage.route(polarisUrl, (route) => route.abort('failed'));
    await missingPage.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
      route.fulfill({ body: '', contentType: 'text/javascript' }),
    );
    await missingPage.route('**/api/admin/products/111/config', (route) => route.fulfill({ json: response(draft()) }));
    await missingPage.goto(server.base + '/admin/products/111/config');
    await missingPage.getByText('Draft version 1').waitFor();
    assert.equal(await missingPage.evaluate(() => !!customElements.get('s-button')), false);
    assert.equal(
      await missingPage
        .locator('s-button')
        .filter({ hasText: 'Save draft' })
        .evaluate((button) => button.shadowRoot),
      null,
    );
  } finally {
    await browser?.close();
    server.child.kill('SIGTERM');
    await server.exited;
  }
});

test('interrupted publication resumes the identical request after reload and reaches a durable phase', {
  timeout: 30000,
}, async () => {
  const source = await readFile(new URL('../fixtures/polaris-1.1.snapshot', import.meta.url));
  const server = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.shopify = { idToken: async () => 'synthetic-publish-token' };
    });
    await page.route(polarisUrl, (route) => route.fulfill({ body: source, contentType: 'text/javascript' }));
    await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
      route.fulfill({ body: '', contentType: 'text/javascript' }),
    );
    let phase = 'DRAFT';
    let writes = 0;
    let firstKey;
    let firstBody;
    await page.route('**/api/admin/products/111/config', (route) => {
      const request = route.request();
      assert.equal(request.headers().authorization, 'Bearer synthetic-publish-token');
      if (request.method() === 'GET') {
        const view = response(draft());
        view.config.publishEligibility = { allowed: true, reason: null };
        view.config.publication.state = phase;
        view.config.publication.revisionId = phase === 'DRAFT' ? null : 'same-immutable-revision';
        return route.fulfill({ json: view });
      }
      assert.equal(request.method(), 'POST');
      const body = request.postDataJSON();
      assert.equal(body.action, 'publish');
      const key = request.headers()['idempotency-key'];
      if (!firstKey) {
        firstKey = key;
        firstBody = body;
      } else {
        assert.equal(key, firstKey);
        assert.deepEqual(body, firstBody);
      }
      writes++;
      if (writes === 1) {
        phase = 'PUBLISH_REQUESTED';
        return route.abort('failed');
      }
      phase = writes === 2 ? 'REMOTE_PENDING' : 'REMOTE_READY_ACTIVATION_PENDING';
      return route.fulfill({
        status: 202,
        json: { kind: 'accepted', state: phase, revisionId: 'same-immutable-revision' },
      });
    });
    await page.goto(server.base + '/admin/products/111/config');
    await page.getByText('Draft version 1').waitFor();
    await page.locator('s-button').filter({ hasText: 'Request publication' }).click();
    await page.getByText(/Continue the same publication request/).waitFor();
    assert.equal(writes, 1);
    await page.reload();
    await page.locator('s-button').filter({ hasText: 'Continue publication' }).click();
    await page.getByText('Remote ready; activation pending').waitFor();
    assert.equal(writes, 3);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('insignia:m5:publish:111')), null);
  } finally {
    await browser?.close();
    server.child.kill('SIGTERM');
    await server.exited;
  }
});

test('publication retry uses the deterministic key when embedded storage is denied', { timeout: 20000 }, async () => {
  const source = await readFile(new URL('../fixtures/polaris-1.1.snapshot', import.meta.url));
  const server = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.shopify = { idToken: async () => 'synthetic-storage-denied-token' };
      Object.defineProperty(window, 'sessionStorage', {
        configurable: true,
        get: () => {
          throw new Error('storage denied');
        },
      });
    });
    await page.route(polarisUrl, (route) => route.fulfill({ body: source, contentType: 'text/javascript' }));
    await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
      route.fulfill({ body: '', contentType: 'text/javascript' }),
    );
    let state = 'PUBLISH_REQUESTED';
    let observedKey;
    await page.route('**/api/admin/products/111/config', (route) => {
      if (route.request().method() === 'GET') {
        const view = response(draft());
        view.config.publishEligibility = { allowed: true, reason: null };
        view.config.publication.state = state;
        view.config.publication.revisionId = 'same-immutable-revision';
        return route.fulfill({ json: view });
      }
      observedKey = route.request().headers()['idempotency-key'];
      state = 'REMOTE_READY_ACTIVATION_PENDING';
      return route.fulfill({ status: 202, json: { kind: 'accepted', state, revisionId: 'same-immutable-revision' } });
    });
    await page.goto(server.base + '/admin/products/111/config');
    await page.locator('s-button').filter({ hasText: 'Continue publication' }).click();
    await page.getByText('Remote ready; activation pending').waitFor();
    assert.equal(observedKey, 'm5pub_config-1_1');
  } finally {
    await browser?.close();
    server.child.kill('SIGTERM');
    await server.exited;
  }
});

test('concurrent editor refreshes share one App Bridge identity request', { timeout: 20000 }, async () => {
  const source = await readFile(new URL('../fixtures/polaris-1.1.snapshot', import.meta.url));
  const server = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.__tokenCalls = 0;
      window.shopify = {
        idToken: () => {
          window.__tokenCalls++;
          return new Promise((resolve) => setTimeout(() => resolve('synthetic-concurrent-token'), 250));
        },
      };
    });
    await page.route(polarisUrl, (route) => route.fulfill({ body: source, contentType: 'text/javascript' }));
    await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
      route.fulfill({ body: '', contentType: 'text/javascript' }),
    );
    let reads = 0;
    let saved;
    const colon = draft();
    colon.methods[0].id = 'screen:print';
    colon.placements[0].id = 'front:chest';
    colon.placements[0].allowedMethodIds = ['screen:print'];
    colon.placements[0].allowedStepIds = ['size:small', 'size:large'];
    colon.geometry.steps[0].id = 'size:small';
    colon.geometry.steps[1].id = 'size:large';
    for (const view of colon.geometry.views) view.placements[0].id = 'front:chest';
    await page.route('**/api/admin/products/111/config', (route) => {
      assert.equal(route.request().headers().authorization, 'Bearer synthetic-concurrent-token');
      if (route.request().method() === 'PUT') {
        saved = route.request().postDataJSON();
        return route.fulfill({ json: { kind: 'saved', draftVersion: '2' } });
      }
      reads++;
      return route.fulfill({ json: response(colon) });
    });
    await page.goto(`${server.base}/admin/products/111/config`);
    await page.waitForFunction(() => window.__tokenCalls === 1);
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.getByText('Draft version 1').waitFor();
    assert.equal(await page.evaluate(() => window.__tokenCalls), 1);
    assert.equal(reads, 3);
    await page.getByRole('button', { name: 'Add fixed price' }).click();
    await page.getByLabel('Role').selectOption('unit');
    await page.getByLabel('Scope').selectOption(
      JSON.stringify({
        kind: 'step',
        placementId: 'front:chest',
        stepId: 'size:small',
      }),
    );
    await page.getByLabel('Specific method').selectOption('screen:print');
    await page.getByLabel('Shop amount (USD)').fill('1.000');
    await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
    await page.getByText('Draft saved.').waitFor();
    assert.deepEqual(saved.draft.pricingRules[0].scope, {
      kind: 'step',
      placementId: 'front:chest',
      stepId: 'size:small',
      methodId: 'screen:print',
    });
    assert.doesNotThrow(() =>
      validatePublishedConfig({
        version: 'm2-published-config-v1',
        shopId: 'shop_1',
        productId: 'product_111',
        revisionId: 'revision_1',
        revisionContentHash: 'a'.repeat(64),
        shopCurrency: saved.draft.shopCurrency,
        methods: saved.draft.methods,
        placements: saved.draft.placements,
        productionOptions: saved.draft.productionOptions,
        pricingRules: saved.draft.pricingRules,
      }),
    );
  } finally {
    await browser?.close();
    server.child.kill('SIGTERM');
    await server.exited;
  }
});

test('empty merchant draft can be configured through typed controls and pass M2 validation', {
  timeout: 20000,
}, async () => {
  const source = await readFile(new URL('../fixtures/polaris-1.1.snapshot', import.meta.url));
  const server = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const empty = {
      ...draft(),
      methods: [],
      placements: [],
      pricingRules: [],
      geometry: { version: 'm5-geometry-v1', views: [{ id: 'front', variantImages: [], placements: [] }], steps: [] },
    };
    let saved;
    await page.addInitScript(() => {
      window.shopify = { idToken: async () => 'synthetic-empty-token' };
    });
    await page.route(polarisUrl, (route) => route.fulfill({ body: source, contentType: 'text/javascript' }));
    await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
      route.fulfill({ body: '', contentType: 'text/javascript' }),
    );
    await page.route('**/api/admin/products/111/config', (route) => {
      assert.equal(route.request().headers().authorization, 'Bearer synthetic-empty-token');
      if (route.request().method() === 'PUT') {
        saved = route.request().postDataJSON();
        return route.fulfill({ json: { kind: 'saved', draftVersion: '2' } });
      }
      return route.fulfill({ json: response(empty) });
    });
    await page.goto(`${server.base}/admin/products/111/config`);
    await page.getByText('Draft version 1').waitFor();
    await page.getByRole('button', { name: 'Add fixed price' }).click();
    assert.equal(
      await page
        .getByLabel('Role')
        .locator('option[value="unit"]')
        .evaluate((option) => option.disabled),
      true,
    );
    await page.getByRole('button', { name: 'Add method' }).click();
    await page.getByLabel('Method name').fill('Screen print');
    await page.getByLabel('Role').selectOption('unit');
    assert.equal(JSON.parse(await page.getByLabel('Scope').inputValue()).kind, 'method');
    await page.getByRole('button', { name: 'Add placement to view' }).click();
    await page.getByLabel('Placement name').fill('Front chest');
    await page.getByRole('button', { name: 'Add size step' }).click();
    await page.getByLabel('Selected step').selectOption({ index: 1 });
    await page.getByLabel('Size step name').fill('Small');
    await page.locator('input[type="checkbox"]').nth(1).check();
    await page.locator('input[type="checkbox"]').nth(2).check();
    await page.getByRole('button', { name: 'Add production option' }).click();
    await page.getByLabel('Option name').fill('Thread color');
    await page.getByLabel(/^Value .* name$/).fill('Navy');
    await page.getByLabel('Shop amount (USD)').fill('2.000');
    await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
    await page.getByText('Draft saved.').waitFor();
    assert.ok(saved.draft.methods.length === 1 && saved.draft.placements.length === 1);
    assert.deepEqual(
      new Set(
        Object.entries(saved.draft.labels).flatMap(([kind, group]) =>
          kind === 'values' ? Object.values(group).flatMap(Object.values) : Object.values(group),
        ),
      ),
      new Set(['Screen print', 'Front chest', 'Small', 'Thread color', 'Navy']),
    );
    assert.doesNotThrow(() =>
      validatePublishedConfig({
        version: 'm2-published-config-v1',
        shopId: 'shop_1',
        productId: 'product_111',
        revisionId: 'revision_1',
        revisionContentHash: 'a'.repeat(64),
        shopCurrency: saved.draft.shopCurrency,
        methods: saved.draft.methods,
        placements: saved.draft.placements,
        productionOptions: saved.draft.productionOptions,
        pricingRules: saved.draft.pricingRules,
      }),
    );
  } finally {
    await browser?.close();
    server.child.kill('SIGTERM');
    await server.exited;
  }
});
