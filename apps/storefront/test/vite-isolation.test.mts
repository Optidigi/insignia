import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium } from 'playwright';
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
    await page.waitForFunction(() => !!customElements.get('insignia-artwork-upload'));
    await first.close();
    await assert.rejects(access(first.config.cacheDir));
    await page.goto(`http://127.0.0.1:${serverPort(second.httpServer)}/`);
    await page.waitForFunction(() => !!customElements.get('insignia-artwork-upload'));
    await access(second.config.cacheDir);
  } finally {
    await browser?.close();
    await first.close();
    await second?.close();
  }
  await assert.rejects(access(first.config.cacheDir));
  if (second) await assert.rejects(access(second.config.cacheDir));
});
