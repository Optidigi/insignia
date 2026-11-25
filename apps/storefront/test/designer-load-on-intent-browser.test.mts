import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import { Liquid } from 'liquidjs';
import { type BrowserType, chromium, firefox, type Page } from 'playwright';
import type { BuyerConfig } from '../src/buyer.ts';
import { createStorefrontTestServer, selectedFrameAssets, serverPort } from './support.mts';

/**
 * #653: a product page loads only the small theme entry. The Designer (modal, controller, frame script and its
 * stylesheet) and the public configuration load on buyer intent, or on a cold click with nothing prepared.
 */
const BROWSER_TEST_TIMEOUT_MS = 60_000;

const config: BuyerConfig = {
  version: 'm7-config-v1',
  productId: '111',
  title: 'Intent shirt',
  shopCurrency: 'USD',
  revisionId: 'r1',
  contentHash: 'a'.repeat(64),
  ready: true,
  methods: [{ id: 'print', label: 'Print' }],
  placements: [
    { id: 'front', label: 'Front', allowedMethodIds: ['print'], allowedStepIds: ['small'], logoLaterAllowed: true },
  ],
  steps: [{ id: 'small', label: 'Small' }],
  options: [],
  decorationPrices: [{ placementId: 'front', methodId: 'print', stepId: 'small', minor: '250' }],
  variants: [
    {
      id: '222',
      label: 'Blue / M',
      available: true,
      selectedOptions: [
        { name: 'Color', value: 'Blue' },
        { name: 'Size', value: 'M' },
      ],
      baseUnitMinor: '1000',
    },
  ],
  geometry: {
    version: 'm5-geometry-v1',
    views: [
      {
        id: 'front',
        image: { revisionId: 'photo', width: 1000, height: 1000 },
        variantImages: [],
        placements: [{ id: 'front', rect: { centerX: 0.5, centerY: 0.5, width: 0.3, height: 0.3 } }],
      },
    ],
    steps: [{ id: 'small', widthFraction: 0.5, heightFraction: 0.5, physicalMm: { width: 50, height: 50 } }],
  },
  imageUrls: { photo: 'https://preview.example/photo.png' },
};
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
  'base64',
);

/** Requests that belong to the Designer or its data, never to the small theme entry. */
const designerRequest = (path: string) =>
  path.startsWith('/apps/insignia/') ||
  path.startsWith('/src/designer/') ||
  path === '/src/buyer.ts' ||
  /\/frontend\/(?:designer|localization)\//.test(path) ||
  /\/insignia-designer(?:-frame\.js|\.css|-font-[a-z]+\.css)$/.test(path) ||
  path.includes('/node_modules/.vite/deps/preact');

async function fixture(t: TestContext, engine: BrowserType, options: { hasTouch?: boolean } = {}) {
  const server = await createStorefrontTestServer({
    plugins: [selectedFrameAssets()],
    server: { host: '127.0.0.1', port: 0, hmr: false },
  });
  await server.listen();
  const browser = await engine.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await server.close();
  });
  const context = await browser.newContext({ hasTouch: options.hasTouch ?? false });
  const page = await context.newPage();
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    requests.push(url.origin === 'https://preview.example' ? url.href : url.pathname);
  });
  let sessions = 0;
  await page.route('**/apps/insignia/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/v1/sessions')) {
      sessions++;
      return route.fulfill({
        json: {
          capability: 'abc.def',
          sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
      });
    }
    return route.fulfill({ json: config });
  });
  await page.route('https://preview.example/**', (route) =>
    route.fulfill({ contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: pixel }),
  );
  await page.goto(`http://127.0.0.1:${serverPort(server.httpServer)}`);
  await page.evaluate(async () => {
    await customElements.whenDefined('insignia-buyer');
    // The manual block's server-rendered markup (customise-control.liquid).
    document.body.innerHTML =
      '<button id="theme-focus">Theme</button><insignia-buyer product-id="111" country="US" style="display:contents"><button type="button" slot="trigger" class="button insignia-customise">Customise</button></insignia-buyer>';
    document.getElementById('theme-focus')?.focus();
  });
  return { page, requests, sessions: () => sessions };
}

/** Longer than the removed idle prewarm's 1.5 s timeout, ending in an idle period. */
async function quietPeriod(page: Page) {
  // Not the network-idle lifecycle: Firefox can lose that timer; every request is recorded either way.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(() => requestIdleCallback(() => resolve(), { timeout: 1000 }), 2000);
      }),
  );
}

