import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium } from 'playwright';

const polarisUrl = 'https://cdn.shopify.com/shopifycloud/polaris-1.1.js';
const polarisSha256 = '912455ad068713e7595f5a506fb7433a078554c327cf0fd30ce86ccb214818fe';
const polarisFixture = new URL('./fixtures/polaris-1.1.snapshot', import.meta.url);

async function startServer() {
  const port = 44000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [new URL('../dist/server/entry.mjs', import.meta.url).pathname], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
  });
  const exited = new Promise((resolve) => child.once('close', resolve));
  let stderr = '';
  child.on('error', (error) => {
    stderr += error.message;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    stderr += chunk;
  });
  const base = `http://127.0.0.1:${port}`;
  let live;
  for (let i = 0; i < 100 && !live && child.exitCode === null; i++) {
    try {
      live = await fetch(`${base}/live`);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  assert.ok(live, stderr);
  assert.deepEqual(await live.json(), { status: 'live' });
  return { base, child, exited };
}

function captureDiagnostics(page) {
  const messages = [];
  page.on('pageerror', (error) => messages.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') messages.push(`console error: ${message.text()}`);
  });
  page.on('requestfailed', (request) =>
    messages.push(`request failed: ${request.url()} (${request.failure()?.errorText})`),
  );
  return () => messages.slice(0, 8).join('\n') || 'no script or page errors recorded';
}

async function requireRealPolarisButton(page, diagnostics) {
  try {
    await page.waitForFunction(
      () => {
        const button = document.querySelector('s-button');
        const registered = customElements.get('s-button');
        return Boolean(
          button &&
            registered &&
            registered !== HTMLElement &&
            button instanceof registered &&
            button.isConnected &&
            typeof button.disabled === 'boolean',
        );
      },
      null,
      { timeout: 5000 },
    );
  } catch (error) {
    const state = await page.evaluate(() => {
      const button = document.querySelector('s-button');
      const registered = customElements.get('s-button');
      return {
        registered: Boolean(registered),
        upgraded: Boolean(button && registered && button instanceof registered),
        constructor: button?.constructor.name,
        disabled: button?.disabled,
        script: document.querySelector('script[src*="polaris-1.1.js"]')?.getAttribute('src'),
      };
    });
    throw new Error(`Polaris button not ready within 5s: ${JSON.stringify(state)}\n${diagnostics()}`, { cause: error });
  }
  await page.locator('s-button').click({ timeout: 5000 });
  await page.getByText('Local count: 1').waitFor({ timeout: 5000 });
}

test('built SSR serves public shell and a real Polaris/Preact interaction', async () => {
  const source = await readFile(polarisFixture);
  assert.equal(createHash('sha256').update(source).digest('hex'), polarisSha256);
  const { base, child, exited } = await startServer();
  let browser;
  try {
    const shell = await (await fetch(base)).text();
    assert.match(shell, /Merchant access is not available/);
    assert.doesNotMatch(shell, /shopify-api|access_token|private_key/i);
    browser = await chromium.launch({ headless: true });

    const page = await browser.newPage();
    const diagnostics = captureDiagnostics(page);
    let servedPolaris = 0;
    await page.route(polarisUrl, (route) => {
      servedPolaris++;
      return route.fulfill({ body: source, contentType: 'text/javascript' });
    });
    const interaction = await page.goto(`${base}/local-test/interaction`);
    assert.equal(interaction?.status(), 200);
    assert.equal(await page.locator('script[src*="polaris-1.1.js"]').getAttribute('src'), polarisUrl);
    await requireRealPolarisButton(page, diagnostics);
    assert.equal(servedPolaris, 1, diagnostics());
    assert.equal(await page.getByText('Local count: 1').count(), 1);

    const blocked = await browser.newPage();
    const blockedDiagnostics = captureDiagnostics(blocked);
    let blockedPolaris = 0;
    await blocked.route(polarisUrl, (route) => {
      blockedPolaris++;
      return route.abort('blockedbyclient');
    });
    const blockedResponse = await blocked.goto(`${base}/local-test/interaction`);
    assert.equal(blockedResponse?.status(), 200);
    await assert.rejects(requireRealPolarisButton(blocked, blockedDiagnostics), /Polaris button not ready/);
    assert.equal(blockedPolaris, 1);
    assert.equal(await blocked.evaluate(() => customElements.get('s-button')), undefined);
    await blocked.locator('s-button').click();
    await blocked.getByText('Local count: 1').waitFor();
  } finally {
    await browser?.close();
    child.kill('SIGTERM');
    await exited;
  }
});
