import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Page } from 'playwright';
import { browserFixture, preferences, routePolaris } from './support/selected-browser.mts';

/** Built Settings page against a synthetic preferences service: the "Email customers about missing artwork" switch. */

type Scenario = {
  enabled?: boolean;
  canEdit?: boolean;
  /** How the next save answers: saved (default), a server error, or a version conflict after another change. */
  save?: 'saved' | 'error' | 'conflict';
  readFails?: boolean;
  saves?: { key: string | null; body: unknown }[];
  locale?: string;
};

async function openSettings(t: Parameters<typeof browserFixture>[0], scenario: Scenario = {}): Promise<Page> {
  const { source, server, browser } = await browserFixture(t);
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'Settings must not throw unhandled browser errors'));
  await page.addInitScript(() => {
    window.shopify = { config: { shop: 'selected-browser.myshopify.com' }, idToken: async () => 'synthetic-settings' };
  });
  await routePolaris(page, source);
  await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', (route) => route.fulfill({ body: '' }));
  await page.route('https://cdn.shopify.com/static/fonts/**', (route) => route.fulfill({ body: '' }));
  let view = {
    ...preferences,
    canEdit: scenario.canEdit ?? true,
    notificationsVersion: '3',
    notifications: { customerArtworkEmail: scenario.enabled ?? true },
  };
  await page.route('**/api/admin/preferences', (route) => {
    const request = route.request();
    if (request.method() === 'GET')
      return scenario.readFails
        ? route.fulfill({ status: 503, json: { error: 'Store preferences unavailable' } })
        : route.fulfill({ json: view });
    const body = request.postDataJSON() as { notifications: { customerArtworkEmail: boolean } };
    scenario.saves?.push({ key: request.headers()['idempotency-key'] ?? null, body });
    if (scenario.save === 'error')
      return route.fulfill({ status: 503, json: { error: 'Store preferences unavailable' } });
    if (scenario.save === 'conflict') {
      // Another staff member already turned it off.
      view = { ...view, notificationsVersion: '4', notifications: { customerArtworkEmail: false } };
      return route.fulfill({
        status: 409,
        json: { kind: 'conflict', message: 'Store preferences changed. Reload before saving again.' },
      });
    }
    view = {
      ...view,
      notificationsVersion: String(Number(view.notificationsVersion) + 1),
      notifications: body.notifications,
    };
    return route.fulfill({ json: { kind: 'saved', preferences: view } });
  });
  await page.goto(`${server.base}/admin/settings${scenario.locale ? `?locale=${scenario.locale}` : ''}`);
  return page;
}

const emailSwitch = (page: Page, name = 'Email customers about missing artwork') =>
  // Polaris renders the switch as a native checkbox in its shadow root.
  page.getByRole('checkbox', { name, exact: true });

test('the store choice is on by default and turning it off saves only that choice', { timeout: 30000 }, async (t) => {
  const saves: { key: string | null; body: unknown }[] = [];
  const page = await openSettings(t, { saves });
  // The section host has no box of its own; its heading is drawn by Polaris.
  await page.locator('s-section[heading="Customer emails"]').waitFor({ state: 'attached' });
  const control = emailSwitch(page);
  await control.click({ trial: true });
  assert.equal(await control.isChecked(), true);
  await page.getByText('open the order and copy the customer upload link', { exact: false }).waitFor();
  await control.click();
  await page.waitForFunction(() => {
    const host = document.querySelector('#customer-artwork-email') as (HTMLElement & { disabled?: boolean }) | null;
    return host && !host.disabled;
  });
  assert.equal(await control.isChecked(), false);
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0]?.body, {
    action: 'notifications',
    authority: preferences.authority,
    expectedVersion: '3',
    notifications: { customerArtworkEmail: false },
  });
  assert.match(saves[0]?.key ?? '', /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
  assert.equal(
    await page
      .getByRole('status')
      .filter({ hasText: /couldn’t|changed/ })
      .count(),
    0,
  );
});

test('a failed save puts the switch back and says so', { timeout: 30000 }, async (t) => {
  const page = await openSettings(t, { save: 'error' });
  const control = emailSwitch(page);
  await control.click({ trial: true });
  await control.click();
  await page.getByText('Your change couldn’t be saved. Try again.', { exact: true }).waitFor();
  assert.equal(await control.isChecked(), true, 'The confirmed store choice is shown again');
});

test('a change made elsewhere is shown instead of the attempted one', { timeout: 30000 }, async (t) => {
  const page = await openSettings(t, { save: 'conflict' });
  const control = emailSwitch(page);
  await control.click({ trial: true });
  await control.click();
  await page
    .getByText('This setting was changed somewhere else. The current setting is shown.', { exact: true })
    .waitFor();
  await page.waitForFunction(() => {
    const host = document.querySelector('#customer-artwork-email') as (HTMLElement & { disabled?: boolean }) | null;
    return host && !host.disabled;
  });
  assert.equal(await control.isChecked(), false, 'The re-read store choice is shown');
});

test('staff without edit access see the choice but cannot change it', { timeout: 30000 }, async (t) => {
  const page = await openSettings(t, { canEdit: false, enabled: false });
  await page.getByText('Only staff who can edit Insignia can change this.', { exact: false }).waitFor();
  const control = emailSwitch(page);
  assert.equal(await control.isChecked(), false);
  assert.equal(await control.isDisabled(), true);
});

test('an unreadable store choice is explained instead of guessed', { timeout: 30000 }, async (t) => {
  const page = await openSettings(t, { readFails: true });
  await page.getByText('This setting couldn’t be loaded. Reload the page to try again.', { exact: true }).waitFor();
  assert.equal(await emailSwitch(page).count(), 0);
});

test('the choice reads in the merchant language', { timeout: 30000 }, async (t) => {
  const page = await openSettings(t, { locale: 'nl' });
  // The section host has no box of its own; its heading is drawn by Polaris.
  await page.locator('s-section[heading="E-mails aan klanten"]').waitFor({ state: 'attached' });
  const control = emailSwitch(page, 'Klanten mailen als er een ontwerp ontbreekt');
  await control.click({ trial: true }); // enabled once the store choice is read
  assert.equal(await control.isChecked(), true);
});
