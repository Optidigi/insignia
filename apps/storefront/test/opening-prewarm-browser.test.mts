import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, firefox } from 'playwright';
import type { BuyerConfig } from '../src/buyer.ts';
import { createStorefrontTestServer, selectedFrameAssets, serverPort } from './support.mts';

// Covers launching the engine and Vite's on-demand first compile on a loaded runner;
// each wait inside still fails on its own condition.
const BROWSER_TEST_TIMEOUT_MS = 60_000;

function deferred() {
  let resolve: () => void = () => {
    throw new Error('Deferred not initialized');
  };
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

const config: BuyerConfig = {
  version: 'm7-config-v1',
  productId: '111',
  title: 'Prepared shirt',
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
/** Opening (not preparation) warms the buyer session once per tab. */
const sessionGrant = () => ({
  json: {
    capability: 'abc.def',
    sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  },
});
for (const engine of [chromium, firefox]) {
  test(`${engine.name()}: idle preparation fetches only public presentation and immutable assets without opening the modal`, async (t) => {
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
    const page = await browser.newPage();
    const origin = `http://127.0.0.1:${serverPort(server.httpServer)}`;
    const paths: string[] = [];
    let opened = false;
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/cart')) paths.push(path);
    });
    await page.route('**/apps/insignia/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      paths.push(path);
      if (path === '/apps/insignia/v1/sessions' && opened) return route.fulfill(sessionGrant());
      assert.equal(
        path,
        '/apps/insignia/v1/config',
        'preparing must not establish sessions or read private cart custody',
      );
      await route.fulfill({ json: config });
    });
    await page.route('https://preview.example/**', (route) =>
      route.fulfill({
        contentType: 'image/png',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
          'base64',
        ),
      }),
    );
    await page.goto(origin);
    await page.evaluate(async () => {
      await customElements.whenDefined('insignia-buyer');
      document.body.innerHTML =
        '<button id="theme-focus">Theme</button><insignia-buyer product-id="111" country="US"></insignia-buyer>';
      document.getElementById('theme-focus')?.focus();
    });
    await page.waitForResponse((response) => new URL(response.url()).pathname === '/apps/insignia/v1/config');
    await page.waitForFunction(
      () =>
        document.querySelector('link[rel=modulepreload][href$="insignia-designer-frame.js"]') &&
        document.querySelector('link[rel=preload][as=style][href$="insignia-designer.css"]'),
    );
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLIFrameElement>('dialog:not([open]) > iframe[srcdoc]')?.style.visibility ===
        'visible',
    );
    await page.waitForFunction(() => {
      const frame = document.querySelector<HTMLIFrameElement>('dialog:not([open]) > iframe[srcdoc]');
      const photo = frame?.contentDocument?.querySelector<HTMLImageElement>('.garment-photo');
      const rect = photo?.getBoundingClientRect();
      return (
        !!frame &&
        frame.clientWidth > 0 &&
        frame.clientHeight > 0 &&
        !!photo?.naturalWidth &&
        !!rect &&
        rect.width > 0 &&
        rect.height > 0
      );
    });
    assert.equal(
      await page.locator('dialog:not([open]) > iframe[srcdoc]').evaluate((frame) => {
        const parent = frame.parentElement;
        return parent ? getComputedStyle(parent).opacity : 'missing';
      }),
      '0',
      'Prepared editor pixels remain transparent even when its iframe sets visibility visible',
    );
    assert.equal(await page.locator('dialog:modal').count(), 0);
    assert.equal(await page.locator('iframe').count(), 1);
    assert.equal(await page.locator('dialog').evaluate((dialog: HTMLDialogElement) => dialog.inert), true);
    await page.locator('iframe').evaluate((frame) => {
      frame.id = 'prepared-frame';
    });
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'theme-focus');
    assert.equal(await page.evaluate(() => document.documentElement.style.overflow), '');
    assert.deepEqual(paths, ['/apps/insignia/v1/config'], 'preparation creates no session');
    const openingAt = Date.now();
    opened = true;
    const sessionRequested = page.waitForRequest(
      (request) => new URL(request.url()).pathname === '/apps/insignia/v1/sessions',
    );
    await page.locator('insignia-buyer button').click();
    await page.frameLocator('dialog:modal > iframe[srcdoc]').locator('.app').waitFor();
    await page.waitForFunction(
      () => document.querySelector<HTMLIFrameElement>('dialog:modal > iframe[srcdoc]')?.style.visibility === 'visible',
    );
    t.diagnostic(
      `Prepared local click-to-visible frame: ${Date.now() - openingAt}ms (source fixture, not native benchmark)`,
    );
    await sessionRequested;
    assert.deepEqual(
      paths,
      ['/apps/insignia/v1/config', '/apps/insignia/v1/sessions'],
      'opening warms exactly one buyer session and reads no private cart custody',
    );
    assert.equal(await page.locator('dialog:modal > #prepared-frame').count(), 1);
    assert.equal(await page.getByText('Loading customization…', { exact: true }).isVisible(), false);
    await page
      .frameLocator('dialog:modal > iframe[srcdoc]')
      .getByRole('button', { name: 'Close customizer', exact: true })
      .click();
    await page.locator('dialog:modal').waitFor({ state: 'detached', timeout: 5000 });
    assert.equal(await page.locator('dialog:modal').count(), 0);
  });
  test(`${engine.name()}: prewarm failures and context changes cannot poison the real opening`, async (t) => {
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
    const page = await browser.newPage();
    const origin = `http://127.0.0.1:${serverPort(server.httpServer)}`;
    const countries: string[] = [];
    await page.route('**/apps/insignia/v1/config*', async (route) => {
      countries.push(new URL(route.request().url()).searchParams.get('country') ?? '');
      await route.fulfill(countries.length === 1 ? { status: 503, json: { error: 'unavailable' } } : { json: config });
    });
    await page.route('https://preview.example/**', (route) =>
      route.fulfill({
        contentType: 'image/png',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
          'base64',
        ),
      }),
    );
    await page.goto(origin);
    await page.evaluate(async () => {
      await customElements.whenDefined('insignia-buyer');
      document.body.innerHTML = '<insignia-buyer product-id="111" country="US"></insignia-buyer>';
    });
    await page.waitForResponse((response) => response.status() === 503 && response.url().includes('/v1/config'));
    await page.evaluate(() => document.querySelector('insignia-buyer')?.setAttribute('country', 'NL'));
    await page.locator('insignia-buyer button').click();
    await page.frameLocator('dialog:modal > iframe[srcdoc]').locator('.app').waitFor();
    assert.deepEqual(countries, ['US', 'NL']);
  });
}

