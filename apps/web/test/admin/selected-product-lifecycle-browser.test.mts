import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MerchantDraftSchema } from '@insignia/contracts';
import type { Page } from 'playwright';
import { required } from './support/fixtures.mts';
import {
  catalog,
  draft,
  editName,
  fixture,
  hostSave,
  methodId,
  preferences,
  storedIntent,
} from './support/selected-browser.mts';

async function acknowledgedSave(page: Page) {
  const response = page.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.url().endsWith('/api/admin/products/111/config'),
  );
  await hostSave(page);
  return response;
}
async function openPublication(page: Page) {
  await page
    .locator('s-button[slot="primary-action"]')
    .filter({ hasText: /^Publish$/ })
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  return page.locator('s-modal').filter({ hasText: 'Publish setup' });
}
async function settleFrame(page: Page) {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

test('unsupported historical advanced economics remain inaccessible to editing and cannot be silently repriced', {
  timeout: 20000,
}, async (t) => {
  const historical = MerchantDraftSchema.parse({
    ...draft,
    selectedSetup: undefined,
    pricingRules: [
      {
        id: 'historical',
        role: 'setup',
        scope: { kind: 'general' },
        rate: {
          kind: 'fixed',
          amount: { shopDecimal: '10.00', presentmentOverrides: [{ currency: 'EUR', decimal: '9.00' }] },
        },
      },
    ],
  });
  const f = await fixture(t, { initialDraft: historical });
  await f.page.goto(`${f.base}/admin/products/111/config?locale=en`);
  await f.page.locator('s-page[heading="Product could not be loaded"]').waitFor({ state: 'attached' });
  await f.page
    .getByText(
      'This configuration uses prices that this editor cannot represent safely. Its saved draft and published prices remain unchanged. Review the pricing before converting it.',
      { exact: true },
    )
    .waitFor();
  assert.equal(await f.page.getByText('Try reloading the page.', { exact: true }).count(), 0);
  assert.equal(await f.page.locator('.placement-editor').count(), 0);
  assert.equal(f.mutations.length, 0);
  assert.equal(f.read().pricingRules[0]?.role, 'setup');
  assert.equal(await storedIntent(f.page), null);
});

test('typed geometry reaches the selected owner before blur and remains exact after an unrelated render and save', {
  timeout: 20000,
}, async (t) => {
  const f = await fixture(t);
  await f.open();
  const horizontal = f.page.getByRole('spinbutton', { name: 'Center X', exact: true });
  await horizontal.fill('40');
  await editName(f.page, 'Rerender without geometry loss');
  assert.equal(await horizontal.inputValue(), '40');
  assert.equal((await acknowledgedSave(f.page)).status(), 200);
  await f.page.waitForFunction(
    () =>
      !sessionStorage.getItem(
        'insignia:selected-product-write:v1:selected-browser.myshopify.com:gid://shopify/Product/111',
      ),
  );
  assert.equal(f.read().selectedSetup?.product.views[0]?.placements[0]?.rect.centerX, 0.4);
  assert.equal(await horizontal.inputValue(), '40');
});

for (const invalid of ['-1', '1.001'])
  test(`selected price validation blocks ${invalid} and cannot dispatch a save`, { timeout: 20000 }, async (t) => {
    const f = await fixture(t);
    await f.open();
    await f.page.getByRole('button', { name: 'Edit Printing price', exact: true }).click();
    const modal = f.page.locator('s-modal').filter({ has: f.page.locator('[data-method-price-field]') });
    await modal.getByRole('spinbutton', { name: 'Price per placement per item', exact: true }).fill(invalid);
    const done = modal.getByRole('button', { name: 'Done', exact: true });
    await done.click();
    await modal.getByText('Enter a valid nonnegative price.', { exact: true }).waitFor();
    await f.page
      .locator('s-button[slot="primary-action"]')
      .filter({ hasText: /^Publish$/ })
      .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
    await f.page
      .locator('s-menu#placement-page-actions s-button')
      .filter({ hasText: 'Copy setup to products' })
      .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
    assert.equal(await modal.isVisible(), true);
    assert.equal(await f.page.locator('s-modal').filter({ hasText: 'Publish setup' }).count(), 0);
    assert.equal(f.mutations.length, 0);
    assert.equal(await storedIntent(f.page), null);
  });

test('a CAS conflict preserves local edits and requires explicit reload of the winning saved draft', {
  timeout: 20000,
}, async (t) => {
  const f = await fixture(t);
  let conflict = false;
  let reads = 0;
  const winning = structuredClone(draft);
  required(required(required(winning.selectedSetup).product.views[0]).placements[0]).name = 'Winning saved name';
  await f.page.route('**/api/admin/products/111/config', async (route) => {
    if (route.request().method() === 'PUT') {
      conflict = true;
      return route.fulfill({
        status: 409,
        json: { error: 'Draft changed. Reload and review the current version.', noEffect: true },
      });
    }
    if (conflict && route.request().method() === 'GET') {
      reads++;
      const view = f.view();
      required(view.config).draft = winning;
      required(view.config).draftVersion = '2';
      return route.fulfill({ json: view });
    }
    return route.fallback();
  });
  await f.open();
  await editName(f.page, 'My losing local name');
  assert.equal((await acknowledgedSave(f.page)).status(), 409);
  await f.page.getByRole('button', { name: 'Reload current draft', exact: true }).waitFor();
  assert.equal(await f.page.getByRole('textbox', { name: /^Placement name/ }).inputValue(), 'My losing local name');
  assert.equal(reads, 0, 'Conflict must not silently replace an unsaved edit');
  assert.equal(await storedIntent(f.page), null);
  assert.equal(f.reconciliations.length, 1, 'Known rejection is fenced without replacing the losing local edit');
  await f.page.getByRole('button', { name: 'Reload current draft', exact: true }).click();
  await f.page.getByRole('textbox', { name: /^Placement name/ }).waitFor();
  assert.equal(await f.page.getByRole('textbox', { name: /^Placement name/ }).inputValue(), 'Winning saved name');
  assert.equal(reads, 1);
});

for (const denied of [401, 403])
  test(`current ${denied} authorization loss clears private selected state and dispatches no write`, {
    timeout: 20000,
  }, async (t) => {
    const f = await fixture(t);
    let revoked = false;
    let checks = 0;
    await f.page.route('**/api/admin/preferences', async (route) => {
      if (!revoked) return route.fallback();
      checks++;
      return route.fulfill({ status: denied, json: { error: 'Current authorization required' } });
    });
    await f.open();
    await editName(f.page, 'Must be cleared after denial');
    revoked = true;
    await hostSave(f.page);
    await f.page.locator('.placement-editor').waitFor({ state: 'detached' });
    assert.ok(checks >= 1);
    assert.equal(f.mutations.length, 0);
    assert.equal(await storedIntent(f.page), null);
    assert.equal(await f.page.getByText('Synthetic selected hoodie', { exact: true }).count(), 0);
  });

for (const state of ['OPERATOR_HOLD', 'RESTORATION_CONFLICT', 'CONFLICT'] as const)
  test(`${state} prevents another selected publication even when stale eligibility is allowed`, {
    timeout: 20000,
  }, async (t) => {
    const f = await fixture(t);
    await f.page.route('**/api/admin/products/111/config', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const view = f.view();
      required(view.config).publication.state = state;
      required(view.config).publishEligibility = { allowed: true, reason: null };
      return route.fulfill({ json: view });
    });
    await f.open();
    const modal = await openPublication(f.page);
    if (await modal.isVisible()) {
      const publish = modal.getByRole('button', { name: 'Publish preview', exact: true });
      if (await publish.count()) await publish.evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
    }
    await settleFrame(f.page);
    assert.equal(f.mutations.length, 0);
    assert.equal(await storedIntent(f.page), null);
  });

