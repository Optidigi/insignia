import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { crc32, deflateSync } from 'node:zlib';
import { currencyExponent } from '@insignia/cart-authorization';
import { priceProposal, validatePublishedConfig } from '@insignia/domain';
import { chromium } from 'playwright';

const polarisUrl = 'https://cdn.shopify.com/shopifycloud/polaris-1.1.js';
const polarisSha = '912455ad068713e7595f5a506fb7433a078554c327cf0fd30ce86ccb214818fe';
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const id = 'gid://shopify/Product/111';
const variant = 'gid://shopify/ProductVariant/11';
const rect = { centerX: 0.5, centerY: 0.5, width: 0.3, height: 0.3 };
function solidPng(width, height, color) {
  const chunk = (name, data) => {
    const type = Buffer.from(name);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
    return Buffer.concat([size, type, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rows.set(color, y * (1 + width * 3) + 1 + x * 3);
  return (
    'data:image/png;base64,' +
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(rows)),
      chunk('IEND', Buffer.alloc(0)),
    ]).toString('base64')
  );
}
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
      installationGeneration: '1',
      draftVersion: '1',
      draft: config,
      currentShopCurrency: 'USD',
      publication: {
        state: 'DRAFT',
        revisionId: null,
        sourceDraftVersion: null,
        requestKey: null,
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
test('editor-generated fixed, override and tier defaults price through unchanged M2 in zero/two/three exponent currencies', {
  timeout: 60000,
}, async () => {
  const source = await readFile(new URL('../fixtures/polaris-1.1.snapshot', import.meta.url));
  assert.equal(createHash('sha256').update(source).digest('hex'), polarisSha);
  const server = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const currency of ['USD', 'EUR', 'JPY', 'KWD']) {
      const page = await browser.newPage();
      await page.addInitScript(() => {
        window.shopify = { idToken: async () => 'synthetic-money-token' };
      });
      await page.route(polarisUrl, (route) => route.fulfill({ body: source, contentType: 'text/javascript' }));
      await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
      await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
        route.fulfill({ body: '', contentType: 'text/javascript' }),
      );
      let current = { ...draft(), shopCurrency: currency };
      let version = '1';
      let saved;
      await page.route('**/api/admin/products/111/config', (route) => {
        if (route.request().method() === 'GET') {
          const value = response(current);
          value.config.currentShopCurrency = currency;
          value.config.draftVersion = version;
          return route.fulfill({ json: value });
        }
        assert.equal(route.request().method(), 'PUT');
        saved = route.request().postDataJSON();
        current = saved.draft;
        version = String(Number(version) + 1);
        return route.fulfill({ json: { kind: 'saved', draftVersion: version } });
      });
      await page.goto(server.base + '/admin/products/111/config');
      await page.getByText('Draft version 1').waitFor();
      await page.getByRole('button', { name: 'Add fixed price' }).click();
      const price = (presentment = currency, quantity = 2) =>
        priceProposal({
          shopId: 'shop_1',
          groups: [
            {
              version: 'm2-customization-group-v1',
              shopId: 'shop_1',
              productId: '111',
              configRevisionId: 'revision_1',
              revisionContentHash: 'a'.repeat(64),
              design: {
                placements: [
                  {
                    placementId: 'front',
                    methodId: 'print',
                    stepId: 'small',
                    artwork: { kind: 'deferred', intentId: 'synthetic-intent' },
                  },
                ],
                options: [],
              },
              variants: [{ variantId: '11', quantity }],
            },
          ],
          configs: [
            validatePublishedConfig({
              version: 'm2-published-config-v1',
              shopId: 'shop_1',
              productId: '111',
              revisionId: 'revision_1',
              revisionContentHash: 'a'.repeat(64),
              shopCurrency: currency,
              methods: saved.draft.methods,
              placements: saved.draft.placements,
              productionOptions: saved.draft.productionOptions,
              pricingRules: saved.draft.pricingRules,
            }),
          ],
          bases: [
            {
              shopId: 'shop_1',
              productId: '111',
              variantId: '11',
              currency: presentment,
              minor: '100',
              contextId: 'ctx',
            },
          ],
          currency: {
            version: 'm2-currency-resolution-v1',
            presentmentCurrency: presentment,
            exponents: { [currency]: currencyExponent(currency), [presentment]: currencyExponent(presentment) },
          },
          effectiveAt: '2026-09-30T12:00:00.000Z',
          marketContext: 'synthetic',
          roundingPolicy: 'm2-half-even-v1',
        });
      const save = async () => {
        await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
        await page.getByText('Draft saved.').waitFor();
      };
      await save();
      assert.equal(price().totalMinor, '200', currency + ' fixed default must be usable');
      await page.getByRole('button', { name: 'Add presentment override' }).click();
      const override = currency === 'EUR' ? 'USD' : 'EUR';
      await page.getByLabel('Presentment currency').fill(override);
      await save();
      assert.equal(price(override).totalMinor, '200', 'override default must be usable without FX');
      await page.getByLabel('Role').selectOption('unit');
      await page
        .locator('select')
        .filter({ has: page.locator('option[value="allUnits"]') })
        .selectOption('allUnits');
      await page.getByRole('button', { name: 'Add quantity tier' }).click();
      await save();
      assert.equal(price(currency, 1).totalMinor, '100', 'first tier must retain usable default');
      assert.equal(price(currency, 2).totalMinor, '200', 'new tier must have usable default');
      await page.close();
    }
  } finally {
    await browser?.close();
    server.child.kill('SIGTERM');
    await server.exited;
  }
});
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
    let version = '1';
    await page.route('**/api/admin/products/111/config', async (route) => {
      const request = route.request();
      if (request.headers().authorization !== 'Bearer synthetic-staff-token')
        return route.fulfill({ status: 401, json: { error: 'Missing synthetic staff token' } });
      if (request.method() === 'GET') {
        const value = response(current);
        value.config.draftVersion = version;
        return route.fulfill({ json: value });
      }
      if (request.method() !== 'PUT') return route.fulfill({ status: 405 });
      saved = request.postDataJSON();
      current = saved.draft;
      version = '2';
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
    await page.getByLabel('Shop amount (USD)').first().fill('4.50');
    await page.getByLabel('Shop amount (USD)').last().fill('3.00');
    await page.getByRole('button', { name: 'Add presentment override' }).first().click();
    await page.getByLabel('Presentment currency').fill('EUR');
    await page.getByLabel('Presentment amount').fill('4.00');
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

test('removing named choices drops only their labels including nested option value labels before save', {
  timeout: 25000,
}, async () => {
  const source = await readFile(new URL('../fixtures/polaris-1.1.snapshot', import.meta.url));
  assert.equal(createHash('sha256').update(source).digest('hex'), polarisSha);
  const server = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.shopify = { idToken: async () => 'synthetic-removal-token' };
    });
    await page.route(polarisUrl, (route) => route.fulfill({ body: source, contentType: 'text/javascript' }));
    await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
    await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
      route.fulfill({ body: '', contentType: 'text/javascript' }),
    );
    let current = draft();
    let version = '1';
    let saved;
    await page.route('**/api/admin/products/111/config', (route) => {
      const request = route.request();
      assert.equal(request.headers().authorization, 'Bearer synthetic-removal-token');
      if (request.method() === 'GET') {
        const value = response(current);
        value.config.draftVersion = version;
        return route.fulfill({ json: value });
      }
      assert.equal(request.method(), 'PUT');
      saved = request.postDataJSON();
      current = saved.draft;
      version = '2';
      return route.fulfill({ json: { kind: 'saved', draftVersion: version } });
    });
    await page.goto(server.base + '/admin/products/111/config');
    await page.getByText('Draft version 1').waitFor();
    await page.waitForFunction(() => document.querySelector('#insignia-visualizer canvas'));
    await page.getByLabel('Method name').fill('Keep print');
    await page.getByRole('button', { name: 'Add method', exact: true }).click();
    await page.getByLabel('Method name').last().fill('Remove unused method');
    await page
      .getByLabel('Method name')
      .last()
      .locator('..')
      .locator('..')
      .getByRole('button', { name: 'Remove', exact: true })
      .click();
    await page.getByRole('button', { name: 'Add production option' }).click();
    await page.getByLabel('Option name').fill('Remove thread');
    await page.getByLabel(/^Value .* name$/).fill('Remove navy');
    await page.getByRole('button', { name: 'Add production option' }).click();
    await page.getByLabel('Option name').last().fill('Keep finish');
    await page
      .getByLabel(/^Value .* name$/)
      .last()
      .fill('Keep matte');
    await page
      .getByLabel('Option name')
      .first()
      .locator('..')
      .locator('..')
      .getByRole('button', { name: 'Remove', exact: true })
      .click();
    await page.getByRole('button', { name: 'Add fixed price' }).click();
    await page.getByLabel('Price name').fill('Keep setup');
    await page.getByRole('button', { name: 'Add fixed price' }).click();
    await page.getByLabel('Price name').last().fill('Remove setup');
    await page.getByRole('button', { name: 'Remove price', exact: true }).last().click();
    await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
    await page.getByText('Draft saved.').waitFor();
    assert.deepEqual(saved.draft.labels.methods, { print: 'Keep print' });
    const option = saved.draft.productionOptions[0];
    assert.deepEqual(saved.draft.labels.options, { [option.id]: 'Keep finish' });
    assert.deepEqual(saved.draft.labels.values, { [option.id]: { [option.allowedValueIds[0]]: 'Keep matte' } });
    assert.deepEqual(saved.draft.labels.prices, { [saved.draft.pricingRules[0].id]: 'Keep setup' });
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

test('variant without a saved image override retains the portrait default until explicit landscape adoption', {
  timeout: 25000,
}, async () => {
  const source = await readFile(new URL('../fixtures/polaris-1.1.snapshot', import.meta.url));
  assert.equal(createHash('sha256').update(source).digest('hex'), polarisSha);
  const portrait = solidPng(40, 80, [220, 30, 30]);
  const landscape = solidPng(80, 40, [30, 60, 220]);
  const server = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1120, height: 900 } });
    await page.addInitScript(() => {
      window.shopify = { idToken: async () => 'synthetic-image-token' };
    });
    page.setDefaultTimeout(5000);
    await page.route(polarisUrl, (route) => route.fulfill({ body: source, contentType: 'text/javascript' }));
    await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
    await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
      route.fulfill({ body: '', contentType: 'text/javascript' }),
    );
    let current = draft();
    current.geometry.views[0].image = { revisionId: 'product_111', width: 40, height: 80 };
    current.geometry.views[0].variantImages = [];
    let version = '1';
    const saved = [];
    await page.route('**/api/admin/products/111/config', (route) => {
      const request = route.request();
      assert.equal(request.headers().authorization, 'Bearer synthetic-image-token');
      if (request.method() === 'GET') {
        const value = response(current);
        value.config.draftVersion = version;
        value.product.imageUrl = portrait;
        value.product.variants[0].imageUrl = landscape;
        return route.fulfill({ json: value });
      }
      assert.equal(request.method(), 'PUT');
      saved.push(request.postDataJSON());
      current = saved.at(-1).draft;
      version = String(Number(version) + 1);
      return route.fulfill({ json: { kind: 'saved', draftVersion: version } });
    });
    await page.goto(server.base + '/admin/products/111/config');
    await page.getByText('Draft version 1').waitFor();
    const waitForColor = (red, blue) =>
      page.waitForFunction(
        ({ red, blue }) => {
          const canvas = document.querySelector('#insignia-visualizer canvas');
          const pixel = canvas?.getContext('2d')?.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
          return pixel?.[0] === red && pixel?.[2] === blue;
        },
        { red, blue },
        { timeout: 5000 },
      );
    await waitForColor(220, 30);
    const canvas = page.locator('#insignia-visualizer canvas').first();
    const portraitPixels = await canvas.evaluate((element) => element.toDataURL());
    await page.getByLabel('Product variant').selectOption('variant_11');
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll('button')].find(
          (button) => button.textContent.trim() === 'Use selected product image',
        )?.disabled,
    );
    await page.getByLabel('Customization mode').selectOption('required');
    await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
    await page.getByText('Draft saved.').waitFor();
    assert.equal(
      await canvas.evaluate((element) => element.toDataURL()),
      portraitPixels,
      'Selecting an unconfigured variant must keep the saved portrait background',
    );
    assert.deepEqual(saved[0].draft.geometry.views[0].image, { revisionId: 'product_111', width: 40, height: 80 });
    assert.deepEqual(saved[0].draft.geometry.views[0].variantImages, []);
    await page.getByRole('button', { name: 'Use selected product image' }).click();
    await waitForColor(30, 220);
    assert.notEqual(await canvas.evaluate((element) => element.toDataURL()), portraitPixels);
    const bounds = await canvas.evaluate((element) => {
      const { width, height } = element;
      const data = element.getContext('2d').getImageData(0, 0, width, height).data;
      let left = width;
      let right = -1;
      let top = height;
      let bottom = -1;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const offset = (y * width + x) * 4;
          if (data[offset] === 30 && data[offset + 1] === 60 && data[offset + 2] === 220) {
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        }
      return { width: right - left + 1, height: bottom - top + 1 };
    });
    assert.ok(
      Math.abs(bounds.width / bounds.height - 2) < 0.02,
      'Adopted landscape must render with its exact aspect ratio',
    );
    await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
    await page.getByText('Draft version 3').waitFor();
    assert.deepEqual(saved[1].draft.geometry.views[0].image, { revisionId: 'product_111', width: 40, height: 80 });
    assert.deepEqual(saved[1].draft.geometry.views[0].variantImages, [
      { variantId: 'variant_11', image: { revisionId: 'variant_11', width: 80, height: 40 } },
    ]);
    assert.ok(
      !JSON.stringify(saved[1].draft.geometry).includes('data:image'),
      'Image URLs stay outside persisted geometry',
    );
  } finally {
    await browser?.close();
    server.child.kill('SIGTERM');
    await server.exited;
  }
});

