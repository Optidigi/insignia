/** Secret-free local composition preview. Never imported or packaged by the application. */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { PurchaseViewSchema } from '@insignia/contracts';
import { build, transform } from 'esbuild';
import { PurchaseListViewSchema } from '../../src/shared/purchase-presentation.ts';
import { createCatalogDemo } from './support/catalog-demo.mts';
import { jsonRecord } from './support/fixtures.mts';
import { loadLegacyDemoCatalog } from './support/legacy-demo-catalog.mts';
import { createMethodCatalogDemo, methodCatalogDemoCollections } from './support/method-catalog-demo.mts';
import { methodPreviewSchema } from './support/method-configuration.mts';
import { methodDetailSkeletonMarkup, methodIndexSkeletonMarkup } from './support/method-skeletons.mts';
import {
  cellKey,
  loadMethodWorkflowProducts,
  parsePrice,
  seedMethods,
  seedProductMethods,
} from './support/method-workflow-model.mts';
import { createOrderDemo, demoAssetOrigin, demoStartPurchaseId } from './support/order-demo.mts';
import { loadPlacementProducts } from './support/placement-workflow-fixtures.mts';
import { createPreviewIconLoader, parsePreviewIconAsset } from './support/preview-assets.mts';
import { draft, response } from './support/product-fixture.mts';
import { createRichPurchasePreviewFixtures } from './support/purchase-preview-fixtures.mts';
import { settingsPlanPreview } from './support/settings-plan-preview.mts';
import { settingsPreviewResponse } from './support/settings-preview-fixtures.mts';

const settingsPreviewScript = (
  await build({
    entryPoints: [new URL('./support/settings-preview-browser.mts', import.meta.url).pathname],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2023',
  })
).outputFiles[0]?.text;
if (!settingsPreviewScript) throw new Error('Settings preview script could not be built');

const homePreviewBundle = await build({
  entryPoints: [new URL('./support/home-preview.tsx', import.meta.url).pathname],
  bundle: true,
  write: false,
  outfile: 'home-preview.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2023',
  jsx: 'automatic',
  jsxImportSource: 'preact',
});

const hostScript = (
  await build({
    entryPoints: [new URL('./support/preview-host.mts', import.meta.url).pathname],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2023',
  })
).outputFiles[0]?.text;
if (!hostScript) throw new Error('Preview host script could not be built');

const previewAssetFetchScript = (
  await transform(await readFile(new URL('./support/preview-icon-transport.mts', import.meta.url), 'utf8'), {
    loader: 'ts',
    format: 'iife',
    target: 'es2023',
  })
).code;

const state = process.env.INSIGNIA_PREVIEW_STATE ?? 'normal';
if (!['normal', 'empty', 'denied', 'unavailable', 'loading'].includes(state))
  throw new Error('INSIGNIA_PREVIEW_STATE must be normal, empty, denied, unavailable or loading');
const scenario = process.env.INSIGNIA_PREVIEW_SCENARIO ?? 'order-demo';
if (!['normal', 'orders-rich', 'order-demo'].includes(scenario))
  throw new Error('INSIGNIA_PREVIEW_SCENARIO must be normal, orders-rich or order-demo');
const demo = scenario === 'order-demo' ? await createOrderDemo() : null;
const catalogDemo = demo
  ? createCatalogDemo(await loadLegacyDemoCatalog((path) => `${demoAssetOrigin}/${path}`))
  : null;
// Frontend-only method exploration. Compiled and served exclusively by this local host.
const methodWorkflow = !!demo;
const methodProducts = methodWorkflow ? await loadMethodWorkflowProducts() : [];
const placementProducts = demo ? await loadPlacementProducts() : [];
function placementEditorSkeletonMarkup(): string {
  const lines = '<span class="placement-skeleton-line"></span><span class="placement-skeleton-line short"></span>';
  return `<div class="placement-workflow" role="status" aria-label="Loading product setup" aria-busy="true"><div class="placement-editor" data-placement-skeleton><aside class="placement-outline"><div class="placement-panel-heading">${lines}</div><div class="placement-property-section">${lines}${lines}</div></aside><section class="placement-workspace"><div class="placement-canvas-toolbar">${lines}</div><div class="placement-canvas-component"></div></section><aside class="placement-properties"><div class="placement-panel-heading">${lines}</div><div class="placement-property-section">${lines}${lines}</div></aside></div></div>`;
}
// Frontend-only garment editor. Uses the existing Konva renderer, never production writes.
const placementBundle = demo
  ? await build({
      entryPoints: [new URL('./support/placement-workflow-preview.tsx', import.meta.url).pathname],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      target: 'es2023',
      jsx: 'automatic',
      jsxImportSource: 'preact',
    })
  : null;
