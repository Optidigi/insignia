import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Page } from 'playwright';
import { editName, fixture, hostSave } from './support/selected-browser.mts';

// Scope: real built UI/client/Polaris in an isolated browser with a synthetic App Bridge save bar.
// #441: Shopify's contextual save bar is the single save path. These are not native save-bar observations.
const barId = 'product-draft-save-bar';
const lastBarEvent = (page: Page) =>
  page.evaluate((id) => window.saveBarEvents.filter(([, target]) => target === id).at(-1)?.[0] ?? null, barId);
const puts = (f: { mutations: { method: string }[] }) => f.mutations.filter((entry) => entry.method === 'PUT');

test('#441: the editor has no save button of its own and the host save bar saves the draft', {
  timeout: 20000,
}, async (t) => {
  const f = await fixture(t);
  await f.open();
  await editName(f.page, 'Saved through the bar');
  await f.page.waitForFunction(() => window.saveBarEvents.some(([kind]) => kind === 'show'));
  assert.equal(await f.page.getByRole('button', { name: 'Save draft', exact: true }).count(), 0);
  assert.equal(await f.page.locator('[data-editor-save-draft]').count(), 0);
  const saved = f.page.waitForResponse((response) => response.request().method() === 'PUT');
  await hostSave(f.page);
  assert.equal((await saved).status(), 200);
  await f.page.waitForFunction(
    (id) => window.saveBarEvents.filter(([, target]) => target === id).at(-1)?.[0] === 'hide',
    barId,
  );
  assert.equal(puts(f).length, 1);
  assert.equal(f.read().selectedSetup?.product.views[0]?.placements[0]?.name, 'Saved through the bar');
});

test('#441: Ctrl+S is the same save as the host save bar', { timeout: 20000 }, async (t) => {
  const f = await fixture(t);
  await f.open();
  await editName(f.page, 'Saved with the keyboard');
  const saved = f.page.waitForResponse((response) => response.request().method() === 'PUT');
  await f.page.keyboard.press('Control+s');
  assert.equal((await saved).status(), 200);
  await f.page.waitForFunction(
    (id) => window.saveBarEvents.filter(([, target]) => target === id).at(-1)?.[0] === 'hide',
    barId,
  );
  assert.equal(puts(f).length, 1);
  assert.equal(f.read().selectedSetup?.product.views[0]?.placements[0]?.name, 'Saved with the keyboard');
});

test('#441: the host Discard reverts the edit after confirmation and writes nothing', {
  timeout: 20000,
}, async (t) => {
  const f = await fixture(t);
  await f.open();
  await editName(f.page, 'Never saved');
  await f.page.waitForFunction(() => window.saveBarEvents.some(([kind]) => kind === 'show'));
  await f.page
    .locator('ui-save-bar button')
    .nth(1)
    .evaluate((button: HTMLButtonElement) => button.click());
  const modal = f.page.locator('#discard-product-changes');
  await modal.getByRole('button', { name: 'Discard', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  assert.equal(await f.page.getByRole('textbox', { name: /^Placement name/ }).inputValue(), 'Right chest');
  assert.equal(f.mutations.length, 0);
  assert.equal(await lastBarEvent(f.page), 'hide');
});

test('#441: the panel and history controls sit in the editor, not under the host save bar in the page header', {
  timeout: 20000,
}, async (t) => {
  const f = await fixture(t);
  await f.open();
  await editName(f.page, 'Dirty');
  await f.page.waitForFunction(() => window.saveBarEvents.some(([kind]) => kind === 'show'));
  const headerLabels = await f.page
    .locator('s-page > s-button[slot="secondary-actions"], s-page > s-button-group[slot="secondary-actions"] s-button')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('accessibilitylabel')));
  assert.deepEqual(headerLabels, ['Preview customization', 'More actions']);
  for (const icon of ['layout-sidebar-left', 'undo', 'redo'])
    assert.equal(await f.page.locator(`[data-placement-editor] s-button[icon="${icon}"]`).count(), 1, icon);
  for (const name of ['Hide views and placements', 'Undo', 'Redo'])
    await f.page.getByRole('button', { name, exact: true }).waitFor({ state: 'visible' });
  await f.page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await f.page.getByRole('textbox', { name: /^Placement name/ }).inputValue(), 'Right chest');
});

test('#441: a publish of a saved draft leaves no "Unsaved changes" bar or save spinner', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  let publishSeen: () => void = () => {};
  const dispatched = new Promise<void>((resolve) => {
    publishSeen = resolve;
  });
  await f.page.route('**/api/admin/products/111/config', async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && JSON.parse(request.postData() ?? '{}').action === 'publish') {
      publishSeen();
      return; // No answer yet: the publish is in flight.
    }
    return route.fallback();
  });
  await f.open();
  await f.page
    .locator('s-button[slot="primary-action"]')
    .filter({ hasText: /^Publish$/ })
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  const modal = f.page.locator('s-modal').filter({ hasText: 'Publish setup' });
  await modal.getByRole('button', { name: /^Publish/ }).click();
  await dispatched;
  await f.page.waitForTimeout(300);
  assert.notEqual(await lastBarEvent(f.page), 'show', 'the draft is saved, so the host bar stays hidden');
  assert.equal(await f.page.locator('ui-save-bar button[variant="primary"][loading]').count(), 0);
});