for (const engine of [chromium, firefox])
  test(`${engine.name()}: a cart page view loads no product configuration until the buyer shows intent`, {
    timeout: BROWSER_TEST_TIMEOUT_MS,
  }, async (t) => {
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
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.requestIdleCallback = (callback) => {
        Reflect.set(window, '__idle', callback);
        return 1;
      };
      window.cancelIdleCallback = () => Reflect.deleteProperty(window, '__idle');
    });
    const paths: string[] = [];
    await page.route('**/apps/insignia/**', (route) => {
      paths.push(new URL(route.request().url()).pathname);
      return route.fulfill({ json: config });
    });
    await page.route('**/cart.js', (route) => route.fulfill({ json: { items: [], attributes: {}, currency: 'USD' } }));
    await page.route('https://preview.example/**', (route) => route.abort());
    await page.goto(`http://127.0.0.1:${serverPort(server.httpServer)}`);
    await page.evaluate(async () => {
      history.replaceState(null, '', '/nl/cart');
      await customElements.whenDefined('insignia-buyer');
      // A visible product control on the cart page, e.g. an auto-placed recommendation quick-add.
      document.body.innerHTML =
        '<insignia-cart-repair cart-root="/nl/"></insignia-cart-repair><insignia-buyer product-id="111" cart-root="/nl/" data-insignia-auto></insignia-buyer>';
      Reflect.get(window, '__idle')?.();
    });
    await page.waitForLoadState('networkidle');
    assert.deepEqual(paths, [], 'an ordinary cart view reads no Insignia configuration');
    await page.locator('insignia-buyer button').hover();
    await page.waitForResponse((response) => new URL(response.url()).pathname === '/apps/insignia/v1/config');
    assert.deepEqual(paths, ['/apps/insignia/v1/config'], 'pointer intent still prepares before the click');
  });

