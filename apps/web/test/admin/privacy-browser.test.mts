import './support/browser-state.mts';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { browserFixture, routePolaris } from './support/selected-browser.mts';

test('merchant can recover a failed privacy lookup and download exact requested data without claiming customer delivery', {
  timeout: 20000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const base = server.base;
  const shell = await fetch(`${base}/admin/settings/privacy`);
  assert.equal(shell.status, 200);
  assert.equal(shell.headers.get('cache-control'), 'private, no-store');
  assert.equal((await shell.text()).includes('2026-10-31'), false, 'bare shell has no private provider facts');
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  page.setDefaultTimeout(5000);
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-privacy-actor' };
  });
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (r) => r.fulfill({ body: '' }));
  await routePolaris(page, source);
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
