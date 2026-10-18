import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { crc32, deflateSync } from 'node:zlib';
import { validatePublishedConfig } from '@insignia/domain';
import { chromium } from 'playwright';

const polarisUrl = 'https://cdn.shopify.com/shopifycloud/polaris-1.1.js';
const polarisSha = '912455ad068713e7595f5a506fb7433a078554c327cf0fd30ce86ccb214818fe';
// Keep external icon delivery at the CDN boundary; this stub does not qualify native icon artwork.
async function routePolaris(target, source) {
  await target.route(polarisUrl, (route) => route.fulfill({ body: source, contentType: 'text/javascript' }));
  await target.route('https://cdn.shopify.com/shopifycloud/admin-ui-foundations/icons/**', (route) =>
    route.fulfill({
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M2 2h16v16H2z"/></svg>',
      contentType: 'image/svg+xml',
    }),
  );
}

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const id = 'gid://shopify/Product/111';
const variant = 'gid://shopify/ProductVariant/11';
test('every merchant route declares the same native Shopify sidebar before private data loads', {
  timeout: 20000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-sidebar-token' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
    route.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
  await page.route('**/api/**', (route) => route.fulfill({ status: 403, json: { error: 'forbidden' } }));
  for (const path of [
    '/admin/products',
    '/admin/products/111/config',
    '/admin/orders',
    '/admin/orders/d841ee12-2075-4101-b3bc-429ad31a4059',
    '/admin/settings/billing',
    '/admin/settings/privacy',
    '/admin/settings',
  ]) {
    const response = await page.goto(server.base + path);
    assert.equal(response.status(), 200);
    assert.equal(response.headers()['cache-control'], 'private, no-store');
    const navigation = page.locator('body > s-app-nav');
    assert.equal(await navigation.count(), 1, 'Shopify receives one app-level navigation declaration');
    assert.equal(await navigation.locator('s-link[rel="home"]').getAttribute('href'), '/admin/products');
    for (const [label, destination] of [
      ['Products', '/admin/products'],
      ['Orders', '/admin/orders'],
      ['Settings', '/admin/settings'],
    ]) {
      assert.equal(
        await navigation
          .locator('s-link:not([rel="home"])')
          .filter({ hasText: new RegExp('^' + label + '$') })
          .getAttribute('href'),
        destination,
      );
    }
    assert.equal(await navigation.locator('s-link').count(), 4, 'Billing and Privacy belong under Settings');
    assert.equal(await page.locator('s-page .admin-navigation').count(), 0, 'No duplicate iframe navigation');
  }
});
test('merchant product screens expose no technical signing setup or setup requests', { timeout: 20000 }, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-signing-status' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
    route.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
  await page.route('**/api/admin/products?*', (route) => route.fulfill({ json: { products: [], nextCursor: null } }));
  const signingRequests = [];
  await page.route('**/api/admin/signing', (route) => {
    signingRequests.push(route.request().method());
    return route.fulfill({ status: 503 });
  });
  await page.goto(server.base + '/admin/products');
  await page.getByText('No products found.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Check signing setup', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Set up signing', exact: true }).count(), 0);
  assert.deepEqual(signingRequests, []);
});
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
async function browserFixture(t) {
  const source = await readFile(new URL('../fixtures/polaris-1.1.snapshot', import.meta.url));
  assert.equal(createHash('sha256').update(source).digest('hex'), polarisSha);
  const server = await startServer();
  let browser;
  t.after(async () => {
    try {
      await browser?.close();
    } finally {
      server.child.kill('SIGTERM');
      await server.exited;
    }
  });
  browser = await chromium.launch({ headless: true, channel: 'chromium' });
  return { source, server, browser };
}
async function startServer() {
  const child = spawn(process.execPath, [new URL('../../dist/server/entry.mjs', import.meta.url).pathname], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', SHOPIFY_CLIENT_ID: '11111111111111111111111111111111' },
  });
  const exited = new Promise((resolve) => child.once('close', resolve));
  let diagnostics = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      diagnostics = (diagnostics + chunk.toString()).slice(-8192);
    });
  let base;
  for (let i = 0; i < 100 && child.exitCode === null; i++) {
    try {
      base = diagnostics.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (base && (await fetch(base + '/live')).ok) return { base, child, exited };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill('SIGTERM');
  await exited;
  throw new Error('Web server did not start: ' + diagnostics);
}
test('built picker refreshes once on 401; second 401, 403 and 503 stop without another request', {
  timeout: 60000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  for (const statuses of [[401, 200], [401, 401], [403], [503]]) {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.syntheticTokenCount = 0;
      window.shopify = { idToken: async () => 'synthetic-refresh-' + ++window.syntheticTokenCount };
    });
    await routePolaris(page, source);
    await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
    await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
      route.fulfill({ body: '', contentType: 'text/javascript' }),
    );
    let active = false;
    const tokens = [];
    await page.route('**/api/admin/products?*', (route) => {
      const request = route.request();
      assert.equal(request.method(), 'GET');
      assert.equal(request.headers().cookie, undefined);
      const status = active ? statuses[tokens.length] : 200;
      if (active) tokens.push(request.headers().authorization);
      assert.ok(status, 'no third retry request is allowed');
      return route.fulfill({
        status,
        headers: status === 401 ? { 'X-Shopify-Retry-Invalid-Session-Request': '1' } : {},
        json:
          status === 200 ? { products: [], nextCursor: null } : { error: 'Synthetic authentication stopped ' + status },
      });
    });
    await page.goto(server.base + '/admin/products');
    await page.getByText('No products found.').waitFor();
    await page.evaluate(() => {
      window.syntheticTokenCount = 0;
    });
    active = true;
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const finalStatus = statuses.at(-1);
    await page
      .getByText(finalStatus === 200 ? 'No products found.' : 'Synthetic authentication stopped ' + finalStatus, {
        exact: true,
      })
      .waitFor();
    assert.equal(await page.evaluate(() => window.syntheticTokenCount), statuses.length);
    assert.deepEqual(
      tokens,
      statuses.map((_, index) => 'Bearer synthetic-refresh-' + (index + 1)),
    );
    await page.close();
  }
});
test('historical advanced pricing stays read-only until an explicit local Lean proposal', {
  timeout: 20000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-lean-conversion' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
    route.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  const current = draft();
  current.pricingRules = [
    {
      id: 'historical',
      role: 'setup',
      scope: { kind: 'general' },
      rate: { kind: 'fixed', amount: { shopDecimal: '10', presentmentOverrides: [{ currency: 'EUR', decimal: '9' }] } },
    },
  ];
  let writes = 0,
    saved;
  await page.route('**/api/admin/products/111/config', (route) => {
    if (route.request().method() === 'GET') {
      const view = response(current);
      view.config.publication.activeRevisionId = 'historical-revision';
      return route.fulfill({ json: view });
    }
    writes++;
    saved = route.request().postDataJSON();
    return route.fulfill({ json: { kind: 'saved', draftVersion: '2' } });
  });
  await page.goto(server.base + '/admin/products/111/config?view=all');
  await page.getByRole('region', { name: 'Historical pricing' }).waitFor({ timeout: 1500 });
  assert.match(await page.getByRole('region', { name: 'Historical pricing' }).innerText(), /10 USD; 9 EUR/);
  for (const name of ['Add fixed price', 'Add quantity tier', 'Add presentment override'])
    assert.equal(await page.getByRole('button', { name }).count(), 0);
  assert.equal(writes, 0);
  await page.getByRole('button', { name: 'Set decoration prices' }).click();
  assert.equal(writes, 0, 'Starting a proposal changes local draft only');
  assert.equal(current.pricingRules[0].role, 'setup');
  await page.getByText('Effective revision: historical-revision', { exact: true }).waitFor({ state: 'attached' });
  const price = page.getByLabel('Method 1 / Placement 1 / Size step 1 — surcharge (USD)', { exact: true });
  assert.equal(await price.inputValue(), '');
  for (const invalid of ['-1', '1.001']) {
    await price.fill(invalid);
    await page.getByRole('alert').filter({ hasText: 'Enter a nonnegative amount' }).waitFor();
    assert.equal(
      await page
        .locator('s-button')
        .filter({ hasText: 'Save draft' })
        .evaluate((button) => button.disabled),
      true,
    );
  }
  await price.fill('2.50');
  await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
  await page.getByText('Draft saved.').waitFor();
  assert.equal(writes, 1);
  assert.equal(saved.draft.pricingRules.length, 1);
  assert.equal(saved.draft.pricingRules[0].role, 'unit');
  assert.deepEqual(saved.draft.pricingRules[0].rate, {
    kind: 'fixed',
    amount: { shopDecimal: '2.50', presentmentOverrides: [] },
  });
});
test('real browser editor syncs typed view, variant and step controls with direct Konva canvas and saved draft', {
  timeout: 45000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
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
  await routePolaris(page, source);
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
  const opened = await page.goto(server.base + '/admin/products/111/config?view=all');
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
  assert.equal(Number(await page.getByLabel('Horizontal position', { exact: true }).inputValue()), 0.4);
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
  await page.getByLabel('Horizontal position', { exact: true }).waitFor();
  const moved = Number(await page.getByLabel('Horizontal position', { exact: true }).inputValue());
  assert.ok(moved > 0.4 && moved < 0.6, 'Konva drag must update the typed placement field: ' + moved);
  await page.getByLabel('Method 1 / Placement 1 / Size step 1 — surcharge (USD)', { exact: true }).fill('4.50');
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
  assert.equal(saved.draft.pricingRules[0].rate.amount.shopDecimal, '4.50');
  assert.ok(saved.draft.geometry.views[0].placements[0].variantOverrides[0].rect.centerX > 0.4);
  assert.ok((await page.evaluate(() => window.__tokenCount)) >= 2);
  assert.deepEqual(errors, []);
});
test('removing named choices drops only their labels including nested option value labels before save', {
  timeout: 25000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-removal-token' };
  });
  await routePolaris(page, source);
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
  await page.goto(server.base + '/admin/products/111/config?view=all');
  await page.getByText('Draft version 1').waitFor();
  await page.waitForFunction(() => document.querySelector('#insignia-visualizer canvas'));
  await page.getByLabel('Method name').fill('Keep print');
  await page.getByRole('button', { name: 'Add method', exact: true }).click();
  await page.getByLabel('Method name').last().fill('Remove unused method');
  await page.getByRole('button', { name: 'Remove method', exact: true }).last().click();
  await page.getByRole('button', { name: 'Add production option' }).click();
  await page.getByLabel('Option name').fill('Remove thread');
  await page.getByLabel(/^Value .* name$/).fill('Remove navy');
  await page.getByRole('button', { name: 'Add production option' }).click();
  await page.getByLabel('Option name').last().fill('Keep finish');
  await page
    .getByLabel(/^Value .* name$/)
    .last()
    .fill('Keep matte');
  await page.getByRole('button', { name: 'Remove option', exact: true }).first().click();
  await page.getByLabel('Keep print / Placement 1 / Size step 1 — surcharge (USD)', { exact: true }).fill('2.00');
  await page.getByRole('button', { name: 'Make unavailable' }).click();
  await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
  await page.getByText('Draft saved.').waitFor();
  assert.deepEqual(saved.draft.labels.methods, { print: 'Keep print' });
  const option = saved.draft.productionOptions[0];
  assert.deepEqual(saved.draft.labels.options, { [option.id]: 'Keep finish' });
  assert.deepEqual(saved.draft.labels.values, { [option.id]: { [option.allowedValueIds[0]]: 'Keep matte' } });
  assert.deepEqual(saved.draft.pricingRules, []);
  assert.deepEqual(saved.draft.labels.prices ?? {}, {});
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
});
test('variant without a saved image override retains the portrait default until explicit landscape adoption', {
  timeout: 25000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const portrait = solidPng(40, 80, [220, 30, 30]);
  const landscape = solidPng(80, 40, [30, 60, 220]);
  const page = await browser.newPage({ viewport: { width: 1120, height: 900 } });
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-image-token' };
  });
  page.setDefaultTimeout(5000);
  await routePolaris(page, source);
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
  await page.goto(server.base + '/admin/products/111/config?view=all');
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
      ![...document.querySelectorAll('s-button')].find(
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
});
test('merchant currency adoption refreshes saved publication eligibility and later failed or stale reads fail closed', {
  timeout: 25000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-currency-token' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
    route.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  let saved;
  let current = draft();
  current.pricingRules = [
    {
      id: 'unit-price',
      role: 'unit',
      scope: { kind: 'step', placementId: 'front', stepId: 'small', methodId: 'print' },
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
      if (refresh === 'failed') return route.fulfill({ status: 503, json: { message: 'Synthetic read unavailable' } });
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
  await page.goto(server.base + '/admin/products/111/config?view=all');
  await page.getByText('Current shop currency: EUR', { exact: false }).waitFor();
  const publicationButton = page.locator('s-button').filter({ hasText: 'Publish saved changes' });
  assert.equal(await publicationButton.evaluate((button) => button.disabled), true);
  assert.equal(
    await page.getByLabel('Method 1 / Placement 1 / Size step 1 — surcharge (USD)', { exact: true }).inputValue(),
    '4.50',
  );
  await page.getByRole('button', { name: 'Use current shop currency' }).click();
  assert.equal(
    await page.getByLabel('Method 1 / Placement 1 / Size step 1 — surcharge (EUR)', { exact: true }).inputValue(),
    '4.50',
  );
  await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
  await page.getByText('Draft saved.').waitFor();
  assert.equal(saved.draft.shopCurrency, 'EUR');
  assert.equal(saved.draft.pricingRules[0].rate.amount.shopDecimal, '4.50');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('s-button')].some(
        (button) => button.textContent.trim() === 'Publish saved changes' && !button.disabled,
      ),
    null,
    { timeout: 5000 },
  );
  assert.equal(readCalls, 2, 'Eligibility must come from the authoritative saved-version read');
  assert.equal(await page.getByText('Shop currency changed', { exact: true }).count(), 0);
  for (const outcome of ['failed', 'stale']) {
    refresh = outcome;
    await page
      .getByLabel('Method 1 / Placement 1 / Size step 1 — surcharge (EUR)', { exact: true })
      .fill(outcome === 'failed' ? '5.00' : '6.00');
    await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
    await page
      .getByText('Draft saved. Publication eligibility could not be verified. Reload before publishing.')
      .waitFor();
    await page.getByText(`Draft version ${outcome === 'failed' ? '3' : '4'}`).waitFor();
    assert.equal(await publicationButton.evaluate((button) => button.disabled), true);
    assert.equal(await page.locator('s-button').filter({ hasText: 'Retry saving' }).count(), 0);
    assert.equal(await page.locator('s-button').filter({ hasText: 'Review latest saved draft' }).count(), 0);
    assert.equal(
      await page.getByLabel('Method 1 / Placement 1 / Size step 1 — surcharge (EUR)', { exact: true }).inputValue(),
      outcome === 'failed' ? '5.00' : '6.00',
    );
    assert.equal(await page.getByLabel('Method name', { exact: true }).isEnabled(), true);
    assert.equal(
      await page.getByLabel('Method 1 / Placement 1 / Size step 1 — surcharge (EUR)', { exact: true }).isEnabled(),
      true,
    );
  }
  assert.equal(readCalls, 4);
});
test('mobile deep link, cookie-free reload, interrupted save, stale conflict, and missing Polaris control', {
  timeout: 45000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const html = await (await fetch(server.base + '/admin/products/111/config')).text();
  assert.ok(!html.includes('Synthetic shirt') && !html.includes('synthetic-staff-token'));
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
  await routePolaris(page, source);
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
  await page.goto(server.base + '/admin/products/111/config?view=all&id_token=synthetic-url-token');
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
  assert.equal(await page.locator('s-button').filter({ hasText: 'Retry saving' }).count(), 1);
  mode = 'retry';
  await page.locator('s-button').filter({ hasText: 'Retry saving' }).click();
  await page.getByText('Draft saved.').waitFor();
  assert.equal(writes, 4);
  assert.equal(current.mode, 'optional');
  mode = 'denied';
  await page.getByLabel('Customization mode').selectOption('required');
  await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
  await page.getByText('Synthetic permission denied').waitFor();
  assert.equal(await page.locator('s-button').filter({ hasText: 'Retry saving' }).count(), 0);
  assert.equal(await page.locator('s-section[heading="Synthetic shirt"]').count(), 0);
  mode = 'invalid';
  await page.reload();
  await page.getByText('Draft version 4').waitFor();
  await page.getByLabel('Customization mode').selectOption('required');
  await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
  await page.getByText('Synthetic draft invalid').waitFor();
  assert.equal(await page.locator('s-button').filter({ hasText: 'Retry saving' }).count(), 0);
  mode = 'malformed';
  await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
  await page.getByText('Save result is uncertain. Retry the exact request or reload.').waitFor();
  assert.equal(await page.getByText('Draft version 4').count(), 1);
  mode = 'malformed-retry';
  await page.locator('s-button').filter({ hasText: 'Retry saving' }).click();
  await page.getByText('Draft saved.').waitFor();
  await page.getByText('Draft version 5').waitFor();
  mode = 'wrong-version';
  await page.getByLabel('Customization mode').selectOption('optional');
  await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
  await page.getByText('Save result is uncertain. Retry the exact request or reload.').waitFor();
  assert.equal(await page.getByText('Draft version 5').count(), 1);
  mode = 'wrong-version-retry';
  await page.locator('s-button').filter({ hasText: 'Retry saving' }).click();
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
  await missingPage.goto(server.base + '/admin/products/111/config?view=all');
  await missingPage
    .getByText('Reopen Insignia from Shopify Admin to try again.', { exact: true })
    .waitFor({ timeout: 20000 });
  assert.equal(await missingPage.locator('#admin-route-content').evaluate((element) => element.inert), true);
  assert.equal(await missingPage.evaluate(() => !!customElements.get('s-button')), false);
  assert.equal(
    await missingPage
      .locator('s-button')
      .filter({ hasText: 'Save draft' })
      .evaluate((button) => button.shadowRoot),
    null,
  );
});
for (const invalidPrice of ['-1', '1.001']) {
  test(`invalid Lean price ${invalidPrice} blocks new publication and copying until corrected`, {
    timeout: 25000,
  }, async (t) => {
    const { source, server, browser } = await browserFixture(t);
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.shopify = { idToken: async () => 'synthetic-price-gate' };
    });
    await routePolaris(page, source);
    await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
      route.fulfill({ body: '', contentType: 'text/javascript' }),
    );
    let current = draft();
    let version = '1';
    const writes = [];
    await page.route('**/api/admin/products/111/config', (route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        const view = response(current);
        view.config.draftVersion = version;
        view.config.publishEligibility = { allowed: true, reason: null };
        return route.fulfill({ json: view });
      }
      const body = request.postDataJSON();
      writes.push(body);
      if (request.method() === 'PUT') {
        current = body.draft;
        version = '2';
        return route.fulfill({ json: { kind: 'saved', draftVersion: version } });
      }
      return route.fulfill({ status: 202, json: { kind: 'accepted', state: 'ACTIVE' } });
    });
    await page.goto(server.base + '/admin/products/111/config?view=all');
    await page.getByText('Draft version 1').waitFor();
    const publish = page.locator('s-button').filter({ hasText: 'Publish saved changes' });
    const copy = page.locator('s-button').filter({ hasText: 'Copy configuration' });
    await page.getByText('Copy to another product', { exact: true }).click();
    await page.route('**/api/admin/products?*', (route) =>
      route.fulfill({
        json: {
          products: [
            {
              id: 'gid://shopify/Product/222',
              title: 'Destination shirt',
              status: 'DRAFT',
              variants: [],
              imageUrl: null,
            },
          ],
          nextCursor: null,
        },
      }),
    );
    await page.getByRole('button', { name: 'Find destination products', exact: true }).click({ timeout: 2000 });
    await page.getByRole('combobox', { name: 'Destination product', exact: true }).selectOption('222');
    assert.equal(await publish.evaluate((button) => button.disabled), false);
    assert.equal(await copy.evaluate((button) => button.disabled), false);
    const price = page.getByLabel('Method 1 / Placement 1 / Size step 1 — surcharge (USD)');
    await price.fill(invalidPrice);
    await page.getByText('Enter a nonnegative amount with at most two decimal places.', { exact: true }).waitFor();
    assert.equal(await publish.evaluate((button) => button.disabled), true);
    assert.equal(await copy.evaluate((button) => button.disabled), true);
    // A synthetic event also exercises handler guards, independently of custom-element disabling.
    await publish.evaluate((button) => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await copy.evaluate((button) => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    assert.deepEqual(writes, []);
    await price.fill('2.50');
    await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
    await page.getByText('Draft saved.', { exact: true }).waitFor();
    assert.equal(await publish.evaluate((button) => button.disabled), false);
    assert.equal(await copy.evaluate((button) => button.disabled), false);
    await publish.click();
    await page.getByText('Publication state refreshed.', { exact: true }).waitFor();
    assert.equal(writes.filter((body) => body.action === 'publish').length, 1);
    assert.equal(writes[0].draft.pricingRules[0].rate.amount.shopDecimal, '2.50');
    await copy.click();
    await page.waitForURL('**/admin/products/222/config');
    assert.equal(writes.filter((body) => body.action === 'copy').length, 1);
  });
}
test('interrupted publication resumes the identical request after reload and reaches a durable phase', {
  timeout: 30000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-publish-token' };
  });
  await routePolaris(page, source);
  page.setDefaultTimeout(5000);
  // Font CDN latency is unrelated to publication identity and must not block page load.
  await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
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
  await page.goto(server.base + '/admin/products/111/config?view=all');
  await page.getByText('Draft version 1').waitFor();
  await page.locator('s-button').filter({ hasText: 'Publish saved changes' }).click();
  await page.getByText(/Continue the same publication request/).waitFor();
  assert.equal(writes, 1);
  await page.reload();
  await page.getByLabel('Method 1 / Placement 1 / Size step 1 — surcharge (USD)').fill('-1');
  const continuePublication = page.locator('s-button').filter({ hasText: 'Continue publication' });
  assert.equal(await continuePublication.evaluate((button) => button.disabled), false);
  assert.equal(
    await page
      .locator('s-button')
      .filter({ hasText: 'Copy configuration' })
      .evaluate((button) => button.disabled),
    true,
  );
  await continuePublication.click();
  await page.getByText('Shopify settings updated; activation is pending').waitFor();
  assert.equal(writes, 3);
  assert.equal(
    JSON.parse(await page.evaluate(() => sessionStorage.getItem('insignia:m5:publish:111'))).key,
    firstKey,
    'Activation continuation keeps the original request identity',
  );
});
test('numeric placement input reaches owner state before blur and survives an owner rerender', {
  timeout: 25000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-owner-input-token' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
  let current = draft();
  let version = '1';
  let saved;
  await page.route('**/api/admin/products/111/config', (route) => {
    if (route.request().method() === 'GET') {
      const view = response(current);
      view.config.draftVersion = version;
      return route.fulfill({ json: view });
    }
    assert.equal(route.request().method(), 'PUT');
    saved = route.request().postDataJSON();
    current = saved.draft;
    version = String(BigInt(version) + 1n);
    return route.fulfill({ json: { kind: 'saved', draftVersion: version } });
  });
  await page.goto(server.base + '/admin/products/111/config?view=all');
  await page.getByLabel('Print area', { exact: true }).selectOption('front');
  await page.getByText('Preview: ready', { exact: true }).waitFor();
  await page.getByLabel('Horizontal position', { exact: true }).fill('0.6');
  await page.getByLabel('Print size', { exact: true }).evaluate((select) => {
    select.value = 'small';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  assert.equal(await page.getByLabel('Horizontal position', { exact: true }).inputValue(), '0.6');
  assert.equal(
    await page.getByLabel('Horizontal position', { exact: true }).evaluate((input) => {
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      return input === active;
    }),
    true,
  );
  await page.waitForFunction(() => {
    const preview = document.querySelector('#insignia-visualizer');
    const scene = JSON.parse(preview.getAttribute('data-projected-geometry'));
    const placement = scene.placements.find((item) => item.id === 'front');
    const actual = (placement.bounds.x - scene.contentRect.x + placement.bounds.width / 2) / scene.contentRect.width;
    return scene.version === Number(preview.getAttribute('data-editor-version')) && Math.abs(actual - 0.6) < 1e-12;
  });
  await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
  await page.getByText('Draft saved.', { exact: true }).waitFor();
  assert.equal(saved.draft.geometry.views[0].placements[0].rect.centerX, 0.6);
  await page.reload();
  await page.getByLabel('Print area', { exact: true }).selectOption('front');
  assert.equal(await page.getByLabel('Horizontal position', { exact: true }).inputValue(), '0.6');
  await page.getByLabel('Horizontal position', { exact: true }).fill('');
  await page.getByLabel('Horizontal position', { exact: true }).pressSequentially('0.605');
  await page.getByLabel('Print size', { exact: true }).evaluate((select) => {
    select.value = 'large';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  assert.equal(await page.getByLabel('Horizontal position', { exact: true }).inputValue(), '0.605');
  await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
  await page.getByText('Draft saved.', { exact: true }).waitFor();
  assert.equal(saved.draft.geometry.views[0].placements[0].rect.centerX, 0.605);
  await page.getByLabel('Horizontal position', { exact: true }).fill('1.2');
  await page.getByLabel('Horizontal position', { exact: true }).press('Tab');
  await page.getByText('Preview: placement rectangle must fit inside normalized image', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Horizontal position', { exact: true }).inputValue(), '0.605');
  await page.reload();
  await page.getByLabel('Print area', { exact: true }).selectOption('front');
  assert.equal(await page.getByLabel('Horizontal position', { exact: true }).inputValue(), '0.605');
});
const stressIterations = Number(process.env.M5_PUBLICATION_STRESS_ITERATIONS ?? '1');
if (!Number.isInteger(stressIterations) || stressIterations < 1 || stressIterations > 100)
  throw new Error('Invalid publication stress iteration count');
for (let iteration = 1; iteration <= stressIterations; iteration++) {
  for (const saveMode of ['dirty', 'ambiguous']) {
    for (const publishMode of ['success', 'failed']) {
      test(`publication ${publishMode} preserves ${saveMode} local edits and exact save recovery [${iteration}/${stressIterations}]`, {
        timeout: 25000,
      }, async (t) => {
        const { source, server, browser } = await browserFixture(t);
        let page;
        try {
          page = await browser.newPage();
          page.setDefaultTimeout(5000);
          await page.addInitScript(() => {
            window.shopify = { idToken: async () => 'synthetic-preserved-edit-token' };
          });
          await routePolaris(page, source);
          await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
          await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
            route.fulfill({ body: '', contentType: 'text/javascript' }),
          );
          if (process.env.M5_STRESS_BLOCK_VISUALIZER === '1') {
            const directory = new URL('../../dist/client/_astro/', import.meta.url);
            let blocked = 0;
            for (const name of await readdir(directory)) {
              if (
                name.endsWith('.js') &&
                /as createVisualizer[,}]/.test(await readFile(new URL(name, directory), 'utf8'))
              ) {
                blocked++;
                await page.route('**/_astro/' + name, (route) => route.abort('failed'));
              }
            }
            assert.equal(blocked, 1, 'Control must block the actual built renderer module');
          }
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
            if (saveMode === 'ambiguous')
              assert.deepEqual(saves[1], saves[0], 'Retry preserves the exact save key/body');
            assert.equal(body.draftVersion, '2', 'Publication refresh must not change the save CAS base');
            current = body.draft;
            version = '3';
            return route.fulfill({ json: { kind: 'saved', draftVersion: version } });
          });
          await page.goto(server.base + '/admin/products/111/config?view=all');
          await page.getByText('Draft version 2').waitFor();
          await page.getByLabel('Method name').fill('Unsaved name');
          await page.getByLabel('Print area', { exact: true }).selectOption('front');
          await page.getByLabel('Horizontal position', { exact: true }).fill('0.6');
          await page.getByLabel('Horizontal position', { exact: true }).press('Tab');
          if (saveMode === 'ambiguous') {
            await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
            await page.locator('s-button').filter({ hasText: 'Retry saving' }).waitFor();
          }
          await page.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          );
          await page.getByText('Preview: ready', { exact: true }).waitFor();
          await page.waitForFunction(() => {
            const preview = document.querySelector('#insignia-visualizer');
            const raw = preview?.getAttribute('data-projected-geometry');
            if (!raw || preview.querySelectorAll('canvas').length !== 3) return false;
            const scene = JSON.parse(raw);
            const placement = scene.placements.find((item) => item.id === 'front');
            if (
              !placement ||
              !scene.contentRect ||
              scene.version !== Number(preview.getAttribute('data-editor-version'))
            )
              return false;
            const centerX =
              (placement.bounds.x - scene.contentRect.x + placement.bounds.width / 2) / scene.contentRect.width;
            return Math.abs(centerX - 0.6) < 1e-12;
          });
          const pixels = await page
            .locator('#insignia-visualizer canvas')
            .evaluateAll((nodes) => nodes.map((canvas) => canvas.toDataURL()));
          assert.equal(pixels.length, 3, 'Konva must have constructed all three layers');
          const sceneBefore = await page.locator('#insignia-visualizer').getAttribute('data-projected-geometry');
          assert.ok(sceneBefore && JSON.parse(sceneBefore).placements.length > 0);
          await page.locator('s-button').filter({ hasText: 'Continue publication' }).click();
          if (publishMode === 'success')
            await page.getByText('Shopify settings updated; activation is pending').waitFor();
          else await page.getByText(/Continue the same publication request after checking/).waitFor();
          assert.equal(await page.getByLabel('Method name').inputValue(), 'Unsaved name');
          await page.getByText('Draft version 2').waitFor();
          await page
            .getByText(saveMode === 'ambiguous' ? 'Save could not be confirmed' : 'Unsaved changes', { exact: true })
            .waitFor();
          assert.equal(await page.getByLabel('Horizontal position', { exact: true }).inputValue(), '0.6');
          assert.deepEqual(
            await page
              .locator('#insignia-visualizer canvas')
              .evaluateAll((nodes) => nodes.map((canvas) => canvas.toDataURL())),
            pixels,
          );
          assert.equal(await page.locator('#insignia-visualizer').getAttribute('data-projected-geometry'), sceneBefore);
          assert.equal(publications.length, 1);
          const action = saveMode === 'ambiguous' ? 'Retry saving' : 'Save draft';
          await page.locator('s-button').filter({ hasText: action }).click();
          await page.getByText('Draft version 3').waitFor();
          await page.getByText('All changes saved', { exact: true }).waitFor();
          assert.equal(saves.at(-1).body.draft.labels.methods.print, 'Unsaved name');
          assert.equal(saves.at(-1).body.draft.geometry.views[0].placements[0].rect.centerX, 0.6);
          assert.equal(saves.length, saveMode === 'ambiguous' ? 2 : 1);
        } catch (error) {
          const observation = page
            ? await page
                .evaluate(() => {
                  const preview = document.querySelector('#insignia-visualizer');
                  const center = document.querySelector('s-number-field[label="Horizontal position"]');
                  return {
                    ownerVersion: preview?.getAttribute('data-editor-version'),
                    selectedPlacement: preview?.getAttribute('data-selected-placement'),
                    numericInputValue: center?.value,
                    projectedGeometry: preview?.getAttribute('data-projected-geometry'),
                    publicationMetadata: preview?.getAttribute('data-publication-state'),
                  };
                })
                .catch(() => ({ unavailable: true }))
            : { unavailable: true };
          console.error(
            'PUBLICATION_STRESS_FIRST_FAILURE',
            JSON.stringify({ iteration, saveMode, publishMode, observation }),
          );
          throw error;
        }
      });
    }
  }
}
test('settled publication read replaces a lost-response warning and stale product status without redispatch', {
  timeout: 25000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-publication-settlement' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
    route.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  let settled = false;
  let writes = 0;
  await page.route('**/api/admin/products/111/config', (route) => {
    if (route.request().method() === 'GET') {
      const value = response(draft());
      value.product.status = settled ? 'ACTIVE' : 'DRAFT';
      value.config.publishEligibility = { allowed: true, reason: null };
      if (settled)
        Object.assign(value.config.publication, {
          state: 'ACTIVE',
          revisionId: 'settled-revision',
          activeRevisionId: 'settled-revision',
          sourceDraftVersion: '1',
          requestKey: 'm5pub_config-1_1_1',
        });
      return route.fulfill({ json: value });
    }
    writes++;
    assert.equal(route.request().headers()['idempotency-key'], 'm5pub_config-1_1_1');
    settled = true;
    return route.abort('failed');
  });
  await page.goto(server.base + '/admin/products/111/config?view=all');
  await page.getByText('Product status: Draft', { exact: true }).waitFor();
  await page.locator('s-button').filter({ hasText: 'Publish saved changes' }).click();
  await page.getByText('Publication state refreshed.', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByText('Product status: Active', { exact: true }).waitFor({ timeout: 1000 });
  assert.equal(writes, 1);
  assert.equal(await page.getByText(/Continue the same publication request after checking/).count(), 0);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('insignia:m5:publish:111')), null);
});
for (const observedKey of ['m5pub_config-1_1_1', 'm5pub_config-1_1_2']) {
  test(`older active publication cannot settle a newer lost-response request (${observedKey})`, {
    timeout: 25000,
  }, async (t) => {
    const { source, server, browser } = await browserFixture(t);
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.shopify = { idToken: async () => 'synthetic-publication-settlement' };
    });
    await routePolaris(page, source);
    await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
      route.fulfill({ body: '', contentType: 'text/javascript' }),
    );
    let writes = 0;
    await page.route('**/api/admin/products/111/config', (route) => {
      if (route.request().method() === 'GET') {
        const value = response(draft());
        value.product.status = 'ACTIVE';
        value.config.draftVersion = '2';
        value.config.publishEligibility = { allowed: true, reason: null };
        Object.assign(value.config.publication, {
          state: 'ACTIVE',
          revisionId: 'settled-revision',
          activeRevisionId: 'settled-revision',
          sourceDraftVersion: '1',
          requestKey: observedKey,
        });
        return route.fulfill({ json: value });
      }
      writes++;
      assert.equal(route.request().headers()['idempotency-key'], 'm5pub_config-1_1_2');
      return route.abort('failed');
    });
    await page.goto(server.base + '/admin/products/111/config?view=all');
    await page.getByText('Product status: Active', { exact: true }).waitFor();
    await page.locator('s-button').filter({ hasText: 'Publish saved changes' }).click();
    await page.getByText(/Continue the same publication request after checking/).waitFor({ timeout: 5000 });
    await page.getByText('Product status: Active', { exact: true }).waitFor({ timeout: 1000 });
    assert.equal(writes, 1);
    const pending = await page.evaluate(() => JSON.parse(sessionStorage.getItem('insignia:m5:publish:111')));
    assert.ok(pending, 'original uncertain request must remain stored');
    await page.locator('s-button').filter({ hasText: 'Continue publication' }).waitFor();
    assert.equal(pending.key, 'm5pub_config-1_1_2');
    assert.equal(pending.body.draftVersion, '2');
    await page.reload();
    await page.locator('s-button').filter({ hasText: 'Continue publication' }).waitFor();
    assert.equal(writes, 1);
  });
}
test('publication retry keeps the original version after a newer draft edit when embedded storage is denied', {
  timeout: 30000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
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
  await routePolaris(page, source);
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
  await page.goto(server.base + '/admin/products/111/config?view=all');
  await page.locator('s-button').filter({ hasText: 'Continue publication' }).click();
  await page.getByText(/Continue the same publication request/).waitFor();
  await page.reload();
  await page.getByText('Draft version 2').waitFor();
  await page.locator('s-button').filter({ hasText: 'Continue publication' }).click();
  await page.getByText('Shopify settings updated; activation is pending').waitFor();
  assert.equal(observedKey, 'm5pub_config-1_1_1');
  assert.equal(writes, 2);
});
test('stale stored publication is replaced by the current immutable intent despite newer ineligible draft', {
  timeout: 25000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-stale-publication-token' };
  });
  await routePolaris(page, source);
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
  await page.goto(server.base + '/admin/products/111/config?view=all');
  await page.getByText('Newer draft feature unavailable').waitFor();
  await page.locator('s-button').filter({ hasText: 'Continue publication' }).click();
  await page.getByText('Shopify settings updated; activation is pending').waitFor();
  assert.equal(writes, 1);
});
test('reinstalled Admin discards prior-generation browser request and publishes with a new key', {
  timeout: 25000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-reinstall-token' };
  });
  await routePolaris(page, source);
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
  await page.goto(server.base + '/admin/products/111/config?view=all');
  await page.getByText('Draft version 1').waitFor();
  await page.locator('s-button').filter({ hasText: 'Publish saved changes' }).click();
  await page.getByText('Shopify settings updated; activation is pending').waitFor();
  assert.equal(received.key, 'm5pub_config-1_2_1');
  assert.deepEqual(received.body, { action: 'publish', configId: 'config-1', draftVersion: '1' });
});
test('concurrent editor refreshes share one App Bridge identity request', { timeout: 20000 }, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.__tokenCalls = 0;
    window.shopify = {
      idToken: () => {
        window.__tokenCalls++;
        if (window.__tokenCalls === 1)
          return new Promise((resolve) => {
            window.__releaseInitialToken = () => resolve('synthetic-concurrent-token');
          });
        return Promise.resolve('synthetic-concurrent-token');
      },
    };
  });
  await routePolaris(page, source);
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
  await page.goto(`${server.base}/admin/products/111/config?view=all`);
  await page.waitForFunction(() => typeof window.__releaseInitialToken === 'function');
  assert.equal(reads, 0, 'the initial identity remains pending until all refreshes have joined');
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.__releaseInitialToken();
  });
  await page.getByText('Draft version 1').waitFor();
  assert.equal(await page.evaluate(() => window.__tokenCalls), 1);
  assert.equal(reads, 3);
  await page.getByLabel('Method 1 / Placement 1 / Size step 1 — surcharge (USD)', { exact: true }).fill('1.00');
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
});
test('empty merchant draft can be configured through typed controls and pass M2 validation', {
  timeout: 20000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
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
  await routePolaris(page, source);
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
  await page.goto(`${server.base}/admin/products/111/config?view=all`);
  await page.getByText('Draft version 1').waitFor();
  await page.getByText('Add a method, placement and allowed size to enter decoration prices.').waitFor();
  await page.getByRole('button', { name: 'Add method' }).click();
  await page.getByLabel('Method name').fill('Screen print');
  await page.getByRole('button', { name: 'Add placement to view' }).click();
  await page.getByLabel('Placement name').fill('Front chest');
  await page.getByRole('button', { name: 'Add size step' }).click();
  await page.getByLabel('Print size', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel('Size step name').fill('Small');
  await page.locator('input[type="checkbox"]').nth(1).check();
  await page.locator('input[type="checkbox"]').nth(2).check();
  await page.getByRole('button', { name: 'Add production option' }).click();
  await page.getByLabel('Option name').fill('Thread color');
  await page.getByLabel(/^Value .* name$/).fill('Navy');
  await page.getByLabel('Screen print / Front chest / Small — surcharge (USD)', { exact: true }).fill('2.00');
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
});
test('mounted admin refreshes late activation and readiness without overwriting local edits, then clears expired identity', {
  timeout: 25000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-late-token' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
    route.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  let state = 'HELD_ACTIVATION_PENDING';
  let expired = false;
  let writes = 0;
  await page.route('**/api/admin/products/111/config', (route) => {
    if (route.request().method() !== 'GET') {
      writes++;
      throw new Error('Passive refresh must never mutate');
    }
    if (expired) return route.fulfill({ status: 401, json: { error: 'Authentication required' } });
    const value = response(draft());
    value.config.publication.state = state;
    value.config.publication.revisionId = 'requested-revision';
    value.config.publication.activeRevisionId = state === 'ACTIVE' ? 'requested-revision' : 'previous-revision';
    value.config.publishEligibility = {
      allowed: state === 'ACTIVE',
      reason: state === 'ACTIVE' ? null : 'Readiness unavailable',
    };
    return route.fulfill({ json: value });
  });
  await page.goto(`${server.base}/admin/products/111/config?view=all`);
  await page.getByText('Product temporarily unavailable while changes activate', { exact: true }).waitFor();
  assert.equal(await page.getByText('Effective revision: requested-revision', { exact: true }).count(), 0);
  await page.getByLabel('Method 1 / Placement 1 / Size step 1 — surcharge (USD)', { exact: true }).fill('3.25');
  state = 'ACTIVE';
  await page.getByText('Active', { exact: true }).waitFor({ timeout: 8000 });
  assert.equal(
    await page.getByLabel('Method 1 / Placement 1 / Size step 1 — surcharge (USD)', { exact: true }).inputValue(),
    '3.25',
  );
  await page.getByText('Draft version 1', { exact: false }).waitFor();
  await page.getByText('Unsaved changes', { exact: true }).waitFor();
  await page.getByText('Effective revision: requested-revision', { exact: true }).waitFor({ state: 'attached' });
  expired = true;
  await page.getByText('Authentication required', { exact: true }).waitFor({ timeout: 8000 });
  assert.equal(
    await page.getByLabel('Method 1 / Placement 1 / Size step 1 — surcharge (USD)', { exact: true }).count(),
    0,
  );
  // Explicit recovery reauthorizes through GET only; denied private edits stay cleared.
  await page.getByRole('button', { name: 'Retry session', exact: true }).click({ timeout: 1500 });
  await page.getByText('Authentication required', { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel('Method 1 / Placement 1 / Size step 1 — surcharge (USD)', { exact: true }).count(),
    0,
  );
  expired = false;
  await page.getByRole('button', { name: 'Retry session', exact: true }).click();
  await page.getByText('Draft version 1', { exact: false }).waitFor();
  await page.getByText('All changes saved', { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel('Method 1 / Placement 1 / Size step 1 — surcharge (USD)', { exact: true }).inputValue(),
    '',
  );
  await page.getByText('Effective revision: requested-revision', { exact: true }).waitFor({ state: 'attached' });
  assert.equal(writes, 0);
});
for (const staleAmount of ['9.00', '2.50'])
  test(`two production admin tabs keep stale edits and explicitly review the winning CAS draft: ${staleAmount}`, {
    timeout: 25000,
  }, async (t) => {
    const { source, server, browser } = await browserFixture(t);
    const context = await browser.newContext();
    await context.addInitScript(() => {
      window.shopify = { idToken: async () => 'synthetic-two-tab-token' };
    });
    await routePolaris(context, source);
    await context.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
      route.fulfill({ body: '', contentType: 'text/javascript' }),
    );
    let current = draft();
    current.pricingRules = [
      {
        id: 'shared-price',
        role: 'unit',
        scope: { kind: 'step', placementId: 'front', stepId: 'small', methodId: 'print' },
        rate: { kind: 'fixed', amount: { shopDecimal: '0', presentmentOverrides: [] } },
      },
    ];
    let version = '1';
    let committed = 0;
    await context.route('**/api/admin/products/111/config', (route) => {
      const request = route.request();
      assert.equal(request.headers().authorization, 'Bearer synthetic-two-tab-token');
      if (request.method() === 'PUT') {
        const body = request.postDataJSON();
        if (body.draftVersion !== version)
          return route.fulfill({
            status: 409,
            json: { kind: 'conflict', message: 'Draft changed. Reload and review the current version.' },
          });
        current = body.draft;
        version = '2';
        committed++;
        return route.fulfill({ json: { kind: 'saved', draftVersion: version } });
      }
      const value = response(current);
      value.config.draftVersion = version;
      return route.fulfill({ json: value });
    });
    const first = await context.newPage();
    const second = await context.newPage();
    for (const page of [first, second]) {
      await page.goto(`${server.base}/admin/products/111/config?view=all`);
      await page.getByText('Draft version 1', { exact: false }).waitFor();
    }
    await first.getByLabel('Method 1 / Placement 1 / Size step 1 — surcharge (USD)', { exact: true }).fill('2.50');
    await second
      .getByLabel('Method 1 / Placement 1 / Size step 1 — surcharge (USD)', { exact: true })
      .fill(staleAmount);
    await first.locator('s-button').filter({ hasText: 'Save draft' }).click();
    await first.getByText('Draft saved.', { exact: true }).waitFor();
    await second.locator('s-button').filter({ hasText: 'Save draft' }).click();
    await second.getByText(/^(Another editor changed|Draft saved;)/).waitFor({ timeout: 3000 });
    assert.equal(
      await second.getByText('Another editor changed this draft. Review the latest version.', { exact: true }).count(),
      1,
    );
    assert.equal(
      await second.getByLabel('Method 1 / Placement 1 / Size step 1 — surcharge (USD)', { exact: true }).inputValue(),
      staleAmount,
    );
    assert.equal(committed, 1);
    await first.goto(`${server.base}/admin/products`);
    await first.goBack();
    await first.getByText('Draft version 2', { exact: false }).waitFor();
    assert.equal(
      await first.getByLabel('Method 1 / Placement 1 / Size step 1 — surcharge (USD)', { exact: true }).inputValue(),
      '2.50',
    );
    await first.reload();
    await first.getByText('Draft version 2', { exact: false }).waitFor();
    await second.getByLabel('Method 1 / Placement 1 / Size step 1 — surcharge (USD)', { exact: true }).fill('1.001');
    await second.locator('s-button').filter({ hasText: 'Review latest saved draft' }).click();
    assert.equal(
      await second.getByLabel('Method 1 / Placement 1 / Size step 1 — surcharge (USD)', { exact: true }).inputValue(),
      '2.50',
    );
    await second.getByText('Draft version 2', { exact: false }).waitFor();
    await second.getByText('All changes saved', { exact: true }).waitFor();
    await second.getByLabel('Method name').fill('Reviewed print');
    assert.equal(
      await second
        .locator('s-button')
        .filter({ hasText: 'Save draft' })
        .evaluate((button) => button.disabled),
      false,
    );
  });
test('authorization denial fences a save already in flight from repopulating private editor state', {
  timeout: 25000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  let releaseRead;
  let releaseSave;
  const readGate = new Promise((resolve) => {
    releaseRead = resolve;
  });
  const saveGate = new Promise((resolve) => {
    releaseSave = resolve;
  });
  let signalRead;
  const readStarted = new Promise((resolve) => {
    signalRead = resolve;
  });
  let signalSave;
  const saveStarted = new Promise((resolve) => {
    signalSave = resolve;
  });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.shopify = { idToken: async () => 'synthetic-fenced-token' };
    });
    await routePolaris(page, source);
    await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
      route.fulfill({ body: '', contentType: 'text/javascript' }),
    );
    let reads = 0;
    let completed = false;
    await page.route('**/api/admin/products/111/config', async (route) => {
      if (route.request().method() === 'PUT') {
        signalSave();
        await saveGate;
        completed = true;
        return route.fulfill({ json: { kind: 'saved', draftVersion: '2' } });
      }
      if (++reads === 1) return route.fulfill({ json: response(draft()) });
      signalRead();
      await readGate;
      return route.fulfill({ status: 401, json: { error: 'Authentication required' } });
    });
    await page.goto(`${server.base}/admin/products/111/config?view=all`);
    await page.getByText('Draft version 1', { exact: false }).waitFor();
    await page.getByLabel('Method 1 / Placement 1 / Size step 1 — surcharge (USD)', { exact: true }).fill('4.00');
    await readStarted;
    await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
    await saveStarted;
    releaseRead();
    await page.getByText('Authentication required', { exact: true }).waitFor({ timeout: 2000 });
    assert.equal(
      await page.getByLabel('Method 1 / Placement 1 / Size step 1 — surcharge (USD)', { exact: true }).count(),
      0,
    );
    const saveResponse = page.waitForResponse((response) => response.request().method() === 'PUT');
    releaseSave();
    await saveResponse;
    await page.waitForTimeout(250);
    assert.ok(completed);
    assert.equal(await page.getByRole('button', { name: 'Retry session', exact: true }).count(), 1);
    assert.equal(
      await page.getByLabel('Method 1 / Placement 1 / Size step 1 — surcharge (USD)', { exact: true }).count(),
      0,
    );
    assert.equal(await page.locator('s-section[heading="Synthetic shirt"]').count(), 0);
    assert.equal(await page.getByText(/Draft saved/).count(), 0);
  } finally {
    releaseRead();
    releaseSave();
  }
});
test('a pre-command passive observation cannot overwrite a newer pending publication or its stored request', {
  timeout: 20000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  let releaseRead;
  const gate = new Promise((resolve) => {
    releaseRead = resolve;
  });
  let signalRead;
  const started = new Promise((resolve) => {
    signalRead = resolve;
  });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.shopify = { idToken: async () => 'synthetic-observation-token' };
    });
    await routePolaris(page, source);
    await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
      route.fulfill({ body: '', contentType: 'text/javascript' }),
    );
    let reads = 0;
    let published = false;
    const old = response(draft());
    old.config.draftVersion = '2';
    old.config.publishEligibility = { allowed: true, reason: null };
    Object.assign(old.config.publication, {
      state: 'ACTIVE',
      revisionId: 'revision-A',
      activeRevisionId: 'revision-A',
    });
    const current = structuredClone(old);
    Object.assign(current.config.publication, {
      state: 'ACTIVATION_WAITING_RELEASE',
      revisionId: 'revision-B',
      sourceDraftVersion: '2',
      requestKey: 'm5pub_config-1_1_2',
    });
    await page.route('**/api/admin/products/111/config', async (route) => {
      if (route.request().method() === 'POST') {
        assert.equal(route.request().postDataJSON().action, 'publish');
        published = true;
        return route.fulfill({
          json: { kind: 'accepted', state: 'ACTIVATION_WAITING_RELEASE', revisionId: 'revision-B' },
        });
      }
      if (++reads === 2) {
        signalRead();
        await gate;
        return route.fulfill({ json: old });
      }
      return route.fulfill({ json: published ? current : old });
    });
    await page.goto(`${server.base}/admin/products/111/config?view=all`);
    await page.getByText('Active', { exact: true }).waitFor();
    await started;
    await page.locator('s-button').filter({ hasText: 'Publish saved changes' }).click();
    await page.getByText('Latest revision: revision-B', { exact: true }).waitFor({ state: 'attached' });
    releaseRead();
    await page.waitForTimeout(300);
    assert.equal(await page.getByText('Latest revision: revision-B', { exact: true }).count(), 1);
    assert.equal(await page.getByText('Publishing paused while app setup is verified', { exact: true }).count(), 1);
    const stored = await page.evaluate(() =>
      Object.values(sessionStorage).filter((value) => value.includes('m5pub_config-1_1_2')),
    );
    assert.equal(stored.length, 1, 'The new pending request remains recoverable');
  } finally {
    releaseRead();
  }
});
test('operator and restoration conflicts cannot initiate another publication from a saved eligible draft', {
  timeout: 15000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-operator-token' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
    route.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  let state = 'OPERATOR_HOLD';
  let writes = 0;
  await page.route('**/api/admin/products/111/config', (route) => {
    if (route.request().method() !== 'GET') {
      writes++;
      return route.fulfill({ status: 409, json: { message: 'Operator recovery required' } });
    }
    const value = response(draft());
    value.config.publishEligibility = { allowed: true, reason: null };
    value.config.publication.state = state;
    return route.fulfill({ json: value });
  });
  for (const next of ['OPERATOR_HOLD', 'RESTORATION_CONFLICT', 'CONFLICT']) {
    state = next;
    await page.goto(`${server.base}/admin/products/111/config?view=all`);
    await page.getByText('Draft version 1', { exact: false }).waitFor();
    const button = page.locator('s-button').filter({ hasText: 'Publish saved changes' });
    assert.equal(await button.evaluate((element) => element.disabled), true, next);
  }
  assert.equal(writes, 0);
});
test('readiness permissions require an explicit gesture and refresh server identity after one exact read-scope grant', {
  timeout: 60000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  assert.equal(
    (await fetch(server.base + '/api/admin/readiness')).status,
    503,
    'The real Astro readiness route exists and fails closed without runtime services',
  );
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.scopeQueries = 0;
    window.scopeRequests = [];
    window.syntheticTokenCount = 0;
    window.shopify = {
      idToken: async () => 'synthetic-ready-' + ++window.syntheticTokenCount,
      scopes: {
        query: async () => {
          window.scopeQueries++;
          return {
            granted: ['write_products'],
            required: [],
            optional: ['read_cart_transforms', 'read_validations'],
          };
        },
        request: async (scopes) => {
          window.scopeRequests.push(scopes);
          return {
            result: 'granted-all',
            detail: { granted: ['write_products', ...scopes], required: [], optional: scopes },
          };
        },
      },
    };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
    route.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  await page.route('**/api/admin/products?*', (route) => route.fulfill({ json: { products: [], nextCursor: null } }));
  const readinessTokens = [];
  await page.route('**/api/admin/readiness', (route) => {
    readinessTokens.push(route.request().headers().authorization);
    assert.equal(route.request().method(), 'GET');
    assert.equal(route.request().headers().cookie, undefined);
    return route.fulfill({ json: { version: 'm5-admin-technical-readiness-v1' } });
  });
  await page.goto(server.base + '/admin/settings');
  await page.getByRole('button', { name: 'App permissions and publication checks', exact: true }).click();
  await page.getByRole('button', { name: 'Check readiness', exact: true }).waitFor();
  await page.locator('astro-island:not([ssr])').waitFor();
  assert.equal(await page.evaluate(() => window.scopeQueries), 0);
  assert.deepEqual(await page.evaluate(() => window.scopeRequests), []);
  assert.deepEqual(readinessTokens, []);
  await page.getByRole('button', { name: 'Check readiness', exact: true }).click();
  await page.getByRole('button', { name: 'Allow readiness checks', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.scopeQueries), 1);
  assert.deepEqual(await page.evaluate(() => window.scopeRequests), []);
  const previousTokenCount = await page.evaluate(() => window.syntheticTokenCount);
  await page.getByRole('button', { name: 'Allow readiness checks', exact: true }).click();
  await page
    .getByText('Readiness checked. Publication still requires current eligibility.', { exact: true })
    .waitFor({ timeout: 3000 });
  assert.deepEqual(await page.evaluate(() => window.scopeRequests), [['read_cart_transforms', 'read_validations']]);
  assert.deepEqual(readinessTokens, ['Bearer synthetic-ready-' + (previousTokenCount + 1)]);
});
test('readiness permission decline, failure and existing grants never broaden or retry the permission request', {
  timeout: 60000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  for (const scenario of [
    {
      granted: ['read_validations'],
      result: 'declined-all',
      requests: [['read_cart_transforms']],
      status: 'Permissions were declined. Readiness remains unverified.',
      reads: 0,
    },
    {
      granted: [],
      result: 'throw',
      requests: [['read_cart_transforms', 'read_validations']],
      status: 'Permission or readiness check did not complete. Check readiness again.',
      reads: 0,
    },
    {
      granted: ['read_cart_transforms', 'read_validations'],
      requests: [],
      status: 'Readiness checked. Publication still requires current eligibility.',
      reads: 1,
    },
    {
      granted: [],
      result: 'granted-all',
      serverStatus: 403,
      denied: true,
      requests: [['read_cart_transforms', 'read_validations']],
      status: 'Synthetic current authorization refused',
      reads: 1,
    },
    {
      granted: [],
      result: 'granted-all',
      serverStatus: 401,
      denied: true,
      requests: [['read_cart_transforms', 'read_validations']],
      status: 'Synthetic current authorization refused',
      reads: 2,
    },
    {
      granted: [],
      result: 'granted-all',
      serverStatus: 503,
      requests: [['read_cart_transforms', 'read_validations']],
      status: 'Permission or readiness check did not complete. Check readiness again.',
      reads: 1,
    },
    {
      granted: [],
      optional: ['read_cart_transforms'],
      requests: [],
      status: 'Readiness could not be checked. Try checking again.',
      reads: 0,
    },
  ]) {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.addInitScript((scenario) => {
      window.scopeRequests = [];
      window.syntheticTokenCount = 0;
      window.shopify = {
        idToken: async () => 'synthetic-ready-' + ++window.syntheticTokenCount,
        scopes: {
          query: async () => ({
            granted: scenario.granted,
            required: [],
            optional: scenario.optional ?? ['read_cart_transforms', 'read_validations'],
          }),
          request: async (scopes) => {
            window.scopeRequests.push(scopes);
            if (scenario.result === 'throw') throw new Error('Synthetic provider failure');
            return { result: scenario.result, detail: { granted: scopes, required: [], optional: scopes } };
          },
        },
      };
    }, scenario);
    await routePolaris(page, source);
    await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
    await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
      route.fulfill({ body: '', contentType: 'text/javascript' }),
    );
    await page.route('**/api/admin/products?*', (route) =>
      route.fulfill({
        json: {
          products: [
            {
              id: 'gid://shopify/Product/111',
              title: 'Synthetic private catalog',
              status: 'DRAFT',
              imageUrl: null,
              variants: [],
            },
          ],
          nextCursor: null,
        },
      }),
    );
    const readinessTokens = [];
    await page.route('**/api/admin/readiness', (route) => {
      readinessTokens.push(route.request().headers().authorization);
      return route.fulfill({
        status: scenario.serverStatus ?? 200,
        json: scenario.serverStatus
          ? { error: 'Synthetic current authorization refused' }
          : { version: 'm5-admin-technical-readiness-v1' },
      });
    });
    await page.goto(server.base + '/admin/settings');
    await page.getByRole('button', { name: 'App permissions and publication checks', exact: true }).click();
    await page.getByRole('button', { name: 'Check readiness', exact: true }).waitFor();
    await page.locator('astro-island:not([ssr])').waitFor();
    assert.deepEqual(readinessTokens, [], 'No readiness request on page boot');
    await page.getByRole('button', { name: 'Check readiness', exact: true }).click();
    if (scenario.requests.length) {
      await page.getByRole('button', { name: 'Allow readiness checks', exact: true }).click();
    }
    if (scenario.denied) {
      await page
        .getByText(/Synthetic current authorization refused|Permission or readiness check did not complete/)
        .waitFor();
    } else {
      await page.getByText(scenario.status, { exact: true }).waitFor();
    }
    assert.deepEqual(await page.evaluate(() => window.scopeRequests), scenario.requests);
    assert.equal(readinessTokens.length, scenario.reads);
    assert.equal(new Set(readinessTokens).size, scenario.reads, 'Every server attempt gets a fresh ID token');
    if (scenario.denied) {
      assert.equal(await page.getByRole('heading', { name: 'Synthetic private catalog' }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Check readiness', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Check signing setup', exact: true }).count(), 0);
      await page.getByText(scenario.status, { exact: true }).waitFor();
    } else {
      assert.equal(await page.getByRole('heading', { name: 'Publication readiness', exact: true }).count(), 1);
      assert.equal(await page.getByRole('button', { name: 'Check signing setup', exact: true }).count(), 0);
    }
    if (scenario.requests.length && !scenario.denied) {
      assert.equal(await page.getByRole('button', { name: 'Allow readiness checks', exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Check readiness', exact: true }).click();
      await page
        .getByText('Permissions are still missing. Reload before another permission request.', { exact: true })
        .waitFor();
      assert.deepEqual(await page.evaluate(() => window.scopeRequests), scenario.requests);
    }
    await page.close();
  }
});
test('both admin pages admit the pinned Polaris CDN font without broadening other CSP sources', {
  timeout: 20000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  for (const path of ['/admin/products', '/admin/products/111/config']) {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.shopify = { idToken: async () => 'synthetic-font-token' };
    });
    await routePolaris(page, source);
    await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
      route.fulfill({ body: '', contentType: 'text/javascript' }),
    );
    let fontRequests = 0;
    await page.route('https://cdn.shopify.com/static/fonts/**', (route) => {
      fontRequests++;
      return route.fulfill({ body: '', contentType: 'font/woff2' });
    });
    await page.route('**/api/admin/products?*', (route) => route.fulfill({ json: { products: [], nextCursor: null } }));
    await page.route('**/api/admin/products/111/config', (route) => route.fulfill({ json: response(draft()) }));
    const document = await page.goto(server.base + path);
    const appBridge = page.locator('script').first();
    assert.equal(await appBridge.getAttribute('src'), 'https://cdn.shopify.com/shopifycloud/app-bridge.js');
    for (const forbidden of ['defer', 'async', 'type']) {
      assert.equal(await appBridge.getAttribute(forbidden), null, `App Bridge forbids ${forbidden}`);
    }
    const directives = Object.fromEntries(
      document
        .headers()
        ['content-security-policy'].split(';')
        .map((part) => part.trim().split(/\s+/))
        .filter(([name]) => name)
        .map(([name, ...values]) => [name, values]),
    );
    assert.deepEqual(directives['font-src'], ['https://cdn.shopify.com']);
    assert.deepEqual(directives['connect-src'], [
      "'self'",
      'https://cdn.shopify.com/shopifycloud/admin-ui-foundations/icons/',
    ]);
    assert.deepEqual(directives['frame-ancestors'], ['https://admin.shopify.com', 'https://*.myshopify.com']);
    assert.ok(!directives['script-src'].some((value) => value.includes('cloudflare')));
    assert.ok(!directives['script-src'].includes("'unsafe-inline'"));
    assert.ok(
      await page.locator('script[src^="/_astro/"]').count(),
      'compiled navigation bootstrap stays external under CSP',
    );
    await page.locator('s-page').waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.ok(fontRequests > 0, 'Polaris font request reaches the CDN boundary instead of being blocked by CSP');
    await page.close();
  }
});
test('product search uses the responsive Polaris table with actionable rows and no technical IDs', {
  timeout: 20000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-picker-token' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
    route.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  const queries = [];
  await page.route('**/api/admin/products?*', (route) => {
    const request = route.request();
    assert.equal(request.method(), 'GET');
    assert.equal(request.headers().cookie, undefined);
    assert.equal(request.headers().authorization, 'Bearer synthetic-picker-token');
    const query = new URL(request.url()).searchParams.get('q');
    queries.push(query);
    return route.fulfill({
      json: {
        products:
          query === 'absent'
            ? []
            : [
                {
                  id,
                  title: 'Historical archived shirt with a long catalog title',
                  status: 'ARCHIVED',
                  imageUrl: null,
                  variants: [{ id: variant, title: 'Blue / Large' }],
                },
              ],
        nextCursor: null,
      },
    });
  });
  await page.goto(server.base + '/admin/products');
  await page.getByRole('link', { name: 'Historical archived shirt with a long catalog title' }).waitFor();
  const navigation = page.locator('s-app-nav');
  assert.equal(
    await navigation
      .locator('s-link')
      .filter({ hasText: /^Products$/ })
      .getAttribute('href'),
    '/admin/products',
  );
  assert.equal(
    await navigation
      .locator('s-link')
      .filter({ hasText: /^Orders$/ })
      .getAttribute('href'),
    '/admin/orders',
  );
  assert.equal(
    await navigation
      .locator('s-link')
      .filter({ hasText: /^Settings$/ })
      .getAttribute('href'),
    '/admin/settings',
  );
  const search = page.getByRole('searchbox', { name: 'Search products', exact: true });
  assert.ok(await search.isVisible());
  await search.focus();
  assert.ok(await search.evaluate((element) => element.matches(':focus')));
  const card = page.locator('s-table-row');
  assert.equal(await page.locator('s-table').count(), 1);
  await page.getByRole('grid').waitFor({ timeout: 3000 });
  await card.getByText('Archived', { exact: true }).waitFor();
  assert.equal(await card.getByText('Blue / Large', { exact: true }).count(), 1);
  assert.equal(await page.getByText(/gid:\/\/shopify\//).count(), 0);
  assert.equal(
    await card.getByRole('link', { name: 'Configure product', exact: true }).getAttribute('href'),
    '/admin/products/111/config',
  );
  await search.fill('archived & blue');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('link', { name: 'Historical archived shirt with a long catalog title' }).waitFor();
  assert.deepEqual(queries, ['', 'archived & blue'], 'Typing does not introduce extra requests');
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (process.env.M5_CAPTURE_BROWSER === '1')
      await page.screenshot({ path: `/tmp/m5-admin-picker-${width}.png`, fullPage: true });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `Picker must fit a ${width}px viewport`,
    );

    const configure = card.getByRole('link', { name: 'Configure product', exact: true });
    await configure.scrollIntoViewIfNeeded();
    assert.ok(await configure.isVisible());
    const actionBox = await configure.boundingBox();
    assert.ok(actionBox && actionBox.x >= 0 && actionBox.x + actionBox.width <= width);
  }
  await search.fill('absent');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByText('No products found.', { exact: true }).waitFor();
  assert.equal(await page.locator('s-table-row').count(), 0);
  assert.deepEqual(queries, ['', 'archived & blue', 'absent']);
});
test('merchant choices use names and numbered fallbacks while pricing saves the original identifiers', {
  timeout: 25000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-choice-labels' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
    route.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  const current = JSON.parse(
    JSON.stringify(draft())
      .replaceAll('"print"', '"method_opaque"')
      .replaceAll('"front"', '"placement_opaque"')
      .replaceAll('"small"', '"step_opaque"')
      .replaceAll('"large"', '"step_other"'),
  );
  current.methods.push({ id: 'method_other' });
  current.placements[0].allowedMethodIds.push('method_other');
  current.productionOptions = [{ id: 'option_opaque', allowedValueIds: ['value_opaque', 'value_other'] }];
  current.pricingRules = [];
  current.labels = {
    methods: { method_opaque: 'Screen print' },
    placements: { placement_opaque: 'Front panel' },
    steps: { step_opaque: 'Small' },
    views: { 'front-view': 'Front view' },
    options: { option_opaque: 'Finish' },
    values: { option_opaque: { value_opaque: 'Matte' } },
  };
  let saved;
  await page.route('**/api/admin/products/111/config', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: response(current) });
    saved = route.request().postDataJSON();
    return route.fulfill({ json: { kind: 'saved', draftVersion: '2' } });
  });
  await page.goto(server.base + '/admin/products/111/config?view=all');
  await page.getByLabel('Print area', { exact: true }).selectOption('placement_opaque');
  await page.getByRole('checkbox', { name: 'Screen print', exact: true }).waitFor({ timeout: 1500 });
  assert.equal(await page.getByRole('checkbox', { name: 'Method 2', exact: true }).isChecked(), true);
  assert.equal(await page.getByRole('checkbox', { name: 'Small', exact: true }).isChecked(), true);
  assert.equal(await page.getByRole('checkbox', { name: 'Size step 2', exact: true }).isChecked(), true);
  assert.equal(await page.locator('s-select[label="View"] > s-option').last().textContent(), 'View 2');
  assert.equal(await page.getByLabel('Value 1 name').inputValue(), 'Matte');
  assert.equal(await page.getByLabel('Value 2 name').count(), 1);
  const price = page.getByLabel('Screen print / Front panel / Small — surcharge (USD)', { exact: true });
  await price.fill('10');
  await page.getByLabel('Method name').first().fill('Renamed print');
  assert.equal(
    await page.getByLabel('Renamed print / Front panel / Small — surcharge (USD)', { exact: true }).count(),
    1,
  );
  for (const internalId of [
    'method_opaque',
    'placement_opaque',
    'step_opaque',
    'option_opaque',
    'value_opaque',
    'price_opaque',
  ])
    assert.ok(
      !(await page.locator('body').innerText()).includes(internalId),
      'Ordinary editor text must not expose ' + internalId,
    );
  await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
  await page.getByText('Draft saved.').waitFor();
  assert.deepEqual(
    saved.draft.pricingRules.map(({ id: _id, ...rule }) => rule),
    [
      {
        role: 'unit',
        scope: { kind: 'step', placementId: 'placement_opaque', stepId: 'step_opaque', methodId: 'method_opaque' },
        rate: { kind: 'fixed', amount: { shopDecimal: '10', presentmentOverrides: [] } },
      },
    ],
  );
  assert.deepEqual(saved.draft.methods, current.methods);
  assert.deepEqual(saved.draft.placements, current.placements);
  assert.deepEqual(saved.draft.productionOptions, current.productionOptions);
  assert.equal(saved.draft.labels.methods.method_opaque, 'Renamed print');
});
test('colliding choice names identify the intended method, size step and option value without rewriting labels', {
  timeout: 25000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  for (const [methodLabels, expectedMethods] of [
    [
      { print: 'Print', second: 'Print', third: 'Print (method 1)' },
      ['Print (method 1)', 'Print (method 2)', 'Print (method 1) (method 3)'],
    ],
    [{ print: 'Method 2' }, ['Method 2 (method 1)', 'Method 2 (method 2)']],
  ]) {
    const page = await browser.newPage();
    try {
      await page.addInitScript(() => {
        window.shopify = { idToken: async () => 'synthetic-colliding-labels' };
      });
      await routePolaris(page, source);
      await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
        route.fulfill({ body: '', contentType: 'text/javascript' }),
      );
      const current = draft();
      current.methods.push({ id: 'second' });
      current.placements[0].allowedMethodIds.push('second');
      if (methodLabels.third) {
        current.methods.push({ id: 'third' });
        current.placements[0].allowedMethodIds.push('third');
      }
      current.productionOptions = [{ id: 'finish', allowedValueIds: ['matte', 'other'] }];
      current.pricingRules = [];
      current.labels = {
        methods: methodLabels,
        placements: { front: 'Front' },
        steps: { small: 'Small', large: 'Small' },
        values: { finish: { matte: 'Matte', other: 'Matte' } },
      };
      let saved;
      await page.route('**/api/admin/products/111/config', (route) => {
        if (route.request().method() === 'GET') return route.fulfill({ json: response(current) });
        saved = route.request().postDataJSON();
        return route.fulfill({ json: { kind: 'saved', draftVersion: '2' } });
      });
      await page.goto(server.base + '/admin/products/111/config?view=all');
      await page
        .getByLabel(`${expectedMethods[0]} / Front / Small (size step 1) — surcharge (USD)`, { exact: true })
        .waitFor({ timeout: 1500 });
      for (const method of expectedMethods)
        assert.equal(
          await page.getByLabel(`${method} / Front / Small (size step 1) — surcharge (USD)`, { exact: true }).count(),
          1,
        );
      await page
        .getByLabel(`${expectedMethods[1]} / Front / Small (size step 2) — surcharge (USD)`, { exact: true })
        .fill('10');
      await page.getByLabel('Value 2 name').fill('Satin');
      await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
      await page.getByText('Draft saved.').waitFor();
      assert.deepEqual(saved.draft.pricingRules[0].scope, {
        kind: 'step',
        placementId: 'front',
        stepId: 'large',
        methodId: 'second',
      });
      assert.deepEqual(saved.draft.pricingRules[0].rate, {
        kind: 'fixed',
        amount: { shopDecimal: '10', presentmentOverrides: [] },
      });
      assert.deepEqual(saved.draft.methods, current.methods);
      assert.deepEqual(saved.draft.placements, current.placements);
      assert.deepEqual(saved.draft.productionOptions, current.productionOptions);
      assert.deepEqual(saved.draft.labels.methods, methodLabels);
      assert.deepEqual(saved.draft.labels.steps, { small: 'Small', large: 'Small' });
      assert.deepEqual(saved.draft.labels.values, { finish: { matte: 'Matte', other: 'Satin' } });
    } finally {
      await page.close();
    }
  }
});
test('compound size-step names remain distinguishable and save the intended placement and step', {
  timeout: 25000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-compound-labels' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
    route.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  const current = draft();
  current.placements[0].allowedStepIds = ['small'];
  current.placements.push({ ...current.placements[0], id: 'back', allowedStepIds: ['large'] });
  current.geometry.views[1].placements[0].id = 'back';
  current.labels = {
    placements: { front: 'Front / Large', back: 'Front' },
    steps: { small: 'Small', large: 'Large / Small' },
  };
  current.pricingRules = [];
  let saved;
  await page.route('**/api/admin/products/111/config', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: response(current) });
    saved = route.request().postDataJSON();
    return route.fulfill({ json: { kind: 'saved', draftVersion: '2' } });
  });
  await page.goto(server.base + '/admin/products/111/config?view=all');
  const prices = page.getByRole('textbox', { name: /price choice [12]\) — surcharge \(USD\)$/ });
  await prices.first().waitFor({ timeout: 1500 });
  assert.equal(await prices.count(), 2);
  for (const name of [
    'Method 1 / Front / Large / Small (price choice 1) — surcharge (USD)',
    'Method 1 / Front / Large / Small (price choice 2) — surcharge (USD)',
  ])
    assert.equal(await page.getByRole('textbox', { name, exact: true }).count(), 1);
  await page
    .getByLabel('Method 1 / Front / Large / Small (price choice 2) — surcharge (USD)', { exact: true })
    .fill('10');
  await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
  await page.getByText('Draft saved.').waitFor();
  assert.deepEqual(saved.draft.pricingRules[0].scope, {
    kind: 'step',
    placementId: 'back',
    stepId: 'large',
    methodId: 'print',
  });
  assert.deepEqual(saved.draft.pricingRules[0].rate, {
    kind: 'fixed',
    amount: { shopDecimal: '10', presentmentOverrides: [] },
  });
  assert.deepEqual(saved.draft.labels, current.labels);
  assert.deepEqual(saved.draft.placements, current.placements);
});
test('Lean price table keeps blank unavailable, saves explicit zero and exact final per-garment surcharges', {
  timeout: 20000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-lean-editor' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
    route.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  const current = draft();
  current.labels = {
    methods: { print: 'Print' },
    placements: { front: 'Front' },
    steps: { small: 'Small', large: 'Large' },
  };
  let saved;
  await page.route('**/api/admin/products/111/config', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: response(current) });
    saved = route.request().postDataJSON();
    return route.fulfill({ json: { kind: 'saved', draftVersion: '2' } });
  });
  await page.goto(server.base + '/admin/products/111/config?view=all');
  const small = page.getByLabel('Print / Front / Small — surcharge (USD)', { exact: true });
  await small.waitFor({ timeout: 1500 });
  assert.equal(await small.inputValue(), '');
  assert.equal(await page.getByRole('button', { name: 'Add fixed price' }).count(), 0);
  assert.equal(await page.getByLabel('Role', { exact: true }).count(), 0);
  await small.fill('3.00');
  await page.getByLabel('Print / Front / Large — surcharge (USD)', { exact: true }).fill('0');
  await page.locator('s-button').filter({ hasText: 'Save draft' }).click();
  await page.getByText('Draft saved.').waitFor();
  assert.deepEqual(
    saved.draft.pricingRules.map(({ id: _id, ...rule }) => rule),
    [
      {
        role: 'unit',
        scope: { kind: 'step', placementId: 'front', stepId: 'small', methodId: 'print' },
        rate: { kind: 'fixed', amount: { shopDecimal: '3.00', presentmentOverrides: [] } },
      },
      {
        role: 'unit',
        scope: { kind: 'step', placementId: 'front', stepId: 'large', methodId: 'print' },
        rate: { kind: 'fixed', amount: { shopDecimal: '0', presentmentOverrides: [] } },
      },
    ],
  );
});

