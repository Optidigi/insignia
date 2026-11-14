import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Page, Route } from 'playwright';
import { fixture, methodId } from './support/selected-browser.mts';
import { methodsFixture, saveMethod } from './support/selected-methods-browser.mts';

// Built admin UI + real Polaris; the provider answers 409 BUSY as the server does while Shopify throttles (#451).
const busyText = 'Shopify is busy right now, so nothing was changed. Wait a few seconds and try again.';
const busy = (route: Route) =>
  route.fulfill({
    status: 409,
    headers: { 'Retry-After': '5' },
    json: { error: 'Shopify is busy. Try again in a few seconds.', code: 'BUSY' },
  });
const unavailable = (route: Route) => route.fulfill({ status: 503, json: { error: 'Admin service unavailable' } });

async function openHome(page: Page, base: string) {
  await page.goto(`${base}/admin/home?locale=en`);
  await page.waitForFunction(() => document.documentElement.dataset.adminReady === 'true');
}

test('Home says Shopify is busy when its products and orders reads were throttled', { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  await f.page.route('**/api/admin/products', busy);
  await f.page.route('**/api/purchases/v1?*', busy);
  await openHome(f.page, f.base);
  await f.page.getByText('Products couldn’t be loaded', { exact: true }).waitFor();
  await f.page.getByText('Orders couldn’t be loaded', { exact: true }).waitFor();
  assert.equal(await f.page.getByText(busyText, { exact: true }).count(), 2);
  assert.equal(await f.page.getByText('Try again, or open products to continue.').count(), 0);
  assert.equal(await f.page.getByText('Try again, or open orders to continue.').count(), 0);
  assert.equal(await f.page.getByRole('button', { name: 'Retry' }).count(), 2, 'The same read can be retried');
});

test('Home keeps its general failure wording for an unavailable service', { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  await f.page.route('**/api/admin/products', unavailable);
  await f.page.route('**/api/purchases/v1?*', unavailable);
  await openHome(f.page, f.base);
  await f.page.getByText('Try again, or open products to continue.', { exact: true }).waitFor();
  await f.page.getByText('Try again, or open orders to continue.', { exact: true }).waitFor();
  assert.equal(await f.page.getByText(busyText, { exact: true }).count(), 0);
});

test('Home says Shopify is busy when its store preferences read was throttled', { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  await f.page.route('**/api/admin/preferences', busy);
  await openHome(f.page, f.base);
  await f.page.getByText(busyText, { exact: true }).waitFor();
  assert.equal(await f.page.getByText('Open the app from your Shopify admin to continue.').count(), 0);
});

test('Methods says Shopify is busy when saving was throttled, keeps the edit and saves the same command again', {
  timeout: 30000,
}, async (t) => {
  const f = await methodsFixture(t, { empty: true });
  let throttled = false;
  await f.page.route(/\/api\/admin\/methods(?:\/[^/?]+)?(?:\?.*)?$/, (route) => {
    if (route.request().method() !== 'POST' || throttled) return route.fallback();
    throttled = true;
    return busy(route);
  });
  await f.open('/admin/methods/new');
  await f.page.getByRole('textbox', { name: /^Method name/ }).fill('Embroidery');
  await f.page.getByRole('textbox', { name: 'Price per location per item', exact: true }).fill('4.50');
  assert.equal((await saveMethod(f.page)).status(), 409);
  await f.page.getByText(busyText, { exact: true }).waitFor();
  assert.equal(await f.page.getByText('These methods could not be saved.', { exact: false }).count(), 0);
  assert.equal(await f.page.getByRole('textbox', { name: /^Method name/ }).inputValue(), 'Embroidery');
  assert.equal(f.writes.length, 0);
  assert.equal((await saveMethod(f.page)).status(), 201);
  await f.page.getByText('Method created.', { exact: true }).waitFor();
  assert.equal(f.records().length, 1);
});

test('a throttled Method copy keeps its dialog open and says Shopify is busy', { timeout: 30000 }, async (t) => {
  const f = await methodsFixture(t);
  await f.page.route(/\/api\/admin\/methods(?:\/[^/?]+)?(?:\?.*)?$/, (route) =>
    route.request().method() === 'POST' ? busy(route) : route.fallback(),
  );
  await f.open(`/admin/methods/${methodId}`);
  await f.page
    .locator('s-button[icon="duplicate"]')
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  const dialog = f.page.locator('s-modal').filter({ hasText: 'Duplicate method' });
  await dialog.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await dialog.getByText(busyText, { exact: true }).waitFor();
  assert.equal(await dialog.isVisible(), true);
  assert.equal(await dialog.getByText('Your browser could not save this copy.', { exact: false }).count(), 0);
  assert.equal(f.writes.length, 0);
});

test('Methods keeps its storage-failure wording for an unavailable service', { timeout: 30000 }, async (t) => {
  const f = await methodsFixture(t, { empty: true });
  let failed = false;
  await f.page.route(/\/api\/admin\/methods(?:\/[^/?]+)?(?:\?.*)?$/, (route) => {
    if (route.request().method() !== 'POST' || failed) return route.fallback();
    failed = true;
    return unavailable(route);
  });
  await f.open('/admin/methods/new');
  await f.page.getByRole('textbox', { name: /^Method name/ }).fill('Embroidery');
  await f.page.getByRole('textbox', { name: 'Price per location per item', exact: true }).fill('4.50');
  assert.equal((await saveMethod(f.page)).status(), 503);
  await f.page
    .getByText('These methods could not be saved. Keep this page open and try again.', { exact: true })
    .waitFor();
  assert.equal(await f.page.getByText(busyText, { exact: true }).count(), 0);
});

test('Methods says Shopify is busy when loading was throttled', { timeout: 30000 }, async (t) => {
  const f = await methodsFixture(t);
  await f.page.route('**/api/admin/methods?view=catalog', busy);
  await f.page.goto(`${f.base}/admin/methods?locale=en`);
  await f.page.getByText(busyText, { exact: true }).waitFor();
  assert.equal(await f.page.getByText('Methods could not be loaded.').count(), 0);
  await f.page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
});

test('Translations says Shopify is busy when loading was throttled', { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  await f.page.route('**/api/admin/preferences', busy);
  await f.page.goto(`${f.base}/admin/settings/translations?locale=en`);
  await f.page.getByText('Translations couldn’t load', { exact: true }).waitFor();
  await f.page.getByText(busyText, { exact: true }).waitFor();
  assert.equal(await f.page.getByText('Your saved text hasn’t been changed. Try again to load it.').count(), 0);
});

test('Translations says Shopify is busy when saving was throttled and keeps the edit', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  await f.page.route('**/api/admin/preferences', (route) =>
    route.request().method() === 'POST' ? busy(route) : route.fallback(),
  );
  await f.page.goto(`${f.base}/admin/settings/translations?locale=en`);
  await f.page.waitForFunction(() => document.documentElement.dataset.adminReady === 'true');
  await f.page.getByRole('button', { name: 'Navigation' }).click();
  const field = f.page.getByRole('textbox', { name: 'English text' }).first();
  await field.fill('Logo');
  await f.page.locator('ui-save-bar button[variant="primary"]').evaluate((button: HTMLButtonElement) => button.click());
  await f.page.getByText('Text couldn’t be saved', { exact: true }).waitFor();
  await f.page.getByText(busyText, { exact: true }).waitFor();
  assert.equal(await f.page.getByText('Your changes are still here. Try saving again.').count(), 0);
  assert.equal(await field.inputValue(), 'Logo');
});
