import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { serverPort } from './support.mts';

const config = {
  id: 'limit-product',
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

/**
 * #348: when the per-visitor session limit rejects the session an upload needs, neither "Try again"
 * nor "Choose another file" can succeed. The Designer names the limit and the wait, and offers Close.
 */
test('the per-visitor session limit shows its own copy and wait, with Close instead of retry actions', async (t) => {
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
  const html = (locale: string) => `<!doctype html><html><body><p>Shopify product page</p><script type="module">
 import {createDesignerFrame} from '/host.js';
 window.designerClosed=0;window.retryAfter=1500;
 createDesignerFrame({config:${JSON.stringify(config)},locale:'${locale}',initialPrints:[{id:'chest',method:'print',size:0,artworkId:'asset'}],initialArtworks:[{id:'asset',name:'Logo.png',url:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/%3E',width:100,height:100}],ports:{artwork:{upload:async(file,request)=>{request.onProgress?.('uploading');throw Object.assign(new Error('Customization request could not be completed.'),{status:429,code:'SESSION_RATE_LIMITED',retryAfter:window.retryAfter})}},cart:{commit:()=>new Promise(()=>{})}},onClose(){window.designerClosed++}});
 </script></body></html>`;
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://fixture.test');
      if (url.pathname === '/products/shirt') {
        response.setHeader('Content-Type', 'text/html');
        response.end(html(url.searchParams.get('locale') ?? 'en'));
      } else if (url.pathname === '/host.js' || url.pathname === '/insignia-designer-frame.js') {
        response.setHeader('Content-Type', 'text/javascript');
        response.end((url.pathname === '/host.js' ? host : frameSource).outputFiles[0]?.text);
      } else if (url.pathname === '/insignia-designer.css') {
        response.setHeader('Content-Type', 'text/css');
        response.end(await readFile(new URL(`../dist${url.pathname}`, import.meta.url)));
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
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const frame = page.frameLocator('dialog > iframe');
  const failUpload = async (locale: string, retryAfter: number) => {
    await page.goto(`http://127.0.0.1:${serverPort(server)}/products/shirt?locale=${locale}`);
    await frame.locator('.app').waitFor({ timeout: 10000 });
    await page.evaluate((value) => Reflect.set(window, 'retryAfter', value), retryAfter);
    await frame.locator('#artwork-chest').click();
    await frame
      .locator('input[type=file]')
      .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('fixture') });
    const alert = frame.locator('#artwork-upload-error');
    await alert.waitFor();
    return {
      message: await alert.innerText(),
      actions: await frame.locator('.upload-failure-actions button').allInnerTexts(),
    };
  };

  assert.deepEqual(await failUpload('en', 1500), {
    message: 'Too many new customization sessions from your network. Try again in 25 minutes.',
    actions: ['Close'],
  });
  // Close dismisses only the artwork dialog; the Designer and its design stay open.
  await frame.locator('.upload-failure-actions').getByRole('button', { name: 'Close', exact: true }).click();
  await frame.locator('.artwork-dialog').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => Reflect.get(window, 'designerClosed')), 0);
  assert.match(await frame.locator('.app').innerText(), /Logo.png/);

  // Whole minutes, rounded up, with the language's plural form.
  assert.deepEqual(await failUpload('en', 30), {
    message: 'Too many new customization sessions from your network. Try again in 1 minute.',
    actions: ['Close'],
  });
  assert.deepEqual(await failUpload('de', 1500), {
    message: 'Zu viele neue Personalisierungssitzungen aus Ihrem Netzwerk. Versuchen Sie es in 25 Minuten erneut.',
    actions: ['Schließen'],
  });
});