test('merchant currency adoption refreshes saved publication eligibility and later failed or stale reads fail closed', {
  timeout: 25000,
}, async () => {
  const source = await readFile(new URL('../fixtures/polaris-1.1.snapshot', import.meta.url));
  assert.equal(createHash('sha256').update(source).digest('hex'), polarisSha);
  const server = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.shopify = { idToken: async () => 'synthetic-currency-token' };
    });
    await page.route(polarisUrl, (route) => route.fulfill({ body: source, contentType: 'text/javascript' }));
    await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
    await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
      route.fulfill({ body: '', contentType: 'text/javascript' }),
    );
    let saved;
    let current = draft();
    current.pricingRules = [
      {
        id: 'setup-price',
        role: 'setup',
        scope: { kind: 'general' },
        rate: { kind: 'fixed', amount: { shopDecimal: '4.50', presentmentOverrides: [] } },
      },
    ];
    let version = '1';
    let readCalls = 0;
    let refresh = 'current';
    await page.route('**/api/admin/products/111/config', (route) => {
      assert.equal(route.request().headers().authorization, 'Bearer synthetic-currency-token');
      if (route.request().method() === 'GET') {
        readCalls++;
        if (refresh === 'failed')
          return route.fulfill({ status: 503, json: { message: 'Synthetic read unavailable' } });
        const view = response(current);
        view.config.draftVersion = refresh === 'stale' ? '2' : version;
        view.config.currentShopCurrency = 'EUR';
        view.config.publishEligibility =
          current.shopCurrency === 'EUR'
            ? { allowed: true, reason: null }
            : { allowed: false, reason: 'Shop currency changed' };
        return route.fulfill({ json: view });
      }
      assert.equal(route.request().method(), 'PUT');
      saved = route.request().postDataJSON();
      assert.equal(saved.draftVersion, version);
      current = saved.draft;
      version = String(Number(version) + 1);
      return route.fulfill({ json: { kind: 'saved', draftVersion: version } });
    });
    await page.goto(server.base + '/admin/products/111/config');
    await page.getByText('Current shop currency: EUR', { exact: false }).waitFor();
    const publicationButton = page.locator('s-button').filter({ hasText: 'Request publication' });
    assert.equal(await publicationButton.evaluate((button) => button.disabled), true);
    assert.equal(await page.getByLabel('Shop amount (USD)').inputValue(), '4.50');
    await page.getByRole('button', { name: 'Use current shop currency' }).click();
    assert.equal(await page.getByLabel('Shop amount (EUR)').inputValue(), '4.50');
    await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
    await page.getByText('Draft saved.').waitFor();
    assert.equal(saved.draft.shopCurrency, 'EUR');
    assert.equal(saved.draft.pricingRules[0].rate.amount.shopDecimal, '4.50');
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('s-button')].some(
          (button) => button.textContent.trim() === 'Request publication' && !button.disabled,
        ),
      null,
      { timeout: 5000 },
    );
    assert.equal(readCalls, 2, 'Eligibility must come from the authoritative saved-version read');
    assert.equal(await page.getByText('Shop currency changed', { exact: true }).count(), 0);
    for (const outcome of ['failed', 'stale']) {
      refresh = outcome;
      await page.getByLabel('Shop amount (EUR)').fill(outcome === 'failed' ? '5.000' : '6.000');
      await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
      await page
        .getByText('Draft saved. Publication eligibility could not be verified. Reload before publishing.')
        .waitFor();
      await page.getByText(`Draft version ${outcome === 'failed' ? '3' : '4'} · saved`).waitFor();
      assert.equal(await publicationButton.evaluate((button) => button.disabled), true);
      assert.equal(await page.locator('s-button').filter({ hasText: 'Retry exact save' }).count(), 0);
      assert.equal(await page.locator('s-button').filter({ hasText: 'Review latest saved draft' }).count(), 0);
      assert.equal(await page.getByLabel('Shop amount (EUR)').inputValue(), outcome === 'failed' ? '5.000' : '6.000');
      assert.equal(await page.locator('fieldset').evaluate((element) => element.disabled), false);
    }
    assert.equal(readCalls, 4);
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
      if (mode === 'malformed') {
        uncertainKey = request.headers()['idempotency-key'];
        uncertainBody = body;
        return route.fulfill({ status: 200, body: '{bad-json', contentType: 'application/json' });
      }
      if (mode === 'malformed-retry') {
        assert.equal(request.headers()['idempotency-key'], uncertainKey);
        assert.deepEqual(body, uncertainBody);
        current = body.draft;
        version = '5';
        return route.fulfill({ json: { kind: 'saved', draftVersion: version } });
      }
      if (mode === 'wrong-version') {
        uncertainKey = request.headers()['idempotency-key'];
        uncertainBody = body;
        return route.fulfill({ json: { kind: 'saved', draftVersion: '999' } });
      }
      if (mode === 'wrong-version-retry') {
        assert.equal(request.headers()['idempotency-key'], uncertainKey);
        assert.deepEqual(body, uncertainBody);
        current = body.draft;
        version = '6';
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
    mode = 'malformed';
    await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
    await page.getByText('Save result is uncertain. Retry the exact request or reload.').waitFor();
    assert.equal(await page.getByText('Draft version 4').count(), 1);
    mode = 'malformed-retry';
    await page.locator('s-button').filter({ hasText: 'Retry exact save' }).click();
    await page.getByText('Draft saved.').waitFor();
    await page.getByText('Draft version 5').waitFor();
    mode = 'wrong-version';
    await page.getByLabel('Customization mode').selectOption('optional');
    await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
    await page.getByText('Save result is uncertain. Retry the exact request or reload.').waitFor();
    assert.equal(await page.getByText('Draft version 5').count(), 1);
    mode = 'wrong-version-retry';
    await page.locator('s-button').filter({ hasText: 'Retry exact save' }).click();
    await page.getByText('Draft version 6').waitFor();
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
        view.config.publication.sourceDraftVersion = phase === 'DRAFT' ? null : '1';
        view.config.publication.requestKey = phase === 'DRAFT' ? null : 'm5pub_config-1_1_1';
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

for (const saveMode of ['dirty', 'ambiguous']) {
  for (const publishMode of ['success', 'failed']) {
    test(`publication ${publishMode} preserves ${saveMode} local edits and exact save recovery`, {
      timeout: 25000,
    }, async () => {
      const source = await readFile(new URL('../fixtures/polaris-1.1.snapshot', import.meta.url));
      assert.equal(createHash('sha256').update(source).digest('hex'), polarisSha);
      const server = await startServer();
      let browser;
      try {
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        page.setDefaultTimeout(5000);
        await page.addInitScript(() => {
          window.shopify = { idToken: async () => 'synthetic-preserved-edit-token' };
        });
        await page.route(polarisUrl, (route) => route.fulfill({ body: source, contentType: 'text/javascript' }));
        await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
        await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
          route.fulfill({ body: '', contentType: 'text/javascript' }),
        );
        let current = draft();
        current.labels = { methods: { print: 'Saved name' } };
        let version = '2';
        let phase = 'PUBLISH_REQUESTED';
        let lostCommittedSaveRead = false;
        const saves = [];
        const publications = [];
        await page.route('**/api/admin/products/111/config', (route) => {
          const request = route.request();
          assert.equal(request.headers().authorization, 'Bearer synthetic-preserved-edit-token');
          if (request.method() === 'GET') {
            if (lostCommittedSaveRead) {
              lostCommittedSaveRead = false;
              return route.fulfill({ status: 503, json: { error: 'Synthetic recovery read unavailable' } });
            }
            const view = response(current);
            view.config.draftVersion = version;
            view.config.publishEligibility = { allowed: true, reason: null };
            view.config.publication = {
              ...view.config.publication,
              state: phase,
              revisionId: 'original-immutable-revision',
              sourceDraftVersion: '1',
              requestKey: 'original-publication-key',
            };
            return route.fulfill({ json: view });
          }
          const key = request.headers()['idempotency-key'];
          const body = request.postDataJSON();
          if (request.method() === 'POST') {
            publications.push({ key, body });
            assert.equal(key, 'original-publication-key');
            assert.deepEqual(body, { action: 'publish', configId: 'config-1', draftVersion: '1' });
            if (publishMode === 'failed') return route.abort('failed');
            phase = 'REMOTE_READY_ACTIVATION_PENDING';
            return route.fulfill({
              status: 202,
              json: { kind: 'accepted', state: phase, revisionId: 'original-immutable-revision' },
            });
          }
          assert.equal(request.method(), 'PUT');
          saves.push({ key, body });
          if (saveMode === 'ambiguous' && saves.length === 1) {
            if (publishMode === 'success') {
              current = body.draft;
              version = '3';
              lostCommittedSaveRead = true;
            }
            return route.abort('failed');
          }
          if (saveMode === 'ambiguous') assert.deepEqual(saves[1], saves[0], 'Retry preserves the exact save key/body');
          assert.equal(body.draftVersion, '2', 'Publication refresh must not change the save CAS base');
          current = body.draft;
          version = '3';
          return route.fulfill({ json: { kind: 'saved', draftVersion: version } });
        });
        await page.goto(server.base + '/admin/products/111/config');
        await page.getByText('Draft version 2').waitFor();
        await page.getByLabel('Method name').fill('Unsaved name');
        await page.getByLabel('Placement').first().selectOption('front');
        await page.getByLabel('centerX', { exact: true }).fill('0.6');
        await page.getByLabel('centerX', { exact: true }).press('Tab');
        if (saveMode === 'ambiguous') {
          await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
          await page.locator('s-button').filter({ hasText: 'Retry exact save' }).waitFor();
        }
        await page.evaluate(
          () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        const pixels = await page
          .locator('#insignia-visualizer canvas')
          .evaluateAll((nodes) => nodes.map((canvas) => canvas.toDataURL()));
        await page.locator('s-button').filter({ hasText: 'Continue publication' }).click();
        if (publishMode === 'success') await page.getByText('Remote ready; activation pending').waitFor();
        else await page.getByText(/Continue the same publication request after checking/).waitFor();
        assert.equal(await page.getByLabel('Method name').inputValue(), 'Unsaved name');
        await page.getByText(`Draft version 2 · ${saveMode}`).waitFor();
        assert.equal(await page.getByLabel('centerX', { exact: true }).inputValue(), '0.6');
        assert.deepEqual(
          await page
            .locator('#insignia-visualizer canvas')
            .evaluateAll((nodes) => nodes.map((canvas) => canvas.toDataURL())),
          pixels,
        );
        assert.equal(publications.length, 1);
        const action = saveMode === 'ambiguous' ? 'Retry exact save' : 'Save draft';
        await page.locator('s-button').filter({ hasText: action }).click();
        await page.getByText('Draft version 3 · saved').waitFor();
        assert.equal(saves.at(-1).body.draft.labels.methods.print, 'Unsaved name');
        assert.equal(saves.at(-1).body.draft.geometry.views[0].placements[0].rect.centerX, 0.6);
        assert.equal(saves.length, saveMode === 'ambiguous' ? 2 : 1);
      } finally {
        await browser?.close();
        server.child.kill('SIGTERM');
        await server.exited;
      }
    });
  }
}

test('publication retry keeps the original version after a newer draft edit when embedded storage is denied', {
  timeout: 30000,
}, async () => {
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
    let writes = 0;
    await page.route('**/api/admin/products/111/config', (route) => {
      if (route.request().method() === 'GET') {
        const view = response(draft());
        view.config.draftVersion = '2';
        view.config.publishEligibility = { allowed: false, reason: 'Newer draft is ineligible' };
        view.config.publication.state = state;
        view.config.publication.revisionId = 'same-immutable-revision';
        view.config.publication.sourceDraftVersion = '1';
        view.config.publication.requestKey = 'm5pub_config-1_1_1';
        return route.fulfill({ json: view });
      }
      const key = route.request().headers()['idempotency-key'];
      const body = route.request().postDataJSON();
      assert.equal(key, 'm5pub_config-1_1_1');
      assert.equal(body.draftVersion, '1');
      observedKey = key;
      writes++;
      if (writes === 1) return route.abort('failed');
      state = 'REMOTE_READY_ACTIVATION_PENDING';
      return route.fulfill({ status: 202, json: { kind: 'accepted', state, revisionId: 'same-immutable-revision' } });
    });
    await page.goto(server.base + '/admin/products/111/config');
    await page.locator('s-button').filter({ hasText: 'Continue publication' }).click();
    await page.getByText(/Continue the same publication request/).waitFor();
    await page.reload();
    await page.getByText('Draft version 2').waitFor();
    await page.locator('s-button').filter({ hasText: 'Continue publication' }).click();
    await page.getByText('Remote ready; activation pending').waitFor();
    assert.equal(observedKey, 'm5pub_config-1_1_1');
    assert.equal(writes, 2);
  } finally {
    await browser?.close();
    server.child.kill('SIGTERM');
    await server.exited;
  }
});