async function assertNothingLoaded(page: Page, requests: string[], message: string) {
  assert.deepEqual(requests.filter(designerRequest), [], message);
  assert.equal(await page.locator('link[rel=modulepreload], link[rel=preload]').count(), 0, message);
  assert.equal(await page.locator('dialog, iframe').count(), 0, message);
}

async function waitForPrepared(page: Page) {
  await page.waitForFunction(
    () =>
      !!document.querySelector('link[rel=modulepreload][href$="insignia-designer-frame.js"]') &&
      !!document.querySelector('link[rel=preload][as=style][href$="insignia-designer.css"]') &&
      !!document.querySelector('link[rel=preload][as=style][href$="insignia-designer-font-latin.css"]'),
  );
}

async function waitForOpenedDesigner(page: Page) {
  await page.frameLocator('dialog:modal > iframe[srcdoc]').locator('.app').waitFor();
  await page.waitForFunction(
    () => document.querySelector<HTMLIFrameElement>('dialog:modal > iframe[srcdoc]')?.style.visibility === 'visible',
  );
}

for (const engine of [chromium, firefox]) {
  test(`${engine.name()}: a product page loads no Designer code, stylesheet or configuration before intent`, {
    timeout: BROWSER_TEST_TIMEOUT_MS,
  }, async (t) => {
    const { page, requests } = await fixture(t, engine);
    await quietPeriod(page);
    await assertNothingLoaded(page, requests, 'nothing of the Designer loads without buyer intent');
    // Scrolling the trigger into view or moving elsewhere on the page is not intent either.
    await page.locator('#theme-focus').hover();
    await page.mouse.wheel(0, 200);
    await quietPeriod(page);
    await assertNothingLoaded(page, requests, 'unrelated interaction loads nothing');
  });

  test(`${engine.name()}: hovering or focusing Customise prepares the Designer without opening it`, {
    timeout: BROWSER_TEST_TIMEOUT_MS,
  }, async (t) => {
    for (const intent of ['hover', 'focus'] as const) {
      const { page, requests, sessions } = await fixture(t, engine);
      await quietPeriod(page);
      await assertNothingLoaded(page, requests, 'nothing before intent');
      await page.locator('insignia-buyer button')[intent]();
      await waitForPrepared(page);
      await page.waitForFunction(() => {
        const preparation = Reflect.get(document.querySelector('insignia-buyer') ?? {}, 'preparation');
        return preparation?.warm?.ready === true;
      });
      assert.ok(requests.includes('/apps/insignia/v1/config'), `${intent} reads the public configuration`);
      assert.ok(
        requests.some((path) => path.endsWith('/insignia-designer.css')),
        `${intent} loads the Designer stylesheet`,
      );
      assert.equal(await page.locator('dialog:modal').count(), 0, 'preparing never opens the Designer');
      assert.equal(sessions(), 0, 'preparing creates no buyer session');
    }
  });

  test(`${engine.name()}: a first press on a touch screen prepares before its click`, {
    timeout: BROWSER_TEST_TIMEOUT_MS,
  }, async (t) => {
    // A touch press dispatches pointerdown (and touchstart where touch events exist), never pointerenter first.
    const events = engine === chromium ? (['touchstart', 'pointerdown'] as const) : (['pointerdown'] as const);
    for (const type of events) {
      const { page, requests } = await fixture(t, engine, { hasTouch: engine === chromium });
      await quietPeriod(page);
      await assertNothingLoaded(page, requests, 'nothing before the press');
      const configRead = page.waitForRequest(
        (request) => new URL(request.url()).pathname === '/apps/insignia/v1/config',
      );
      await page
        .locator('insignia-buyer button')
        .dispatchEvent(type, type === 'pointerdown' ? { pointerType: 'touch', isPrimary: true } : {});
      await configRead;
      await waitForPrepared(page);
      assert.equal(await page.locator('dialog:modal').count(), 0);
    }
  });

  test(`${engine.name()}: a cold click with nothing prepared shows the trigger busy state and opens the Designer`, {
    timeout: BROWSER_TEST_TIMEOUT_MS,
  }, async (t) => {
    const { page, requests, sessions } = await fixture(t, engine);
    await quietPeriod(page);
    await assertNothingLoaded(page, requests, 'nothing before the click');
    const trigger = page.locator('insignia-buyer button');
    // A programmatic click carries no pointer or focus intent: the fully cold path.
    const started = Date.now();
    await trigger.evaluate((button: HTMLButtonElement) => button.click());
    assert.equal(await trigger.getAttribute('aria-busy'), 'true', 'the existing busy state shows at once');
    await waitForOpenedDesigner(page);
    t.diagnostic(`cold click-to-ready: ${Date.now() - started}ms (Vite source host, not a native benchmark)`);
    assert.equal(await trigger.getAttribute('aria-busy'), null);
    assert.equal(await page.locator('dialog:modal').count(), 1);
    assert.equal(await page.locator('iframe').count(), 1);
    assert.equal(sessions(), 1);
  });

  test(`${engine.name()}: hover then click opens the prepared Designer`, {
    timeout: BROWSER_TEST_TIMEOUT_MS,
  }, async (t) => {
    const { page } = await fixture(t, engine);
    const trigger = page.locator('insignia-buyer button');
    await trigger.hover();
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
    const started = Date.now();
    await trigger.click();
    await waitForOpenedDesigner(page);
    t.diagnostic(`hover +300ms click-to-ready: ${Date.now() - started}ms (Vite source host, not a native benchmark)`);
    assert.equal(await page.locator('iframe').count(), 1);
  });
}

