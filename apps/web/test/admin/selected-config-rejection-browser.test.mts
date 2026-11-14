import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Page, Route } from 'playwright';
import type { ConfigRejectionCode } from '../../src/shared/config-rejection.ts';
import { editName, fixture, hostSave, storedIntent } from './support/selected-browser.mts';

// Built selected UI + real Polaris; the authenticated provider answers with synthetic 422 rejections (#438).
const nameField = (page: Page) => page.getByRole('textbox', { name: /^Placement name/ });
const retry = (page: Page) => page.getByRole('button', { name: 'Retry', exact: true });
const lostRequestText =
  'Your changes could not be confirmed. Retry the original request before saving different changes.';
const discardAndReload = (page: Page) => page.getByRole('button', { name: 'Discard changes and reload', exact: true });

type Rejection = {
  code?: ConfigRejectionCode | 'FUTURE_CODE';
  message?: string;
  validationIssues?: { path: string; message: string }[];
};
function rejectSavesOnce(rejection: Rejection) {
  const keys: (string | undefined)[] = [];
  const rule = (route: Route) => {
    const request = route.request();
    if (request.method() !== 'PUT') return route.fallback();
    keys.push(request.headers()['idempotency-key']);
    if (keys.length > 1) return route.fallback();
    return route.fulfill({
      status: 422,
      json: {
        kind: 'invalid',
        noEffect: true,
        message: 'Review the configuration validation errors before saving or publishing.',
        ...rejection,
      },
    });
  };
  return { keys, rule };
}

async function saveRejected(page: Page, message: string) {
  const response = page.waitForResponse((entry) => entry.request().method() === 'PUT');
  await hostSave(page);
  assert.equal((await response).status(), 422);
  // The banner holds its text beside an action button, so the text is matched as a substring.
  await page.getByText(message).first().waitFor();
}

const actionable: [ConfigRejectionCode, Rejection, string][] = [
  [
    'DRAFT_SCHEMA_INVALID',
    {
      validationIssues: [
        { path: 'selectedSetup.product.views.0.name', message: 'String must contain at least 1 character' },
      ],
    },
    'A value in this setup isn’t valid (selectedSetup.product.views.0.name). Correct it, then save again.',
  ],
  [
    'SETUP_CAPACITY_EXCEEDED',
    {},
    'This configuration exceeds the supported limits: 16 views, 32 placements, 32 methods, 64 decoration sizes, 250 variants, and 100 image or alignment overrides per view or placement.',
  ],
  [
    'SETUP_MEDIA_NOT_OWNED',
    {},
    'A view or option image isn’t one of this product’s Shopify images, or one image is used twice. Choose the product’s own images, then save again.',
  ],
  [
    'SETUP_SIZE_INVALID',
    {},
    'A decoration size must be more than 0% and at most 100% of the area. Correct the size, then save again.',
  ],
  [
    'PRICE_AMOUNT_INVALID',
    {},
    'A price has more decimal places than the shop currency allows, or isn’t a number. Prices are never rounded; correct the price, then save again.',
  ],
  [
    'LEAN_PRICING_INVALID',
    {},
    'Each price must be one final amount per item and cannot be negative. Correct the price, then save again.',
  ],
  [
    'GEOMETRY_INVALID',
    {},
    'A placement area doesn’t fit its view, or refers to a view or variant that no longer exists. Adjust the area, then save again.',
  ],
];
for (const [code, rest, text] of actionable)
  test(`a ${code} rejection says what to fix, offers no Retry, keeps the edit and lets a corrected save succeed`, {
    timeout: 30000,
  }, async (t) => {
    const f = await fixture(t);
    const rejecting = rejectSavesOnce({ code, ...rest });
    await f.page.route('**/api/admin/products/111/config', rejecting.rule);
    await f.open();
    await editName(f.page, 'Edit that the server rejected');
    await saveRejected(f.page, text);
    assert.equal(await retry(f.page).count(), 0, 'A rejection is deterministic; Retry would be rejected again');
    assert.equal(await f.page.getByText(lostRequestText).count(), 0);
    assert.equal(await f.page.getByRole('button', { name: 'Reload current draft' }).count(), 0);
    assert.equal(await discardAndReload(f.page).count(), 0, 'This rejection is fixed by editing, not reloading');
    assert.equal(await storedIntent(f.page), null, 'The rejected request leaves no pending write');
    assert.equal(await nameField(f.page).inputValue(), 'Edit that the server rejected', 'Edits stay in the editor');
    await editName(f.page, 'Corrected edit');
    const acknowledged = f.page.waitForResponse((entry) => entry.request().method() === 'PUT');
    await hostSave(f.page);
    assert.equal((await acknowledged).status(), 200);
    await f.page
      .getByText('Draft saved. Publish separately to update the storefront.', { exact: true })
      .first()
      .waitFor();
    assert.equal(await f.page.getByText(text, { exact: true }).count(), 0, 'A successful save clears the rejection');
    assert.equal(f.read().selectedSetup?.product.views[0]?.placements[0]?.name, 'Corrected edit');
    assert.equal(rejecting.keys.length, 2);
    assert.ok(rejecting.keys[0] && rejecting.keys[1] && rejecting.keys[0] !== rejecting.keys[1], 'A new request');
    assert.equal(await storedIntent(f.page), null);
  });

