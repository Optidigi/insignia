import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MerchantDraftSchema } from '@insignia/contracts';
import {
  artifacts,
  authority,
  editName,
  fixture,
  hostSave,
  imageUrl,
  methodId,
  storedIntent,
} from './support/selected-browser.mts';

// Scope: real built UI/client/Polaris in an isolated browser with synthetic provider HTTP.
// These are not native Shopify save-bar observations or owner visual acceptance.
test('selected desktop and mobile layouts retain their workspace columns, image and accessible panel navigation', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  await f.open();
  const nativeLabels = await f.page
    .locator(
      's-page > s-button-group[slot="secondary-actions"] > s-button, s-page > s-button[commandfor="placement-page-actions"]',
    )
    .evaluateAll((buttons) => buttons.map((button) => button.textContent?.trim()));
  assert.deepEqual(
    nativeLabels,
    ['Hide views and placements', 'Undo', 'Redo', 'More actions'],
    'Bridge native-header export needs text labels even when controls render as icons',
  );
  const bounds = await f.page.locator('.placement-editor').evaluate((editor) => {
    const outline = editor.querySelector('.placement-outline')?.getBoundingClientRect();
    const canvas = editor.querySelector('.placement-workspace')?.getBoundingClientRect();
    const props = editor.querySelector('.placement-properties')?.getBoundingClientRect();
    if (!outline || !canvas || !props) throw new Error('Selected workspace panels missing');
    return {
      outline: { x: outline.x, width: outline.width },
      canvas: { x: canvas.x, width: canvas.width },
      props: { x: props.x, width: props.width },
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  assert.equal(bounds.outline.x, 4);
  assert.equal(bounds.canvas.x, 288);
  assert.equal(bounds.props.x, 952);
  assert.equal(bounds.outline.width, 280);
  assert.equal(bounds.props.width, 324);
  assert.ok(bounds.outline.x < bounds.canvas.x && bounds.canvas.x < bounds.props.x);
  assert.ok(bounds.canvas.width > 500);
  assert.equal(bounds.overflow, false);
  await f.page.screenshot({ path: new URL('desktop.png', artifacts).pathname });
  await f.page.setViewportSize({ width: 390, height: 844 });
  await f.page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await f.page.getByRole('textbox', { name: /^Placement name/ }).waitFor({ state: 'visible' });
  assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await f.page.getByRole('tab', { name: 'Settings', exact: true }).getAttribute('aria-selected'), 'true');
  await f.page.screenshot({ path: new URL('mobile.png', artifacts).pathname });
});

test('a selected draft edit saves through the actual journal client with its frozen scope and visible confirmed value', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  await f.open();
  await editName(f.page, 'Chest after save');
  const savedResponse = f.page.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.url().endsWith('/api/admin/products/111/config'),
  );
  await hostSave(f.page);
  assert.equal((await savedResponse).status(), 200);
  await f.page.waitForFunction(
    () =>
      !sessionStorage.getItem(
        'insignia:selected-product-write:v1:selected-browser.myshopify.com:gid://shopify/Product/111',
      ),
  );
  await f.page.getByRole('textbox', { name: /^Placement name/ }).waitFor();
  assert.equal(await f.page.getByRole('textbox', { name: /^Placement name/ }).inputValue(), 'Chest after save');
  const writes = f.mutations.filter((entry) => entry.method === 'PUT');
  assert.equal(writes.length, 1);
  const written = writes[0];
  assert.ok(written);
  assert.equal(writes[0]?.authority, authority);
  assert.match(writes[0]?.key ?? '', /:save$/);
  assert.equal(
    MerchantDraftSchema.parse(JSON.parse(written.body).draft).selectedSetup?.product.views[0]?.placements[0]?.name,
    'Chest after save',
  );
});

test('delayed saves fence keyboard, programmatic native/header actions and input events from changing the committed candidate', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t, { holdSave: true });
  await f.open();
  await editName(f.page, 'Frozen save name');
  await hostSave(f.page);
  await f.saveReceived;
  await f.page.waitForFunction(() => {
    const button = document.querySelector('ui-save-bar button[variant="primary"]');
    return button instanceof HTMLButtonElement && button.disabled;
  });
  await f.page
    .locator('s-text-field[name="placement-name"]')
    .evaluate((field: HTMLElementTagNameMap['s-text-field']) => {
      field.value = 'Late injected name';
      field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    });
  await f.page.keyboard.press('Control+s');
  await hostSave(f.page);
  await f.page
    .locator('s-button-group[slot="secondary-actions"] s-button[icon="undo"]')
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  await f.page
    .locator('s-button[slot="primary-action"]')
    .filter({ hasText: /^Publish$/ })
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  assert.equal(await f.page.locator('s-modal').filter({ hasText: 'Publish setup' }).isVisible(), false);
  assert.equal(f.mutations.filter((entry) => entry.method === 'PUT').length, 1);
  f.release();
  await f.page.waitForFunction(
    () =>
      !sessionStorage.getItem(
        'insignia:selected-product-write:v1:selected-browser.myshopify.com:gid://shopify/Product/111',
      ),
  );
  assert.equal(f.read().selectedSetup?.product.views[0]?.placements[0]?.name, 'Frozen save name');
  assert.equal(await f.page.getByRole('textbox', { name: /^Placement name/ }).inputValue(), 'Frozen save name');
});