test('stale stored publication is replaced by the current immutable intent despite newer ineligible draft', {
  timeout: 25000,
}, async () => {
  const source = await readFile(new URL('../fixtures/polaris-1.1.snapshot', import.meta.url));
  const server = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.shopify = { idToken: async () => 'synthetic-stale-publication-token' };
    });
    await page.route(polarisUrl, (route) => route.fulfill({ body: source, contentType: 'text/javascript' }));
    await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
      route.fulfill({ body: '', contentType: 'text/javascript' }),
    );
    let state = 'PUBLISH_REQUESTED';
    let writes = 0;
    await page.route('**/api/admin/products/111/config', (route) => {
      if (route.request().method() === 'GET') {
        const view = response(draft());
        view.config.draftVersion = '3';
        view.config.publishEligibility = { allowed: false, reason: 'Newer draft feature unavailable' };
        view.config.publication.state = state;
        view.config.publication.revisionId = 'revision-B';
        view.config.publication.sourceDraftVersion = '2';
        view.config.publication.requestKey = 'publish-key-B';
        return route.fulfill({ json: view });
      }
      writes++;
      assert.equal(route.request().headers()['idempotency-key'], 'publish-key-B');
      assert.equal(route.request().postDataJSON().draftVersion, '2');
      state = 'REMOTE_READY_ACTIVATION_PENDING';
      return route.fulfill({ status: 202, json: { kind: 'accepted', state, revisionId: 'revision-B' } });
    });
    await page.goto(server.base + '/live');
    await page.evaluate(() =>
      sessionStorage.setItem(
        'insignia:m5:publish:111',
        JSON.stringify({
          method: 'POST',
          body: { action: 'publish', configId: 'config-1', draftVersion: '1' },
          key: 'm5pub_config-1_1',
          installationGeneration: '1',
        }),
      ),
    );
    await page.goto(server.base + '/admin/products/111/config');
    await page.getByText('Newer draft feature unavailable').waitFor();
    await page.locator('s-button').filter({ hasText: 'Continue publication' }).click();
    await page.getByText('Remote ready; activation pending').waitFor();
    assert.equal(writes, 1);
  } finally {
    await browser?.close();
    server.child.kill('SIGTERM');
    await server.exited;
  }
});

