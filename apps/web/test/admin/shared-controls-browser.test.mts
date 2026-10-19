import type { PurchaseView } from '@insignia/contracts';
import { required } from './support/fixtures.mts';
import './support/browser-state.mts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { TestContext } from 'node:test';
import { test } from 'node:test';
import { chromium } from 'playwright';

const id = 'd841ee12-2075-4101-b3bc-429ad31a4059';
function view(state: PurchaseView['artworkState'] = 'PENDING_ARTWORK'): PurchaseView {
  return {
    version: 'm8-purchase-v1',
    isTest: false,
    purchaseId: id,
    orderId: 'gid://shopify/Order/1',
    orderCreatedAt: '2026-10-12T12:00:00Z',
    currency: 'USD',
    exponent: 2,
    originalTotalMinor: '9007199254740993',
    firstPaidAt: null,
    financialStatus: 'PENDING',
    cancelledAt: null,
    exceptions: [],
    artworkVersion: 0,
    artworkState: state,
    refunds: [],
    lines: [{ orderLineId: 'line1', productId: '111', variantId: '11', quantity: 2, unitPriceMinor: '4500' }],
    groups:
      state === 'ERASED'
        ? []
        : [
            {
              index: 0,
              productId: '111',
              configRevisionId: 'historical1',
              variants: [{ variantId: '11', quantity: 2 }],
              placements: [
                {
                  id: 'front',
                  methodId: 'print',
                  stepId: 'small',
                  originalArtwork: { kind: 'deferred', intentId: 'intent1' },
                  currentAssetId: null,
                  currentExpiresAt: null,
                  expired: false,
                },
              ],
              geometry: null,
              presentation: null,
              imageUrls: {},
              payloadExpiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
            },
          ],
    artworkEvents: [],
  };
}
async function fixture(t: TestContext, apiKey = '11111111111111111111111111111111') {
  const child = spawn(
    process.execPath,
    [process.env.PURCHASE_BROWSER_ENTRY ?? new URL('../../dist/server/entry.mjs', import.meta.url).pathname],
    {
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: '0',
        SHOPIFY_CLIENT_ID: apiKey,
        ARTWORK_R2_ENDPOINT: 'https://private.example',
      },
    },
  );
  let log = '';
  child.stdout.on('data', (x) => (log += x));
  child.stderr.on('data', (x) => (log += x));
  const exited = new Promise((r) => child.once('close', r));
  let base: string | undefined;
  for (let i = 0; i < 100; i++) {
    base = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (base) {
      try {
        if ((await fetch(`${base}/live`)).ok) break;
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(base, log);
  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    child.kill('SIGTERM');
    await exited;
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  if (apiKey) await page.addInitScript(() => (window.shopify = { idToken: async () => 'synthetic-purchase-actor' }));
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (r) => r.fulfill({ body: '' }));
  const polaris = await readFile(new URL('../fixtures/polaris-1.1.snapshot', import.meta.url));
  await page.route('https://cdn.shopify.com/shopifycloud/polaris-1.1.js', (r) =>
    r.fulfill({ body: polaris, contentType: 'text/javascript' }),
  );
  await page.route('https://cdn.shopify.com/shopifycloud/admin-ui-foundations/icons/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"></svg>',
    }),
  );
  await page.route('https://cdn.shopify.com/static/fonts/**', (r) => r.fulfill({ body: '' }));
  return { page, base };
}
test('private artwork uses the Polaris drop zone and keeps verified upload actions inside Polaris', {
  timeout: 20000,
}, async (t) => {
  const { page, base } = await fixture(t);
  const asset = '0829a06c-e8c5-40aa-9167-4fb47e443231';
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  let uploads = 0;
  let current = view();
  await page.route(`**/api/purchases/v1/${id}`, (r) => r.fulfill({ json: current }));
  await page.route(`**/api/purchases/v1/${id}/artwork`, (r) => {
    assert.deepEqual(r.request().postDataJSON(), {
      expectedVersion: 0,
      groupIndex: 0,
      placementId: 'front',
      assetId: asset,
    });
    current = {
      ...current,
      artworkVersion: 1,
      artworkState: 'READY',
      groups: current.groups.map((group) => ({
        ...group,
        placements: group.placements.map((placement) => ({
          ...placement,
          currentAssetId: asset,
          currentExpiresAt: expiresAt,
        })),
      })),
    };
    return r.fulfill({ json: current });
  });
  await page.route(`**/api/purchases/v1/${id}/artwork/${asset}/download`, (r) =>
    r.fulfill({ json: { url: 'https://private.example/original.svg', expiresAt } }),
  );
  await page.route('**/api/artwork', (r) => {
    uploads++;
    return r.fulfill({
      json: { assetId: asset, expiresAt, upload: { url: 'https://private.example/q', headers: {} } },
    });
  });
  await page.route('https://private.example/**', (r) =>
    r.fulfill({
      status: 200,
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
        'base64',
      ),
      contentType: 'image/png',
      headers: { 'Access-Control-Allow-Origin': '*' },
    }),
  );
  await page.route(`**/api/artwork/${asset}/**`, (r) =>
    r.fulfill({
      json: r.request().url().endsWith('/status')
        ? { state: 'USABLE', expiresAt }
        : r.request().url().endsWith('/preview')
          ? { url: 'https://private.example/preview.png', width: 10, height: 10, expiresAt }
          : r.request().url().endsWith('/download')
            ? { url: 'https://private.example/original.svg', expiresAt }
            : {},
    }),
  );
  await page.goto(`${base}/admin/orders/${id}`);
  const artwork = page.getByRole('region', { name: 'Private artwork', exact: true });
  await artwork.waitFor();
  assert.equal(await artwork.locator('s-drop-zone').count(), 1, 'The merchant file picker is a Polaris drop zone');
  assert.equal(
    await artwork.evaluate((el) => el.querySelectorAll('input,button,a,select,textarea').length),
    0,
    'No default native controls in merchant light DOM',
  );
  await artwork
    .locator('input[type=file]')
    .setInputFiles({ name: 'safe.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await artwork.getByRole('img', { name: 'Verified artwork preview', exact: true }).waitFor();
  assert.equal(uploads, 1, 'One selected file admits exactly one upload');
  assert.equal(
    await artwork.getByRole('button', { name: 'Prepare original download', exact: true }).count(),
    0,
    'Unattached uploads do not expose a purchase original download',
  );
  await page.getByRole('button', { name: 'Attach artwork', exact: true }).click();
  const placement = page.getByRole('region', { name: 'Artwork front', exact: true });
  await placement.getByRole('button', { name: 'Prepare original download', exact: true }).click();
  await placement.getByRole('link', { name: 'Download verified original', exact: true }).waitFor();
  assert.equal(await placement.locator('s-button').filter({ hasText: 'Prepare original download' }).count(), 1);
  assert.equal(await placement.locator('s-link').filter({ hasText: 'Download verified original' }).count(), 1);
  assert.equal(await placement.evaluate((el) => el.querySelectorAll('input,button,a,select,textarea').length), 0);
});

test('missing app configuration renders stable Polaris recovery without bootstrapping private application work', {
  timeout: 20000,
}, async (t) => {
  const { page, base } = await fixture(t, '');
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
  });
  await page.clock.install();
  const response = await page.goto(`${base}/admin/products`);
  assert.equal(required(response).status(), 503);
  const heading = page.getByRole('heading', { name: 'Application unavailable', exact: true });
  await heading.waitFor();
  assert.equal(await page.locator('s-page[heading="Application unavailable"]').count(), 1);
  assert.equal(await page.locator('s-banner[heading="Insignia could not open"][tone="critical"]').count(), 1);
  const link = page.getByRole('link', { name: 'Return to Shopify Admin', exact: true });
  assert.equal(await link.getAttribute('href'), 'https://admin.shopify.com');
  assert.equal(await link.getAttribute('target'), '_top');
  assert.equal(await page.locator('#admin-route-skeleton').count(), 0);
  assert.equal(await page.locator('[inert]').count(), 0);
  assert.equal(
    await page.locator('script[src*="app-bridge"], meta[name="shopify-api-key"], s-app-nav, astro-island').count(),
    0,
  );
  assert.deepEqual([...apiRequests], []);
  await page.clock.fastForward(15000);
  assert.equal(await heading.isVisible(), true);
  assert.equal(await link.isVisible(), true);
  assert.equal(await page.getByText('Interface unavailable', { exact: true }).count(), 0);
  assert.equal(await page.locator('[inert], #admin-route-skeleton').count(), 0);
  assert.deepEqual([...apiRequests], []);
});
