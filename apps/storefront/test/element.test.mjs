import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { createServer } from 'vite';

test('custom element mounts, unmounts, and contains DOM, state and events', async () => {
  // Bind an OS-assigned port on the server itself: no random-port collision or
  // gap between probing an unused port and taking ownership of it.
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: true } });
  let browser;
  try {
    await server.listen();
    const address = server.httpServer.address();
    assert.ok(address && typeof address === 'object');
    const port = address.port;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}`);
    await page.getByRole('button', { name: 'Mount', exact: true }).click();
    const first = page.locator('insignia-local-preview').first();
    await first.locator('button').click();
    assert.equal(await first.locator('output').textContent(), '1');
    assert.equal(await page.locator('#preview-slot > button').count(), 0);
    const observed = await page.evaluate(() => {
      const host = document.querySelector('insignia-local-preview');
      let onHost = 0;
      let onDocument = 0;
      host.addEventListener('insignia-local-change', () => onHost++);
      document.addEventListener('insignia-local-change', () => onDocument++);
      host.shadowRoot.querySelector('button').click();
      return { onHost, onDocument };
    });
    assert.deepEqual(observed, { onHost: 1, onDocument: 0 });
    await page.getByRole('button', { name: 'Mount', exact: true }).click();
    const second = page.locator('insignia-local-preview').nth(1);
    assert.equal(await second.locator('output').textContent(), '0');
    await page.getByRole('button', { name: 'Unmount' }).click();
    assert.equal(await page.locator('insignia-local-preview').count(), 1);
    assert.equal(await page.locator('insignia-local-preview output').count(), 1);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test('guest artwork selection event survives derivative renewal and carries no private URL or capability', async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: true } });
  let browser;
  try {
    await server.listen();
    const address = server.httpServer.address();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.clock.install();
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const assetExpiresAt = await page.evaluate(() => new Date(Date.now() + 7 * 86400000).toISOString());
    let previewReads = 0;
    let admissions = 0;
    let denied = false;
    await page.route('**/apps/insignia/guest/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const now = await page.evaluate(() => Date.now());
      if (path.endsWith('/session'))
        return route.fulfill({ json: { token: 'abc.def', expiresAt: new Date(now + 4 * 3600000).toISOString() } });
      assert.equal(route.request().headers().authorization, undefined);
      assert.equal(route.request().postDataJSON().capability, 'abc.def');
      if (denied) return route.fulfill({ status: 403 });
      if (path === '/apps/insignia/guest') {
        admissions++;
        return route.fulfill({
          json: {
            assetId: id,
            expiresAt: assetExpiresAt,
            upload: { url: 'https://private.example/q', headers: { 'Content-Type': 'image/svg+xml' } },
          },
        });
      }
      if (path.endsWith('/status')) return route.fulfill({ json: { state: 'USABLE', expiresAt: assetExpiresAt } });
      if (path.endsWith('/preview')) {
        if (++previewReads === 2) return route.fulfill({ status: 503 });
        return route.fulfill({
          json: {
            url: `https://private.example/p-${previewReads}.png`,
            width: 10,
            height: 10,
            expiresAt: new Date(now + 60000).toISOString(),
          },
        });
      }
      return route.fulfill({ json: {} });
    });
    await page.route('https://private.example/q', (route) =>
      route.fulfill({
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'PUT',
          'Access-Control-Allow-Headers': 'content-type',
        },
      }),
    );
    await page.route('**/apps/insignia/guest', async (route) => {
      assert.equal(route.request().postDataJSON().capability, 'abc.def');
      admissions++;
      return route.fulfill({
        json: {
          assetId: id,
          expiresAt: assetExpiresAt,
          upload: { url: 'https://private.example/q', headers: { 'Content-Type': 'image/svg+xml' } },
        },
      });
    });
    await page.evaluate(() => {
      window.selections = [];
      const host = document.createElement('insignia-artwork-upload');
      host.setAttribute('product-id', '111');
      host.addEventListener('insignia-artwork-change', (e) => window.selections.push(e.detail));
      document.body.append(host);
    });
    const host = page.locator('insignia-artwork-upload');
    await host
      .locator('input[type=file]')
      .setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
    await host.getByRole('img').waitFor();
    await page.clock.fastForward(61000);
    await host.getByText('Artwork request unavailable').waitFor();
    assert.equal(await host.getByRole('img').count(), 0);
    assert.deepEqual(await page.evaluate(() => window.selections.at(-1)), {
      assetId: id,
      expiresAt: assetExpiresAt,
    });
    await host.getByRole('button', { name: 'Retry artwork preview' }).click();
    await host.getByText('Artwork preview renewed.').waitFor();
    assert.equal(admissions, 1);
    assert.equal(await page.evaluate(() => window.selections.filter(Boolean).length), 1);
    denied = true;
    await page.clock.fastForward(61000);
    await host.getByText('Artwork request unavailable').waitFor();
    assert.equal(await page.evaluate(() => window.selections.at(-1)), null);
    assert.equal(await host.getByRole('button', { name: 'Prepare original download' }).count(), 0);
  } finally {
    await browser?.close();
    await server.close();
  }
});
