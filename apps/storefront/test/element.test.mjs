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
