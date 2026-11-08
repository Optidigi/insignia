import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import type { BuyerConfig } from '../src/buyer.ts';
import { serverPort } from './support.mts';

test('failed target-product lookup never displays another product frozen config in selected repair', async (t) => {
  const source: BuyerConfig = {
    version: 'm7-config-v1',
    productId: '111',
    revisionId: 'x-revision',
    contentHash: 'a'.repeat(64),
    title: 'Private product X',
    shopCurrency: 'USD',
    methods: [{ id: 'print', label: 'Print' }],
    placements: [
      { id: 'front', label: 'Front', allowedMethodIds: ['print'], allowedStepIds: ['small'], logoLaterAllowed: true },
    ],
    steps: [{ id: 'small', label: 'Small' }],
    options: [],
    variants: [
      {
        id: '101',
        label: 'X',
        available: true,
        selectedOptions: [{ name: 'Title', value: 'Default Title' }],
        baseUnitMinor: '1000',
      },
    ],
    geometry: {
      version: 'm5-geometry-v1',
      views: [
        {
          id: 'front',
          image: { revisionId: 'x-photo', width: 1000, height: 1000 },
          variantImages: [],
          placements: [{ id: 'front', rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 } }],
        },
      ],
      steps: [{ id: 'small', widthFraction: 0.5, heightFraction: 0.5, physicalMm: { width: 100, height: 100 } }],
    },
    imageUrls: { 'x-photo': 'https://example.test/x.png' },
    decorationPrices: [{ placementId: 'front', methodId: 'print', stepId: 'small', minor: '500' }],
    ready: true,
  };
  const group = {
    productId: '222',
    configRevisionId: 'y-revision',
    revisionContentHash: 'b'.repeat(64),
    design: {
      placements: [
        {
          placementId: 'back',
          methodId: 'print',
          stepId: 'large',
          artwork: { kind: 'deferred', intentId: 'original-y' },
        },
      ],
      options: [],
    },
    variants: [{ variantId: '202', quantity: 1 }],
  };
  const compiled = await build({
      entryPoints: [new URL('../src/designer/controller.ts', import.meta.url).pathname],
      bundle: true,
      write: false,
      loader: { '.css': 'text' },
      platform: 'browser',
      format: 'esm',
    }),
    script = compiled.outputFiles[0];
  assert(script);
  const html = `<!doctype html><script type="module">import{mountLiveDesigner}from'/controller.js';window.controller=await mountLiveDesigner({source:${JSON.stringify(source)},proxyBase:'/apps/insignia',cartRoot:'/',country:'US',marketId:'42',locale:'en',storeName:'Store',repair:true,storage:sessionStorage,onClose(){},onError(){},isCurrent:()=>true});</script>`;
  const server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? '/', 'http://fixture').pathname;
      if (path === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end(html);
        return;
      }
      if (path === '/controller.js') {
        response.setHeader('Content-Type', 'text/javascript');
        response.end(script.text);
        return;
      }
      if (!/^\/insignia-[A-Za-z0-9_.-]+\.(?:js|css)$/.test(path)) {
        response.statusCode = 404;
        response.end();
        return;
      }
      response.setHeader('Content-Type', path.endsWith('.css') ? 'text/css' : 'text/javascript');
      response.end(await readFile(new URL(`../dist${path}`, import.meta.url)));
    })().catch(() => {
      response.statusCode = 500;
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
  const page = await browser.newPage();
  let configReads = 0,
    mutations = 0;
  await page.route('**/cart.js', (route) =>
    route.fulfill({
      json: {
        currency: 'USD',
        attributes: {},
        items: [
          {
            key: 'custom-y',
            product_id: 222,
            variant_id: 202,
            quantity: 1,
            properties: { _insignia_quote_v2: 'old', _insignia_member_v2: 'member' },
          },
        ],
      },
    }),
  );
  await page.route('**/apps/insignia/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/sessions'))
      return route.fulfill({
        json: {
          capability: 'abc.def',
          sessionId: '11111111-1111-4111-8111-111111111111',
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
      });
    if (path.endsWith('/cart-state')) return route.fulfill({ json: { groups: [group], repairRequired: false } });
    if (path.endsWith('/config')) {
      configReads++;
      assert.equal(new URL(route.request().url()).searchParams.get('productId'), '222');
      return route.fulfill({ status: 503, json: { error: 'unavailable' } });
    }
    mutations++;
    return route.fulfill({ status: 500, json: { error: 'unexpected' } });
  });
  await page.goto(`http://127.0.0.1:${serverPort(server)}/`);
  const frame = page.frameLocator('iframe');
  await frame.getByRole('heading', { name: 'Your customization needs review' }).waitFor();
  assert.equal(configReads, 1);
  assert.equal(await frame.locator('.preview-panel').count(), 0);
  assert.doesNotMatch(await frame.locator('body').innerText(), /Private product X/);
  assert.equal(await page.locator('iframe').getAttribute('title'), 'Customization');
  assert.equal(await frame.getByRole('button', { name: 'Start a new customization', exact: true }).count(), 0);
  assert.equal(await frame.getByRole('button', { name: 'Review removing this customization', exact: true }).count(), 1);
  assert.equal(mutations, 0);

  await page.route('**/cart.js', (route) => route.fulfill({ json: { currency: 'USD', attributes: {}, items: [] } }));
  await page.route('**/apps/insignia/v1/cart-state', (route) =>
    route.fulfill({ json: { groups: [], repairRequired: false } }),
  );
  await page.evaluate(async (source) => {
    Reflect.get(window, 'controller').destroy();
    const missing = structuredClone(source);
    for (const step of missing.geometry.steps) Reflect.deleteProperty(step, 'physicalMm');
    const { mountLiveDesigner } = await import(/* @vite-ignore */ new URL('/controller.js', location.href).href);
    Reflect.set(
      window,
      'controller',
      await mountLiveDesigner({
        source: missing,
        proxyBase: '/apps/insignia',
        cartRoot: '/',
        country: 'US',
        marketId: '42',
        locale: 'en',
        storeName: 'Store',
        repair: false,
        storage: sessionStorage,
        onClose() {},
        onError() {},
        isCurrent: () => true,
      }),
    );
  }, source);
  await frame.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  assert.equal(
    await frame.getByRole('button', { name: 'Review removing all customized items', exact: true }).count(),
    0,
    'empty carts must not offer removal',
  );
  assert.equal(await frame.getByRole('heading', { name: 'Unavailable', exact: true }).count(), 1);
  assert.doesNotMatch(await frame.locator('body').innerText(), /existing customized items stay in the cart/i);
  assert.equal(mutations, 0);
  await page.route('**/cart.js', (route) =>
    route.fulfill({
      json: {
        currency: 'USD',
        attributes: {},
        items: [
          {
            key: 'unrestorable',
            product_id: 222,
            variant_id: 202,
            quantity: 1,
            properties: { _insignia_quote_v2: 'old', _insignia_member_v2: 'member' },
          },
        ],
      },
    }),
  );
  await page.evaluate(async (source) => {
    Reflect.get(window, 'controller').destroy();
    const { mountLiveDesigner } = await import(/* @vite-ignore */ new URL('/controller.js', location.href).href);
    Reflect.set(
      window,
      'controller',
      await mountLiveDesigner({
        source,
        proxyBase: '/apps/insignia',
        cartRoot: '/',
        country: 'US',
        marketId: '42',
        locale: 'en',
        storeName: 'Store',
        repair: true,
        storage: sessionStorage,
        onClose() {},
        onError() {},
        isCurrent: () => true,
      }),
    );
  }, source);
  await frame.getByRole('button', { name: 'Review removing all customized items', exact: true }).click();
  await frame.getByRole('button', { name: 'Confirm cart update', exact: true }).waitFor();
  assert.equal(
    mutations,
    0,
    'unrestorable customized lines remain removable only through explicit review/confirmation',
  );
});
