import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { type TestContext, test } from 'node:test';
import { build } from 'esbuild';
import { type BrowserType, chromium, firefox } from 'playwright';
import { serverPort } from './support.mts';

const colorIds = ['white', 'black', 'red', 'blue', 'green', 'yellow'];
const config = {
  id: 'names-product',
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
  colors: colorIds.map((id) => ({
    id,
    name: id,
    availableSizeIds: ['small'],
    images: {
      front:
        'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"%3E%3Crect width="1000" height="1000" fill="white"/%3E%3C/svg%3E',
    },
  })),
  variantMatrix: colorIds.map((id, index) => ({
    rowId: id,
    columnId: 'small',
    variantId: String(101 + index),
    available: true,
  })),
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
let sources: Promise<[string, string]> | undefined;
const buildSources = () =>
  (sources ??= Promise.all([
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
  ]).then(([host, frame]) => [host.outputFiles[0]?.text ?? '', frame.outputFiles[0]?.text ?? '']));

/** The Designer opened in one customer language, as the storefront frame does. */
async function openDesigner(t: TestContext, engine: BrowserType, locale: string) {
  const [host, frameSource] = await buildSources();
  const html = `<!doctype html><html><body><script type="module">
 import {createDesignerFrame} from '/host.js';
 createDesignerFrame({config:${JSON.stringify({ ...config, locale })},locale:'${locale}',ports:{artwork:{upload:()=>new Promise(()=>{})},cart:{commit:()=>new Promise(()=>{})}},onClose(){}});
 </script></body></html>`;
  const server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? '/', 'http://fixture.test').pathname;
      if (path === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end(html);
      } else if (path === '/host.js' || path === '/insignia-designer-frame.js') {
        response.setHeader('Content-Type', 'text/javascript');
        response.end(path === '/host.js' ? host : frameSource);
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
  await page.goto(`http://127.0.0.1:${serverPort(server)}/`);
  const frame = page.frameLocator('dialog > iframe');
  await frame.locator('.app').waitFor({ timeout: 10000 });
  return frame;
}

// The accessible name a screen reader or speech input user gets for each control, per customer language.
const languages = [
  { locale: 'en', overflow: '+1, All 6 options', artwork: 'Choose artwork', action: 'Choose' },
  { locale: 'nl', overflow: '+1, Alle opties (6)', artwork: 'Ontwerp kiezen', action: 'Kiezen' },
  { locale: 'de', overflow: '+1, Alle 6 Optionen', artwork: 'Motiv auswählen', action: 'Auswählen' },
  { locale: 'fr', overflow: '+1, Toutes les 6 options', artwork: 'Choisir un visuel', action: 'Choisir' },
  { locale: 'es', overflow: '+1, Las 6 opciones', artwork: 'Elegir diseño', action: 'Elegir' },
  { locale: 'it', overflow: '+1, Tutte le 6 opzioni', artwork: 'Scegli la grafica', action: 'Scegli' },
];

for (const engine of [chromium, firefox])
  for (const language of languages)
    test(`${engine.name()} ${language.locale}: the colour overflow and empty artwork controls have one clean name containing their visible text`, async (t) => {
      const frame = await openDesigner(t, engine, language.locale);
      // Visible "+1" (#414): the name starts with it.
      assert.equal((await frame.locator('.more-colors').textContent())?.trim(), '+1');
      await frame.getByRole('button', { name: language.overflow, exact: true }).waitFor({ timeout: 2000 });
      // Empty placement artwork (#415): heading and trailing action are both visible; the name says the action once.
      await frame.locator('.empty-state button').click();
      const artwork = frame.locator('.artwork-choice');
      await artwork.waitFor();
      const visible = ((await artwork.textContent()) ?? '').replaceAll(/\s+/g, ' ').toLowerCase();
      assert.ok(
        visible.includes(language.artwork.toLowerCase()) && visible.includes(language.action.toLowerCase()),
        visible,
      );
      assert.ok(
        language.artwork.toLowerCase().includes(language.action.toLowerCase()),
        'the name contains the visible action word',
      );
      await frame.getByRole('button', { name: language.artwork, exact: true }).waitFor({ timeout: 2000 });
    });