for (const engine of [chromium, firefox])
  test(`${engine.name()}: presentation preparation expires, aborts on disconnect, and never prewarms cart repair`, {
    timeout: BROWSER_TEST_TIMEOUT_MS,
  }, async (t) => {
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
    const page = await browser.newPage();
    await page.addInitScript(() => {
      let next = 0;
      window.requestIdleCallback = (callback) => {
        const id = ++next;
        Reflect.set(window, '__idle', callback);
        Reflect.set(window, '__idleId', id);
        return id;
      };
      window.cancelIdleCallback = (id) => {
        if (Reflect.get(window, '__idleId') === id) Reflect.deleteProperty(window, '__idle');
      };
    });
    let requests = 0;
    const first = deferred();
    await page.route('**/apps/insignia/v1/config*', async (route) => {
      requests++;
      await route.fulfill({ json: config });
      first.resolve();
    });
    await page.route('https://preview.example/**', (route) =>
      route.fulfill({
        contentType: 'image/png',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
          'base64',
        ),
      }),
    );
    await page.goto(`http://127.0.0.1:${serverPort(server.httpServer)}`);
    await page.evaluate(async () => {
      await customElements.whenDefined('insignia-buyer');
      document.body.innerHTML = '<insignia-buyer product-id="111" repair></insignia-buyer>';
      Reflect.get(window, '__idle')?.();
    });
    assert.equal(requests, 0);
    await page.evaluate(() => {
      document.body.innerHTML = '<insignia-buyer product-id="111"></insignia-buyer>';
      Reflect.get(window, '__idle')?.();
    });
    await first.promise;
    await page.waitForFunction(
      () => !!document.querySelector('link[rel=modulepreload][href$="insignia-designer-frame.js"]'),
    );
    await page.evaluate(() => {
      const now = Date.now() + 60001;
      Date.now = () => now;
    });
    await page.locator('insignia-buyer button').click();
    await page.frameLocator('dialog:modal > iframe[srcdoc]').locator('.app').waitFor();
    assert.equal(requests, 2, 'expired advisory presentation must be read again before first opening');
    await page.evaluate(() => document.querySelector('insignia-buyer')?.remove());
    assert.equal(await page.locator('dialog').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.style.overflow), '');
    const queued = deferred();
    const release = deferred();
    let aborted = false;
    page.on('requestfailed', (request) => {
      if (request.url().includes('/v1/config')) aborted = true;
    });
    await page.route('**/apps/insignia/v1/config*', async (route) => {
      queued.resolve();
      await release.promise;
      await route.fulfill({ json: config }).catch(() => {});
    });
    await page.evaluate(() => {
      document.body.innerHTML = '<insignia-buyer product-id="111"></insignia-buyer>';
      Reflect.get(window, '__idle')?.();
    });
    await queued.promise;
    const failed = page.waitForEvent('requestfailed', (request) => request.url().includes('/v1/config'));
    await page.evaluate(() => document.querySelector('insignia-buyer')?.remove());
    release.resolve();
    await failed;
    assert.equal(aborted, true);
    assert.equal(await page.locator('dialog').count(), 0);
  });

for (const engine of [chromium, firefox])
  test(`${engine.name()}: failed background stylesheet keeps the theme usable and a real click initializes a fresh frame`, {
    timeout: BROWSER_TEST_TIMEOUT_MS,
  }, async (t) => {
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
    const page = await browser.newPage();
    let clicked = false;
    await page.route('**/apps/insignia/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/v1/sessions') && clicked) return route.fulfill(sessionGrant());
      assert.match(path, /\/v1\/config$/, 'background failure must not read private state');
      return route.fulfill({ json: config });
    });
    const blockedStyles: string[] = [];
    await page.route('**/insignia-designer.css', (route) => {
      blockedStyles.push(route.request().url());
      return route.abort();
    });
    await page.route('https://preview.example/**', (route) =>
      route.fulfill({
        contentType: 'image/png',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
          'base64',
        ),
      }),
    );
    await page.goto(`http://127.0.0.1:${serverPort(server.httpServer)}`);
    await page.evaluate(async () => {
      await customElements.whenDefined('insignia-buyer');
      document.body.innerHTML =
        '<button id="theme-focus">Theme</button><insignia-buyer product-id="111"></insignia-buyer>';
      document.getElementById('theme-focus')?.focus();
    });
    await page.waitForFunction(
      () => !!document.querySelector('dialog > div')?.shadowRoot?.querySelector('[role=alert]'),
    );
    assert.ok(blockedStyles.length > 0, 'exercise an actual failed stylesheet request');
    assert.equal(await page.locator('dialog:modal').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'theme-focus');
    assert.equal(await page.evaluate(() => document.documentElement.style.overflow), '');
    await page.locator('iframe').evaluate((frame) => {
      frame.id = 'failed-background-frame';
    });
    await page.unroute('**/insignia-designer.css');
    clicked = true;
    await page.locator('insignia-buyer button').click();
    await page.frameLocator('dialog:modal > iframe[srcdoc]').locator('.app').waitFor();
    assert.equal(await page.locator('#failed-background-frame').count(), 0);
    assert.equal(await page.locator('iframe').count(), 1);
    assert.equal(await page.getByRole('alert').count(), 0);
  });

