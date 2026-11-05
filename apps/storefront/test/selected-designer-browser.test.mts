import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { serverPort } from './support.mts';

test('isolated selected Designer preserves edits, renders real review before consent and retries one cart identity', async (t) => {
  const host = await build({
    entryPoints: [new URL('../src/designer/frame-host.ts', import.meta.url).pathname],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
  });
  const source = host.outputFiles[0];
  assert(source);
  const config = {
    id: 'live-product',
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
    methods: [{ id: 'print', label: 'Print', surcharge: 500 }],
    productionOptions: [
      {
        id: 'packing',
        label: 'Packaging',
        values: [
          { id: 'plain', label: 'Plain' },
          { id: 'gift', label: 'Gift wrap' },
        ],
      },
    ],
  };
  const html = `<!doctype html><html><head><style>body{font-family:serif}#outside{color:rgb(200,0,0)}</style></head><body><p id="outside">Shopify-owned page</p><script type="module">
 import {createDesignerFrame} from '/host.js';
 const config=${JSON.stringify(config)};
 window.preparations=[];window.writes=[];window.designerClosed=0;
 const frame=createDesignerFrame({config,locale:'en',initialPrints:[{id:'chest',method:'print',size:0,artworkId:'asset'}],initialArtworks:[{id:'asset',name:'Logo.png',url:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect width="100" height="100" fill="navy"/%3E%3C/svg%3E',width:100,height:100}],ports:{artwork:{upload:async()=>{throw Error('unused')}},review:{prepare:async(request)=>{window.preparations.push({key:request.idempotencyKey,design:request.design});frame.review({currency:'USD',exponent:2,totalMinor:'3500',customizedQuantity:request.design.variants[0].quantity,groups:[{id:'other',label:'Reviewed customized cart',quantity:request.design.variants[0].quantity,totalMinor:'3500'}]});}},cart:{commit:async(request)=>{window.writes.push({key:request.idempotencyKey,design:request.design});if(window.writes.length===1)throw Error('lost response');return{kind:'applied',requestId:request.requestId,designId:request.design.id,operation:request.operation,authority:'shopify'};}}},onClose(){window.designerClosed++}});
 window.liveFrame=frame;
 </script></body></html>`;
  const server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? '/', 'http://fixture.test').pathname;
      if (path === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end(html);
        return;
      }
      if (path === '/host.js') {
        response.setHeader('Content-Type', 'text/javascript');
        response.end(source.text);
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.goto(`http://127.0.0.1:${serverPort(server)}/`);
  const frame = page.frameLocator('iframe');
  try {
    await frame.locator('.app').waitFor({ timeout: 10000 });
  } catch {
    throw new Error(
      JSON.stringify({
        errors,
        frames: page.frames().map((frame) => frame.url()),
        body: await page.locator('body').innerText(),
      }),
    );
  }
  assert.match(await frame.locator('.app').evaluate((element) => getComputedStyle(element).fontFamily), /Inter/);
  assert.equal(await page.locator('#outside').evaluate((element) => getComputedStyle(element).color), 'rgb(200, 0, 0)');
  await frame.getByRole('button', { name: 'Choose quantities', exact: true }).click();
  assert.equal(await frame.getByLabel('Packaging', { exact: true }).inputValue(), 'plain');
  await frame.getByLabel('Packaging', { exact: true }).selectOption('gift');
  const quantity = frame.locator('input[type=number]:enabled').first();
  await quantity.fill('2');
  await page.evaluate(() => Reflect.get(window, 'liveFrame').repair({ canStart: true, canRemoveGroup: false }));
  await frame.getByRole('heading', { name: 'Your customization needs review' }).waitFor();
  assert.equal(await quantity.inputValue(), '2');
  assert.equal(await frame.getByLabel('Packaging', { exact: true }).inputValue(), 'gift');
  assert.equal(await page.evaluate(() => Reflect.get(window, 'writes').length), 0);
  await page.evaluate(() => Reflect.get(window, 'liveFrame').repair());

  await frame.getByRole('button', { name: 'Review', exact: true }).last().click();
  await frame.getByRole('button', { name: 'Add to cart', exact: true }).waitFor();
  await page.waitForFunction(() => Reflect.get(window, 'preparations').length === 1);
  assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'preparations')[0].design.options), [
    { optionId: 'packing', valueId: 'gift' },
  ]);
  await frame.getByText('Gift wrap', { exact: true }).waitFor();
  assert.equal(await frame.locator('.footer-price strong').innerText(), '$35.00');
  assert.equal(await page.evaluate(() => Reflect.get(window, 'writes').length), 0);
  await frame.locator('.review-pricing summary').click();
  await frame.getByText(/Reviewed customized cart/).waitFor();
  await frame.getByRole('button', { name: 'Add to cart', exact: true }).click();
  await frame.locator('.cart-submit-error').waitFor();
  await frame.getByRole('button', { name: 'Previous step', exact: true }).click();
  assert.equal(await quantity.inputValue(), '2');
  await frame.getByRole('button', { name: 'Review', exact: true }).last().click();
  await page.waitForFunction(() => Reflect.get(window, 'preparations').length === 2);
  await frame.getByRole('button', { name: 'Add to cart', exact: true }).click();
  await page.waitForFunction(() => Reflect.get(window, 'designerClosed') === 1);
  const attempts = (await page.evaluate(() => Reflect.get(window, 'writes'))) as {
    key: string;
    design: { id: string };
  }[];
  assert.equal(attempts[0]?.key, attempts[1]?.key);
  assert.equal(attempts[0]?.design.id, attempts[1]?.design.id);
  assert.equal(await page.locator('iframe').isHidden(), true);
});