test('editor guides configuration through prices to publication while keeping diagnostics collapsed', {
  timeout: 20000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-editor-flow' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
    route.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
  const current = response(draft());
  current.config.publication = {
    ...current.config.publication,
    state: 'ACTIVE',
    activeRevisionId: 'technical-revision',
    functionReadiness: 'RELEASE_BOUND',
  };
  await page.route('**/api/admin/products/111/config', (route) => route.fulfill({ json: current }));
  await page.goto(server.base + '/admin/products/111/config?view=all');
  await page.getByText('All changes saved', { exact: true }).waitFor();
  const prices = page.getByRole('link', { name: '3. Prices', exact: true });
  await prices.waitFor({ timeout: 2000 });
  await prices.click();
  assert.equal(new URL(page.url()).hash, '#decoration-prices');
  assert.equal(await page.getByText('Function readiness: RELEASE_BOUND', { exact: true }).isVisible(), false);
  await page.getByRole('link', { name: '4. Review and publish', exact: true }).click();
  await page.getByText('Technical publication details', { exact: true }).click();
  await page.getByText('Effective revision: technical-revision', { exact: true }).waitFor({ state: 'attached' });
  assert.equal(
    await page.locator('s-button[variant="primary"]').filter({ hasText: 'Save draft' }).innerText(),
    'Save draft',
  );
  await page.getByRole('link', { name: '4. Review and publish', exact: true }).click();
  await page.getByRole('button', { name: 'Publish saved changes', exact: true }).waitFor();
  if (process.env.M5_CAPTURE_BROWSER === '1')
    await page.screenshot({ path: '/tmp/insignia-admin-workflow-editor.png', fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.querySelectorAll('table,input:not([type="file"]),select,textarea,button').length,
    ),
    0,
    'ordinary admin controls use Polaris; shadow internals are excluded',
  );
});

