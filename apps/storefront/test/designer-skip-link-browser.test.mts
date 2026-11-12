import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium, firefox } from 'playwright';
import { serverPort } from './support.mts';

const config = {
  id: 'skip-product',
  name: 'Shirt',
  description: 'Shirt',
  storeName: 'Store',
  productName: 'Shirt',
  productDescription: 'Shirt',
  basePrice: 1000,
  currency: 'USD',
  locale: 'en',
  preview: 'photo',
  maxQuantity: 100,
  artworkLater: false,
  sizes: [{ id: 'small', label: 'Small' }],
  colors: [
    {
      id: 'white',
      name: 'White',
      availableSizeIds: ['small'],
      images: {
        front:
          'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"%3E%3Crect width="1000" height="1000" fill="white"/%3E%3C/svg%3E',
      },
    },
  ],
  variantMatrix: [{ rowId: 'white', columnId: 'small', variantId: '101', available: true }],
  views: [{ id: 'front', label: 'Front', illustration: 'front' }],
  positions: [
    {
      id: 'chest',
      name: 'Chest',
      view: 'front',
      x: 50,
      y: 50,
      width: 20,
      dimensions: [10],
      sizePrices: [0],
      price: 0,
      methodIds: ['print'],
    },
  ],
  methods: [{ id: 'print', label: 'Print', surcharge: 0 }],
};

for (const engine of [chromium, firefox])
  test(`${engine.name()}: skip link moves focus to the design controls without navigating the srcdoc frame`, async (t) => {
    const [host, frameSource] = await Promise.all([
      build({
        entryPoints: [new URL('../src/designer/frame-host.ts', import.meta.url).pathname],
        bundle: true,
        write: false,
        loader: { '.css': 'text' },
        format: 'esm',
        platform: 'browser',
      }),
      build({
        entryPoints: [new URL('../src/designer/frame.tsx', import.meta.url).pathname],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        define: { 'import.meta.env.DEV': 'false' },
        jsx: 'automatic',
        jsxImportSource: 'preact',
        loader: { '.css': 'text' },
        logLevel: 'error',
      }),
    ]);
    const html = `<!doctype html><html><body><p>Shopify product page</p><script type="module">
 import {createDesignerFrame} from '/host.js';
 window.designerClosed=0;
 window.liveFrame=createDesignerFrame({config:${JSON.stringify(config)},locale:'en',ports:{artwork:{upload:()=>new Promise(()=>{})},cart:{commit:()=>new Promise(()=>{})}},onClose(){window.designerClosed++}});
 </script></body></html>`;
    const server = createServer((request, response) => {
      void (async () => {
        const path = new URL(request.url ?? '/', 'http://fixture.test').pathname;
        // Shopify storefront pages refuse framing, as on the reported store.
        response.setHeader('X-Frame-Options', 'DENY');
        if (path === '/' || path === '/products/shirt') {
          response.setHeader('Content-Type', 'text/html');
          response.end(html);
        } else if (path === '/host.js' || path === '/insignia-designer-frame.js') {
          response.setHeader('Content-Type', 'text/javascript');
          response.end((path === '/host.js' ? host : frameSource).outputFiles[0]?.text);
        } else if (path === '/insignia-designer.css') {
          response.setHeader('Content-Type', 'text/css');
          response.end(await readFile(new URL(`../dist${path}`, import.meta.url)));
        } else {
          response.statusCode = 404;
          response.end();
        }
      })().catch(() => {
        response.statusCode = 500;
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await engine.launch({ headless: true });
    t.after(async () => {
      await browser.close();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`http://127.0.0.1:${serverPort(server)}/products/shirt`);
    const frame = page.frameLocator('dialog > iframe');
    const skip = frame.getByRole('link', { name: 'Skip to design controls', exact: true });
    const state = () =>
      page.evaluate(() => {
        const document = window.document.querySelector('iframe')?.contentDocument;
        return {
          url: document?.URL ?? null,
          app: Boolean(document?.querySelector('.app')),
          focused: document?.activeElement?.id ?? null,
        };
      });

    for (const activate of ['keyboard', 'mouse'] as const) {
      await frame.locator('.app').waitFor({ timeout: 10000 });
      await skip.focus();
      if (activate === 'keyboard') await page.keyboard.press('Enter');
      else await skip.click();
      await page
        .waitForFunction(
          () => window.document.querySelector('iframe')?.contentDocument?.activeElement?.id === 'design-controls',
          undefined,
          { timeout: 2000 },
        )
        .catch(() => undefined);
      assert.deepEqual(await state(), { url: 'about:srcdoc', app: true, focused: 'design-controls' }, activate);
      // The document is still the live Designer: its close control works.
      await frame.getByRole('button', { name: 'Close customizer', exact: true }).click();
      await page.waitForFunction(() => Reflect.get(window, 'designerClosed') === 1);
      await page.evaluate(() => {
        Reflect.set(window, 'designerClosed', 0);
        Reflect.get(window, 'liveFrame').open();
      });
    }
  });
