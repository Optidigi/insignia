import assert from 'node:assert/strict';
import { test } from 'node:test';
import { required } from './support/fixtures.mts';
import { catalog, fixture } from './support/selected-browser.mts';

// Production observation (17 Nov 2026): the first click on a Method row was lost when the catalogue
// arrived during the click, because the late "Add method" row moved the row under the pointer.
test('a Method row is not offered until the catalogue loads, so a click cannot land on a row that then moves', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  const release = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  t.after(() => release.resolve());
  await f.open();
  await f.page.route('**/api/admin/methods?view=catalog', async (route) => {
    started.resolve();
    await release.promise;
    await route.fulfill({ json: catalog }).catch(() => {});
  });
  await f.page.getByRole('button', { name: 'Manage methods', exact: true }).click();
  const dialog = f.page.locator('s-modal').filter({ has: f.page.locator('.pm-manager') });
  await started.promise;
  await dialog.locator('.pm-manager__results[aria-busy="true"]').waitFor();
  const done = dialog.locator('s-button[slot="primary-action"]');
  const printing = dialog.getByRole('checkbox', { name: 'Printing', exact: true });
  assert.equal(await printing.count(), 0, 'No Method row may be interactive while the catalogue loads');
  assert.equal(await dialog.locator('.pm-manager__results s-spinner').count(), 1);
  assert.notEqual(await done.getAttribute('disabled'), null, 'Done waits for the catalogue');

  // A real press that spans the catalogue arrival must not change the selection.
  const busy = required(await dialog.locator('.pm-manager__results').boundingBox());
  await f.page.mouse.move(busy.x + 24, busy.y + busy.height / 2);
  await f.page.mouse.down();
  release.resolve();
  await dialog.locator('.pm-manager__create-action').waitFor();
  await f.page.mouse.up();
  await printing.waitFor();
  assert.equal(await printing.isChecked(), true);

  // The row is shown at its final position; the first real click on it applies.
  const first = required(await printing.boundingBox());
  await f.page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  const settled = required(await printing.boundingBox());
  assert.equal(settled.y, first.y, 'The loaded row does not move after it appears');
  await f.page.mouse.click(settled.x + settled.width / 2, settled.y + settled.height / 2);
  await f.page.waitForFunction(
    () =>
      document.querySelector<HTMLElementTagNameMap['s-checkbox']>('.pm-manager__method s-checkbox')?.checked === false,
    undefined,
    { timeout: 2000 },
  );
  assert.equal(await printing.isChecked(), false);
  assert.equal(f.mutations.length, 0);
});
