import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { serverPort } from './support.mts';

const config = {
  id: 'cart-limit-product',
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
 * #335: the storefront pre-check and the server's 422 both carry `code: 'CAPACITY_EXCEEDED'`. Through the
 * real iframe bridge the Designer names the cart limit and offers Edit quantities, never a futile Retry.
 */
test('a cart over the signed-set capacity crosses the frame bridge as a cart limit with Edit quantities', async (t) => {
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
  // `server` mimics the buyer API's 422; otherwise the storefront pre-check's error. `lines`: over 200 cart lines.
  const html = (
    locale: string,
    server: boolean,
    lines: boolean,
  ) => `<!doctype html><html><body><p>Shopify product page</p><script type="module">
 import {createDesignerFrame} from '/host.js';
 window.preparations=0;
 const limit=()=>Object.assign(new Error(${server ? "'Your cart has reached the customization limit.'" : "'Cart customization limit reached'"}),${server ? "{status:422,code:'CAPACITY_EXCEEDED'" : "{code:'CAPACITY_EXCEEDED'"}${lines ? ',cartLines:true}' : '}'});
 createDesignerFrame({config:${JSON.stringify(config)},locale:'${locale}',initialPrints:[{id:'chest',method:'print',size:0,artworkId:'asset'}],initialArtworks:[{id:'asset',name:'Logo.png',url:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/%3E',width:100,height:100}],ports:{artwork:{upload:()=>new Promise(()=>{})},review:{prepare:async()=>{window.preparations++;throw limit()}},cart:{commit:async(request)=>{request.onPreparing?.();throw limit()}}},onClose(){}});
 </script></body></html>`;
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://fixture.test');
      if (url.pathname === '/products/shirt') {
        response.setHeader('Content-Type', 'text/html');
        response.end(
          html(url.searchParams.get('locale') ?? 'en', url.searchParams.has('server'), url.searchParams.has('lines')),
        );
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
  const review = async (query: string) => {
    await page.goto(`http://127.0.0.1:${serverPort(server)}/products/shirt?${query}`);
    await frame.locator('.app').waitFor({ timeout: 10000 });
    await frame.locator('.steps button').nth(1).click();
    await frame.locator('#quantity-white-small').fill('2');
    await frame.locator('.steps button').nth(2).click();
    const alert = frame.locator('.cart-submit-error');
    await alert.waitFor();
    return {
      message: await alert.innerText(),
      action: await frame.locator('.panel-footer .primary-button').innerText(),
    };
  };
  const english = {
    message:
      'Your cart has reached the customization limit of 32 customized cart lines and 10,000 customized items. Remove items from your cart or lower quantities to continue.',
    action: 'Edit quantities',
  };

  for (const query of ['locale=en', 'locale=en&server']) {
    assert.deepEqual(await review(query), english, query);
    const preparations = await page.evaluate(() => Reflect.get(window, 'preparations'));
    // The primary action goes back to Quantities; it never re-sends the same rejected cart.
    await frame.locator('.panel-footer .primary-button').click();
    await frame.locator('.app[data-step="1"]').waitFor();
    assert.equal(await page.evaluate(() => Reflect.get(window, 'preparations')), preparations);
  }
  assert.deepEqual(await review('locale=de&server'), {
    message:
      'Ihr Warenkorb hat die Höchstgrenze von 32 personalisierten Warenkorbpositionen und 10.000 personalisierten Artikeln erreicht. Entfernen Sie Artikel aus Ihrem Warenkorb oder verringern Sie die Mengen, um fortzufahren.',
    action: 'Mengen bearbeiten',
  });
  // Over 200 cart lines in total: generic copy, since 32 / 10,000 is not what the buyer exceeded.
  assert.deepEqual(await review('locale=en&server&lines'), {
    message: 'Your cart has too many items to customize this design. Remove items from your cart to continue.',
    action: 'Edit quantities',
  });
});