for (const engine of [chromium, firefox])
  test(`${engine.name()}: failed background photos stop preparation instead of refreshing rotating URLs`, {
    timeout: BROWSER_TEST_TIMEOUT_MS,
  }, async (t) => {
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
    const page = await browser.newPage();
    let reads = 0;
    let photosBlocked = true;
    await page.route('**/apps/insignia/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/v1/sessions') && !photosBlocked) return route.fulfill(sessionGrant());
      assert.match(path, /\/v1\/config$/, 'background failure must never read private state');
      const source = structuredClone(config);
      source.imageUrls.photo = `https://preview.example/rotating-${++reads}.png`;
      return route.fulfill({ json: source });
    });
    await page.route('https://preview.example/**', (route) =>
      photosBlocked
        ? route.abort()
        : route.fulfill({
            contentType: 'image/png',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
              'base64',
            ),
          }),
    );
    await page.goto(`http://127.0.0.1:${serverPort(server.httpServer)}`);
    const failed = page.waitForEvent('requestfailed', (request) =>
      request.url().startsWith('https://preview.example/'),
    );
    await page.evaluate(async () => {
      await customElements.whenDefined('insignia-buyer');
      document.body.innerHTML =
        '<button id="theme-focus">Theme</button><insignia-buyer product-id="111"></insignia-buyer>';
      document.getElementById('theme-focus')?.focus();
    });
    await failed;
    await page.waitForLoadState('networkidle', { timeout: 3000 });
    assert.equal(reads, 1, 'new signed URLs must not turn an idle failed photo into a refresh loop');
    assert.equal(await page.locator('dialog:modal').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'theme-focus');
    assert.equal(await page.evaluate(() => document.documentElement.style.overflow), '');
    await page.locator('iframe').evaluate((frame) => {
      frame.id = 'failed-photo-frame';
    });
    photosBlocked = false;
    await page.locator('insignia-buyer button').click();
    const active = page.frameLocator('dialog:modal > iframe[srcdoc]');
    await active.locator('.app').waitFor();
    await active.locator('.garment-photo').evaluate(async (photo: HTMLImageElement) => photo.decode());
    assert.equal(await page.locator('#failed-photo-frame').count(), 0);
    assert.equal(await page.locator('iframe').count(), 1);
  });