test('reinstalled Admin discards prior-generation browser request and publishes with a new key', {
  timeout: 25000,
}, async () => {
  const source = await readFile(new URL('../fixtures/polaris-1.1.snapshot', import.meta.url));
  const server = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.shopify = { idToken: async () => 'synthetic-reinstall-token' };
    });
    await page.route(polarisUrl, (route) => route.fulfill({ body: source, contentType: 'text/javascript' }));
    await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
      route.fulfill({ body: '', contentType: 'text/javascript' }),
    );
    let received;
    let phase = 'DRAFT';
    await page.route('**/api/admin/products/111/config', (route) => {
      if (route.request().method() === 'GET') {
        const view = response(draft());
        view.config.installationGeneration = '2';
        view.config.publishEligibility = { allowed: true, reason: null };
        view.config.publication.state = phase;
        return route.fulfill({ json: view });
      }
      received = {
        key: route.request().headers()['idempotency-key'],
        body: route.request().postDataJSON(),
      };
      phase = 'REMOTE_READY_ACTIVATION_PENDING';
      return route.fulfill({ status: 202, json: { kind: 'accepted', state: phase, revisionId: 'new-revision' } });
    });
    await page.goto(server.base + '/live');
    await page.evaluate(() =>
      sessionStorage.setItem(
        'insignia:m5:publish:111',
        JSON.stringify({
          method: 'POST',
          body: { action: 'publish', configId: 'config-1', draftVersion: '1' },
          key: 'm5pub_config-1_1_1',
          installationGeneration: '1',
        }),
      ),
    );
    await page.goto(server.base + '/admin/products/111/config');
    await page.getByText('Draft version 1').waitFor();
    await page.locator('s-button').filter({ hasText: 'Request publication' }).click();
    await page.getByText('Remote ready; activation pending').waitFor();
    assert.equal(received.key, 'm5pub_config-1_2_1');
    assert.deepEqual(received.body, { action: 'publish', configId: 'config-1', draftVersion: '1' });
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
      const value = response(saved?.draft ?? colon);
      value.config.draftVersion = saved ? '2' : '1';
      return route.fulfill({ json: value });
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
      const value = response(saved?.draft ?? empty);
      value.config.draftVersion = saved ? '2' : '1';
      return route.fulfill({ json: value });
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