test('unknown save results retain immutable custody across malformed success and exact retry', {
  timeout: 20000,
}, async (t) => {
  const f = await fixture(t);
  const writes: { key: string | undefined; body: string | null }[] = [];
  await f.page.route('**/api/admin/products/111/config', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    writes.push({ key: route.request().headers()['idempotency-key'], body: route.request().postData() });
    return writes.length === 1
      ? route.fulfill({ status: 200, contentType: 'application/json', body: '{bad-json' })
      : route.fallback();
  });
  await f.open();
  await editName(f.page, 'Malformed success recovery');
  await hostSave(f.page);
  await f.page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  const original = await storedIntent(f.page);
  assert.ok(original);
  await f.page
    .locator('s-text-field[name="placement-name"]')
    .evaluate((field: HTMLElementTagNameMap['s-text-field']) => {
      field.value = 'Forbidden replacement';
      field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    });
  await f.page
    .locator('ui-save-bar button')
    .nth(1)
    .evaluate((button: HTMLButtonElement) => button.click());
  assert.equal(await storedIntent(f.page), original);
  const acknowledged = f.page.waitForResponse((response) => response.request().method() === 'PUT');
  await f.page.getByRole('button', { name: 'Retry', exact: true }).click();
  await acknowledged;
  await f.page.waitForFunction(
    () =>
      !sessionStorage.getItem(
        'insignia:selected-product-write:v1:selected-browser.myshopify.com:gid://shopify/Product/111',
      ),
  );
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1], writes[0]);
  assert.equal(
    await f.page.getByRole('textbox', { name: /^Placement name/ }).inputValue(),
    'Malformed success recovery',
  );
});