test('editor keeps the live preview beside settings on desktop and fits mobile without losing the draft', {
  timeout: 20000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(3000);
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-editor-layout' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) =>
    route.fulfill({ body: '', contentType: 'text/javascript' }),
  );
  await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
  await page.route('**/api/admin/products/111/config', (route) => route.fulfill({ json: response(draft()) }));
  await page.goto(server.base + '/admin/products/111/config?view=all');
  const preview = page.getByRole('img', { name: 'Product placement preview', exact: true });
  await page.getByText('All changes saved', { exact: true }).waitFor();
  await preview.waitFor();
  const editorArea = await page.getByRole('combobox', { name: 'Customization mode', exact: true }).boundingBox();
  const previewArea = await preview.boundingBox();
  assert.ok(
    editorArea && previewArea && editorArea.width + previewArea.width > 1200,
    'editor uses the available desktop width',
  );
  const rules = page.getByRole('combobox', { name: 'Customization mode', exact: true });
  const previewBox = await preview.boundingBox(),
    rulesBox = await rules.boundingBox();
  assert.ok(
    previewBox && rulesBox && previewBox.x >= rulesBox.x + rulesBox.width,
    'Live preview sits beside, rather than far below, configuration controls',
  );
  const price = page.getByLabel('Method 1 / Placement 1 / Size step 1 — surcharge (USD)', { exact: true });
  await price.fill('3.25');
  await page.getByRole('link', { name: 'Preview', exact: true }).click();
  assert.equal(await price.inputValue(), '3.25');
  await page.getByText('Unsaved changes', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await preview.scrollIntoViewIfNeeded();
  assert.ok(await preview.isVisible());
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.equal(await price.inputValue(), '3.25');
  if (process.env.M5_CAPTURE_BROWSER === '1')
    await page.screenshot({ path: '/tmp/insignia-admin-editor-layout-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  if (process.env.M5_CAPTURE_BROWSER === '1')
    await page.screenshot({ path: '/tmp/insignia-admin-editor-layout-desktop.png', fullPage: true });
});

test('configuration loading reserves space with an accessible skeleton until authenticated data arrives', {
  timeout: 15000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-skeleton' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (r) => r.fulfill({ body: '' }));
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/admin/products/111/config', async (r) => {
    await pending;
    return r.fulfill({ json: response(draft()) });
  });
  await page.goto(server.base + '/admin/products/111/config');
  const skeleton = page.getByRole('status', { name: 'Page content', exact: true });
  await skeleton.waitFor({ timeout: 2000 });
  assert.ok((await skeleton.boundingBox()).height > 200, 'reserve the form area during loading');
  assert.equal(
    await page.locator('#admin-route-skeleton s-section[slot=aside]').count(),
    1,
    'loading matches the editor side preview',
  );
  await page.waitForFunction(() => customElements.get('s-box'));
  const previewPaint = await page
    .locator('#admin-route-skeleton .admin-skeleton-preview s-box')
    .first()
    .evaluate((box) => box.shadowRoot.querySelector('.box').getBoundingClientRect().height);
  assert.equal(previewPaint, 420, 'preview placeholder paints the real canvas height');
  const fieldPaint = await page
    .locator('#admin-route-skeleton .admin-skeleton-form .admin-skeleton-row s-stack s-box')
    .nth(1)
    .evaluate((box) => box.shadowRoot.querySelector('.box').getBoundingClientRect().height);
  assert.equal(fieldPaint, 36, 'form placeholder paints an input rather than a text line');
  assert.equal(await page.getByRole('button', { name: 'Save draft', exact: true }).count(), 0);
  release();
  await page.getByText('All changes saved', { exact: true }).waitFor();
  assert.equal(await skeleton.isVisible(), false);
});