test('a pending publication remains visibly pending and reuses its original publication identity', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t, { publicationPending: true });
  await f.open();
  await f.page
    .locator('s-button[slot="primary-action"]')
    .filter({ hasText: /^Publish$/ })
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  const modal = f.page.locator('s-modal').filter({ hasText: 'Publish setup' });
  await modal.getByRole('button', { name: 'Publish preview', exact: true }).click();
  await f.page
    .getByText('Publication is still processing. Continue the original request to check its status.', { exact: true })
    .waitFor();
  assert.equal(await f.page.getByText('Published', { exact: true }).count(), 0);
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  const retryAcknowledged = f.page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && (response.request().postData() ?? '').includes('"action":"publish"'),
  );
  await f.page.getByRole('button', { name: 'Retry', exact: true }).click();
  await retryAcknowledged;
  await f.page.waitForFunction(
    () =>
      JSON.parse(
        sessionStorage.getItem(
          'insignia:selected-product-write:v1:selected-browser.myshopify.com:gid://shopify/Product/111',
        ) ?? 'null',
      )?.stage === 'publish',
  );
  assert.equal(
    f.mutations.filter((entry) => entry.method === 'PUT').length,
    1,
    'Publication continuation must not issue another save',
  );
  const publishes = f.mutations.filter((entry) => entry.key?.endsWith(':publish'));
  assert.equal(publishes.length, 2);
  assert.equal(publishes[1]?.key, publishes[0]?.key);
  assert.equal(publishes[1]?.body, publishes[0]?.body);
  assert.notEqual(
    publishes[1]?.key,
    'm5pub_cfg-selected-111_2_1',
    'Continuation uses the HTTP intent identity, not a different server publication key',
  );
});

test('read-only selected views cannot dispatch save/publication through synthetic host or keyboard actions', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t, { readOnly: true });
  await f.open();
  await f.page
    .locator('s-text-field[name="placement-name"]')
    .evaluate((field: HTMLElementTagNameMap['s-text-field']) => {
      field.value = 'Forbidden';
      field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    });
  await hostSave(f.page);
  await f.page.keyboard.press('Control+s');
  await f.page
    .locator('s-button[slot="primary-action"]')
    .filter({ hasText: /^Publish$/ })
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  const publish = f.page.locator('s-modal').filter({ hasText: 'Publish setup' });
  if (await publish.isVisible()) {
    await publish
      .getByRole('button', { name: 'Publish preview', exact: true })
      .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  }
  await f.page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  assert.equal(f.mutations.length, 0);
  assert.equal(await storedIntent(f.page), null);
});

test('a first selected view creates its configuration then saves one exact authoring intent', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t, { absent: true });
  await f.open();
  await f.page.locator('[data-outline-add-view]').click();
  const picker = f.page.locator('s-modal').filter({ has: f.page.locator('.placement-image-picker') });
  const choice = picker.locator('button.placement-image-choice').first();
  await choice.waitFor({ state: 'visible' });
  await f.page.waitForFunction(() => {
    const input = document.querySelector('.placement-image-picker button.placement-image-choice');
    return input instanceof HTMLButtonElement && !input.disabled;
  });
  await choice.click();
  await picker.getByRole('button', { name: 'Add view', exact: true }).click();
  await f.page.getByRole('textbox', { name: /^View name/ }).fill('First authored view');
  const saveAcknowledged = f.page.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.url().endsWith('/api/admin/products/111/config'),
  );
  await hostSave(f.page);
  await saveAcknowledged;
  await f.page.waitForFunction(
    () =>
      !sessionStorage.getItem(
        'insignia:selected-product-write:v1:selected-browser.myshopify.com:gid://shopify/Product/111',
      ),
  );
  const created = f.mutations.filter((entry) => JSON.parse(entry.body).action === 'create');
  const saved = f.mutations.filter((entry) => entry.method === 'PUT');
  assert.equal(created.length, 1);
  assert.equal(saved.length, 1);
  assert.equal(created[0]?.key?.replace(/:create$/, ''), saved[0]?.key?.replace(/:save$/, ''));
  assert.equal(f.read().selectedSetup?.product.views[0]?.name, 'First authored view');
  assert.equal(f.read().selectedSetup?.product.views[0]?.imageUrl, imageUrl);
});

