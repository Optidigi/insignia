import assert from 'node:assert/strict';
import { test } from 'node:test';
import { methodId } from './support/selected-browser.mts';
import { methodsFixture, saveMethod } from './support/selected-methods-browser.mts';

test('real selected Method editing exposes Shopify save state and saves the exact current configuration', {
  timeout: 20000,
}, async (t) => {
  const f = await methodsFixture(t);
  await f.open(`/admin/methods/${methodId}`);
  await f.page.getByRole('textbox', { name: /^Method name/ }).fill('Screen printing');
  await f.page.waitForFunction(() => window.saveBarEvents.some(([kind]) => kind === 'show'));
  assert.equal((await saveMethod(f.page)).status(), 200);
  await f.page.getByText('Method saved.', { exact: true }).waitFor();
  assert.equal(f.writes.length, 1);
  assert.equal(f.records()[0]?.configuration.name, 'Screen printing');
  assert.equal(f.records()[0]?.configuration.productIds[0], '111');
});

test('selected Method cancel restores the saved name and manual assignment reload keeps its real Shopify identity', {
  timeout: 20000,
}, async (t) => {
  const f = await methodsFixture(t);
  await f.open(`/admin/methods/${methodId}`);
  await f.page.getByRole('link', { name: 'Synthetic selected hoodie', exact: true }).waitFor();
  await f.page.getByRole('textbox', { name: /^Method name/ }).fill('Cancelled method name');
  await f.page
    .locator('ui-save-bar button')
    .nth(1)
    .evaluate((button: HTMLButtonElement) => button.click());
  const modal = f.page.locator('#method-draft-save-bar-discard');
  await modal.getByRole('button', { name: 'Discard', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  assert.equal(await f.page.getByRole('textbox', { name: /^Method name/ }).inputValue(), 'Printing');
  assert.equal(f.writes.length, 0);
  await f.page.reload();
  await f.page.locator('.method-workflow').waitFor({ state: 'visible' });
  await f.page.getByRole('link', { name: 'Synthetic selected hoodie', exact: true }).waitFor();
  assert.equal(f.writes.length, 0);
  assert.equal(f.records()[0]?.configuration.productIds[0], '111');
});

test('selected Method translations use sparse defaults and persist merchant-authored names and descriptions', {
  timeout: 20000,
}, async (t) => {
  const f = await methodsFixture(t);
  await f.open(`/admin/methods/${methodId}`);
  const locale = f.page.getByRole('combobox', { name: 'Translation language', exact: true });
  await locale.selectOption('nl');
  const name = f.page.getByRole('textbox', { name: /^Method name/ });
  assert.equal(await name.inputValue(), '');
  assert.equal(await name.getAttribute('placeholder'), 'Printing');
  await name.fill('Bedrukking');
  await f.page.getByRole('textbox', { name: 'Description (optional)', exact: true }).fill('Volledige kleur');
  assert.equal((await saveMethod(f.page)).status(), 200);
  await f.page.getByText('Method saved.', { exact: true }).waitFor();
  assert.deepEqual(f.records()[0]?.configuration.translations?.nl, {
    name: 'Bedrukking',
    explanation: 'Volledige kleur',
  });
  assert.equal(f.records()[0]?.configuration.name, 'Printing');
  await locale.selectOption('de');
  assert.equal(await name.inputValue(), '');
  assert.equal(await name.getAttribute('placeholder'), 'Printing');
  assert.equal(f.writes.length, 1, 'Changing displayed language is not an authoring mutation');
});

test('selected Method delete confirmation cancels without a mutation and explicit deletion removes one exact version', {
  timeout: 20000,
}, async (t) => {
  const f = await methodsFixture(t);
  await f.open(`/admin/methods/${methodId}`);
  async function requestDeletion() {
    await f.page
      .locator('s-menu#method-detail-actions s-button[tone="critical"]')
      .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
    return f.page.locator('s-modal').filter({ hasText: 'Delete Printing?' });
  }
  let modal = await requestDeletion();
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  assert.equal(f.writes.length, 0);
  modal = await requestDeletion();
  const receipt = f.page.waitForResponse((response) => response.request().method() === 'DELETE');
  await modal.getByRole('button', { name: 'Delete method', exact: true }).click();
  await receipt;
  await f.page.getByText('Method deleted.', { exact: true }).waitFor();
  assert.equal(f.writes.length, 1);
  assert.equal(f.records().length, 0);
});

test('lost selected Method create reply resumes its original exact command on reload without duplicate catalogue rows', {
  timeout: 20000,
}, async (t) => {
  const f = await methodsFixture(t, { empty: true, loseFirstReply: true });
  await f.open('/admin/methods/new');
  await f.page.getByRole('textbox', { name: /^Method name/ }).fill('Embroidery');
  await f.page.getByRole('textbox', { name: 'Price per location per item', exact: true }).fill('4.50');
  await f.page.locator('ui-save-bar button[variant="primary"]').evaluate((button: HTMLButtonElement) => button.click());
  await f.page
    .getByText('These methods could not be saved. Keep this page open and try again.', { exact: true })
    .waitFor();
  assert.equal(f.writes.length, 1);
  assert.equal(f.records().length, 1);
  await f.page.reload();
  await f.page.locator('.method-workflow').waitFor({ state: 'visible' });
  assert.equal(f.writes.length, 2);
  assert.deepEqual(f.writes[1], f.writes[0]);
  assert.equal(f.records().length, 1);
  assert.equal(f.records()[0]?.configuration.name, 'Embroidery');
});

test('selected Methods authority loss clears private editor state and a readonly actor cannot mutate through host callbacks', {
  timeout: 20000,
}, async (t) => {
  const f = await methodsFixture(t);
  await f.open(`/admin/methods/${methodId}`);
  await f.page.getByRole('textbox', { name: /^Method name/ }).fill('Denied method name');
  f.revoke();
  assert.equal((await saveMethod(f.page)).status(), 403);
  await f.page.locator('.method-workflow').waitFor({ state: 'detached' });
  assert.equal(await f.page.getByRole('textbox', { name: /^Method name/ }).count(), 0);
  const readonly = await methodsFixture(t, { readOnly: true });
  await readonly.open(`/admin/methods/${methodId}`);
  await readonly.page
    .locator('s-text-field[name="method-name"]')
    .evaluate((field: HTMLElementTagNameMap['s-text-field']) => {
      field.value = 'Forbidden';
      field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    });
  await readonly.page
    .locator('ui-save-bar button[variant="primary"]')
    .evaluate((button: HTMLButtonElement) => button.click());
  await readonly.page
    .locator('s-menu#method-detail-actions s-button[tone="critical"]')
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  await readonly.page
    .locator('s-button[icon="duplicate"]')
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  await readonly.page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  assert.equal(readonly.writes.length, 0);
  assert.equal(readonly.records()[0]?.configuration.name, 'Printing');
});

test('a delayed Method save fences stale host actions and injected input from replacing the confirmed candidate', {
  timeout: 20000,
}, async (t) => {
  const f = await methodsFixture(t, { holdWrite: true });
  await f.open(`/admin/methods/${methodId}`);
  await f.page.getByRole('textbox', { name: /^Method name/ }).fill('Frozen method save');
  const acknowledged = saveMethod(f.page);
  await f.writeStarted;
  await f.page.locator('s-text-field[name="method-name"]').evaluate((field: HTMLElementTagNameMap['s-text-field']) => {
    field.value = 'Injected late name';
    field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  });
  await f.page.locator('ui-save-bar button[variant="primary"]').evaluate((button: HTMLButtonElement) => button.click());
  await f.page
    .locator('s-button[icon="duplicate"]')
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  await f.page
    .locator('s-menu#method-detail-actions s-button[tone="critical"]')
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  f.release();
  assert.equal((await acknowledged).status(), 200);
  await f.page.getByText('Method saved.', { exact: true }).waitFor();
  assert.equal(f.writes.length, 1);
  assert.equal(f.records()[0]?.configuration.name, 'Frozen method save');
  assert.equal(await f.page.getByRole('textbox', { name: /^Method name/ }).inputValue(), 'Frozen method save');
  assert.equal(await f.page.locator('s-modal[data-method-dialog]').count(), 0);
});

test('selected Methods keeps catalogue names scannable and fits narrow screens before opening an editable detail', {
  timeout: 20000,
}, async (t) => {
  const f = await methodsFixture(t);
  await f.open();
  const method = f.page.getByRole('link', { name: 'Printing', exact: true });
  await method.waitFor();
  assert.equal(
    await f.page.getByRole('textbox', { name: /^Method name/ }).count(),
    0,
    'Catalogue search does not expose an editing form',
  );
  await f.page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await method.click();
  await f.page.getByRole('textbox', { name: /^Method name/ }).waitFor();
  assert.equal(f.writes.length, 0);
  assert.equal(new URL(f.page.url()).pathname, `/admin/methods/${methodId}`);
});

test('explicit same-amount Method review adopts the changed shop currency and survives reload without an implicit relabel', {
  timeout: 20000,
}, async (t) => {
  const f = await methodsFixture(t, { currency: 'EUR' });
  await f.open(`/admin/methods/${methodId}`);
  const price = f.page.getByRole('textbox', { name: 'Price per location per item', exact: true });
  assert.equal(await price.inputValue(), '');
  assert.equal(f.records()[0]?.currency, 'USD');
  assert.equal(f.writes.length, 0);
  assert.equal(await f.page.locator('ui-save-bar button[variant="primary"]').isDisabled(), true);
  await price.fill('3.50');
  await f.page.waitForFunction(() => window.saveBarEvents.some(([kind]) => kind === 'show'));
  await f.page
    .locator('ui-save-bar button')
    .nth(1)
    .evaluate((button: HTMLButtonElement) => button.click());
  const discard = f.page.locator('#method-draft-save-bar-discard');
  await discard.getByRole('button', { name: 'Discard', exact: true }).click();
  await discard.waitFor({ state: 'hidden' });
  assert.equal(await price.inputValue(), '');
  assert.equal(await f.page.locator('ui-save-bar button[variant="primary"]').isDisabled(), true);
  assert.equal(f.writes.length, 0);
  await price.fill('3.50');
  await f.page
    .locator('s-link[slot="breadcrumb-actions"]')
    .evaluate((link: HTMLElementTagNameMap['s-link']) => link.click());
  const leave = f.page.locator('s-modal[data-method-dialog]');
  await leave.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await leave.waitFor({ state: 'hidden' });
  assert.equal(new URL(f.page.url()).pathname, `/admin/methods/${methodId}`);
  assert.equal(f.writes.length, 0);
  assert.equal((await saveMethod(f.page)).status(), 200);
  await f.page.getByText('Method saved.', { exact: true }).waitFor();
  assert.equal(f.writes.length, 1);
  assert.equal(f.records()[0]?.configuration.amount, '3.50');
  assert.equal(f.records()[0]?.currency, 'EUR');
  await f.page.reload();
  await f.page.locator('.method-workflow').waitFor({ state: 'visible' });
  assert.equal(
    await f.page.getByRole('textbox', { name: 'Price per location per item', exact: true }).inputValue(),
    '3.50',
  );
  assert.equal(f.writes.length, 1);
});

test('suspending the product picker keeps concurrent method dialogs uniquely addressable', {
  timeout: 30000,
}, async (t) => {
  const f = await methodsFixture(t, { shopifyModal: true });
  await f.open();
  await f.page.getByRole('link', { name: 'Printing', exact: true }).click();
  const name = f.page.getByRole('textbox', { name: /^Method name/ });
  await name.fill('Unsaved method name');
  await f.page.getByRole('button', { name: 'Select products', exact: true }).click();
  const picker = f.page.locator('s-modal[data-method-dialog]').filter({ hasText: 'Select products' });
  await picker.waitFor({ state: 'visible' });
  await f.page.goBack();
  const dialogs = f.page.locator('s-modal[data-method-dialog]');
  await f.page.getByRole('heading', { name: 'Discard unsaved changes?', exact: true }).waitFor();
  const ids = await dialogs.evaluateAll((elements) => elements.map((element) => (element as HTMLElement).id));
  assert.equal(ids.length, 2, 'The suspended product picker and leave confirmation stay mounted together');
  assert.ok(ids.every(Boolean), 'Every open Method dialog needs an ID for Shopify host routing');
  assert.equal(new Set(ids).size, 2, 'Concurrent Method dialogs need distinct Shopify host IDs');
});

test('a resumed product picker survives its delayed host dismissal without writing the draft', {
  timeout: 30000,
}, async (t) => {
  const f = await methodsFixture(t, { shopifyModal: true, deferShopifyModalDismiss: true });
  await f.open();
  await f.page.getByRole('link', { name: 'Printing', exact: true }).click();
  await f.page.getByRole('textbox', { name: /^Method name/ }).fill('Unsaved method name');
  await f.page.getByRole('button', { name: 'Select products', exact: true }).click();
  const picker = f.page.locator('s-modal[data-method-dialog]').filter({ hasText: 'Select products' });
  await picker.waitFor({ state: 'visible' });
  const pickerId = await picker.getAttribute('id');

  await f.page.goBack();
  const leave = f.page.locator('s-modal[data-method-dialog]').filter({ hasText: 'Discard unsaved changes?' });
  await leave.waitFor({ state: 'visible' });
  await leave.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await leave.waitFor({ state: 'detached' });

  await f.page.evaluate(() => window.finishShopifyModalDismiss());
  await picker.waitFor({ state: 'visible' });
  await f.page.locator('[data-shopify-host-modal-scrim]').waitFor({ state: 'attached' });
  assert.equal(await picker.getAttribute('id'), pickerId);
  assert.equal(f.writes.length, 0);

  await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
  await picker.waitFor({ state: 'detached' });
  await f.page.locator('[data-shopify-host-modal-scrim]').waitFor({ state: 'detached' });
  assert.equal(f.writes.length, 0);
});

declare global {
  interface Window {
    resumeQa009PickerShow(): void;
    cancelQa009PickerShow(): void;
  }
}

test('pending picker dismissal is delivered after leave confirmation resumes its owner', {
  timeout: 30000,
}, async (t) => {
  const f = await methodsFixture(t, { shopifyModal: true });
  await f.page.addInitScript(() => {
    const modal = window.shopify?._internal?.modal;
    if (!modal) throw new Error('Expected Shopify modal fixture');
    const originalShow = modal.show.bind(modal);
    let held = false;
    modal.show = async (id, options) => {
      await originalShow(id, options);
      if (held) return;
      held = true;
      const cancel = options?.buttons?.find(
        (button) =>
          !!button &&
          typeof button === 'object' &&
          'label' in button &&
          button.label === 'Cancel' &&
          'onAction' in button,
      );
      if (!cancel || typeof cancel !== 'object' || !('onAction' in cancel) || typeof cancel.onAction !== 'function')
        throw new Error('Expected Cancel');
      const action = cancel.onAction;
      window.cancelQa009PickerShow = () => {
        action();
      };
      await new Promise<void>((resolve) => {
        window.resumeQa009PickerShow = resolve;
      });
    };
  });
  await f.open();
  await f.page.getByRole('link', { name: 'Printing', exact: true }).click();
  await f.page.getByRole('textbox', { name: /^Method name/ }).fill('Unsaved method name');
  await f.page.getByRole('button', { name: 'Select products', exact: true }).click();
  await f.page.waitForFunction(() => typeof window.cancelQa009PickerShow === 'function');
  await f.page.evaluate(() => window.cancelQa009PickerShow());
  await f.page.goBack();
  const leave = f.page.locator('s-modal[data-method-dialog]').filter({ hasText: 'Discard unsaved changes?' });
  await leave.waitFor({ state: 'visible' });
  await f.page.evaluate(() => window.resumeQa009PickerShow());
  await f.page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await leave.waitFor({ state: 'detached' });
  await f.page
    .locator('s-modal[data-method-dialog]')
    .filter({ hasText: 'Select products' })
    .waitFor({ state: 'detached' });
  assert.equal(await f.page.getByRole('textbox', { name: /^Method name/ }).inputValue(), 'Unsaved method name');
  assert.equal(await f.page.locator('[data-shopify-host-modal-scrim]').count(), 0);
  assert.equal(f.writes.length, 0);
});