const placementCopyBundle = demo
  ? await build({
      entryPoints: [new URL('./support/placement-setup-copy-entry.tsx', import.meta.url).pathname],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      target: 'es2023',
      jsx: 'automatic',
      jsxImportSource: 'preact',
    })
  : null;
const productMethods = seedProductMethods(methodProducts);
const methodData = {
  methods: seedMethods().map((method, index) => ({
    ...method,
    pricing: index === 0 ? 'fixed' : 'product',
    amount: index === 0 ? '5.00' : '',
    assignment: index === 0 ? 'manual' : 'tags',
    productIds: index === 0 ? methodProducts.map((product) => product.id.replace('gid://shopify/Product/', '')) : [],
    tags: index === 0 ? [] : ['polo'],
    tagMatch: 'any',
  })),
  products: methodProducts.map((product) => ({
    id: product.id.replace('gid://shopify/Product/', ''),
    title: product.title,
    image: product.image,
    tags: [
      'customizable',
      product.title.toLowerCase().includes('hoodie')
        ? 'hoodie'
        : product.title.toLowerCase().includes('polo')
          ? 'polo'
          : 't-shirt',
    ],
    collections: product.title.toLowerCase().includes('hoodie')
      ? [methodCatalogDemoCollections.hoodies, methodCatalogDemoCollections.workwear]
      : product.title.toLowerCase().includes('polo')
        ? [methodCatalogDemoCollections.polos, methodCatalogDemoCollections.workwear]
        : [methodCatalogDemoCollections.tShirts, methodCatalogDemoCollections.teamwear],
    setup: (productMethods[product.id] ?? []).map((method) => ({
      methodId: method.sourceId,
      locations: method.locationIds.length,
      pricedLocations: method.locationIds.filter((locationId) =>
        product.locations
          .find((location) => location.id === locationId)
          ?.sizes.some((size) => parsePrice(method.prices[cellKey(locationId, size.id)] ?? '').kind === 'valid'),
      ).length,
    })),
  })),
};
const largeMethodData = methodWorkflow ? createMethodCatalogDemo(methodPreviewSchema.parse(methodData)) : null;
const methodBundle = demo
  ? await build({
      entryPoints: [new URL('./support/method-workflow-preview.tsx', import.meta.url).pathname],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      target: 'es2023',
      jsx: 'automatic',
      jsxImportSource: 'preact',
    })
  : null;
const demoScripts = new Map<string, string>();
if (demo) {
  for (const name of ['browser', 'transport', 'worker']) {
    const compiled = await build({
      entryPoints: [new URL(`./support/order-demo-${name}.mts`, import.meta.url).pathname],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      target: 'es2023',
    });
    const script = compiled.outputFiles[0]?.text;
    if (!script) throw new Error(`Local ${name} script could not be built`);
    demoScripts.set(`/__preview/demo/${name}.js`, script);
  }
}
const fixtures = jsonRecord(await readFile(new URL('./support/preview-fixtures.json', import.meta.url), 'utf8'));
// Preview-only access observation. No real permissions are requested or granted.
fixtures['/api/admin/readiness'] = {
  version: 'm5-admin-technical-readiness-v1',
  canRead: true,
  canEdit: true,
};
for (const value of Object.values(fixtures)) {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'orderName' in value &&
    typeof value.orderName === 'string'
  )
    value.orderName = value.orderName.split(' — ')[0];
}
const list = fixtures['/api/purchases/v1'];
if (list && typeof list === 'object' && !Array.isArray(list) && 'items' in list && Array.isArray(list.items)) {
  Object.assign(list, { timeZone: 'Europe/Amsterdam' });
  for (const item of list.items as unknown[])
    if (item && typeof item === 'object' && 'orderName' in item && typeof item.orderName === 'string')
      item.orderName = item.orderName.split(' — ')[0];
}
if (scenario === 'orders-rich') {
  for (const path of Object.keys(fixtures)) if (/^\/api\/purchases\/v1\/[0-9a-f-]+$/i.test(path)) delete fixtures[path];
  Object.assign(fixtures, createRichPurchasePreviewFixtures());
}
const config = response(draft());
config.product.title = 'Cotton crewneck — local sample';
config.config.draft.labels = {
  methods: { print: 'Screen printing' },
  placements: { front: 'Front chest' },
  steps: { small: 'Small', large: 'Large' },
};
// Read-only selected-container fixtures for scenarios without the interactive demo adapter.
const selectedContext = { shop: 'synthetic.myshopify.com', authority: 'a'.repeat(64), canEdit: false };
fixtures['/api/admin/preferences'] = {
  version: 'merchant-preferences-v1', ...selectedContext, canReadPrivacy: false,
  guidanceVersion: '0', wordingVersion: '0', guidance: { dismissed: false, completedSteps: [] },
  overlays: { en: { locale: 'en', messages: {} } },
};
fixtures['/api/admin/methods'] = { ...selectedContext, currency: 'USD', methods: [] };
Object.assign(config.product, { tags: [], collections: [], collectionsTruncated: false, methodSetup: [],
  configurationSummary: { state: 'draft', methods: ['Screen printing'], locations: ['Front chest'] } });