for (const closePath of ['X', 'Escape', 'Cancel'] as const) {
  test(`Shopify-hosted Add views ${closePath} clears the host overlay and restores focus`, {
    timeout: 30000,
  }, async (t) => {
    const f = await fixture(t, { shopifyModal: true });
    await f.open();
    const trigger = f.page.locator('[data-outline-add-view]');
    await trigger.click();
    const picker = f.page
      .locator('s-modal[data-method-dialog]')
      .filter({ has: f.page.locator('.placement-image-picker') });
    await picker.waitFor({ state: 'visible' });
    await f.page.locator('[data-shopify-host-modal-scrim]').waitFor({ state: 'attached' });

    if (closePath === 'X') {
      const id = await picker.getAttribute('id');
      const imageChoice = picker.locator('button.placement-image-choice').first();
      await imageChoice.waitFor({ state: 'visible' });
      await f.page.waitForFunction(() => {
        const choice = document.querySelector('.placement-image-picker button.placement-image-choice');
        return choice instanceof HTMLButtonElement && !choice.disabled;
      });
      await imageChoice.click();
      assert.equal(await picker.getAttribute('id'), id, 'The host routing ID remains stable as the picker rerenders');
      await f.page.evaluate(() => window.dismissShopifyModal());
    } else if (closePath === 'Escape') await f.page.keyboard.press('Escape');
    else await picker.getByRole('button', { name: 'Cancel', exact: true }).click();

    await picker.waitFor({ state: 'detached' });
    await f.page.locator('[data-shopify-host-modal-scrim]').waitFor({ state: 'detached' });
    await f.page.waitForFunction(() => {
      const button = document.querySelector('[data-outline-add-view]');
      return button instanceof HTMLElement && document.activeElement === button;
    });
    assert.equal(f.mutations.length, 0, 'Closing the picker does not save a design change');
  });
}

test('equal-valued explicit Method edits become dirty metadata and undo restores inheritance before an exact save', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  await f.open();
  async function makeEqualOverride() {
    await f.page.getByRole('button', { name: 'Edit Printing price', exact: true }).click();
    const dialog = f.page.locator('s-modal').filter({ has: f.page.locator('[data-method-price-field]') });
    await dialog.getByRole('spinbutton', { name: /^Price per placement per item/ }).fill('3.50');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await f.page.waitForFunction(() => {
      const button = document.querySelector('ui-save-bar button[variant="primary"]');
      return button instanceof HTMLButtonElement && !button.disabled;
    });
  }
  await makeEqualOverride();
  assert.equal(f.mutations.length, 0);
  await f.page
    .locator('s-button-group[slot="secondary-actions"] s-button[icon="undo"]')
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  await f.page.waitForFunction(() => {
    const button = document.querySelector('ui-save-bar button[variant="primary"]');
    return button instanceof HTMLButtonElement && button.disabled;
  });
  assert.equal(f.mutations.length, 0);
  await makeEqualOverride();
  const savedResponse = f.page.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.url().endsWith('/api/admin/products/111/config'),
  );
  await hostSave(f.page);
  assert.equal((await savedResponse).status(), 200);
  await f.page.waitForFunction(
    () =>
      !sessionStorage.getItem(
        'insignia:selected-product-write:v1:selected-browser.myshopify.com:gid://shopify/Product/111',
      ),
  );
  const persisted = f.read();
  assert.equal(persisted.selectedSetup?.methodBindings[methodId]?.prices.default?.source, 'product');
  assert.equal(persisted.selectedSetup?.product.methods[0]?.amount, '3.50');
  assert.equal(
    persisted.pricingRules[0]?.rate.kind === 'fixed' && persisted.pricingRules[0].rate.amount.shopDecimal,
    '3.50',
  );
});

test('unsaved merchant preview accepts a viewBox-only SVG without production upload or cart authority', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  await f.open();
  const popup = f.page.waitForEvent('popup');
  await f.page.locator('s-button[accessibilitylabel="Preview customization"]').evaluate((button) => {
    if (!(button instanceof HTMLElement)) throw new Error('Missing HTML preview control');
    button.click();
  });
  const preview = await popup;
  preview.setDefaultTimeout(5000);
  const requests: string[] = [];
  preview.on('request', (request) => {
    if (request.method() !== 'GET') requests.push(new URL(request.url()).pathname);
  });
  await preview.getByRole('button', { name: 'Add artwork', exact: true }).click();
  await preview.getByRole('button', { name: 'Choose artwork Choose', exact: true }).click();
  await preview
    .locator('input[type=file]')
    .setInputFiles(new URL('../../../../frontend/designer/public/trail-logo.svg', import.meta.url).pathname);
  await preview.locator('img[src^="blob:"]').first().waitFor();
  assert.equal(
    await preview
      .locator('img[src^="blob:"]')
      .first()
      .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
    true,
  );
  assert.doesNotMatch(await preview.locator('body').innerText(), /couldn.t open this image/i);
  assert.equal(f.mutations.length, 0);
  assert.deepEqual(requests, [], 'preview artwork stays browser-local');
  await preview.close();
});
