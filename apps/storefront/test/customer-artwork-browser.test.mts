import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { serverPort } from './support.mts';

test('post-order selected Designer scrubs capability, verifies upload and fills a missing slot without cart effects', async (t) => {
  const bundled = await build({
    stdin: {
      contents: "import {mountCustomerArtwork} from './src/designer/customer-artwork';mountCustomerArtwork();",
      resolveDir: new URL('..', import.meta.url).pathname,
      sourcefile: 'portal.tsx',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    loader: { '.css': 'empty' },
    define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
  });
  const script = bundled.outputFiles[0];
  assert(script);
  const photo = 'https://images.example.test/photo.svg';
  const product = {
    id: '111',
    title: 'Ordered T-shirt',
    images: [{ id: 'photo', url: photo, width: 1000, height: 1200, alt: 'Front' }],
    methods: [{ id: 'print', name: 'Printing', pricing: 'fixed', amount: '5.00' }],
    views: [
      {
        id: 'front',
        name: 'Front',
        imageUrl: photo,
        imageWidth: 1000,
        imageHeight: 1200,
        calibration: {
          imageUrl: photo,
          imageWidth: 1000,
          imageHeight: 1200,
          a: { x: 0.2, y: 0.5 },
          b: { x: 0.8, y: 0.5 },
          distanceCm: 30,
        },
        placements: [
          {
            id: 'chest',
            name: 'Chest',
            rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 },
            widthCm: '10',
            heightCm: '12',
            methodIds: ['print'],
            logoLaterAllowed: false,
            sizes: [{ id: 'small', name: 'Small', widthPercent: '100', prices: {} }],
          },
        ],
      },
    ],
  };
  const slot = {
    groupIndex: 0,
    placementId: 'chest',
    productId: '111',
    revisionId: 'revision',
    methodId: 'print',
    stepId: 'chest:small',
  };
  const purchaseId = '11111111-1111-4111-8111-111111111111',
    assetId = '22222222-2222-4222-8222-222222222222',
    capability = 'a'.repeat(64),
    expiresAt = '2027-01-01T00:00:00Z';
  let attached = false;
  let attachCount = 0;
  let previewCount = 0;
  const actions: string[] = [];
  const authorizations: string[] = [];
  const server = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://fixture').pathname;
      if (path === '/artwork-upload') {
        res.setHeader('Content-Type', 'text/html');
        res.end(
          '<!doctype html><html lang="en"><head><link rel="stylesheet" href="/designer.css"></head><body><script type="module" src="/portal.js"></script></body></html>',
        );
        return;
      }
      if (path === '/portal.js') {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(script.text);
        return;
      }
      if (path === '/designer.css') {
        res.setHeader('Content-Type', 'text/css');
        res.end(await readFile(new URL('../dist/insignia-designer.css', import.meta.url)));
        return;
      }
      if (path === '/api/customer-artwork/v1') {
        let raw = '';
        for await (const chunk of req) raw += String(chunk);
        const body = JSON.parse(raw);
        actions.push(body.action);
        authorizations.push(String(req.headers.authorization));
        const base = { purchaseId, expiresAt, artworkVersion: attached ? 1 : 0, slots: attached ? [] : [slot] };
        let response: unknown;
        if (body.action === 'view')
          response = {
            ...base,
            currency: 'USD',
            configurations: attached
              ? []
              : [
                  {
                    groupIndex: 0,
                    productId: '111',
                    revisionId: 'revision',
                    slots: [slot],
                    selectedSetup: { version: 'selected-product-setup-v1', methodBindings: {}, product },
                    contentHash: 'a'.repeat(64),
                    variantIds: ['101'],
                    positions: [],
                    geometry: {
                      version: 'm5-geometry-v1',
                      views: [
                        {
                          id: 'front',
                          image: { revisionId: 'photo', width: 1000, height: 1200 },
                          variantImages: [],
                          placements: [{ id: 'chest', rect: { centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 } }],
                        },
                      ],
                      steps: [
                        {
                          id: 'chest:small',
                          widthFraction: 1,
                          heightFraction: 1,
                          physicalMm: { width: 100, height: 120 },
                        },
                      ],
                    },
                  },
                ],
          };
        else if (body.action === 'begin')
          response = { assetId, expiresAt, upload: { url: 'https://upload.example.test/original', headers: {} } };
        else if (body.action === 'complete') response = { state: 'QUEUED', expiresAt };
        else if (body.action === 'status') response = { state: 'USABLE', expiresAt };
        else if (body.action === 'preview') {
          previewCount++;
          response = {
            url: `https://images.example.test/${previewCount === 1 ? 'logo' : 'renewed'}.svg`,
            width: 100,
            height: 100,
            expiresAt: new Date(Date.now() + (previewCount === 1 ? 60000 : 3600000)).toISOString(),
          };
        } else if (body.action === 'attach') {
          assert.equal(body.assetId, assetId);
          assert.equal(body.placementId, 'chest');
          assert.match(body.requestId, /^[a-f0-9-]{36}$/);
          assert.equal(attached, false);
          attached = true;
          attachCount++;
          response = { ...base, artworkVersion: 1, slots: [] };
        } else throw new Error('Unexpected action');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(response));
        return;
      }
      res.statusCode = 404;
      res.end();
    })().catch((error) => {
      res.statusCode = 500;
      res.end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://images.example.test/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1200"><rect width="1000" height="1200" fill="navy"/></svg>',
    }),
  );
  await page.route('https://upload.example.test/**', (route) =>
    route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' } }),
  );
  await page.clock.install();
  await page.goto(`http://127.0.0.1:${serverPort(server)}/artwork-upload#capability=${capability}`);
  try {
    await page.locator('.app.admin-preview').waitFor({ timeout: 5000 });
  } catch {
    throw new Error(JSON.stringify({ errors, body: await page.locator('body').innerText(), actions }));
  }
  assert.equal(new URL(page.url()).hash, '');
  await page.locator('button.artwork-choice').first().click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'logo.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100"/></svg>',
    ),
  });
  await page.getByRole('button', { name: 'logo.svg Change', exact: true }).waitFor();
  assert.equal(attached, true);
  assert.equal(attachCount, 1);
  assert(actions.includes('complete'));
  assert(actions.includes('status'));
  assert(actions.includes('preview'));
  assert(authorizations.every((value) => value === `Bearer ${capability}`));
  const renewed = page.waitForRequest('https://images.example.test/renewed.svg');
  await page.clock.fastForward(61000);
  await renewed;
  assert.equal(previewCount, 2, 'the visible expired preview renews through the owned read service');
  assert.equal(attachCount, 1, 'preview renewal must never reattach or replace submitted artwork');
  // The artwork-only UI keeps the chosen file available for review, but customer replacement
  // cannot allocate a new private upload once this slot has been filled.
  await page.locator('button.artwork-choice').first().click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'replacement.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>'),
  });
  await page.locator('.upload-error').waitFor();
  assert.equal(actions.filter((action) => action === 'begin').length, 1);
  assert.equal(await page.getByRole('button', { name: 'Add to cart', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
});