async function renderManualBlock(settings: Record<string, unknown>) {
  const engine = new Liquid({
    root: new URL('../../../extensions/insignia-theme/snippets/', import.meta.url).pathname,
    extname: '.liquid',
    globals: {
      shop: {
        name: 'Demo',
        metafields: { $app: { insignia_public_config_v2: { value: { generationHex: 'a'.repeat(32) } } } },
      },
      routes: { root_url: '/' },
      localization: { country: { iso_code: 'US' }, market: { id: '42' } },
      request: { locale: { iso_code: 'en' }, design_mode: false },
    },
  });
  engine.registerFilter('t', () => 'Customise');
  return String(
    await engine.parseAndRender("{% render 'customise-control', product: product, block: block, control: 'manual' %}", {
      product: {
        id: '111',
        variants: [],
        metafields: { $app: { insignia_policy_v2: { value: `${'a'.repeat(32)}:1:required` } } },
      },
      block: {
        shopify_attributes: '',
        settings: {
          proxy_prefix: 'insignia',
          button_label: '',
          button_style: 'auto',
          button_width: 'theme',
          override_radius: false,
          override_border: false,
          button_spacing: 0,
          ...settings,
        },
      },
    }),
  );
}

test('the server-rendered Customise button keeps its size and position when the script arrives', {
  timeout: BROWSER_TEST_TIMEOUT_MS,
}, async (t) => {
  const server = await createStorefrontTestServer({ server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await server.close();
  });
  const origin = `http://127.0.0.1:${serverPort(server.httpServer)}`;
  for (const settings of [
    {},
    {
      button_style: 'secondary',
      button_width: 'full',
      button_background: '#112233',
      button_color: '#ffffff',
      override_radius: true,
      button_radius: 12,
      override_border: true,
      button_border_width: 3,
      button_border_color: '#445566',
      button_spacing: 16,
    },
    { button_width: 'content', button_label: 'Design yours' },
  ]) {
    const markup = await renderManualBlock(settings);
    const page = await browser.newPage();
    await page.addInitScript(() => {
      const shifts: number[] = [];
      Reflect.set(window, '__shifts', shifts);
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) shifts.push(Reflect.get(entry, 'value') as number);
      }).observe({ type: 'layout-shift', buffered: true });
    });
    // A theme product form: the script is not loaded with the page, as on a slow storefront.
    await page.route(`${origin}/product`, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=412"><style>
          body{margin:0;font:16px/1.5 sans-serif}form{display:flex;flex-wrap:wrap;gap:8px;padding:16px;max-width:380px}
          .button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 24px;border:1px solid #000;border-radius:4px;background:#000;color:#fff;font:inherit}
          .button--secondary{background:#fff;color:#000}footer{height:300px;background:#eee}
        </style></head><body><main><h1>Shirt</h1><form action="/cart/add"><input name="id" value="101">${markup}</form></main><footer>Footer</footer></body></html>`,
      }),
    );
    await page.goto(`${origin}/product`);
    const box = () =>
      page.locator('insignia-buyer button').evaluate((button) => {
        const rect = button.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, text: button.textContent };
      });
    const before = await box();
    assert.ok(before.width > 0 && before.height > 0, 'the button is laid out before any Insignia script runs');
    assert.equal(before.text, settings.button_label ?? 'Customise');
    await page.evaluate(async () => {
      await import(/* @vite-ignore */ `${location.origin}/src/main.ts`);
      await customElements.whenDefined('insignia-buyer');
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.ok(await page.locator('insignia-buyer').evaluate((buyer) => !!buyer.shadowRoot), 'the element upgraded');
    assert.deepEqual(await box(), before, `${JSON.stringify(settings)} keeps its first-paint box`);
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, '__shifts')), [], 'no layout shift');
    await page.close();
  }
});
