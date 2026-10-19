import './support/browser-state.mts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium } from 'playwright';

test('merchant billing separates development terms and trial, links Shopify management and recovers a failed observation', {
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
  const shell = await fetch(`${base}/admin/settings/billing`);
  assert.equal(shell.status, 200);
  assert.equal(shell.headers.get('cache-control'), 'private, no-store');
  assert.equal((await shell.text()).includes('2026-10-31'), false, 'bare shell has no private provider facts');
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(5000);
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-billing-actor' };
  });
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (r) => r.fulfill({ body: '' }));
  const polaris = await readFile(new URL('../fixtures/polaris-1.1.snapshot', import.meta.url));
  await page.route('https://cdn.shopify.com/shopifycloud/polaris-1.1.js', (r) =>
    r.fulfill({ body: polaris, contentType: 'text/javascript' }),
  );
  await page.route('https://cdn.shopify.com/static/fonts/**', (r) => r.fulfill({ body: '' }));
  const view: import('../../src/shared/billing-view.js').BillingView = {
    status: 'trial',
    observedAt: '2026-10-17T10:00:00.000Z',
    trialEndsAt: '2026-10-31T08:54:46.000Z',
    currentCycle: null,
    scheduledCancellation: false,
    pendingChange: false,
    newActionsAllowed: true,
    standardPrice: { amount: '49.99', currency: 'USD', intervalDays: 30 },
    recurringPrice: { amount: '0.00', currency: 'USD' },
    developmentTerms: true,
    managementUrl: 'https://admin.shopify.com/store/example/charges/insignia-1/pricing_plans',
  };
  let failing = true;
  let calls = 0;
  await page.route('**/api/admin/billing', (route) => {
    calls++;
    assert.equal(route.request().method(), 'GET');
    assert.equal(route.request().headers().authorization, 'Bearer synthetic-billing-actor');
    return failing
      ? route.fulfill({ status: 503, json: { error: 'Billing status unavailable' } })
      : route.fulfill({ json: view });
  });
  await page.goto(`${base}/admin/settings/billing`);
  await page.getByText('Billing status could not be verified. Try again.').waitFor();
  const navigation = page.locator('s-app-nav');
  assert.equal(
    await navigation
      .locator('s-link')
      .filter({ hasText: /^Products$/ })
      .getAttribute('href'),
    '/admin/products',
  );
  assert.equal(
    await navigation
      .locator('s-link')
      .filter({ hasText: /^Orders$/ })
      .getAttribute('href'),
    '/admin/orders',
  );
  assert.equal(
    await navigation
      .locator('s-link')
      .filter({ hasText: /^Settings$/ })
      .getAttribute('href'),
    '/admin/settings',
  );
  assert.equal(await page.locator('s-text[data-date-time]').count(), 0);
  failing = false;
  await page.getByRole('button', { name: 'Refresh billing status' }).click();
  await page.getByText('Development test terms: USD 0.00 per 30 days.').waitFor();
  await page.getByText('Subscription price: USD 49.99 per 30 days.').waitFor();
  await page.getByText('Trial active').waitFor();
  assert.equal(await page.locator('s-text[data-date-time]').first().getAttribute('data-date-time'), view.trialEndsAt);
  const manage = page.getByRole('link', { name: 'Manage billing in Shopify' });
  assert.equal(await manage.getAttribute('href'), view.managementUrl);
  assert.equal(await manage.getAttribute('target'), '_top');
  assert.equal(await page.getByText(/unlimited/i).count(), 0);
  await page.screenshot({ path: '/tmp/insignia-lean-local-billing-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'billing fits a narrow merchant viewport',
  );
  await page.screenshot({ path: '/tmp/insignia-lean-local-billing-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  view.status = 'inactive';
  view.trialEndsAt = null;
  view.recurringPrice = null;
  view.developmentTerms = false;
  view.newActionsAllowed = false;
  await page.getByRole('button', { name: 'Refresh billing status' }).click();
  await page.getByText('No active subscription', { exact: true }).waitFor();
  assert.equal(await page.getByText('Trial active', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Development test terms: USD 0.00 per 30 days.').count(), 0);
  await page.getByText('New customization offers and publication are unavailable.', { exact: false }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Manage billing in Shopify' }).count(), 1);
  assert.equal(calls, 3);
});