fixtures['/api/admin/products'] = { products: [config.product], nextCursor: null };
fixtures['/api/admin/products/111/config'] = config;
const loadPreviewIcon = createPreviewIconLoader();
const child = spawn(process.execPath, [new URL('../../dist/server/entry.mjs', import.meta.url).pathname], {
  // Deliberately exclude ambient credentials, DATABASE_URL and production configuration.
  env: { PATH: process.env.PATH, HOST: '127.0.0.1', PORT: '0', SHOPIFY_CLIENT_ID: '11111111111111111111111111111111' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk: Buffer) => {
  output += chunk.toString();
});
child.stderr.on('data', (chunk: Buffer) => {
  output += chunk.toString();
});
let upstream: string | undefined;
for (let attempt = 0; attempt < 100 && child.exitCode === null; attempt++) {
  upstream = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
  if (upstream) break;
  await new Promise((resolve) => setTimeout(resolve, 50));
}
if (!upstream) {
  child.kill();
  throw new Error('Build the web app first; local SSR preview could not start.');
}
const origin = upstream;
const server = createServer(async (request, reply) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    reply.setHeader('cache-control', 'no-store');
    if (
      request.method === 'GET' &&
      ['/illustrations/shopify/empty-records.png', '/illustrations/shopify/empty-product.png', '/illustrations/editor-sample.png'].includes(url.pathname)
    ) {
      reply.setHeader('content-type', 'image/png');
      reply.end(await readFile(new URL(`../../dist/client${url.pathname}`, import.meta.url)));
      return;
    }
    // Read-only, loopback-only screenshot gallery for owner review.
    if (request.method === 'GET' && url.pathname === '/__preview/home/create-product-handoff') {
      reply.setHeader('content-type', 'text/html; charset=utf-8');
      const catalog = url.searchParams.get('mode') === 'products';
      const heading = catalog ? 'Open Products in Shopify' : 'Add a product in Shopify';
      const explanation = catalog
        ? 'In a connected store, this action opens the Shopify product catalog.'
        : 'In a connected store, this action opens Shopify’s product creation form.';
      reply.end(
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading}</title><style>body{font:14px/1.5 system-ui;margin:32px;color:#303030}main{max-width:540px;margin:64px auto}a{color:#005bd3}</style><main><h1>${heading}</h1><p>${explanation} No product is created by this local preview.</p><a href="/admin/home?__home_example=no-products">Return to Home</a></main></html>`,
      );
      return;
    }
    if (request.method === 'GET' && ['/__preview/home/app.js', '/__preview/home/style.css'].includes(url.pathname)) {
      const css = url.pathname.endsWith('.css');
      reply.setHeader('content-type', css ? 'text/css' : 'text/javascript');
      reply.end(homePreviewBundle.outputFiles.find((file) => file.path.endsWith(css ? '.css' : '.js'))?.text ?? '');
      return;
    }
    if (url.pathname === '/__preview/settings/theme-handoff') {
      const task = url.searchParams.get('task');
      const label =
        task === 'button'
          ? 'Add the customization button'
          : task === 'cart'
            ? 'Enable cart review'
            : task === 'preview'
              ? 'Preview the selected product'
              : 'Edit the published theme';
      const example = url.searchParams.get('example') ?? 'not-added';
      const returnUrl = `/admin/settings/storefront?${new URLSearchParams({ __settings_example: example })}`;
      reply.setHeader('content-type', 'text/html; charset=utf-8');
      reply.end(
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Shopify theme editor handoff</title><style>body{font:14px/1.5 system-ui;background:#f7f7f8;color:#303030;margin:0;padding:32px 20px}main{max-width:580px;margin:64px auto;background:white;border:1px solid #ddd;border-radius:12px;padding:24px}h1{font-size:20px}a{color:#005bd3}small{color:#616161}</style><main><small>Local preview · Shopify-owned handoff</small><h1>${label}</h1><p>In a connected store, this action opens Shopify’s theme editor. Position the Insignia block or enable the app embed, preview your changes and save in Shopify.</p><p>This local preview cannot change a theme.</p><a href="${returnUrl.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">Return to Storefront setup</a></main></html>`,
      );
      return;
    }
    if (url.pathname === '/__preview/settings/billing-handoff') {
      reply.setHeader('content-type', 'text/html; charset=utf-8');
      reply.end(settingsPlanPreview());
      return;
    }
    if (url.pathname === '/__preview/settings/language-handoff') {
      const example = url.searchParams.get('example') ?? 'initial';
      const returnUrl = `/admin/settings/translations?${new URLSearchParams({ __translations_example: example })}`;
      reply.setHeader('content-type', 'text/html; charset=utf-8');
      reply.end(
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Shopify language settings</title><style>body{font:14px/1.5 system-ui;background:#f7f7f8;color:#303030;margin:0;padding:32px 20px}main{max-width:580px;margin:64px auto;background:white;border:1px solid #ddd;border-radius:12px;padding:24px}h1{font-size:20px}a{color:#005bd3}small{color:#616161}</style><main><small>Local preview · Shopify-owned settings</small><h1>Manage storefront languages</h1><p>In a connected store, this action opens Shopify Settings → Languages. Shopify controls adding, publishing, and assigning storefront languages.</p><p>This local preview cannot change a language.</p><a href="${returnUrl.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">Return to Translations</a></main></html>`,
      );
      return;
    }
    if (request.method === 'GET' && url.pathname === '/__preview/host.css') {
      reply.setHeader('content-type', 'text/css');
      reply.end(await readFile(new URL('./support/preview-host.css', import.meta.url)));
      return;
    }
    const variantPhoto =
      /^\/__preview\/(?:placement-variant-photos|demo\/files)\/(shirt-(?:black|white|navy)-(?:front|back|left|right)\.jpg)$/.exec(
        url.pathname,
      );
    if (demo && request.method === 'GET' && variantPhoto?.[1]) {
      reply.setHeader('content-type', 'image/jpeg');
      reply.end(await readFile(new URL(`./support/assets/variant-photos/${variantPhoto[1]}`, import.meta.url)));
      return;
    }
    if (demo && request.method === 'GET' && url.pathname.startsWith('/__preview/placement-workflow/')) {
      if (url.pathname.endsWith('/catalog')) {
        reply.setHeader('content-type', 'application/json');
        reply.end(JSON.stringify(placementProducts));
      } else if (url.pathname.endsWith('/copy.js')) {
        reply.setHeader('content-type', 'text/javascript');
        reply.end(placementCopyBundle?.outputFiles?.[0]?.text);
      } else if (url.pathname.endsWith('/data')) {
        const product = placementProducts.find(
          (item) => item.id.replace('gid://shopify/Product/', '') === url.searchParams.get('product'),
        );
        reply.statusCode = product ? 200 : 404;
        reply.setHeader('content-type', 'application/json');
        reply.end(JSON.stringify(product ?? { error: 'Product unavailable' }));
      } else if (url.pathname.endsWith('/app.js')) {
        reply.setHeader('content-type', 'text/javascript');
        reply.end(placementBundle?.outputFiles?.[0]?.text);
      } else if (url.pathname.endsWith('/style.css')) {
        reply.setHeader('content-type', 'text/css');
        const sheets = await Promise.all(
          [
            'placement-workflow-preview.css',
            'placement-variant-photo-panel.css',
            'placement-method-manager.css',
            'placement-image-picker.css',
            'placement-setup-copy-dialog.css',
            'placement-setup-copy-review.css',
          ].map((name) => readFile(new URL(`./support/${name}`, import.meta.url), 'utf8')),
        );
        reply.end(sheets.join('\n'));
      } else {
        reply.statusCode = 404;
        reply.end('Preview resource unavailable');
      }
      return;
    }
    if (methodWorkflow && request.method === 'GET' && url.pathname.startsWith('/__preview/method-workflow/')) {
      if (url.pathname.endsWith('/data')) {
        reply.setHeader('content-type', 'application/json');
        reply.end(JSON.stringify(url.searchParams.get('catalog') === 'large' ? largeMethodData : methodData));
      } else if (url.pathname.endsWith('/app.js')) {
        reply.setHeader('content-type', 'text/javascript');
        reply.end(methodBundle?.outputFiles?.[0]?.text);
      } else if (url.pathname.endsWith('/style.css')) {
        reply.setHeader('content-type', 'text/css');
        reply.end(
          (
            await Promise.all([
              readFile(new URL('./support/method-workflow-preview.css', import.meta.url), 'utf8'),
              readFile(new URL('./support/method-product-picker.css', import.meta.url), 'utf8'),
            ])
          ).join('\n'),
        );
      } else {
        reply.statusCode = 404;
        reply.end('Preview resource unavailable');
      }
      return;
    }
    const demoScript = demoScripts.get(url.pathname);
    if (demoScript && request.method === 'GET') {
      reply.setHeader('content-type', 'text/javascript');
      reply.setHeader('service-worker-allowed', '/');
      reply.end(demoScript);
      return;
    }
    if (catalogDemo && state === 'normal' && url.pathname === '/__preview/demo/reset' && request.method === 'POST')
      catalogDemo.reset();
    if (state === 'normal' && request.method === 'GET' && /^\/api\/admin\/products\/\d+\/config$/.test(url.pathname)) {
      const example = url.searchParams.get('__settings_example');
      const fixture = example ? settingsPreviewResponse(url.pathname, example) : undefined;
      if (fixture) {
        reply.statusCode = fixture.status;
        reply.setHeader('content-type', 'application/json');
        reply.end(JSON.stringify(fixture.body));
        return;
      }
    }
    if (catalogDemo && state === 'normal' && (await catalogDemo.handle(request, reply, url))) return;
    if (demo && state === 'normal' && (await demo.handle(request, reply, url))) return;
    if (url.pathname === '/__preview/assets.js') {
      reply.setHeader('content-type', 'text/javascript; charset=utf-8');
      reply.end(previewAssetFetchScript);
      return;
    }
    if (url.pathname === '/__preview/host.js') {
      reply.setHeader('content-type', 'text/javascript');
      reply.end(hostScript);
      return;
    }
    if (url.pathname === '/__preview/bridge.js') {
      reply.setHeader('content-type', 'text/javascript');
      reply.end(settingsPreviewScript);
      return;
    }
    if (url.pathname === '/__preview/polaris.js') {
      reply.setHeader('content-type', 'text/javascript');
      reply.end(await readFile(new URL('../fixtures/polaris-2.0-rc.snapshot', import.meta.url)));
      return;
    }
    if (url.pathname.startsWith('/__preview/icons/')) {
      const asset = parsePreviewIconAsset(url.pathname, url.search);
      if (!asset) {
        reply.statusCode = 404;
        reply.end('Preview icon unavailable');
        return;
      }
      if (request.method !== 'GET') {
        reply.statusCode = 405;
        reply.setHeader('allow', 'GET');
        reply.end('Preview icon route only accepts GET');
        return;
      }
      try {
        const body = await loadPreviewIcon(asset);
        reply.statusCode = 200;
        reply.setHeader('cache-control', 'public, max-age=3600, immutable');
        reply.setHeader('content-type', 'image/svg+xml');
        reply.setHeader('content-length', String(body.byteLength));
        reply.setHeader('x-content-type-options', 'nosniff');
        reply.end(body);
      } catch {
        reply.statusCode = 502;
        reply.end('Preview icon unavailable');
      }
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      reply.setHeader('content-type', 'application/json');
      if (request.method !== 'GET') {
        reply.statusCode = 405;
        reply.end(
          JSON.stringify({
            error: 'Local preview is read-only. Use browser regression fixtures for command outcomes.',
          }),
        );
        return;
      }
      if (state === 'loading') await new Promise((resolve) => setTimeout(resolve, 3000));
      if (state === 'denied' || state === 'unavailable') {
        reply.statusCode = state === 'denied' ? 403 : 503;
        reply.end(
          JSON.stringify({
            error: state === 'denied' ? 'Local preview: access denied' : 'Local preview: service unavailable',
          }),
        );
        return;
      }
      const settingsExample = url.searchParams.get('__settings_example');
      const settingsResult =
        state === 'normal' && settingsExample ? settingsPreviewResponse(url.pathname, settingsExample) : undefined;
      if (settingsResult) {
        reply.statusCode = settingsResult.status;
        reply.end(JSON.stringify(settingsResult.body));
        return;
      }
      if (url.pathname === '/api/purchases/v1') {
        const source = PurchaseListViewSchema.parse(
          demo
            ? { version: 'm8-purchase-list-v1', items: demo.orders, nextCursor: null, timeZone: 'Europe/Amsterdam' }
            : fixtures[url.pathname],
        );
        const sort = url.searchParams.get('sort') ?? 'date-desc';
        const limit = Number(url.searchParams.get('limit') ?? '20');
        const before = url.searchParams.get('before');
        const createdFrom = url.searchParams.get('createdFrom');
        const createdBefore = url.searchParams.get('createdBefore');
        if (
          !['date-asc', 'date-desc'].includes(sort) ||
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > 50 ||
          [createdFrom, createdBefore].some(
            (date) => date !== null && !PurchaseViewSchema.shape.orderCreatedAt.safeParse(date).success,
          ) ||
          (createdFrom !== null && createdBefore !== null && Date.parse(createdFrom) >= Date.parse(createdBefore))
        ) {
          reply.statusCode = 400;
          reply.end(JSON.stringify({ code: 'INVALID_REQUEST' }));
          return;
        }
        const direction = sort === 'date-asc' ? 1 : -1;
        const ordered = (state === 'empty' ? [] : [...source.items]).sort((a, b) => {
          const byDate = Date.parse(a.orderCreatedAt) - Date.parse(b.orderCreatedAt);
          const byId = a.purchaseId < b.purchaseId ? -1 : a.purchaseId > b.purchaseId ? 1 : 0;
          return direction * (byDate || byId);
        });
        const cursorIndex = before ? ordered.findIndex((item) => item.purchaseId === before) : -1;
        const remaining = before && cursorIndex < 0 ? [] : ordered.slice(cursorIndex + 1);
        const filtered = remaining.filter(
          (item) =>
            (createdFrom === null || Date.parse(item.orderCreatedAt) >= Date.parse(createdFrom)) &&
            (createdBefore === null || Date.parse(item.orderCreatedAt) < Date.parse(createdBefore)),
        );
        const items = filtered.slice(0, limit);
        reply.statusCode = 200;
        reply.end(
          JSON.stringify(
            PurchaseListViewSchema.parse({
              ...source,
              items,
              nextCursor: filtered.length > limit ? (items.at(-1)?.purchaseId ?? null) : null,
            }),
          ),
        );
        return;
      }
      const data =
        state === 'empty'
          ? url.pathname === '/api/admin/products'
            ? { products: [], nextCursor: null }
            : url.pathname === '/api/admin/methods'
              ? { ...selectedContext, currency: 'USD', methods: [] }
              : url.pathname === '/api/purchases/v1'
                ? { version: 'm8-purchase-list-v1', items: [], nextCursor: null }
                : url.pathname === '/api/purchases/v1/privacy'
                  ? { items: [] }
                  : fixtures[url.pathname]
          : fixtures[url.pathname];
      reply.statusCode = data ? 200 : 404;
      reply.end(JSON.stringify(data ?? { error: 'No synthetic fixture for this resource' }));
      return;
    }
    // No webhook, proxy, upload, release or other command route reaches the real SSR server.
    if (
      request.method !== 'GET' ||
      (!url.pathname.startsWith('/admin') && !url.pathname.startsWith('/_astro/') && url.pathname !== '/live')
    ) {
      reply.statusCode = 404;
      reply.end('Local preview route unavailable');
      return;
    }
    const inside = url.searchParams.has('__preview_frame') || request.headers['sec-fetch-dest'] === 'iframe';
    url.searchParams.delete('__preview_frame');
    const methodRoute = methodWorkflow && /^\/admin\/methods(?:\/[a-zA-Z0-9-]+)?\/?$/.test(url.pathname);
    const result = await fetch(origin + (methodRoute ? '/admin/methods' : url.pathname) + url.search, {
      redirect: 'manual',
    });
    const type = result.headers.get('content-type') ?? '';
    reply.statusCode = result.status;
    const location = result.headers.get('location');
    if (location) {
      const destination = new URL(location, origin);
      if (destination.origin !== origin || !destination.pathname.startsWith('/admin/'))
        throw new Error('Preview redirect must stay within local merchant routes');
      reply.setHeader('location', destination.pathname + destination.search + destination.hash);
    }
    reply.setHeader('content-type', type);
    if (type.includes('text/html')) {
      let html = (await result.text())
        .replace('https://cdn.shopify.com/shopifycloud/app-bridge.js', '/__preview/bridge.js')
        .replace('https://cdn.shopify.com/shopifycloud/polaris-2.0-rc.js', '/__preview/polaris.js')
        .replace(
          /<script\b(?=[^>]*\bsrc="\/__preview\/polaris\.js")[^>]*>\s*<\/script>/,
          '<script defer src="/__preview/assets.js"></script><script defer src="/__preview/polaris.js"></script>',
        );
      html = html.replace('<html ', '<html data-preview-order-queries="true" ');
      if (demo) html = html.replace('</head>', '<script src="/__preview/demo/transport.js"></script></head>');
      if (demo && state === 'normal' && /^\/admin\/home\/?$/.test(url.pathname)) {
        html = html
          .replace(
            /<astro-island\b[^>]*component-url="[^"]*MerchantHomeContainer[^"]*"[^>]*>[\s\S]*?<\/astro-island>/,
            '<div id="home-workflow-preview"></div>',
          )
          .replace(
            '</head>',
            '<link rel="stylesheet" href="/__preview/home/style.css"><script defer src="/__preview/home/app.js"></script></head>',
          );
      }
      if (demo && state === 'normal' && /^\/admin\/products\/?$/.test(url.pathname)) {
        html = html
          .replace('<html ', '<html data-preview-setup-copy="true" ')
          .replace(
            '</head>',
            '<link rel="stylesheet" href="/__preview/placement-workflow/style.css"><script type="module" src="/__preview/placement-workflow/copy.js"></script></head>',
          );
      }
      if (demo && state === 'normal' && /^\/admin\/products\/\d+\/config\/?$/.test(url.pathname)) {
        html = html.replace(
          /<astro-island\b[^>]*component-url="[^"]*SelectedProductContainer[^"]*"[^>]*>[\s\S]*?<\/astro-island>/,
          '<div id="placement-workflow-preview" role="status" aria-label="Loading product setup"></div>',
        );
        html = html.replace(
          '</head>',
          '<link rel="stylesheet" href="/__preview/placement-workflow/style.css"><script type="module" src="/__preview/placement-workflow/app.js"></script></head>',
        );
        html = html.replace(
          /<div id="admin-route-skeleton"([^>]*)>[\s\S]*?(?=<div id="admin-route-failure")/,
          (_match, attributes: string) =>
            `<div id="admin-route-skeleton"${attributes}>${placementEditorSkeletonMarkup()}</div>\n`,
        );
      }
      if (methodWorkflow && state === 'normal' && (methodRoute || url.pathname === '/admin/settings/methods')) {
        html = html.replace(
          /<astro-island\b[^>]*component-url="[^"]*MethodsContainer[^"]*"[^>]*>[\s\S]*?<\/astro-island>/,
          '<div id="method-workflow-preview" role="status" aria-label="Loading decoration methods"></div>',
        );
        html = html.replace(
          '</head>',
          '<link rel="stylesheet" href="/__preview/method-workflow/style.css"><script type="module" src="/__preview/method-workflow/app.js"></script></head>',
        );
      }
      const localMethodRoute = /^\/admin\/methods(?:\/([a-zA-Z0-9-]+))?\/?$/.exec(url.pathname);
      const methodIndexRoute = url.pathname === '/admin/settings/methods';
      if (methodWorkflow && state === 'normal' && (localMethodRoute || methodIndexRoute)) {
        const methodDetail = localMethodRoute?.[1] !== undefined;
        const skeletonLocale =
          url.searchParams.get('__i18n') === 'expanded' ? 'en-XA' : (url.searchParams.get('locale') ?? 'en');
        html = html.replace(
          /<div id="admin-route-skeleton"([^>]*)>[\s\S]*?(?=<div id="admin-route-failure")/,
          (_match, attributes: string) =>
            `<div id="admin-route-skeleton"${attributes}>${methodDetail ? methodDetailSkeletonMarkup(skeletonLocale) : methodIndexSkeletonMarkup(skeletonLocale)}</div>\n    `,
        );
      }
      if (!inside && request.headers['sec-fetch-dest'] === 'document' && result.ok) {
        const htmlAttribute = (value: string) =>
          value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
        const source = new URL(url.pathname + url.search, 'http://localhost');
        source.searchParams.set('__preview_frame', '1');
        const orderOptions = [
          ['101', '#1042 · T-shirt, two sizes'],
          ['102', '#1043 · Hoodie, artwork needed'],
          ['103', '#1044 · Polo, six items'],
          ['104', '#1045 · Mixed garments'],
          ['105', '#1046 · Hoodie, two designs'],
          ['106', '#1047 · Polo, artwork locked'],
          ['107', '#1048 · T-shirt, six placements'],
          ['108', '#1049 · Hoodie, four sizes and artwork needed'],
        ]
          .map(
            ([id, label]) =>
              `<s-option value="/admin/orders/10000000-0000-4000-8000-${id?.padStart(12, '0')}">${label}</s-option>`,
          )
          .join('');
        const demoControls = demo
          ? `<footer data-demo-controls><div data-demo-meta role="status" aria-live="polite"><s-text data-demo-message>Starting local demo…</s-text></div><div data-demo-picker><s-select data-demo-order label="Sample order" labelAccessibilityVisibility="exclusive"><s-option value="none">Sample order</s-option><s-option value="/admin/orders">Orders overview</s-option>${orderOptions}</s-select></div><div data-placement-example-controls hidden><s-select data-placement-example label="Setup example" labelAccessibilityVisibility="exclusive"><s-option value="configured">Configured product</s-option><s-option value="partial">Partially configured</s-option><s-option value="large">10 views · 40 placements</s-option><s-option value="many-methods">18 decoration methods</s-option><s-option value="copy-ready">Copy setup · 2 empty products</s-option><s-option value="blank">Unconfigured product</s-option><s-option value="first-product">First product · no methods</s-option><s-option value="no-images">No product images</s-option><s-option value="variant-photos">Variant images · assigned</s-option><s-option value="variant-unassigned">Variant images · first setup</s-option><s-option value="variant-missing">Variant images · missing Back</s-option><s-option value="variant-fit">Variant images · Colour and Fit</s-option><s-option value="variant-review">Variant images · alignment review</s-option><s-option value="variant-alignment">Variant images · custom alignment</s-option><s-option value="variant-many">Variant images · large range</s-option><s-option value="variant-image-error">Variant images · image unavailable</s-option><s-option value="variant-long">Variant images · long option names</s-option></s-select></div><div data-method-catalog-controls hidden title="Generated sample products share the original garment images and configurations."><s-select data-method-catalog label="Methods catalog" labelAccessibilityVisibility="exclusive"><s-option value="small">Original 3 products</s-option><s-option value="large">60 sample products</s-option></s-select></div><div data-demo-artwork><s-link href="/__preview/demo/files/north-coast-chest-replacement.png" download="north-coast-chest-replacement.png">Sample replacement</s-link></div><s-button data-demo-reset variant="secondary" icon="reset">Reset demo</s-button></footer>`
          : '';
        const methodIndexPage =
          methodWorkflow && (source.pathname === '/admin/methods' || source.pathname === '/admin/settings/methods');
        const methodDetailPage = methodWorkflow && /^\/admin\/methods\/[^/]+\/?$/.test(source.pathname);
        const initialHeading =
          source.pathname === '/admin/home'
            ? 'Insignia'
            : methodIndexPage
              ? 'Methods'
              : methodDetailPage
                ? source.pathname.endsWith('/new')
                  ? 'Create method'
                  : 'Decoration method'
                : source.pathname === '/admin/settings/translations'
                  ? 'Translations'
                  : source.pathname.startsWith('/admin/products')
                    ? 'Products'
                    : source.pathname.startsWith('/admin/settings')
                      ? 'Settings'
                      : 'Orders';
        const initialIcon =
          source.pathname === '/admin/home'
            ? 'home'
            : methodIndexPage || methodDetailPage
              ? 'settings'
              : source.pathname.startsWith('/admin/products')
                ? 'product'
                : source.pathname.startsWith('/admin/settings')
                  ? 'settings'
                  : 'order';
        const outer = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Insignia local preview</title><script defer src="/__preview/assets.js"></script><script defer src="/__preview/polaris.js"></script><script defer src="/__preview/bridge.js"></script><script type="module" src="/__preview/host.js"></script><link rel="stylesheet" href="/__preview/host.css"></head><body><header><div class="preview-header"><div class="preview-context"><s-button data-preview-nav icon="menu" variant="tertiary" accessibilityLabel="Preview navigation" commandFor="preview-navigation"></s-button><s-stack data-page-breadcrumbs direction="inline" gap="small"></s-stack><s-icon data-page-icon type="${initialIcon}"></s-icon><div class="preview-title"><s-heading>${initialHeading}</s-heading></div></div><div class="preview-mobile-actions" hidden><s-button data-mobile-page-trigger icon="menu-horizontal" variant="secondary" accessibilityLabel="Page actions" commandFor="preview-mobile-page-menu"></s-button></div><s-stack data-page-actions direction="inline" gap="small"></s-stack></div></header><s-menu id="preview-mobile-page-menu" accessibilityLabel="Page actions"></s-menu><s-popover id="preview-navigation" inlineSize="240px"><s-box padding="small"><s-stack data-preview-navigation gap="small"><s-link href="/admin/home">Home</s-link><s-link href="/admin/products">Products</s-link><s-link href="/admin/orders">Orders</s-link><s-link href="/admin/methods">Methods</s-link><s-link href="/admin/settings">Settings</s-link></s-stack></s-box></s-popover><iframe title="Insignia app preview" src="${htmlAttribute(source.pathname + source.search)}"></iframe></body></html>`;
        reply.end(
          demo
            ? outer
                .replace(
                  '</head>',
                  '<script type="module" src="/__preview/demo/browser.js"></script><style>[data-demo-controls]{display:flex;align-items:center;gap:12px;padding:8px 16px;border-top:1px solid #e3e3e3;flex-wrap:wrap}[data-demo-meta]{margin-right:auto}[data-demo-picker]{width:260px;max-width:100%}[data-method-catalog-controls],[data-placement-example-controls]{width:210px;max-width:100%}[data-method-catalog-controls][hidden],[data-placement-example-controls][hidden]{display:none}@media(max-width:480px){[data-demo-meta]{margin-right:0}[data-demo-picker]{flex:1;min-width:180px;width:auto}}</style></head>',
                )
                .replace(
                  '<iframe title="Insignia app preview" src=',
                  '<iframe title="Insignia app preview" data-demo-src=',
                )
                .replace('</body>', `${demoControls}</body>`)
            : outer,
        );
      } else reply.end(html);
    } else reply.end(Buffer.from(await result.arrayBuffer()));
  } catch {
    reply.statusCode = 500;
    reply.end('Local preview failed');
  }
});
const previewPort = Number(process.env.INSIGNIA_PREVIEW_PORT ?? '62168');
if (!Number.isInteger(previewPort) || previewPort < 0 || previewPort > 65535)
  throw new Error('Invalid local preview port');
server.listen(previewPort, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Local socket unavailable');
const startPath =
  scenario === 'order-demo'
    ? `/admin/orders/${demoStartPurchaseId}`
    : scenario === 'orders-rich'
      ? '/admin/orders'
      : '/admin/products';
console.log(`Local merchant preview (${state}, ${scenario}): http://127.0.0.1:${address.port}${startPath}`);
console.log('No native authentication or provider acceptance is established. Ctrl-C stops both owned processes.');
function stop() {
  server.close();
  server.closeAllConnections();
  child.kill('SIGTERM');
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
child.once('exit', () => {
  server.close();
  server.closeAllConnections();
});