test('guided product setup shows one stage at a time and keeps unsaved choices without writes', {
  timeout: 20000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  page.setDefaultTimeout(3000);
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-guided-setup' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (r) => r.fulfill({ body: '' }));
  let writes = 0;
  await page.route('**/api/admin/products/111/config', (r) => {
    if (r.request().method() !== 'GET') writes++;
    return r.fulfill({ json: response(draft()) });
  });
  await page.goto(server.base + '/admin/products/111/config');
  await page.getByText('Step 1 of 4 · Product rules', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Method name').isVisible(), true);
  assert.equal(await page.getByLabel('View name').isVisible(), false);
  await page.getByLabel('Method name').fill('Embroidery');
  await page.getByRole('button', { name: 'Continue to images and print areas', exact: true }).click();
  await page.getByText('Step 2 of 4 · Images and print areas', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Method name').isVisible(), false);
  assert.equal(await page.getByLabel('View name').isVisible(), true);
  await page.getByRole('button', { name: 'Continue to prices', exact: true }).click();
  await page.getByLabel('Embroidery / Placement 1 / Size step 1 — surcharge (USD)', { exact: true }).fill('2.50');
  await page.getByRole('button', { name: 'Continue to review', exact: true }).click();
  await page.getByText('Step 4 of 4 · Review and publish', { exact: true }).waitFor();
  if (process.env.M5_CAPTURE_BROWSER === '1')
    await page.screenshot({ path: '/tmp/insignia-guided-review.png', fullPage: true });
  await page.getByRole('button', { name: 'Back to prices', exact: true }).click();
  assert.equal(
    await page.getByLabel('Embroidery / Placement 1 / Size step 1 — surcharge (USD)', { exact: true }).inputValue(),
    '2.50',
  );
  assert.equal(writes, 0, 'step navigation never saves or publishes implicitly');
  await page.getByRole('button', { name: 'View all settings', exact: true }).click();
  assert.equal(await page.getByLabel('Method name').isVisible(), true);
  assert.equal(await page.getByLabel('View name').isVisible(), true);
  await page.goBack();
  await page.getByText('Step 3 of 4 · Prices', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Method name').isVisible(), false);
  await page.getByRole('link', { name: '1. Product rules', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  if (process.env.M5_CAPTURE_BROWSER === '1')
    await page.screenshot({ path: '/tmp/insignia-guided-mobile.png', fullPage: true });
});

test('settings method library saves reusable names and editor imports an independent unsaved copy', {
  timeout: 20000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  page.setDefaultTimeout(2500);
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-library' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (r) => r.fulfill({ body: '' }));
  const methods = [];
  let writes = 0;
  await page.route('**/api/admin/methods', async (r) => {
    assert.equal(r.request().headers().authorization, 'Bearer synthetic-library');
    if (r.request().method() === 'POST') {
      assert.ok(r.request().headers()['idempotency-key']);
      methods.push({ id: '52915e17-8104-4ef2-beb8-e99efc2914ec', name: r.request().postDataJSON().name, version: '1' });
      return r.fulfill({ status: 201, json: { kind: 'created', method: methods[0] } });
    }
    return r.fulfill({ json: { methods } });
  });
  await page.route('**/api/admin/products/111/config', (r) => {
    if (r.request().method() !== 'GET') writes++;
    return r.fulfill({ json: response(draft()) });
  });
  await page.goto(server.base + '/admin/settings/methods');
  await page.getByLabel('New method name', { exact: true }).fill('Embroidery');
  await page.getByRole('button', { name: 'Add to library', exact: true }).click();
  await page.getByLabel('Library method name', { exact: true }).waitFor();
  await page.goto(server.base + '/admin/products/111/config');
  await page.getByRole('button', { name: 'Choose from library', exact: true }).click();
  await page.getByLabel('Library method', { exact: true }).selectOption(methods[0].id);
  await page.getByRole('button', { name: 'Add selected method', exact: true }).click();
  assert.equal(await page.getByLabel('Method name', { exact: true }).nth(1).inputValue(), 'Embroidery');
  await page.getByText('Unsaved changes', { exact: true }).waitFor();
  methods[0].name = 'Later library name';
  assert.equal(await page.getByLabel('Method name', { exact: true }).nth(1).inputValue(), 'Embroidery');
  assert.equal(writes, 0, 'import only changes the local draft');
});

test('settings owns billing and privacy and storefront guidance opens exact unsaved Shopify theme links', {
  timeout: 15000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  for (const section of ['billing', 'privacy']) {
    const response = await fetch(server.base + '/admin/' + section + '?host=synthetic', { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/admin/settings/' + section + '?host=synthetic');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.shopify = { config: { shop: 'example.myshopify.com' }, idToken: async () => 'synthetic-theme-guidance' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (r) => r.fulfill({ body: '' }));
  const requests = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/')) requests.push(r.method());
  });
  await page.goto(server.base + '/admin/settings/storefront');
  const navigation = page.getByRole('navigation', { name: 'Settings sections' });
  for (const title of ['General', 'Decoration methods', 'Storefront setup', 'Billing', 'Privacy'])
    assert.equal(await navigation.getByRole('link', { name: title, exact: true }).count(), 1);
  const button = page.locator('s-button').filter({ hasText: 'Add customization button' });
  await button.waitFor();
  const link = new URL(await button.getAttribute('href'));
  assert.equal(link.origin, 'https://example.myshopify.com');
  assert.equal(link.pathname, '/admin/themes/current/editor');
  assert.deepEqual(Object.fromEntries(link.searchParams), {
    template: 'product',
    addAppBlockId: '11111111111111111111111111111111/customize',
    target: 'mainSection',
  });
  const repair = new URL(
    await page.locator('s-button').filter({ hasText: 'Set up cart repair embed' }).getAttribute('href'),
  );
  assert.deepEqual(Object.fromEntries(repair.searchParams), {
    context: 'apps',
    template: 'product',
    activateAppId: '11111111111111111111111111111111/cart-repair',
  });
  assert.deepEqual(requests, [], 'guidance does not mutate or inspect themes');
});

test('method library fences authorization loss and reconciles a lost create response without duplicate rows', {
  timeout: 20000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  page.setDefaultTimeout(2000);
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-method-fence' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (r) => r.fulfill({ body: '' }));
  let saved = null,
    first = true,
    denied = false;
  const keys = [];
  await page.route('**/api/admin/methods', (r) => {
    if (denied) return r.fulfill({ status: 403, json: { error: 'Current authorization required' } });
    if (r.request().method() === 'GET') return r.fulfill({ json: { methods: saved ? [saved] : [] } });
    keys.push(r.request().headers()['idempotency-key']);
    saved = { id: '52915e17-8104-4ef2-beb8-e99efc2914ec', name: 'Embroidery', version: '1' };
    if (first) {
      first = false;
      return r.abort('failed');
    }
    return r.fulfill({ status: 201, json: { kind: 'created', method: saved } });
  });
  await page.goto(server.base + '/admin/settings/methods');
  await page.getByLabel('New method name', { exact: true }).fill('Embroidery');
  await page.getByRole('button', { name: 'Add to library', exact: true }).click();
  const retry = page.getByRole('button', { name: 'Retry last change', exact: true });
  await retry.waitFor();
  assert.equal(await page.getByRole('button', { name: 'Add to library', exact: true }).isEnabled(), false);
  await page.getByRole('button', { name: 'Refresh library', exact: true }).click();
  await page.getByLabel('Library method name', { exact: true }).waitFor();
  await retry.click();
  await page.getByText('Library saved. Existing products are unchanged.', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Library method name', { exact: true }).count(), 1);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  denied = true;
  await page.getByRole('button', { name: 'Refresh library', exact: true }).click();
  await page.locator('s-banner').filter({ hasText: 'Current authorization required' }).waitFor();
  assert.equal(await page.getByLabel('Library method name', { exact: true }).count(), 0);
  assert.equal(await page.getByLabel('New method name', { exact: true }).count(), 0);
});

test('editor library requests share authorization clearing and discard pre-denial responses', {
  timeout: 20000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  page.setDefaultTimeout(2500);
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-library-epoch' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (r) => r.fulfill({ body: '' }));
  await page.route('**/api/admin/products/111/config', (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ json: response(draft()) })
      : r.fulfill({ status: 403, json: { error: 'Current authorization required' } }),
  );
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let started;
  const requested = new Promise((resolve) => {
    started = resolve;
  });
  let deny = false;
  await page.route('**/api/admin/methods', async (r) => {
    if (deny) return r.fulfill({ status: 403, json: { error: 'Library authorization denied' } });
    started();
    await pending;
    return r.fulfill({
      json: { methods: [{ id: '52915e17-8104-4ef2-beb8-e99efc2914ec', name: 'Stale private method', version: '1' }] },
    });
  });
  try {
    await page.goto(server.base + '/admin/products/111/config');
    await page.getByRole('button', { name: 'Choose from library', exact: true }).click();
    await requested;
    await page.getByLabel('Method name', { exact: true }).fill('Local change');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await page.getByRole('button', { name: 'Retry session', exact: true }).waitFor();
    assert.equal(await page.getByLabel('Method name', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Retry session', exact: true }).click();
    await page.getByText('All changes saved', { exact: true }).waitFor();
    release();
    await page.waitForTimeout(100);
    assert.equal(
      await page.getByLabel('Library method', { exact: true }).count(),
      0,
      'late library data cannot enter the new authorization epoch',
    );
    deny = true;
    await page.getByRole('button', { name: 'Choose from library', exact: true }).click();
    await page.getByText('Library authorization denied', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save draft', exact: true }).count(), 0);
  } finally {
    release();
  }
});

test('every merchant route paints silent placeholders before Polaris and hydration, including static Settings', {
  timeout: 30000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  page.setDefaultTimeout(2500);
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-route-shell' };
  });
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (r) => r.fulfill({ body: '' }));
  let release;
  let pending;
  await page.route(polarisUrl, async (r) => {
    await pending;
    return r.fulfill({ body: source, contentType: 'text/javascript' });
  });
  await page.route('**/api/**', (r) => r.fulfill({ status: 403, json: { error: 'Reopen from Shopify Admin' } }));
  for (const path of [
    '/admin/products',
    '/admin/orders',
    '/admin/settings',
    '/admin/settings/methods',
    '/admin/settings/storefront',
    '/admin/settings/billing',
    '/admin/settings/privacy',
    '/admin/products/111/config',
  ]) {
    pending = new Promise((resolve) => {
      release = resolve;
    });
    try {
      await page.goto(server.base + path, { waitUntil: 'commit' });
      const skeleton = page.getByRole('status', { name: 'Page content', exact: true });
      await skeleton.waitFor();
      assert.ok((await skeleton.boundingBox()).height > 200, path);
      assert.equal((await skeleton.innerText()).trim(), '', 'placeholders have no visible loading copy');
      assert.equal(await page.locator('s-app-nav').isVisible(), false, 'never flash raw sidebar links');
      release();
      await skeleton.waitFor({ state: 'hidden', timeout: 10000 });
      assert.equal(await page.locator('s-page').last().isVisible(), true, path);
      assert.equal(
        await page
          .locator('body')
          .evaluate((b) => Array.from(b.querySelectorAll('button,input,select,textarea,a,details,summary')).length),
        0,
        path + ' has only Polaris controls in light DOM',
      );
    } finally {
      release();
    }
  }
});

test('internal merchant navigation shows silent placeholders until destination data settles', {
  timeout: 15000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  page.setDefaultTimeout(2500);
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-transition' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (r) => r.fulfill({ body: '' }));
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/purchases/v1/privacy', async (r) => {
    await pending;
    return r.fulfill({ json: { items: [] } });
  });
  try {
    await page.goto(server.base + '/admin/settings');
    await page.getByRole('link', { name: 'Privacy', exact: true }).click();
    const shell = page.getByRole('status', { name: 'Page content', exact: true });
    await shell.waitFor();
    assert.equal(new URL(page.url()).pathname, '/admin/settings/privacy');
    assert.equal((await shell.innerText()).trim(), '');
    assert.equal(await page.getByRole('button', { name: 'Refresh requests', exact: true }).isVisible(), false);
    release();
    await page.getByText('No data requests are currently available.', { exact: true }).waitFor({ timeout: 8000 });
    assert.equal(await shell.isVisible(), false);
  } finally {
    release();
  }
});

test('configurator leads with editable product rules and Polaris actions rather than stacked status cards', {
  timeout: 15000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(2500);
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-compact-editor' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (r) => r.fulfill({ body: '' }));
  await page.route('**/api/admin/products/111/config', (r) => r.fulfill({ json: response(draft()) }));
  await page.goto(server.base + '/admin/products/111/config');
  const mode = page.getByRole('combobox', { name: 'Customization mode', exact: true });
  await mode.waitFor();
  assert.ok((await mode.boundingBox()).y < 650, 'first editable field is in the initial desktop viewport');
  if (process.env.M5_CAPTURE_POLISH === '1') {
    await page.screenshot({ path: '/tmp/insignia-polaris-editor-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '/tmp/insignia-polaris-editor-mobile.png', fullPage: true });
  }
  assert.equal(
    await page.getByRole('heading', { name: 'Publication', exact: true }).isVisible(),
    false,
    'detailed publication belongs to review',
  );
  assert.equal(
    await page
      .locator('body')
      .evaluate((b) => b.querySelectorAll('button,input,select,textarea,a,details,summary,p,h1,h2,h3,strong').length),
    0,
    'shared controls and typography use Polaris',
  );
});

test('cancelled merchant navigation keeps the current page usable without a stuck skeleton', {
  timeout: 15000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  page.setDefaultTimeout(1800);
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-cancel' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (r) => r.fulfill({ body: '' }));
  await page.goto(server.base + '/admin/settings');
  await page.getByRole('link', { name: 'Privacy', exact: true }).waitFor();
  await page
    .locator('s-button[href="/admin/settings/privacy"]')
    .evaluate((node) => node.addEventListener('click', (event) => event.preventDefault(), { once: true }));
  await page.getByRole('link', { name: 'Privacy', exact: true }).click();
  await page.getByRole('link', { name: 'General', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/admin/settings');
  assert.equal(await page.getByRole('status', { name: 'Page content', exact: true }).isVisible(), false);
});

test('late authenticated read replaces the bootstrap timeout notice with the settled page', {
  timeout: 15000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  page.setDefaultTimeout(2500);
  await page.clock.install();
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-late-read' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (r) => r.fulfill({ body: '' }));
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/purchases/v1/privacy', async (r) => {
    await pending;
    return r.fulfill({ json: { items: [] } });
  });
  try {
    await page.goto(server.base + '/admin/settings/privacy');
    await page.getByRole('status', { name: 'Page content', exact: true }).waitFor();
    await page.clock.fastForward(16000);
    await page.locator('#admin-route-failure').waitFor();
    release();
    await page.getByText('No data requests are currently available.', { exact: true }).waitFor();
    assert.equal(await page.locator('#admin-route-failure').isVisible(), false);
    assert.equal(await page.locator('#admin-route-content').evaluate((element) => element.inert), false);
  } finally {
    release();
  }
});
