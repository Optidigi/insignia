import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium } from 'playwright';
import type { Plugin } from 'vite';
import { createStorefrontTestServer as createServer, selectedFrameAssets, serverPort } from './support.mts';

test('parallel storefront servers own independent optimizer caches and survive another fixture closing', async () => {
  const first = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: true } });
  let second: Awaited<ReturnType<typeof createServer>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    second = await createServer({
      plugins: [selectedFrameAssets()],
      server: { host: '127.0.0.1', port: 0, strictPort: true },
    });
    assert.notEqual(
      first.config.cacheDir,
      second.config.cacheDir,
      'different fixture configurations must not invalidate each other’s module cache',
    );
    await Promise.all([first.listen(), second.listen()]);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${serverPort(first.httpServer)}/`);
    await page.waitForFunction(() => !!customElements.get('insignia-buyer'));
    await first.close();
    await assert.rejects(access(first.config.cacheDir));
    await page.goto(`http://127.0.0.1:${serverPort(second.httpServer)}/`);
    await page.waitForFunction(() => !!customElements.get('insignia-buyer'));
    await access(second.config.cacheDir);
  } finally {
    await browser?.close();
    await first.close();
    await second?.close();
  }
  await assert.rejects(access(first.config.cacheDir));
  if (second) await assert.rejects(access(second.config.cacheDir));
});

test('a fixture closed while its post-scan dependency bundle runs leaves no optimizer write behind', {
  timeout: 30_000,
}, async () => {
  let bundleStart!: () => void;
  let bundleClose!: () => void;
  const bundleStarted = new Promise<void>((resolve) => {
    bundleStart = resolve;
  });
  const bundleClosed = new Promise<void>((resolve) => {
    bundleClose = resolve;
  });
  let bundling = false;
  let bundleEndedBeforeClose = false;
  // Vite runs these plugins in its dependency scan too; only the bundle's input is a dependency record.
  const observer: Plugin = {
    name: 'observe-dependency-bundle',
    buildStart(options) {
      if (Array.isArray(options.input)) return;
      bundling = true;
      bundleStart();
    },
    closeBundle() {
      if (!bundling) return;
      bundling = false;
      bundleClose();
    },
  };
  const server = await createServer({
    logLevel: 'silent',
    optimizeDeps: { rolldownOptions: { plugins: [observer] } },
    server: { host: '127.0.0.1', port: 0, strictPort: true },
  });
  try {
    await server.listen();
    // With no requests the crawl ends first, so Vite's crawl-end handler, not close(), owns the scan's bundle.
    await server.environments.client.waitForRequestsIdle();
    await bundleStarted;
    bundleEndedBeforeClose = !bundling;
  } finally {
    await server.close();
  }
  assert.equal(bundleEndedBeforeClose, false, 'the fixture must close while the dependency bundle is in flight');
  await assert.rejects(access(server.config.cacheDir));
  await bundleClosed;
  await assert.rejects(access(server.config.cacheDir), 'a closed fixture must not recreate its optimizer cache');
});