test('session storage denial fails closed before selected authoring dispatch', { timeout: 20000 }, async (t) => {
  const f = await fixture(t);
  await f.page.addInitScript(() =>
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw new DOMException('Denied', 'SecurityError');
      },
    }),
  );
  await f.page.goto(`${f.base}/admin/products/111/config?locale=en`);
  await f.page.locator('s-page[heading="Product could not be loaded"]').waitFor({ state: 'attached' });
  await f.page.getByText('Try reloading the page.', { exact: true }).waitFor();
  assert.equal(await f.page.locator('.placement-editor').count(), 0);
  assert.equal(f.mutations.length, 0);
});

test('an older ACTIVE revision cannot settle a newer selected publication intent', { timeout: 20000 }, async (t) => {
  const f = await fixture(t);
  let publishing = false;
  let current = false;
  const publishes: { key: string | undefined; body: string | null }[] = [];
  await f.page.route('**/api/admin/products/111/config', async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && request.postDataJSON().action === 'publish') {
      publishing = true;
      publishes.push({ key: request.headers()['idempotency-key'], body: request.postData() });
      return route.fulfill({
        status: 202,
        json: { kind: 'accepted', state: 'REMOTE_PENDING', revisionId: 'new-revision' },
      });
    }
    if (publishing && request.method() === 'GET') {
      const view = f.view();
      const config = required(view.config);
      config.publication = {
        ...config.publication,
        state: 'ACTIVE',
        revisionId: current ? 'new-revision' : 'older-revision',
        sourceDraftVersion: current ? '2' : '1',
        requestKey: current ? 'm5pub_cfg-selected-111_2_1' : 'm5pub_cfg-selected-111_1_1',
        activeRevisionId: current ? 'new-revision' : 'older-revision',
      };
      config.publishedSetup = structuredClone(required(draft.selectedSetup));
      return route.fulfill({ json: view });
    }
    return route.fallback();
  });
  await f.open();
  const modal = await openPublication(f.page);
  await modal.getByRole('button', { name: 'Publish preview', exact: true }).click();
  await f.page
    .getByText('Publication is still processing. Continue the original request to check its status.', { exact: true })
    .waitFor();
  assert.ok(await storedIntent(f.page), 'Older ACTIVE revision must not erase newer custody');
  assert.equal(await f.page.getByText('Published', { exact: true }).count(), 0);
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  current = true;
  const response = f.page.waitForResponse((response) => response.request().method() === 'POST');
  await f.page.getByRole('button', { name: 'Retry', exact: true }).click();
  await response;
  await f.page.waitForFunction(
    () =>
      !sessionStorage.getItem(
        'insignia:selected-product-write:v1:selected-browser.myshopify.com:gid://shopify/Product/111',
      ),
  );
  assert.equal(publishes.length, 2);
  assert.deepEqual(publishes[1], publishes[0]);
});