for (const engine of [chromium, firefox])
  test(`${engine.name()}: one visible idle owner yields to explicit intent without retiring an opened Designer`, {
    timeout: BROWSER_TEST_TIMEOUT_MS,
  }, async (t) => {
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
    const page = await browser.newPage();
    await page.addInitScript(() => {
      let next = 0;
      const idle = new Map<number, IdleRequestCallback>();
      Reflect.set(window, '__runIdle', () => {
        const callbacks = [...idle.values()];
        idle.clear();
        for (const callback of callbacks) callback({ didTimeout: false, timeRemaining: () => 10 });
      });
      window.requestIdleCallback = (callback) => {
        const id = ++next;
        idle.set(id, callback);
        return id;
      };
      window.cancelIdleCallback = (id) => {
        idle.delete(id);
      };
    });
    const reads: string[] = [];
    let sessions = 0;
    await page.route('**/apps/insignia/**', (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/v1/sessions')) {
        sessions++;
        return route.fulfill(sessionGrant());
      }
      assert.match(url.pathname, /\/v1\/config$/, 'preparation must not establish sessions or read private custody');
      const id = url.searchParams.get('productId') ?? '';
      reads.push(id);
      return route.fulfill({
        json: { ...config, productId: id, title: id === '111' ? 'First shirt' : 'Second shirt' },
      });
    });
    await page.route('https://preview.example/**', (route) =>
      route.fulfill({
        contentType: 'image/png',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
          'base64',
        ),
      }),
    );
    await page.goto(`http://127.0.0.1:${serverPort(server.httpServer)}`);
    await page.evaluate(async () => {
      await customElements.whenDefined('insignia-buyer');
      document.body.innerHTML =
        '<button id="theme-focus">Theme</button><insignia-buyer product-id="113"><button slot="trigger" style="position:fixed;left:-4000px">Offscreen</button></insignia-buyer><insignia-buyer product-id="111"></insignia-buyer><insignia-buyer product-id="112"></insignia-buyer>';
      document.getElementById('theme-focus')?.focus();
      const modal = document.createElement('dialog');
      modal.id = 'existing-theme-modal';
      document.body.append(modal);
      modal.showModal();
      Reflect.get(window, '__runIdle')();
    });
    assert.deepEqual(reads, [], 'an existing modal suppresses automatic preparation');
    assert.equal(await page.locator('iframe').count(), 0);
    await page.evaluate(() => {
      const modal = document.getElementById('existing-theme-modal') as HTMLDialogElement;
      modal.close();
      modal.remove();
      for (const buyer of document.querySelectorAll('insignia-buyer')) {
        buyer.remove();
        document.body.append(buyer);
      }
      document.getElementById('theme-focus')?.focus();
      Reflect.get(window, '__runIdle')();
    });
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLIFrameElement>('dialog[aria-label="First shirt"] > iframe')?.style.visibility ===
        'visible',
    );
    // Wait for this owner's completed preparation, not the page-wide network-idle
    // lifecycle: Firefox can lose that idle timer while replacing a srcdoc frame.
    await page.waitForFunction(() => {
      const buyer = document.querySelector('insignia-buyer[product-id="111"]');
      const preparation = buyer && Reflect.get(buyer, 'preparation');
      return preparation?.warm?.ready === true && !preparation.controller.signal.aborted;
    });
    assert.deepEqual(reads, ['111']);
    assert.equal(await page.locator('iframe').count(), 1);
    await page.locator('iframe').evaluate((frame) => {
      frame.id = 'unchanged-context';
    });
    await page.locator('insignia-buyer[product-id="111"]').evaluate((buyer) => buyer.setAttribute('product-id', '111'));
    assert.equal(
      await page.locator('#unchanged-context').count(),
      1,
      'idempotent context assignment preserves prepared state',
    );
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'theme-focus');
    const second = page.locator('insignia-buyer[product-id="112"] button');
    await second.focus();
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLIFrameElement>('dialog[aria-label="Second shirt"] > iframe')?.style.visibility ===
        'visible',
    );
    assert.deepEqual(reads, ['111', '112']);
    assert.equal(await page.locator('dialog[aria-label="First shirt"]').count(), 0);
    assert.equal(await page.locator('iframe').count(), 1);
    assert.equal(await second.evaluate((button) => document.activeElement === button), true);
    assert.equal(await page.locator('dialog:modal').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.style.overflow), '');
    assert.equal(sessions, 0, 'preparing visible or intended controls creates no session');
    await second.click();
    const active = () => page.frameLocator('dialog:modal > iframe[srcdoc]');
    await active().locator('.app').waitFor();
    await page.locator('dialog:modal > iframe').evaluate((frame) => {
      frame.id = 'retained-second';
    });
    await active().getByRole('button', { name: 'Close customizer', exact: true }).click();
    await page.locator('insignia-buyer[product-id="111"] button').click();
    await active().locator('.app').waitFor();
    assert.equal(await active().getByText('First shirt', { exact: true }).count(), 1);
    assert.equal(
      await page.locator('#retained-second').count(),
      1,
      'preparing another product never destroys a retained opened Designer',
    );
    await active().getByRole('button', { name: 'Close customizer', exact: true }).click();
    await second.click();
    await active().locator('.app').waitFor();
    assert.equal(await page.locator('dialog:modal > #retained-second').count(), 1);
    assert.equal(sessions, 1, 'opened Designers share one tab session');
  });

declare global {
  interface Window {
    coldCancellation: { release(): void; fetched: boolean; held: boolean; completed: number };
  }
}