test('a rejection code without its own wording says "This change can\'t be saved" with the server reason', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  const rejecting = rejectSavesOnce({
    code: 'CONFIG_POLICY_INVALID',
    validationIssues: [{ path: 'placements', message: 'Placement uses a method that is not allowed' }],
  });
  await f.page.route('**/api/admin/products/111/config', rejecting.rule);
  await f.open();
  await editName(f.page, 'Generic rejection');
  await saveRejected(f.page, 'This change can’t be saved: Placement uses a method that is not allowed');
  assert.equal(await retry(f.page).count(), 0);
  assert.equal(await nameField(f.page).inputValue(), 'Generic rejection');
  assert.equal(await storedIntent(f.page), null);
});

test('a 422 from a newer server with an unknown code is still a rejection, not a lost request', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  const rejecting = rejectSavesOnce({ code: 'FUTURE_CODE', message: 'A rule this page does not know' });
  await f.page.route('**/api/admin/products/111/config', rejecting.rule);
  await f.open();
  await editName(f.page, 'Unknown code');
  await saveRejected(f.page, 'This change can’t be saved: A rule this page does not know');
  assert.equal(await retry(f.page).count(), 0);
  assert.equal(await storedIntent(f.page), null);
});

const reloading: [ConfigRejectionCode, string][] = [
  [
    'SHOP_CURRENCY_CHANGED',
    'The shop currency changed after this draft was made. Reload to review your prices in the new currency. Reloading discards the changes you have not saved.',
  ],
  [
    'METHOD_LINKS_CHANGED',
    'The methods linked to this product changed after this draft was made. Reload to review them. Reloading discards the changes you have not saved.',
  ],
  [
    'PRODUCT_IDENTITY_CHANGED',
    'This draft belongs to a different product. Reload this page to open the right draft. Reloading discards the changes you have not saved.',
  ],
  [
    'MEDIA_URL_NOT_CANONICAL',
    'A product image in this draft is out of date. Reload to refresh the images. Reloading discards the changes you have not saved.',
  ],
];
for (const [code, text] of reloading)
  test(`a ${code} rejection keeps the edit until the merchant chooses a Reload that says it discards changes`, {
    timeout: 30000,
  }, async (t) => {
    const f = await fixture(t);
    const rejecting = rejectSavesOnce({ code });
    await f.page.route('**/api/admin/products/111/config', rejecting.rule);
    await f.open();
    await editName(f.page, 'Unsaved edit');
    await saveRejected(f.page, text);
    assert.equal(await retry(f.page).count(), 0);
    assert.equal(await nameField(f.page).inputValue(), 'Unsaved edit', 'No forced reload or discard');
    assert.equal(await storedIntent(f.page), null);
    const reload = discardAndReload(f.page);
    await reload.waitFor();
    await Promise.all([f.page.waitForEvent('load'), reload.click()]);
    await f.page.locator('.placement-editor').waitFor({ state: 'visible' });
    assert.equal(await nameField(f.page).inputValue(), 'Right chest', 'Reload shows the saved draft');
  });

