import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { build } from 'vite';
import { copyThemeAssets } from '../scripts/copy-theme-asset.mts';
import config from '../vite.config.ts';
import { serverPort } from './support.mts';

test('unlocked storefront loads buyer controls through its cookie-gated proxy and public-only idle CDN preparation', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'insignia-theme-build-'));
  try {
    await build({
      ...config,
      root: new URL('..', import.meta.url).pathname,
      logLevel: 'silent',
      build: { ...config.build, outDir: temporary },
    });
    const files = await readdir(temporary);
    assert.ok(files.includes('insignia-element.js'), 'separate ES entry must exist');
    assert.ok(
      files.some((file) => /^insignia-controller-.*\.js$/.test(file)),
      'the real storefront controller must remain a dynamic chunk',
    );
    assert.ok(files.includes('insignia-designer-frame.js'), 'the selected Designer has a separate iframe entry');
    assert.ok(files.includes('insignia-designer.css'), 'the selected Designer stylesheet ships with its frame');
    assert.equal(
      files.some((file) => file.startsWith('insignia-customizer-')),
      false,
      'No retired customizer host is packaged',
    );
    assert.ok(files.length >= 6, 'bootstrap, element, buyer, controller and Designer assets stay separate');
    const classic = await readFile(join(temporary, 'insignia-storefront.js'), 'utf8');
    assert.match(classic, /currentScript/);
    assert.match(classic, /import\(/);
    assert.match(classic, /insignia-element\.js/);
    const assets = join(temporary, 'theme-assets');
    const copied = await copyThemeAssets({ from: temporary, to: assets });
    assert.deepEqual(copied.sort(), files.sort());
    await writeFile(join(assets, 'insignia-previous-hash.js'), '// older cached entry dependency');
    const otherOutput = await mkdtemp(join(tmpdir(), 'insignia-theme-copy-'));
    try {
      // Simulate the next copy without treating prior hashed assets as disposable.
      for (const file of files) await writeFile(join(otherOutput, file), await readFile(join(temporary, file)));
      await copyThemeAssets({ from: otherOutput, to: assets });
      assert.match(await readFile(join(assets, 'insignia-previous-hash.js'), 'utf8'), /older/);
    } finally {
      await rm(otherOutput, { recursive: true, force: true });
    }
    const server = createServer(async (request, response) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (path.startsWith('/cdn-assets/')) {
        try {
          response.setHeader('Content-Type', path.endsWith('.css') ? 'text/css' : 'text/javascript');
          response.end(await readFile(join(assets, path.slice('/cdn-assets/'.length))));
        } catch {
          response.writeHead(404).end();
        }
      } else {
        response.setHeader('Content-Type', 'text/html');
        response.end(
          `<!doctype html><html lang="en"><head><style>body{font-family:serif}</style></head><body><insignia-buyer product-id="111" proxy-base="/apps/insignia" cart-root="/nl/" country="NL" market-id="42"></insignia-buyer><script defer src="/cdn-assets/insignia-storefront.js?v=123"></script></body></html>`,
        );
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page
        .context()
        .addCookies([
          { name: 'synthetic_storefront_unlock', value: 'yes', url: `http://127.0.0.1:${serverPort(server)}` },
        ]);
      const requested: string[] = [];
      page.on('request', (request) => {
        if (new URL(request.url()).pathname.split('/').at(-1)?.startsWith('insignia-'))
          requested.push(new URL(request.url()).pathname);
      });
      const photo = await readFile(
        new URL(
          '../../../frontend/admin/examples/admin/support/assets/legacy-catalog/hoodie-front.jpg',
          import.meta.url,
        ),
      );
      await page.route('https://synthetic.invalid/captured/hoodie-front.jpg', (route) =>
        route.fulfill({ contentType: 'image/jpeg', body: photo }),
      );
      const ordinary = [
        { key: 'ordinary', variant_id: 999, product_id: 888, quantity: 2, properties: { gift: 'keep' } },
      ];
      const originalOrdinary = structuredClone(ordinary);
      let cartReads = 0;
      const cartWrites: string[] = [];
      const proxyMutations: string[] = [];
      const privateProxyReads: string[] = [];
      await page.route('**/cart.js', (route) => {
        cartReads++;
        return route.fulfill({ json: { items: ordinary, attributes: {}, currency: 'EUR' } });
      });
      await page.route(/\/cart\/(?:add|update|change)\.js(?:\?.*)?$/, (route) => {
        cartWrites.push(route.request().method());
        return route.fulfill({ status: 409, json: { error: 'Bootstrap cannot mutate a cart' } });
      });
      await page.route('**/apps/insignia/v1/**', (route) => {
        if (route.request().method() !== 'GET')
          proxyMutations.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
        else privateProxyReads.push(new URL(route.request().url()).pathname);
        return route.fulfill({ status: 503, json: { error: 'Bootstrap cannot allocate private commerce authority' } });
      });
      let lockedRequests = 0,
        unlockedRequests = 0;
      await page.route('**/apps/insignia/v1/config*', (route) => {
        assert.equal(route.request().method(), 'GET');
        const query = new URL(route.request().url()).searchParams;
        assert.equal(query.get('productId'), '111');
        assert.equal(query.get('country'), 'NL');
        if (!route.request().headers().cookie?.includes('synthetic_storefront_unlock=yes')) {
          lockedRequests++;
          return route.fulfill({ status: 302, headers: { Location: '/password' }, body: '' });
        }
        unlockedRequests++;
        return route.fulfill({
          json: {
            version: 'm7-config-v1',
            productId: '111',
            revisionId: 'r1',
            contentHash: 'a'.repeat(64),
            ready: true,
            title: 'Synthetic published hoodie',
            shopCurrency: 'EUR',
            decorationPrices: [{ placementId: 'front', methodId: 'print', stepId: 'small', minor: '350' }],
            wording: { wordingVersion: '0', overlays: { en: { locale: 'en', messages: {} } } },
            methods: [{ id: 'print', label: 'Print' }],
            placements: [
              {
                id: 'front',
                label: 'Front',
                allowedMethodIds: ['print'],
                allowedStepIds: ['small'],
                logoLaterAllowed: true,
              },
            ],
            steps: [{ id: 'small', label: 'Small' }],
            options: [],
            variants: [
              {
                id: '222',
                label: 'Blue M',
                available: true,
                selectedOptions: [
                  { name: 'Color', value: 'Blue' },
                  { name: 'Size', value: 'M' },
                ],
                baseUnitMinor: '2000',
              },
            ],
            geometry: {
              version: 'm5-geometry-v1',
              views: [
                {
                  id: 'front',
                  image: { revisionId: 'synthetic-image', width: 1000, height: 1000 },
                  variantImages: [],
                  placements: [{ id: 'front', rect: { centerX: 0.5, centerY: 0.5, width: 0.3, height: 0.3 } }],
                },
              ],
              steps: [{ id: 'small', widthFraction: 0.5, heightFraction: 0.5, physicalMm: { width: 50, height: 50 } }],
            },
            imageUrls: { 'synthetic-image': 'https://synthetic.invalid/captured/hoodie-front.jpg' },
          },
        });
      });
      await page.goto(`http://127.0.0.1:${serverPort(server)}/nl/products/example`);
      const host = page.locator('insignia-buyer');
      await host.getByRole('button', { name: 'Customize this product' }).waitFor();
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLIFrameElement>('dialog:not([open]) > iframe[srcdoc]')?.style.visibility ===
          'visible',
      );
      const preparedFrame = page.locator('dialog:not([open]) > iframe[srcdoc]');
      assert.equal(await preparedFrame.count(), 1, 'The built CDN entry prepares the selected frame on idle');
      await preparedFrame.evaluate((element) => {
        element.id = 'synthetic-prepared-frame';
      });
      assert.equal(await page.locator('dialog:modal').count(), 0, 'Preparation never opens a modal');
      assert.equal(await page.locator('dialog').evaluate((element: HTMLDialogElement) => element.inert), true);
      assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'BODY');
      assert.equal(await page.evaluate(() => document.documentElement.style.overflow), '');
      assert.deepEqual(privateProxyReads, [], 'Idle preparation never reads private commerce authority');
      assert.deepEqual(proxyMutations, [], 'Idle preparation never establishes a buyer session or writes a draft');
      assert.equal(cartReads, 0);
      assert.deepEqual(cartWrites, []);
      assert.equal(
        await page.evaluate(async () => {
          try {
            await fetch('/apps/insignia/v1/config?productId=111&country=NL', {
              credentials: 'omit',
              redirect: 'error',
            });
            return 'unexpected-config';
          } catch {
            return 'blocked';
          }
        }),
        'blocked',
        'Without the storefront unlock cookie the proxy cannot expose configuration',
      );
      assert.equal(lockedRequests, 1);
      await host.getByRole('button', { name: 'Customize this product' }).click();
      assert.equal(
        await page.locator('dialog:modal > #synthetic-prepared-frame').count(),
        1,
        'The real click reveals the same prepared frame',
      );
      const iframe = page.locator('iframe');
      const frame = page.frameLocator('iframe');
      await frame.getByRole('navigation', { name: 'Design steps', exact: true }).waitFor();
      await frame.getByRole('heading', { name: 'Synthetic published hoodie', exact: true }).waitFor();
      assert.equal(await iframe.getAttribute('sandbox'), 'allow-scripts allow-same-origin');
      assert.equal(await iframe.getAttribute('title'), 'Synthetic published hoodie');
      assert.match(await frame.locator('.app').evaluate((element) => getComputedStyle(element).fontFamily), /Inter/);
      assert.equal(
        await page.locator('body').evaluate((element) => getComputedStyle(element).fontFamily),
        'serif',
        'Designer CSS stays inside its iframe',
      );
      assert.ok(requested.some((path) => path.startsWith('/cdn-assets/insignia-controller-')));
      assert.ok(requested.includes('/cdn-assets/insignia-designer-frame.js'));
      assert.ok(requested.includes('/cdn-assets/insignia-designer.css'));
      assert.ok(
        requested.every((path) => path.startsWith('/cdn-assets/')),
        'All runtime assets resolve beside the trusted classic CDN entry, not the locale/product URL',
      );
      assert.equal(unlockedRequests, 1);
      await page.evaluate(() => {
        const seen: unknown[] = [];
        Reflect.set(window, 'syntheticProtocolEvents', seen);
        window.addEventListener('message', (event) => {
          if (event.data?.probe) seen.push(event.data.probe);
        });
        const current = document.querySelector('iframe');
        if (!current?.contentWindow) throw Error('Missing real Designer frame');
        window.postMessage(
          { type: 'insignia:designer:closed', channel: current.name, probe: 'wrong-source' },
          location.origin,
        );
        window.dispatchEvent(
          new MessageEvent('message', {
            origin: 'https://foreign.invalid',
            source: current.contentWindow,
            data: { type: 'insignia:designer:closed', channel: current.name, probe: 'wrong-origin' },
          }),
        );
      });
      await frame.locator('body').evaluate(() => {
        window.parent.postMessage(
          { type: 'insignia:designer:closed', channel: 'wrong-nonce', probe: 'wrong-channel' },
          new URL(document.referrer).origin,
        );
        window.addEventListener('message', (event) => {
          if (event.data?.probe === 'wrong-frame-channel')
            window.parent.postMessage({ probe: 'wrong-frame-channel-observed' }, new URL(document.referrer).origin);
        });
      });
      await page.evaluate(() => {
        const current = document.querySelector('iframe');
        if (!current?.contentWindow) throw Error('Missing real Designer frame');
        current.contentWindow.postMessage(
          {
            type: 'insignia:designer:repair',
            channel: 'wrong-nonce',
            repair: { cause: 'unavailable', canRemoveAll: true },
            probe: 'wrong-frame-channel',
          },
          location.origin,
        );
      });
      await page.waitForFunction(() => {
        const seen = Reflect.get(window, 'syntheticProtocolEvents');
        return (
          Array.isArray(seen) &&
          ['wrong-source', 'wrong-origin', 'wrong-channel', 'wrong-frame-channel-observed'].every((probe) =>
            seen.includes(probe),
          )
        );
      });
      await frame
        .locator('body')
        .evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
      assert.equal(await iframe.isVisible(), true, 'Foreign source/origin/channel cannot close the active Designer');
      assert.equal(
        await frame.locator('.app').isVisible(),
        true,
        'An invalid parent nonce cannot replace the Designer with repair UI',
      );
      assert.deepEqual(cartWrites, []);
      // Opening warms the tab's buyer session once (here refused); it writes no draft or quote.
      const warmed = ['POST /apps/insignia/v1/sessions'];
      assert.deepEqual(proxyMutations, warmed);
      assert.deepEqual(privateProxyReads, []);
      assert.equal(cartReads, 0, 'Opening the unmodified product does not inspect or mutate an ordinary cart');
      assert.deepEqual(ordinary, originalOrdinary);
      await frame.getByRole('button', { name: 'Close customizer', exact: true }).click();
      await iframe.waitFor({ state: 'hidden' });
      assert.equal(
        await host
          .getByRole('button', { name: 'Customize this product' })
          .evaluate((element) => element.matches(':focus')),
        true,
        'A valid frame close restores the actual trigger focus',
      );
      assert.deepEqual(cartWrites, []);
      assert.deepEqual(proxyMutations, warmed);
      assert.deepEqual(ordinary, originalOrdinary);
    } finally {
      await browser?.close();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
