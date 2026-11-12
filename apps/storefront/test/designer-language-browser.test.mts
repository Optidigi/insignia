import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium, firefox } from 'playwright';
import { serverPort } from './support.mts';

const config = {
  id: 'language-product',
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
  test(`${engine.name()}: the srcdoc document language follows the Designer language and close copy is consistent`, async (t) => {
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
 window.liveFrame=createDesignerFrame({config:${JSON.stringify(config)},locale:'de',initialPrints:[{id:'chest',method:'print',size:0,artworkId:'asset'}],initialArtworks:[{id:'asset',name:'Logo.png',url:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/%3E',width:100,height:100}],ports:{artwork:{upload:()=>new Promise(()=>{})},cart:{commit:()=>new Promise(()=>{})}},onClose(){window.designerClosed++}});
 </script></body></html>`;
    // Cart repair without a current product configuration renders no Designer.
    const repairHtml = `<!doctype html><html><body><p>Shopify product page</p><script type="module">
 import {createDesignerFrame} from '/host.js';
 createDesignerFrame({title:'Shirt',locale:'de',repair:{canStart:false,canRemoveGroup:false,canRemoveAll:false},onRepair:async()=>undefined,onClose(){}});
 </script></body></html>`;
    const server = createServer((request, response) => {
      void (async () => {
        const path = new URL(request.url ?? '/', 'http://fixture.test').pathname;
        if (path === '/' || path === '/products/shirt' || path === '/products/repair') {
          response.setHeader('Content-Type', 'text/html');
          response.end(path === '/products/repair' ? repairHtml : html);
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
    const documentLanguage = () =>
      page.evaluate(() => document.querySelector('iframe')?.contentDocument?.documentElement.lang);
    await frame.locator('.app[lang="de"]').waitFor({ timeout: 10000 });
    assert.equal(await documentLanguage(), 'de', 'screen readers read the srcdoc document in the Designer language');
    assert.equal(await page.evaluate(() => document.documentElement.lang), '', 'the host page keeps its own language');

    const closeDialog = async () => {
      await frame.locator('.header-actions > button.icon-button').click();
      const dialog = frame.locator('dialog.close-dialog');
      await dialog.waitFor();
      const text = {
        title: await dialog.locator('h2').innerText(),
        help: await dialog.locator('#close-dialog-help').innerText(),
      };
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      return text;
    };
    await frame.locator('#customer-language').selectOption('it');
    await frame.locator('.app[lang="it"]').waitFor();
    assert.equal(await documentLanguage(), 'it');
    const italian = await closeDialog();
    // The help names the same thing as its title, not the artwork ("Grafica") step.
    assert.match(italian.title, /personalizzazione/);
    assert.match(italian.help, /personalizzazione/);
    assert.doesNotMatch(italian.help, /design/);

    await frame.locator('#customer-language').selectOption('es');
    await frame.locator('.app[lang="es"]').waitFor();
    assert.equal(await documentLanguage(), 'es');
    const spanish = await closeDialog();
    assert.equal(spanish.title, '¿Cerrar la personalización?');
    // "diseño" is the artwork in Spanish; the help names the whole customization like its title.
    assert.match(spanish.help, /personalización/);
    assert.doesNotMatch(spanish.help, /diseño/);

    await frame.locator('#customer-language').selectOption('');
    await frame.locator('.app[lang="de"]').waitFor();
    assert.equal(await documentLanguage(), 'de');

    // A repair-only frame has no Designer to mirror its language; the srcdoc carries a baseline.
    await page.goto(`http://127.0.0.1:${serverPort(server)}/products/repair`);
    await page.frameLocator('dialog > iframe').locator('body > *').first().waitFor({ timeout: 10000 });
    assert.equal(await documentLanguage(), 'de', 'repair-only frame language');
  });
