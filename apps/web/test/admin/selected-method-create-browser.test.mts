import assert from 'node:assert/strict';
import { test } from 'node:test';
import { methodsFixture, saveMethod } from './support/selected-methods-browser.mts';

// Scope: real built Methods UI/Polaris in an isolated browser with synthetic provider HTTP (#442 item 6).
// These are not native Shopify save-bar observations.
const barId = 'method-draft-save-bar';
const lastBarEvent = (page: import('playwright').Page) =>
  page.evaluate((id) => window.saveBarEvents.filter(([, target]) => target === id).at(-1)?.[0] ?? null, barId);

test('#442 item 6: a blank new library method shows no save bar; the first edit shows it and Discard clears the form', {
  timeout: 20000,
}, async (t) => {
  const f = await methodsFixture(t, { empty: true });
  await f.open('/admin/methods/new');
  await f.page.getByRole('textbox', { name: /^Method name/ }).waitFor();
  assert.equal(
    await f.page.evaluate(
      (id) => window.saveBarEvents.some(([kind, target]) => kind === 'show' && target === id),
      barId,
    ),
    false,
    'nothing to save yet, so the host bar is not shown (Shopify shows it on the first edit)',
  );
  const name = f.page.getByRole('textbox', { name: /^Method name/ });
  await name.fill('Embroidery');
  await f.page.waitForFunction(
    (id) => window.saveBarEvents.filter(([, target]) => target === id).at(-1)?.[0] === 'show',
    barId,
  );
  await f.page
    .locator('ui-save-bar button')
    .nth(1)
    .evaluate((button: HTMLButtonElement) => button.click());
  const modal = f.page.locator('#method-draft-save-bar-discard');
  await modal.getByRole('button', { name: 'Discard', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  assert.equal(await name.inputValue(), '');
  assert.equal(await lastBarEvent(f.page), 'hide');
  assert.equal(f.writes.length, 0);
});

test('#442 item 6: a saved library price reads with two decimals', { timeout: 20000 }, async (t) => {
  const f = await methodsFixture(t, { empty: true });
  await f.open('/admin/methods/new');
  await f.page.getByRole('textbox', { name: /^Method name/ }).fill('Embroidery');
  const price = f.page.getByRole('textbox', { name: 'Price per location per item', exact: true });
  await price.fill('12.5');
  assert.equal((await saveMethod(f.page)).status(), 201);
  await f.page.waitForFunction(
    (id) => window.saveBarEvents.filter(([, target]) => target === id).at(-1)?.[0] === 'hide',
    barId,
  );
  assert.equal(f.records()[0]?.configuration.amount, '12.50');
  assert.equal(await price.inputValue(), '12.50');
  assert.equal(await lastBarEvent(f.page), 'hide');
});
