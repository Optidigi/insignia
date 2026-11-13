import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { type TestContext, test } from 'node:test';
import { build } from 'esbuild';
import { type BrowserType, chromium, firefox, type Page } from 'playwright';
import { serverPort } from './support.mts';

const config = {
  id: 'focus-product',
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
const placed = {
  initialPrints: [{ id: 'chest', method: 'print', size: 0, artworkId: 'asset' }],
  initialArtworks: [
    {
      id: 'asset',
      name: 'Logo.png',
      url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/%3E',
      width: 100,
      height: 100,
    },
  ],
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

/** The theme's trigger opens the Designer, as the storefront element does. */
async function openProductPage(
  t: TestContext,
  engine: BrowserType,
  options: { artwork?: boolean; hidden?: boolean; resume?: boolean },
) {
  const [host, frameSource] = await buildSources();
  const frameOptions = JSON.stringify({
    config,
    locale: 'en',
    ...(options.artwork || options.resume ? placed : {}),
    ...(options.resume ? { resumeDraft: { id: 'draft', prints: placed.initialPrints, quantities: {} } } : {}),
    ...(options.hidden ? { initiallyHidden: true } : {}),
  });
  const html = `<!doctype html><html><body><p>Shopify product page</p><a href="#top" id="before">Page link</a><button id="trigger" type="button">Customize this product</button><a href="#end" id="after">Later page link</a><script type="module">
 import {createDesignerFrame} from '/host.js';
 window.designerClosed=0;
 const ports={artwork:{upload:()=>new Promise(()=>{})},cart:{commit:()=>new Promise(()=>{})}};
 const create=()=>createDesignerFrame({...${frameOptions},ports,onClose(){window.designerClosed++}});
 ${options.hidden ? 'window.liveFrame=create();' : ''}
 document.getElementById('trigger').addEventListener('click',()=>{if(window.liveFrame)window.liveFrame.open();else window.liveFrame=create()});
 </script></body></html>`;
  const server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? '/', 'http://fixture.test').pathname;
      if (path === '/' || path === '/products/shirt') {
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
  await page.goto(`http://127.0.0.1:${serverPort(server)}/products/shirt`);
  return page;
}

/** Where keyboard focus is, as a keyboard user would learn it: the host element and the one inside the frame. */
const focusState = (page: Page) =>
  page.evaluate(() => {
    const iframe = document.querySelector('dialog > iframe');
    const inner = iframe instanceof HTMLIFrameElement ? iframe.contentDocument : null;
    const active = inner?.activeElement;
    const style = active && inner?.defaultView ? inner.defaultView.getComputedStyle(active) : null;
    return {
      host: document.activeElement?.tagName.toLowerCase() ?? null,
      hostId: document.activeElement?.id ?? null,
      frameFocused: Boolean(inner?.hasFocus()),
      inApp: Boolean(active?.closest('.app')),
      inDialog: Boolean(active?.closest('dialog')),
      inFrame: Boolean(active && active !== inner?.body && active !== inner?.documentElement),
      name: active?.textContent?.trim().slice(0, 40) ?? null,
      tag: active?.tagName.toLowerCase() ?? null,
      outline: style && style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0,
    };
  });
const waitForClosed = (page: Page, closed: number) =>
  page.waitForFunction(
    (expected) => Reflect.get(window, 'designerClosed') === expected && !document.querySelector('dialog[open]'),
    closed,
  );
async function openWithKeyboard(page: Page) {
  await page.locator('#trigger').focus();
  await page.keyboard.press('Enter');
  await page.frameLocator('dialog > iframe').locator('.app').waitFor({ timeout: 10000 });
  await page.waitForFunction(() =>
    document.querySelector<HTMLIFrameElement>('dialog > iframe')?.contentDocument?.hasFocus(),
  );
}

for (const engine of [chromium, firefox]) {
  test(`${engine.name()}: opening the Designer focuses its first control with a visible ring, and Escape returns focus`, async (t) => {
    const page = await openProductPage(t, engine, {});
    await openWithKeyboard(page);
    // Wait for the open focus to settle rather than sleeping.
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLIFrameElement>('dialog > iframe')?.contentDocument?.activeElement?.tagName === 'A',
      undefined,
      { timeout: 2000 },
    );
    const state = await focusState(page);
    assert.equal(state.tag, 'a');
    assert.equal(state.name, 'Skip to design controls');
    assert.equal(state.frameFocused, true);
    assert.equal(state.outline, true, 'the focused control shows a visible ring');
    await page.keyboard.press('Escape');
    await waitForClosed(page, 1);
    assert.equal((await focusState(page)).hostId, 'trigger');
  });

  test(`${engine.name()}: a prepared hidden Designer does not take focus until it is opened`, async (t) => {
    const page = await openProductPage(t, engine, { hidden: true });
    await page.locator('#trigger').focus();
    await page.frameLocator('dialog > iframe').locator('.app').waitFor({ state: 'attached', timeout: 10000 });
    await page.waitForFunction(() => Reflect.get(window, 'liveFrame')?.initialized);
    assert.equal((await focusState(page)).hostId, 'trigger');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLIFrameElement>('dialog > iframe')?.contentDocument?.activeElement?.tagName === 'A',
      undefined,
      { timeout: 2000 },
    );
    assert.equal((await focusState(page)).name, 'Skip to design controls');
  });

  for (const artwork of [false, true])
    test(`${engine.name()}: Tab and Shift+Tab stay inside the Designer ${artwork ? 'with artwork placed' : 'on the empty Artwork step'}`, async (t) => {
      const page = await openProductPage(t, engine, { artwork });
      await openWithKeyboard(page);
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLIFrameElement>('dialog > iframe')?.contentDocument?.activeElement?.tagName === 'A',
        undefined,
        { timeout: 2000 },
      );
      const inside = async (step: string) => {
        const state = await focusState(page);
        assert.equal(state.host, 'iframe', `${step}: the page behind the dialog never takes focus`);
        assert.equal(state.inApp, true, `${step}: a control inside the Designer has focus (${JSON.stringify(state)})`);
        return state;
      };
      const first = await inside('open');
      // Forwards through every control and one past the last: focus wraps to the first control.
      const seen: string[] = [];
      for (let i = 0; i < 80; i++) {
        await page.keyboard.press('Tab');
        const state = await inside(`Tab ${i + 1}`);
        seen.push(`${state.tag}:${state.name}`);
        if (state.name === first.name && state.tag === first.tag) break;
      }
      assert.ok(seen.length > 2 && seen.length < 80, `Tab wrapped to the first control after ${seen.length} presses`);
      const last = seen.at(-2) ?? '';
      // Backwards from the first control: focus wraps to the last control.
      await page.keyboard.press('Shift+Tab');
      const state = await inside('Shift+Tab');
      assert.equal(`${state.tag}:${state.name}`, last);
    });

  test(`${engine.name()}: dialogs inside the Designer keep their own focus and trap Tab`, async (t) => {
    // The resume prompt (§8.2): Continue has focus, and the opening focus does not take it over.
    const resume = await openProductPage(t, engine, { resume: true });
    await openWithKeyboard(resume);
    const prompt = resume.frameLocator('dialog > iframe').getByRole('heading', { name: 'Continue your design?' });
    await prompt.waitFor();
    await resume.waitForFunction(
      () =>
        document.querySelector<HTMLIFrameElement>('dialog > iframe')?.contentDocument?.activeElement?.tagName ===
        'BUTTON',
    );
    assert.equal((await focusState(resume)).name, 'Continue');
    for (const key of ['Tab', 'Tab', 'Tab']) {
      await resume.keyboard.press(key);
      const state = await focusState(resume);
      assert.equal(
        state.host === 'iframe' && state.inDialog,
        true,
        `Tab stays in the prompt: ${JSON.stringify(state)}`,
      );
    }

    // An edited design: Escape asks "Close customization?" with focus on Keep editing (#350).
    const page = await openProductPage(t, engine, { artwork: true });
    await openWithKeyboard(page);
    const frame = page.frameLocator('dialog > iframe');
    await page.keyboard.press('Escape');
    await frame.getByRole('heading', { name: 'Close customization?', exact: true }).waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLIFrameElement>('dialog > iframe')?.contentDocument?.activeElement?.tagName ===
        'BUTTON',
    );
    assert.equal((await focusState(page)).name, 'Keep editing');
    for (let press = 0; press < 5; press++) {
      await page.keyboard.press('Tab');
      const state = await focusState(page);
      assert.equal(
        state.host === 'iframe' && state.inDialog,
        true,
        `Tab stays in the decision: ${JSON.stringify(state)}`,
      );
    }
    await page.keyboard.press('Escape');
    await frame.getByRole('heading', { name: 'Close customization?', exact: true }).waitFor({ state: 'detached' });
    // The Designer restores focus on the next frame; wait for that state rather than a delay.
    await page.waitForFunction(() => {
      const inner = document.querySelector<HTMLIFrameElement>('dialog > iframe')?.contentDocument;
      return Boolean(inner?.activeElement && inner.activeElement !== inner.body);
    });
    const after = await focusState(page);
    assert.equal(after.host === 'iframe' && after.inFrame, true, 'focus stays inside the Designer after Keep editing');
  });

  test(`${engine.name()}: the close button still closes the opened Designer and returns focus to the trigger`, async (t) => {
    const page = await openProductPage(t, engine, {});
    await openWithKeyboard(page);
    await page.frameLocator('dialog > iframe').getByRole('button', { name: 'Close customizer', exact: true }).click();
    await waitForClosed(page, 1);
    assert.equal((await focusState(page)).hostId, 'trigger');
  });
}
