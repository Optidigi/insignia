import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MerchantDraftSchema } from '@insignia/contracts';
import { required } from './support/fixtures.mts';
import { draft, editName, fixture, hostSave } from './support/selected-browser.mts';

// Scope: real built UI/client/Polaris in an isolated browser with synthetic provider HTTP and App Bridge doubles (#442).
// These are not native Shopify observations.
type Fixture = Awaited<ReturnType<typeof fixture>>;

const publishButton = (f: Fixture) =>
  f.page.locator('s-button[slot="primary-action"]').filter({ hasText: /^Publish$/ });
const clickPublish = (f: Fixture) =>
  publishButton(f).evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());

test('#442 item 1: the publish dialog says plainly that shoppers can customize the product once it is live', {
  timeout: 20000,
}, async (t) => {
  const f = await fixture(t);
  await f.open();
  await clickPublish(f);
  const modal = f.page.locator('s-modal').filter({ hasText: 'Publish setup' });
  await modal.waitFor({ state: 'visible' });
  const text = await modal.innerText();
  assert.match(text, /Shoppers will be able to customize this product/);
  assert.doesNotMatch(text, /preview/i);
  await modal.getByRole('button', { name: 'Publish', exact: true }).waitFor();
});

test('#442 item 2: "Draft saved" goes to the Shopify toast, which stays long enough to read', {
  timeout: 20000,
}, async (t) => {
  const f = await fixture(t);
  await f.page.addInitScript(() => {
    const toasts: [string, { duration?: number } | undefined][] = [];
    (window as unknown as { toasts: typeof toasts }).toasts = toasts;
    window.shopify = {
      ...window.shopify,
      toast: { show: (message: string, options?: { duration?: number }) => toasts.push([message, options]) },
    } as Window['shopify'];
  });
  await f.open();
  await editName(f.page, 'Toasted');
  await hostSave(f.page);
  await f.page.waitForFunction(() => (window as unknown as { toasts: unknown[] }).toasts.length > 0);
  const [message, options] = await f.page.evaluate(
    () => (window as unknown as { toasts: [string, { duration?: number }][] }).toasts[0]!,
  );
  assert.equal(message, 'Draft saved. Publish separately to update the storefront.');
  assert.ok((options?.duration ?? 0) >= 8000, 'long enough to read');
  assert.equal(await f.page.locator('.placement-notice.is-feedback').count(), 0, 'no in-page banner over the fields');
  assert.equal(
    await f.page.locator('.placement-announcement', { hasText: 'Draft saved' }).count(),
    0,
    'the host toast announces it; the iframe live region does not repeat it',
  );
});

test('#442 item 4: the calibration hint says what to measure', { timeout: 20000 }, async (t) => {
  const value = structuredClone(draft);
  const front = required(required(value.selectedSetup).product.views[0]);
  delete front.calibration;
  const f = await fixture(t, { initialDraft: MerchantDraftSchema.parse(value) });
  await f.open();
  await clickPublish(f);
  const checklist = f.page.locator('s-modal').filter({ hasText: 'Finish setup' });
  await checklist.waitFor({ state: 'visible' });
  assert.match(await checklist.innerText(), /known width on the garment, such as the chest width/);
});

test('#442 item 5: a new size starts smaller than the existing sizes and is not a copy of them', {
  timeout: 20000,
}, async (t) => {
  const f = await fixture(t);
  await f.open();
  await f.page.getByRole('button', { name: 'Add size', exact: true }).click();
  const rows = () =>
    f.page
      .locator('.placement-size-row')
      .evaluateAll((nodes) =>
        nodes.map((row) => Array.from(row.querySelectorAll('s-text-field')).map((field) => field.value)),
      );
  // The fixture's only size is "Small" at 50 %; the new one is half of the smallest.
  assert.deepEqual(await rows(), [
    ['Small', '50'],
    ['Size 1', '25'],
  ]);
  await f.page.getByRole('button', { name: 'Add size', exact: true }).click();
  assert.deepEqual(
    (await rows()).map((row) => row[1]),
    ['50', '25', '12'],
  );
});

test('#442 item 7: Publish is disabled while the editor has no views', { timeout: 20000 }, async (t) => {
  const f = await fixture(t, { absent: true });
  await f.open();
  await f.page.getByText('Add your first product view').waitFor();
  assert.equal(await publishButton(f).evaluate((button: HTMLElementTagNameMap['s-button']) => button.disabled), true);
  await f.page.getByText('Publishing becomes available once the product has a view.').waitFor();
  assert.equal(f.mutations.length, 0);
});

test('#442 item 3: Enter in the Add method name field adds exactly one method; an empty name shows the name error', {
  timeout: 20000,
}, async (t) => {
  const f = await fixture(t);
  await f.open();
  await f.page.getByRole('button', { name: 'Manage methods', exact: true }).click();
  const dialog = f.page.locator('s-modal[data-method-dialog]');
  await dialog.getByRole('button', { name: 'Add method', exact: true }).first().click();
  const name = dialog.getByRole('textbox', { name: 'Method name', exact: true });
  await name.press('Enter');
  assert.ok(
    await dialog.locator('s-text-field[data-new-product-method]').getAttribute('error'),
    'empty name is refused',
  );
  await name.fill('Embroidery');
  await name.press('Enter');
  await f.page.keyboard.press('Enter');
  await name.waitFor({ state: 'detached' });
  // The new method is added to the placement and its price screen opens.
  await dialog.locator('section[aria-label*="Embroidery"]').waitFor();
  await dialog.getByRole('button', { name: 'Back to methods', exact: true }).click();
  assert.equal(await dialog.getByRole('checkbox', { name: 'Embroidery', exact: true }).count(), 1);
});
