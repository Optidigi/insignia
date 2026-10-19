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

test('unlocked storefront loads buyer controls through its cookie-gated proxy and lazy classic CDN bootstrap', async () => {
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
      files.some((file) => /^insignia-customizer-.*\.js$/.test(file)),
      'buyer must remain a dynamic chunk',
    );
    assert.ok(files.length >= 4, 'bootstrap, element, buyer and renderer need separate assets');
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
          response.setHeader('Content-Type', 'text/javascript');
          response.end(await readFile(join(assets, path.slice('/cdn-assets/'.length))));
        } catch {
          response.writeHead(404).end();
        }
      } else {
        response.setHeader('Content-Type', 'text/html');
        response.end(
          `<insignia-buyer product-id="111" proxy-base="/apps/insignia" cart-root="/nl/" country="NL" market-id="m1"></insignia-buyer><script defer src="/cdn-assets/insignia-storefront.js?v=123"></script>`,
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
      await page.route('https://synthetic.invalid/product.png', (route) =>
        route.fulfill({
          contentType: 'image/png',
          body: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lL0AAAAASUVORK5CYII=',
            'base64',
          ),
        }),
      );
      await page.route('**/cart.js', (route) => route.fulfill({ json: { items: [], currency: 'EUR' } }));
      await page.route('**/apps/insignia/v1/config*', (route) => {
        if (!route.request().headers().cookie?.includes('synthetic_storefront_unlock=yes'))
          return route.fulfill({ status: 302, headers: { Location: '/password' }, body: '' });
        return route.fulfill({
          json: {
            version: 'm7-config-v1',
            productId: '111',
            revisionId: 'r1',
            contentHash: 'a'.repeat(64),
            ready: true,
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
            variants: [{ id: '222', label: 'Blue M', available: true }],
            geometry: {
              version: 'm5-geometry-v1',
              views: [
                {
                  id: 'front',
                  image: { revisionId: 'synthetic-image', width: 100, height: 100 },
                  variantImages: [],
                  placements: [{ id: 'front', rect: { centerX: 0.5, centerY: 0.5, width: 0.3, height: 0.3 } }],
                },
              ],
              steps: [{ id: 'small', widthFraction: 0.5, heightFraction: 0.5 }],
            },
            imageUrls: { 'synthetic-image': 'https://synthetic.invalid/product.png' },
          },
        });
      });
      await page.goto(`http://127.0.0.1:${serverPort(server)}/nl/products/example`);
      const host = page.locator('insignia-buyer');
      await host.getByRole('button', { name: 'Customize this product' }).waitFor();
      assert.equal(
        requested.some((path) => path.includes('insignia-customizer-')),
        false,
      );
      assert.equal(
        requested.some((path) => path.includes('insignia-lib-')),
        false,
      );
      const rendererLoad = page.waitForRequest((request) => /insignia-lib-.*\.js$/.test(request.url()), {
        timeout: 5000,
      });
      void rendererLoad.catch(() => {});
      await host.getByRole('button', { name: 'Customize this product' }).click();
      await host.getByRole('dialog').waitFor();
      try {
        await host.getByRole('list', { name: 'Customization steps' }).waitFor({ timeout: 3000 });
      } catch {
        assert.fail(`Customization controls missing: ${await host.getByRole('alert').textContent()}`);
      }
      await rendererLoad;
      assert.ok(requested.some((path) => path.startsWith('/cdn-assets/insignia-customizer-')));
      assert.ok(requested.some((path) => path.startsWith('/cdn-assets/insignia-lib-')));
      assert.ok(requested.every((path) => path.startsWith('/cdn-assets/')));
    } finally {
      await browser?.close();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
