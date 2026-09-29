import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { chromium } from 'playwright';

test('custom element mounts, unmounts, and contains DOM, state and events', async () => {
  const port = 45000 + Math.floor(Math.random() * 1000);
  const child = spawn(new URL('../node_modules/.bin/vite', import.meta.url).pathname, [
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ]);
  const exited = new Promise((resolve) => child.once('close', resolve));
  let stderr = '';
  child.on('error', (error) => {
    stderr += error.message;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    stderr += chunk;
  });
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 100 && !ready && child.exitCode === null; i++) {
      try {
        ready = (await fetch(`http://127.0.0.1:${port}`)).ok;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    assert.ok(ready, stderr);
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
    child.kill('SIGTERM');
    await exited;
  }
});