test('a rejected first dispatch leaves no pending write even when the fence request cannot be sent', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  const rejecting = rejectSavesOnce({ code: 'SETUP_SIZE_INVALID' });
  let fences = 0;
  await f.page.route('**/api/admin/products/111/config', (route) => {
    const request = route.request();
    if (request.method() === 'POST' && request.postDataJSON().action === 'reconcile') {
      fences++;
      return route.fulfill({ status: 503, json: { error: 'Service unavailable' } });
    }
    return rejecting.rule(route);
  });
  await f.open();
  await editName(f.page, 'Fence unavailable');
  await saveRejected(
    f.page,
    'A decoration size must be more than 0% and at most 100% of the area. Correct the size, then save again.',
  );
  assert.equal(fences, 1);
  assert.equal(await retry(f.page).count(), 0);
  assert.equal(await storedIntent(f.page), null);
  assert.equal(await nameField(f.page).inputValue(), 'Fence unavailable');
});

test('a rejection while publishing closes the review and shows what to fix, keeping the edit', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  const rejecting = rejectSavesOnce({ code: 'SETUP_SIZE_INVALID' });
  await f.page.route('**/api/admin/products/111/config', rejecting.rule);
  await f.open();
  await editName(f.page, 'Rejected while publishing');
  await f.page
    .locator('s-button[slot="primary-action"]')
    .filter({ hasText: /^Publish$/ })
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  const modal = f.page.locator('s-modal').filter({ hasText: 'Publish setup' });
  await modal.getByRole('button', { name: 'Publish preview', exact: true }).click();
  await f.page
    .getByText(
      'A decoration size must be more than 0% and at most 100% of the area. Correct the size, then save again.',
      {
        exact: true,
      },
    )
    .first()
    .waitFor();
  assert.equal(await f.page.getByText('Your browser could not publish this preview.', { exact: false }).count(), 0);
  assert.equal(await retry(f.page).count(), 0);
  assert.equal(await storedIntent(f.page), null);
  assert.equal(await nameField(f.page).inputValue(), 'Rejected while publishing');
});

for (const [name, lose] of [
  ['a 503', (route: Route) => route.fulfill({ status: 503, json: { error: 'Admin service unavailable' } })],
  ['a network failure', (route: Route) => route.abort('timedout')],
] as const)
  test(`${name} stays an unconfirmed write: the original request can be retried, with its identity kept`, {
    timeout: 30000,
  }, async (t) => {
    const f = await fixture(t);
    const writes: { key: string | undefined; body: string | null }[] = [];
    await f.page.route('**/api/admin/products/111/config', (route) => {
      const request = route.request();
      if (request.method() !== 'PUT') return route.fallback();
      writes.push({ key: request.headers()['idempotency-key'], body: request.postData() });
      return writes.length === 1 ? lose(route) : route.fallback();
    });
    await f.open();
    await editName(f.page, 'Lost response');
    await hostSave(f.page);
    await f.page.getByText(lostRequestText, { exact: true }).first().waitFor();
    await retry(f.page).first().waitFor();
    assert.ok(await storedIntent(f.page), 'The unresolved write stays in custody');
    assert.equal(await f.page.getByText('This change can’t be saved', { exact: false }).count(), 0);
    const acknowledged = f.page.waitForResponse((entry) => entry.request().method() === 'PUT');
    await retry(f.page).first().click();
    assert.equal((await acknowledged).status(), 200);
    await f.page.waitForFunction(
      () =>
        !sessionStorage.getItem(
          'insignia:selected-product-write:v1:selected-browser.myshopify.com:gid://shopify/Product/111',
        ),
    );
    assert.deepEqual(writes[1], writes[0]);
    assert.equal(f.read().selectedSetup?.product.views[0]?.placements[0]?.name, 'Lost response');
  });
