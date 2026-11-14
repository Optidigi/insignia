import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Page } from 'playwright';
import { required } from './support/fixtures.mts';
import { draft, fixture, hostSave, methodId } from './support/selected-browser.mts';
import { methodsFixture, saveMethod } from './support/selected-methods-browser.mts';

/** Chromium discards a comma typed into an input[type=number]; only real key presses reproduce that. */
const ambiguous = ['1.234,5', '7,5,0', '7a', 'abc', '1e3'];

/** Saves through the host save bar and waits until the write is acknowledged and its pending intent is cleared. */
async function acknowledgedSave(page: Page) {
  const response = page.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.url().endsWith('/api/admin/products/111/config'),
  );
  await hostSave(page);
  const saved = await response;
  await page.waitForFunction(
    () =>
      !sessionStorage.getItem(
        'insignia:selected-product-write:v1:selected-browser.myshopify.com:gid://shopify/Product/111',
      ),
  );
  return saved;
}

async function typeInto(page: Page, locator: ReturnType<Page['getByRole']>, text: string) {
  await locator.click();
  await locator.press('Control+A');
  await locator.press('Delete');
  await locator.pressSequentially(text);
}

test('a typed comma price on the Method page saves 7.50 and is shown back as an exact amount', {
  timeout: 20000,
}, async (t) => {
  const f = await methodsFixture(t, { empty: true });
  await f.open('/admin/methods/new');
  await f.page.getByRole('textbox', { name: /^Method name/ }).fill('Embroidery');
  const price = f.page.getByRole('textbox', { name: 'Price per location per item', exact: true });
  await price.pressSequentially('7,5');
  assert.equal(await price.inputValue(), '7,5', 'The typed comma is kept, never dropped');
  await price.blur();
  assert.equal(await price.inputValue(), '7.50');
  assert.equal(
    await price.evaluate((input: HTMLInputElement) => input.inputMode),
    'decimal',
    'Touch keyboards offer the decimal keypad',
  );
  assert.equal((await saveMethod(f.page)).status(), 201);
  await f.page.getByText('Method created.', { exact: true }).waitFor();
  assert.equal(f.records()[0]?.configuration.amount, '7.50');
});

for (const dot of ['7.5', '12,50'])
  test(`a Method price typed as ${dot} saves the same exact amount`, { timeout: 20000 }, async (t) => {
    const f = await methodsFixture(t, { empty: true });
    await f.open('/admin/methods/new');
    await f.page.getByRole('textbox', { name: /^Method name/ }).fill('Embroidery');
    await f.page.getByRole('textbox', { name: 'Price per location per item', exact: true }).pressSequentially(dot);
    assert.equal((await saveMethod(f.page)).status(), 201);
    await f.page.getByText('Method created.', { exact: true }).waitFor();
    assert.equal(f.records()[0]?.configuration.amount, dot === '7.5' ? '7.50' : '12.50');
  });

for (const text of ambiguous)
  test(`a Method price typed as ${text} shows an error and cannot be saved`, { timeout: 20000 }, async (t) => {
    const f = await methodsFixture(t, { empty: true });
    await f.open('/admin/methods/new');
    await f.page.getByRole('textbox', { name: /^Method name/ }).fill('Embroidery');
    const price = f.page.getByRole('textbox', { name: 'Price per location per item', exact: true });
    await price.pressSequentially(text);
    await price.blur();
    assert.equal(await price.inputValue(), text, 'Invalid text is never rewritten into another amount');
    await f.page
      .locator('ui-save-bar button[variant="primary"]')
      .evaluate((button: HTMLButtonElement) => button.click());
    await f.page.getByText('Enter a price from 0 to 99,999.99.', { exact: true }).waitFor();
    assert.equal(f.writes.length, 0);
  });