for (const engine of [chromium, firefox]) {
  test(`${engine.name()}: cold opening owns one immediate modal and keeps loading inside its editor shell`, async (t) => {
    const server = await createStorefrontTestServer({
      plugins: [selectedFrameAssets()],
      server: { host: '127.0.0.1', port: 0, hmr: false },
    });
    await server.listen();
    const browser = await engine.launch({ headless: true });
    const hold = deferred();
    t.after(async () => {
      hold.resolve();
      await browser.close();
      await server.close();
    });
    const page = await browser.newPage();
    await page.addInitScript(() => {
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const state = { release, fetched: false, held: false, completed: 0 };
      window.coldCancellation = state;
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const isConfig = String(input).includes('/v1/config');
        if (isConfig) state.fetched = true;
        try {
          return await originalFetch(input, init);
        } catch (error) {
          if (isConfig && init?.signal?.aborted) {
            state.held = true;
            await gate;
          }
          throw error;
        }
      };
    });
    await page.route('**/apps/insignia/v1/config*', async (route) => {
      await hold.promise;
      await route.fulfill({ json: config });
    });
    await page.route('https://preview.example/**', (route) =>
      route.fulfill({
        contentType: 'image/png',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
          'base64',
        ),
      }),
    );
    await page.goto(`http://127.0.0.1:${serverPort(server.httpServer)}`);
    await page.evaluate(async () => {
      await customElements.whenDefined('insignia-buyer');
      document.body.innerHTML = '<insignia-buyer product-id="111" country="US"></insignia-buyer>';
    });
    // Observe completion without changing the opening's result or scheduling.
    await page.evaluate(() => {
      const definition = customElements.get('insignia-buyer');
      if (!definition) throw new Error('Missing buyer element');
      const prototype = definition.prototype as { mount(): Promise<void> };
      const originalMount = prototype.mount;
      prototype.mount = async function () {
        try {
          await originalMount.call(this);
        } finally {
          window.coldCancellation.completed++;
        }
      };
    });
    const trigger = page.locator('insignia-buyer button');
    await trigger.click();
    await page.locator('dialog:modal').waitFor();
    await page.waitForFunction(() => window.coldCancellation.fetched);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.coldCancellation.held);
    await page.locator('dialog:modal').waitFor({ state: 'detached' });
    assert.equal(await trigger.getAttribute('aria-busy'), null);
    assert.equal(await trigger.evaluate((button) => document.activeElement === button), true);
    assert.equal(await page.evaluate(() => document.documentElement.style.overflow), '');
    // Both the cancelled read and the new opening finish after the hold releases.
    // Only the new generation may adopt a frame or retain the scroll lock.
    await trigger.click();
    await page.locator('dialog:modal').waitFor();
    assert.equal(await page.locator('dialog:modal').count(), 1);
    await page.locator('dialog:modal').evaluate((dialog) => {
      dialog.id = 'same-startup-shell';
    });
    // Deliver the cancelled read only after the replacement owns the shell.
    await page.evaluate(() => window.coldCancellation.release());
    await page.waitForFunction(() => window.coldCancellation.completed >= 1);
    assert.equal(await trigger.getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('dialog:modal header').count(), 1);
    assert.equal(await page.locator('dialog:modal .designer-loading-state').count(), 1);
    assert.equal(
      await page.locator('dialog:modal .admin-preview-message').count(),
      0,
      'No separate loading-page composition',
    );
    hold.resolve();
    await page.frameLocator('dialog:modal > iframe[srcdoc]').locator('.app').waitFor();
    await page.waitForFunction(
      () => document.querySelector<HTMLIFrameElement>('dialog:modal > iframe[srcdoc]')?.style.visibility === 'visible',
    );
    assert.equal(
      await page.locator('dialog:modal#same-startup-shell').count(),
      1,
      'The editor adopts the already-open shell',
    );
    assert.equal(await page.locator('dialog:modal').count(), 1);
    assert.equal(await trigger.getAttribute('aria-busy'), null);
    await page
      .frameLocator('dialog:modal > iframe[srcdoc]')
      .getByRole('button', { name: 'Close customizer', exact: true })
      .click();
    await page.locator('dialog:modal').waitFor({ state: 'detached' });
    assert.equal(await page.locator('#same-startup-shell > iframe').isVisible(), false);
    assert.equal(await trigger.evaluate((button) => document.activeElement === button), true);
    assert.equal(await page.evaluate(() => document.documentElement.style.overflow), '');
    assert.equal(await page.locator('iframe').count(), 1, 'Cancelled completion cannot create a second frame');
  });
}
