import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium, firefox } from 'playwright';
import { serverPort } from './support.mts';

const config = {
  id: 'close-product',
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
  test(`${engine.name()}: Escape routes every close through the close and upload decisions`, async (t) => {
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
 window.liveFrame=createDesignerFrame({config:${JSON.stringify(config)},locale:'en',initialPrints:[{id:'chest',method:'print',size:0,artworkId:'asset'}],initialArtworks:[{id:'asset',name:'Logo.png',url:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/%3E',width:100,height:100}],ports:{artwork:{upload:(file,request)=>{request.onProgress?.('processing');window.uploadSignal=request.signal;return new Promise((resolve,reject)=>{request.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})})}},cart:{commit:()=>new Promise(()=>{})}},onClose(){window.designerClosed++}});
 </script></body></html>`;
    const server = createServer((request, response) => {
      void (async () => {
        const path = new URL(request.url ?? '/', 'http://fixture.test').pathname;
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
    await frame.locator('.app').waitFor({ timeout: 10000 });
    const closeQuestion = frame.getByRole('heading', { name: 'Close customization?', exact: true });
    const uploadQuestion = frame.getByRole('heading', { name: 'Cancel this upload?', exact: true });
    const hostState = () =>
      page.evaluate(() => ({
        open: document.querySelector('dialog')?.open,
        closed: Reflect.get(window, 'designerClosed'),
        aborted: Reflect.get(window, 'uploadSignal')?.aborted ?? null,
      }));
    // Focus can leave the srcdoc document (for example Shift+Tab out of the frame).
    // Programmatic focus is not user activation, as with repeated Escape presses.
    const focusHostDialog = () =>
      page.waitForFunction(() => {
        const dialog = document.querySelector('dialog');
        if (!dialog) return false;
        // Firefox can ignore one programmatic focus while its child frame owns focus.
        dialog.tabIndex = -1;
        window.focus();
        dialog.focus();
        return document.activeElement === dialog && !dialog.querySelector('iframe')?.contentDocument?.hasFocus();
      });

    // Edited design, focus inside the Designer: Escape asks, Escape again keeps editing.
    await frame.locator('h1').click();
    await page.keyboard.press('Escape');
    await closeQuestion.waitFor();
    await page.keyboard.press('Escape');
    await closeQuestion.waitFor({ state: 'detached' });

    // Focus on the host dialog: every Escape asks, never a native close.
    for (let attempt = 1; attempt <= 2; attempt++) {
      await focusHostDialog();
      await page.keyboard.press('Escape');
      await closeQuestion.waitFor({ timeout: 2000 }).catch(() => undefined);
      assert.deepEqual(
        { ...(await hostState()), asked: await closeQuestion.isVisible() },
        { open: true, closed: 0, aborted: null, asked: true },
        `host Escape ${attempt}`,
      );
      await page.keyboard.press('Escape');
      await closeQuestion.waitFor({ state: 'detached' });
    }

    // Focus on the host <body> (outside the dialog): a native close request must still ask.
    const focusHostBody = () =>
      page.waitForFunction(() => {
        (document.activeElement as HTMLElement | null)?.blur();
        window.focus();
        return (
          document.activeElement === document.body && !document.querySelector('iframe')?.contentDocument?.hasFocus()
        );
      });
    for (let attempt = 1; attempt <= 2; attempt++) {
      await focusHostBody();
      await page.keyboard.press('Escape');
      await closeQuestion.waitFor({ timeout: 2000 }).catch(() => undefined);
      assert.deepEqual(
        { ...(await hostState()), asked: await closeQuestion.isVisible() },
        { open: true, closed: 0, aborted: null, asked: true },
        `body Escape ${attempt}`,
      );
      await page.keyboard.press('Escape');
      await closeQuestion.waitFor({ state: 'detached' });
    }

    // A rejected upload's error stays in the upload dialog. Escape and a host close request
    // (the outer dialog's cancel, e.g. Android back) both close that nested dialog first.
    for (const route of ['keyboard', 'host'] as const) {
      await frame.locator('#artwork-chest').click();
      await frame
        .locator('input[type=file]')
        .setInputFiles({ name: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') });
      await frame.getByText('Choose a PNG, JPG or SVG image.').waitFor();
      if (route === 'keyboard') await page.keyboard.press('Escape');
      else await page.locator('dialog').first().dispatchEvent('cancel');
      await frame.locator('.artwork-dialog').waitFor({ state: 'detached', timeout: 2000 });
      assert.equal(await closeQuestion.count(), 0, `nested dialog first: ${route}`);
      if (route === 'keyboard') {
        await frame.getByRole('button', { name: 'Close customizer', exact: true }).focus();
        await page.keyboard.press('Enter');
      } else await page.locator('dialog').first().dispatchEvent('cancel');
      await closeQuestion.waitFor({ timeout: 2000 });
      assert.equal(await frame.getByText('Choose a PNG, JPG or SVG image.').count(), 0, `stale upload error: ${route}`);
      await page.keyboard.press('Escape');
      await closeQuestion.waitFor({ state: 'detached' });
    }

    // Unfinished upload: Escape and a host close request both ask about the upload first
    // and keep it running until the customer cancels it.
    await frame.locator('#artwork-chest').click();
    await frame
      .locator('input[type=file]')
      .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('png') });
    await frame.getByText('Checking artwork…', { exact: true }).waitFor();
    for (const route of ['keyboard', 'host'] as const) {
      if (route === 'keyboard') await page.keyboard.press('Escape');
      else await page.locator('dialog').first().dispatchEvent('cancel');
      await uploadQuestion.waitFor({ timeout: 2000 });
      assert.deepEqual(await hostState(), { open: true, closed: 0, aborted: false }, route);
      await page.keyboard.press('Escape');
      await uploadQuestion.waitFor({ state: 'detached' });
      await frame.getByText('Checking artwork…', { exact: true }).waitFor();
    }
    await page.locator('dialog').first().dispatchEvent('cancel');
    await uploadQuestion.waitFor({ timeout: 2000 });
    await frame.getByRole('button', { name: 'Cancel upload', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => Reflect.get(window, 'uploadSignal')?.aborted === true);
    // Cancelling the upload closes its dialog; the next host request asks about the customizer.
    await frame.locator('.artwork-dialog').waitFor({ state: 'detached' });
    assert.equal((await hostState()).closed, 0);
    await page.locator('dialog').first().dispatchEvent('cancel');
    await closeQuestion.waitFor({ timeout: 2000 });
    await frame.getByRole('button', { name: 'Close customization', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => Reflect.get(window, 'designerClosed') === 1);
    assert.deepEqual(await hostState(), { open: false, closed: 1, aborted: true });
    assert.equal(await page.evaluate(() => document.documentElement.style.overflow), '');
  });