test('Shopify save state and confirmed discard restore the selected draft without dispatching a write', {
  timeout: 20000,
}, async (t) => {
  const f = await fixture(t);
  await f.open();
  await editName(f.page, 'Unsaved placement');
  await f.page.waitForFunction(() => window.saveBarEvents.some(([kind]) => kind === 'show'));
  const discard = f.page.locator('ui-save-bar button').nth(1);
  await discard.evaluate((button: HTMLButtonElement) => button.click());
  const modal = f.page.locator('#discard-product-changes');
  await modal.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  assert.equal(await f.page.getByRole('textbox', { name: /^Placement name/ }).inputValue(), 'Unsaved placement');
  await discard.evaluate((button: HTMLButtonElement) => button.click());
  await modal.getByRole('button', { name: 'Discard', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  assert.equal(await f.page.getByRole('textbox', { name: /^Placement name/ }).inputValue(), 'Right chest');
  assert.equal(f.mutations.length, 0);
  assert.equal(await storedIntent(f.page), null);
  assert.equal(await f.page.locator('ui-save-bar button[variant="primary"]').isDisabled(), true);
});

test('cancelled dirty selected navigation preserves local edits and the current usable workspace', {
  timeout: 20000,
}, async (t) => {
  const f = await fixture(t);
  await f.open();
  await editName(f.page, 'Keep before leaving');
  await f.page
    .locator('s-link[slot="breadcrumb-actions"]')
    .evaluate((link: HTMLElementTagNameMap['s-link']) => link.click());
  const modal = f.page.locator('s-modal').filter({ hasText: 'Leave without saving?' });
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  assert.equal(new URL(f.page.url()).pathname, '/admin/products/111/config');
  assert.equal(await f.page.getByRole('textbox', { name: /^Placement name/ }).inputValue(), 'Keep before leaving');
  assert.equal(await f.page.locator('#admin-route-content').evaluate((element: HTMLElement) => element.inert), false);
  assert.equal(f.mutations.length, 0);
});

test('a currency change preserves the original amounts until explicit merchant review adopts the current shop currency', {
  timeout: 20000,
}, async (t) => {
  const f = await fixture(t);
  await f.page.route('**/api/admin/methods?view=catalog', (route) =>
    route.fulfill({ json: { ...catalog, currency: 'EUR' } }),
  );
  await f.page.route('**/api/admin/products/111/config', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const view = f.view();
    const config = required(view.config);
    config.currentShopCurrency = 'EUR';
    config.publishEligibility = {
      allowed: MerchantDraftSchema.parse(config.draft).shopCurrency === 'EUR',
      reason: MerchantDraftSchema.parse(config.draft).shopCurrency === 'EUR' ? null : 'Shop currency changed',
    };
    return route.fulfill({ json: view });
  });
  await f.open();
  await f.page.getByRole('button', { name: 'Review prices in the shop currency', exact: true }).waitFor();
  assert.match(
    await f.page
      .locator('s-banner')
      .filter({ hasText: /The shop currency is now EUR/ })
      .innerText(),
    /^The shop currency is now EUR/,
  );
  assert.equal(f.read().shopCurrency, 'USD');
  assert.equal(f.read().selectedSetup?.product.methods[0]?.amount, '3.50');
  await hostSave(f.page);
  assert.equal(f.mutations.length, 0);
  await f.page.getByRole('button', { name: 'Review prices in the shop currency', exact: true }).click();
  await editName(f.page, 'Explicit EUR price review');
  assert.equal((await acknowledgedSave(f.page)).status(), 200);
  await f.page.waitForFunction(
    () =>
      !sessionStorage.getItem(
        'insignia:selected-product-write:v1:selected-browser.myshopify.com:gid://shopify/Product/111',
      ),
  );
  assert.equal(f.read().shopCurrency, 'EUR');
  assert.equal(f.read().selectedSetup?.product.methods[0]?.amount, '3.50');
  assert.equal(f.read().selectedSetup?.methodBindings[methodId]?.prices.default?.source, 'product');
});

for (const readback of ['failed', 'stale'] as const)
  test(`a ${readback} read after acknowledged save cannot authorize selected publication`, {
    timeout: 20000,
  }, async (t) => {
    const f = await fixture(t);
    let saved = false;
    await f.page.route('**/api/admin/products/111/config', (route) => {
      if (route.request().method() === 'PUT') {
        saved = true;
        return route.fallback();
      }
      if (saved && route.request().method() === 'GET') {
        if (readback === 'failed') return route.fulfill({ status: 503, json: { error: 'Saved readback unavailable' } });
        const view = f.view();
        required(view.config).draftVersion = '999';
        return route.fulfill({ json: view });
      }
      return route.fallback();
    });
    await f.open();
    await editName(f.page, 'Save is acknowledged, read is unverified');
    await acknowledgedSave(f.page);
    await f.page.getByRole('button', { name: 'Reload current draft', exact: true }).waitFor();
    assert.equal(await storedIntent(f.page), null, 'Known committed save is not another pending mutation');
    assert.equal(
      await f.page.getByRole('textbox', { name: /^Placement name/ }).inputValue(),
      'Save is acknowledged, read is unverified',
    );
    assert.equal(
      await f.page
        .locator('s-button[slot="primary-action"]')
        .filter({ hasText: /^Publish$/ })
        .evaluate((button: HTMLElementTagNameMap['s-button']) => button.disabled),
      true,
      'Unverified settlement cannot offer a new publication',
    );
    const modal = await openPublication(f.page);
    if (await modal.isVisible()) {
      const publish = modal.getByRole('button', { name: 'Publish preview', exact: true });
      if (await publish.count()) await publish.evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
    }
    await settleFrame(f.page);
    assert.equal(f.mutations.filter((entry) => JSON.parse(entry.body).action === 'publish').length, 0);
  });

test('authorization denial during a pending save fences its late completion from restoring private selected state', {
  timeout: 20000,
}, async (t) => {
  const f = await fixture(t, { holdSave: true });
  let denied = false;
  await f.page.route('**/api/admin/products/111/config', (route) =>
    denied && route.request().method() === 'GET'
      ? route.fulfill({ status: 403, json: { error: 'Current authorization required' } })
      : route.fallback(),
  );
  await f.open();
  await editName(f.page, 'Pending private value');
  await hostSave(f.page);
  await f.saveReceived;
  denied = true;
  await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  try {
    await f.page.locator('.placement-editor').waitFor({ state: 'detached' });
    const response = f.page.waitForResponse((response) => response.request().method() === 'PUT');
    f.release();
    await response;
    await settleFrame(f.page);
    assert.equal(await f.page.locator('.placement-editor').count(), 0);
    assert.equal(await f.page.getByText('Pending private value', { exact: true }).count(), 0);
  } finally {
    f.release();
  }
});

test('adding a real catalogue Method changes only the unsaved selected product and records explicit inheritance', {
  timeout: 20000,
}, async (t) => {
  const f = await fixture(t);
  const importedId = '3c251e0d-26b6-49dd-9564-61eaac0321df';
  const imported = {
    version: '1',
    currency: 'USD',
    configuration: {
      id: importedId,
      name: 'Embroidery',
      explanation: 'Stitched decoration',
      pricing: 'fixed',
      amount: '4.50',
      assignment: 'manual',
      productIds: ['111'],
      tags: [],
      tagMatch: 'any',
    },
  };
  await f.page.route('**/api/admin/methods?view=catalog', (route) =>
    route.fulfill({ json: { ...catalog, methods: [...catalog.methods, imported] } }),
  );
  await f.open();
  await f.page.getByRole('button', { name: 'Manage methods', exact: true }).click();
  const dialog = f.page.locator('s-modal').filter({ has: f.page.locator('.pm-manager') });
  await dialog.getByRole('checkbox', { name: 'Embroidery', exact: true }).check();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await f.page.getByRole('button', { name: 'Edit Embroidery price', exact: true }).waitFor();
  assert.equal(f.mutations.length, 0);
  assert.equal(f.read().selectedSetup?.product.methods.length, 1, 'The server draft remains untouched until Save');
  assert.equal((await acknowledgedSave(f.page)).status(), 200);
  await f.page.waitForFunction(
    () =>
      !sessionStorage.getItem(
        'insignia:selected-product-write:v1:selected-browser.myshopify.com:gid://shopify/Product/111',
      ),
  );
  assert.equal(f.read().selectedSetup?.methodBindings[importedId]?.prices.default?.source, 'catalog');
  assert.equal(f.read().selectedSetup?.methodBindings[importedId]?.prices.default?.value, '4.50');
});

test('dragging the real selected canvas updates typed geometry and the saved product without changing its economic price', {
  timeout: 20000,
}, async (t) => {
  const f = await fixture(t);
  await f.open();
  const canvas = f.page.locator('[data-placement-canvas]');
  const bounds = required(await canvas.boundingBox());
  const side = Math.min(bounds.width, bounds.height);
  const x = bounds.x + (bounds.width - side) / 2 + side * 0.38,
    y = bounds.y + (bounds.height - side) / 2 + side * 0.315;
  await f.page.mouse.move(x, y);
  await f.page.mouse.down();
  await f.page.mouse.move(x + 24, y + 12, { steps: 8 });
  await f.page.mouse.up();
  await f.page.waitForFunction(() => {
    const field = document.querySelector<HTMLElementTagNameMap['s-number-field']>(
      's-number-field[name="area-centerX"]',
    );
    return !!field && Number(field.value) > 38;
  });
  const horizontal = Number(await f.page.getByRole('spinbutton', { name: 'Center X', exact: true }).inputValue());
  assert.ok(horizontal > 38 && horizontal < 45);
  assert.equal((await acknowledgedSave(f.page)).status(), 200);
  await f.page.waitForFunction(
    () =>
      !sessionStorage.getItem(
        'insignia:selected-product-write:v1:selected-browser.myshopify.com:gid://shopify/Product/111',
      ),
  );
  const placed = f.read().selectedSetup?.product.views[0]?.placements[0];
  assert.ok(placed && placed.rect.centerX > 0.38 && placed.rect.centerX < 0.45);
  assert.equal(f.read().selectedSetup?.product.methods[0]?.amount, '3.50');
});

test('a blank product-specific cell is not offered while explicit zero is an exact free choice', {
  timeout: 20000,
}, async (t) => {
  const initial = structuredClone(draft);
  const selected = required(initial.selectedSetup);
  const method = required(selected.product.methods[0]);
  method.pricing = 'product';
  method.amount = '';
  initial.pricingRules = [];
  const binding = required(selected.methodBindings[methodId]);
  binding.prices = { default: { source: 'product', value: '' }, '["chest","small"]': { source: 'product', value: '' } };
  const f = await fixture(t, { initialDraft: initial });
  await f.open();
  const price = f.page.getByRole('spinbutton', { name: 'Price for Small', exact: true });
  assert.equal(await price.inputValue(), '');
  assert.equal(await price.getAttribute('placeholder'), 'Not offered');
  await price.fill('0');
  assert.equal(f.mutations.length, 0);
  assert.equal((await acknowledgedSave(f.page)).status(), 200);
  await f.page.waitForFunction(
    () =>
      !sessionStorage.getItem(
        'insignia:selected-product-write:v1:selected-browser.myshopify.com:gid://shopify/Product/111',
      ),
  );
  assert.equal(f.read().selectedSetup?.product.views[0]?.placements[0]?.sizes[0]?.prices[methodId], '0');
  assert.equal(f.read().selectedSetup?.methodBindings[methodId]?.prices['["chest","small"]']?.source, 'product');
  await f.page.reload();
  await f.page.locator('.placement-editor').waitFor({ state: 'visible' });
  assert.equal(await f.page.getByRole('spinbutton', { name: 'Price for Small', exact: true }).inputValue(), '0');
});

test('a different authoring scope cannot replay or silently replace a previous installation pending intent', {
  timeout: 20000,
}, async (t) => {
  const f = await fixture(t, { loseSaveReply: true });
  await f.open();
  await editName(f.page, 'Previous authority intent');
  await hostSave(f.page);
  await f.page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  const original = await storedIntent(f.page);
  assert.ok(original);
  const next = 'b'.repeat(64);
  await f.page.route('**/api/admin/preferences', (route) =>
    route.fulfill({ json: { ...preferences, authority: next } }),
  );
  await f.page.route('**/api/admin/methods?view=catalog', (route) =>
    route.fulfill({ json: { ...catalog, authority: next } }),
  );
  const reconciliations: unknown[] = [];
  await f.page.route('**/api/admin/products/111/config', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body: unknown = route.request().postDataJSON();
    assert.deepEqual(body, { action: 'reconcile', stage: 'save', operationKey: JSON.parse(original).key });
    assert.equal(route.request().headers()['x-insignia-setup-authority'], next);
    reconciliations.push(body);
    return route.fulfill({ json: { kind: 'resolved' } });
  });
  await f.page.reload();
  await f.page.locator('.placement-editor').waitFor({ state: 'visible' });
  assert.equal(f.mutations.length, 1, 'Previous save is never replayed under new authority');
  assert.equal(reconciliations.length, 1);
  assert.equal(
    await storedIntent(f.page),
    null,
    'Current-authority receipt/fence closes the previous identity before accepting new edits',
  );
});
