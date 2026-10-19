import './support/browser-state.mts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium } from 'playwright';

test('merchant can recover a failed privacy lookup and download exact requested data without claiming customer delivery', {
  timeout: 20000,
}, async (t) => {
  const child = spawn(process.execPath, [new URL('../../dist/server/entry.mjs', import.meta.url).pathname], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', SHOPIFY_CLIENT_ID: '11111111111111111111111111111111' },
  });
  let log = '';
  child.stdout.on('data', (part) => {
    log += part;
  });
  child.stderr.on('data', (part) => {
    log += part;
  });
  const exited = new Promise((resolve) => child.once('close', resolve));
  t.after(async () => {
    child.kill('SIGTERM');
    await exited;
  });
  let base: string | undefined;
  for (let i = 0; i < 100; i++) {
    base = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (base) {
      try {
        if ((await fetch(`${base}/live`)).ok) break;
      } catch {}
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(base, log);
  const shell = await fetch(`${base}/admin/settings/privacy`);
  assert.equal(shell.status, 200);
  assert.equal(shell.headers.get('cache-control'), 'private, no-store');
  assert.equal((await shell.text()).includes('2026-10-31'), false, 'bare shell has no private provider facts');
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(5000);
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-privacy-actor' };
  });
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (r) => r.fulfill({ body: '' }));
  const polaris = await readFile(new URL('../fixtures/polaris-1.1.snapshot', import.meta.url));
  await page.route('https://cdn.shopify.com/shopifycloud/polaris-1.1.js', (r) =>
    r.fulfill({ body: polaris, contentType: 'text/javascript' }),
  );
  await page.route('https://cdn.shopify.com/static/fonts/**', (r) => r.fulfill({ body: '' }));
  const inbox = '83cec3c3-6010-4941-9743-99ea655a9999',
    purchase = '9f959f81-f169-4848-a190-0b0059db8888';
  const receipt = {
    inboxId: inbox,
    requestId: '19',
    receivedAt: '2026-10-17T10:00:00Z',
    fulfillBy: '2026-11-16T10:00:00Z',
    requestedOrderCount: 1,
  };
  let failing = true;
  let denied = false;
  await page.route('**/api/purchases/v1/privacy**', (route) => {
    assert.equal(route.request().headers().authorization, 'Bearer synthetic-privacy-actor');
    const path = new URL(route.request().url()).pathname;
    if (denied) return route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } });
    if (failing) return route.fulfill({ status: 503, json: { code: 'UNAVAILABLE' } });
    if (path.endsWith('/privacy')) return route.fulfill({ json: { items: [receipt] } });
    if (path.endsWith(`/orders/${purchase}`))
      return route.fulfill({ json: { order: { originalTotalMinor: '2001' }, designs: [] } });
    return route.fulfill({
      json: { ...receipt, orders: [{ orderId: 'gid://shopify/Order/909', purchaseId: purchase }] },
    });
  });
  await page.goto(`${base}/admin/settings/privacy`);
  await page.getByRole('alert').waitFor();
  failing = false;
  await page.getByRole('button', { name: 'Refresh requests' }).click();
  await page.getByRole('button', { name: 'Open request' }).click();
  await page.getByRole('link', { name: 'Original artwork and retained preview' }).waitFor();
  await page.screenshot({ path: '/tmp/insignia-canonical-privacy-desktop.png', fullPage: true });
  assert.equal(
    await page.getByRole('link', { name: 'Original artwork and retained preview' }).getAttribute('href'),
    `/admin/orders/${purchase}`,
  );
  await page.getByText('Downloading here does not confirm delivery to the customer.', { exact: false }).waitFor();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download order data' }).click();
  const download = await downloaded;
  assert.equal(download.suggestedFilename(), `insignia-order-${purchase}.json`);
  assert.deepEqual(JSON.parse(await readFile(await download.path(), 'utf8')), {
    order: { originalTotalMinor: '2001' },
    designs: [],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '/tmp/insignia-canonical-privacy-mobile.png', fullPage: true });
  denied = true;
  await page.getByRole('button', { name: 'Open request', exact: true }).click();
  await page
    .locator('s-banner')
    .filter({ hasText: 'Reopen Insignia from Shopify Admin to verify your access.' })
    .waitFor();
  await page.screenshot({ path: '/tmp/insignia-canonical-privacy-denied-mobile.png', fullPage: true });
  assert.equal(await page.getByRole('button', { name: 'Open request', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Download request summary (JSON)', exact: true }).count(), 0);
  assert.equal(await page.getByRole('link', { name: 'Original artwork and retained preview', exact: true }).count(), 0);
});