test('a typed comma fixed price in the placement Method dialog is saved as 7.50', { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  await f.open();
  await f.page.getByRole('button', { name: 'Edit Printing price', exact: true }).click();
  const modal = f.page.locator('s-modal').filter({ has: f.page.locator('[data-method-price-field]') });
  const price = modal.getByRole('textbox', { name: 'Price per placement per item', exact: true });
  await typeInto(f.page, price, '7,5');
  assert.equal(await price.inputValue(), '7,5');
  await price.blur();
  assert.equal(await price.inputValue(), '7.50');
  await modal.getByRole('button', { name: 'Done', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  assert.equal((await acknowledgedSave(f.page)).status(), 200);
  assert.equal(f.read().selectedSetup?.product.methods[0]?.amount, '7.50');
});

for (const text of ambiguous)
  test(`a placement Method dialog price typed as ${text} shows an error and cannot be saved`, {
    timeout: 30000,
  }, async (t) => {
    const f = await fixture(t);
    await f.open();
    await f.page.getByRole('button', { name: 'Edit Printing price', exact: true }).click();
    const modal = f.page.locator('s-modal').filter({ has: f.page.locator('[data-method-price-field]') });
    const price = modal.getByRole('textbox', { name: 'Price per placement per item', exact: true });
    await typeInto(f.page, price, text);
    await price.blur();
    assert.equal(await price.inputValue(), text);
    await modal.getByRole('button', { name: 'Done', exact: true }).click();
    await modal.getByText('Enter a valid nonnegative price.', { exact: true }).waitFor();
    assert.equal(await modal.isVisible(), true);
    assert.equal(f.mutations.length, 0);
  });

function productSpecific() {
  const initial = structuredClone(draft);
  const selected = required(initial.selectedSetup);
  const method = required(selected.product.methods[0]);
  method.pricing = 'product';
  method.amount = '';
  initial.pricingRules = [];
  const binding = required(selected.methodBindings[methodId]);
  binding.prices = { default: { source: 'product', value: '' }, '["chest","small"]': { source: 'product', value: '' } };
  return initial;
}

test('a typed comma per-size price saves the exact 7.50 amount', { timeout: 30000 }, async (t) => {
  const f = await fixture(t, { initialDraft: productSpecific() });
  await f.open();
  const price = f.page.getByRole('textbox', { name: 'Price for Small', exact: true });
  await price.pressSequentially('7,5');
  assert.equal(await price.inputValue(), '7,5');
  await price.blur();
  assert.equal(await price.inputValue(), '7.50');
  assert.equal((await acknowledgedSave(f.page)).status(), 200);
  assert.equal(f.read().selectedSetup?.product.views[0]?.placements[0]?.sizes[0]?.prices[methodId], '7.50');
});

test('a per-size price save is not possible while the field holds 1.234,5', { timeout: 30000 }, async (t) => {
  const f = await fixture(t, { initialDraft: productSpecific() });
  await f.open();
  const price = f.page.getByRole('textbox', { name: 'Price for Small', exact: true });
  await price.pressSequentially('1.234,5');
  await price.blur();
  assert.equal(await price.inputValue(), '1.234,5');
  await hostSave(f.page);
  await f.page.getByText('Enter a valid nonnegative price.', { exact: true }).first().waitFor();
  assert.equal(f.mutations.length, 0);
});

test('a typed comma geometry value is read as a decimal and saved exactly', { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  await f.open();
  const horizontal = f.page.getByRole('textbox', { name: 'Center X', exact: true });
  await typeInto(f.page, horizontal, '40,5');
  assert.equal(await horizontal.inputValue(), '40,5');
  assert.equal((await acknowledgedSave(f.page)).status(), 200);
  assert.equal(f.read().selectedSetup?.product.views[0]?.placements[0]?.rect.centerX, 0.405);
});

test('geometry typed as 1.234,5 shows an error and cannot be saved', { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  await f.open();
  const horizontal = f.page.getByRole('textbox', { name: 'Center X', exact: true });
  await typeInto(f.page, horizontal, '1.234,5');
  await hostSave(f.page);
  await f.page.getByText('Enter a position or size.', { exact: true }).first().waitFor();
  assert.equal(f.mutations.length, 0);
});

test('a typed comma size scale is saved as the exact dot decimal', { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  await f.open();
  const scale = f.page.getByRole('textbox', { name: 'Area scale (%)', exact: true }).first();
  await typeInto(f.page, scale, '62,5');
  assert.equal(await scale.inputValue(), '62,5');
  assert.equal((await acknowledgedSave(f.page)).status(), 200);
  assert.equal(f.read().selectedSetup?.product.views[0]?.placements[0]?.sizes[0]?.widthPercent, '62.5');
});

test('a size scale typed as 1.234,5 shows an error and cannot be saved', { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  await f.open();
  const scale = f.page.getByRole('textbox', { name: 'Area scale (%)', exact: true }).first();
  await typeInto(f.page, scale, '1.234,5');
  await hostSave(f.page);
  await f.page.getByText('Enter a size factor greater than 0 and at most 100%.', { exact: true }).first().waitFor();
  assert.equal(f.mutations.length, 0);
});

async function startMeasuring(page: Page) {
  await page
    .locator('s-button[accessibilitylabel="Measure image"]')
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  return page.getByRole('textbox', { name: 'Known length', exact: true });
}

test('a typed comma known length calibrates the image with the exact decimal distance', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  await f.open();
  const length = await startMeasuring(f.page);
  assert.equal(await length.inputValue(), '50');
  await typeInto(f.page, length, '62,5');
  assert.equal(await length.inputValue(), '62,5');
  await f.page.getByRole('button', { name: 'Apply', exact: true }).click();
  await length.waitFor({ state: 'detached' });
  assert.equal((await acknowledgedSave(f.page)).status(), 200);
  assert.equal(f.read().selectedSetup?.product.views[0]?.calibration?.distanceCm, 62.5);
});

test('a known length typed as 1.234,5 shows the measurement error and is not applied', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  await f.open();
  const length = await startMeasuring(f.page);
  await typeInto(f.page, length, '1.234,5');
  await f.page.getByRole('button', { name: 'Apply', exact: true }).click();
  await f.page
    .getByText('Choose two different points inside the image and enter a positive distance.', { exact: true })
    .waitFor();
  assert.equal(await length.inputValue(), '1.234,5');
  assert.equal(f.mutations.length, 0);
});

test('a typed comma point coordinate is read as a decimal percentage', { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  await f.open();
  const length = await startMeasuring(f.page);
  await f.page.getByText('Enter point coordinates', { exact: true }).click();
  const x = f.page.getByRole('textbox', { name: 'Point A X', exact: true });
  await typeInto(f.page, x, '12,5');
  await length.waitFor();
  await f.page.getByRole('button', { name: 'Apply', exact: true }).click();
  await length.waitFor({ state: 'detached' });
  assert.equal((await acknowledgedSave(f.page)).status(), 200);
  assert.equal(f.read().selectedSetup?.product.views[0]?.calibration?.a.x, 0.125);
});
