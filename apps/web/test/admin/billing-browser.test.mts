import './support/browser-state.mts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserFixture, routePolaris } from './support/selected-browser.mts';

test('merchant billing shows current monthly and annual terms, links Shopify management and recovers a failed observation', {
  timeout: 20000,
}, async (t) => {
  const { source, server, browser } = await browserFixture(t);
  const base = server.base;
  const shell = await fetch(`${base}/admin/settings/billing`);
  assert.equal(shell.status, 200);
  assert.equal(shell.headers.get('cache-control'), 'private, no-store');
  assert.equal((await shell.text()).includes('2026-10-31'), false, 'bare shell has no private provider facts');
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  page.setDefaultTimeout(5000);
  await page.addInitScript(() => {
    window.shopify = { idToken: async () => 'synthetic-billing-actor' };
  });
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (r) => r.fulfill({ body: '' }));
  await routePolaris(page, source);
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
    recurringPrice: { amount: '0.0', currency: 'USD', billingPeriod: 'EVERY_30_DAYS' }, // Shopify's development terms value
    developmentTerms: true,
    managementUrl: 'https://admin.shopify.com/store/example/charges/insignia-1/pricing_plans',
  };
  let response: 'error' | 'unverified' | 'current' = 'error';
  let calls = 0;
  await page.route('**/api/admin/billing', (route) => {
    calls++;
    assert.equal(route.request().method(), 'GET');
    assert.equal(route.request().headers().authorization, 'Bearer synthetic-billing-actor');
    if (response === 'error') return route.fulfill({ status: 503, json: { error: 'Billing status unavailable' } });
    if (response === 'unverified') {
      return route.fulfill({
        json: {
          ...view,
          status: 'unavailable',
          observedAt: null,
          trialEndsAt: null,
          standardPrice: null,
          recurringPrice: null,
          developmentTerms: false,
          newActionsAllowed: false,
        },
      });
    }
    return route.fulfill({ json: view });
  });
  await page.goto(`${base}/admin/settings/billing`);
  await page.getByText('Billing status could not be verified.').waitFor();
  await page.screenshot({ path: '/tmp/insignia-canonical-billing-unavailable.png', fullPage: true });
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
  response = 'unverified';
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  const fallback = page.getByRole('link', { name: 'View plans in Shopify' });
  await fallback.waitFor();
  assert.equal(await fallback.getAttribute('href'), view.managementUrl);
  assert.equal(await fallback.getAttribute('target'), '_top');
  assert.equal(await page.locator('.billing-amount').count(), 0);
  response = 'current';
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByText('Development test terms', { exact: true }).waitFor();
  await page
    .locator('.billing-amount')
    .filter({ hasText: /^USD\s0\.00$/ })
    .waitFor();
  await page.getByText('per 30 days', { exact: true }).waitFor();
  await page.getByText('Standard plan price', { exact: true }).waitFor();
  await page.getByText(/^USD\s49\.99 per 30 days$/).waitFor();
  await page.getByText('Trial active').waitFor();
  assert.equal(await page.locator('s-text[data-date-time]').first().getAttribute('data-date-time'), view.trialEndsAt);
  const manage = page.getByRole('link', { name: 'Manage plan in Shopify' });
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
  view.status = 'active';
  view.trialEndsAt = null;
  view.currentCycle = { startTime: '2026-10-01T00:00:00Z', endTime: '2027-10-01T00:00:00Z' };
  view.pendingChange = true;
  view.standardPrice = null;
  view.recurringPrice = { amount: '499.1234', currency: 'EUR', billingPeriod: 'ANNUAL' };
  view.developmentTerms = false;
  await page.reload();
  await page.getByText('Subscription active', { exact: true }).waitFor();
  await page.getByText(/^EUR\s499\.1234$/).waitFor();
  await page.getByText('per year', { exact: true }).waitFor();
  await page.getByText('Change pending', { exact: true }).waitFor();
  assert.equal(await page.getByText('per 30 days', { exact: true }).count(), 0);

  view.recurringPrice = { amount: '0.0', currency: 'USD', billingPeriod: 'ANNUAL' };
  view.developmentTerms = true;
  await page.reload();
  await page.getByText('Development test terms', { exact: true }).waitFor();
  await page.getByText(/^USD\s0\.00$/).waitFor();
  await page.getByText('per year', { exact: true }).waitFor();
  assert.equal(await page.getByText('Standard plan price', { exact: true }).count(), 0);

  view.status = 'inactive';
  view.currentCycle = null;
  view.pendingChange = false;
  view.recurringPrice = null;
  view.developmentTerms = false;
  view.newActionsAllowed = false;
  await page.reload(); // Explicit fresh observation; the selected successful view has no refresh action.
  await page.getByText('No active subscription', { exact: true }).waitFor();
  assert.equal(await page.getByText('Trial active', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Development test terms', { exact: true }).count(), 0);
  await page.getByText('New customizations and product publication are unavailable.', { exact: false }).waitFor();
  const inactiveManagement = page.getByRole('link', { name: 'Choose a plan in Shopify', exact: true });
  assert.equal(await inactiveManagement.getAttribute('href'), view.managementUrl);
  assert.equal(await inactiveManagement.getAttribute('target'), '_top');
  assert.equal(calls, 6);
});
