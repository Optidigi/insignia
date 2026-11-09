import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MerchantDraftSchema } from '@insignia/contracts';
import { fixture, product } from './support/selected-browser.mts';

test('built Copy action discovers twenty products within its deadline and hydrates only the selected target for review', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  await f.open();
  const ids = Array.from({ length: 20 }, (_, i) => `gid://shopify/Product/${222 + i}`);
  let details = 0;
  await f.page.route('**/api/admin/products?*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1700));
    await route.fulfill({
      json: {
        products: ids.map((id, i) => ({
          ...product,
          id,
          title: `Copy target ${i}`,
          configurationSummary: { state: i === 0 ? 'draft' : 'not_configured', methods: [], locations: [] },
        })),
        nextCursor: null,
      },
    });
  });
  await f.page.route(/\/api\/admin\/products\/2\d\d\/config$/, async (route) => {
    assert.equal(route.request().method(), 'GET');
    details++;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const id = `gid://shopify/Product/${new URL(route.request().url()).pathname.split('/').at(-2)}`;
    await route.fulfill({
      json: { product: { ...product, id, title: `Copy target ${ids.indexOf(id)}` }, config: null },
    });
  });
  const started = Date.now();
  await f.page
    .locator('s-menu#placement-page-actions s-button')
    .filter({ hasText: 'Copy setup to products' })
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  const dialog = f.page.locator('s-modal').filter({ has: f.page.locator('.placement-setup-copy') });
  const target = dialog.locator('s-checkbox[name="targetProducts"]').first();
  await target.waitFor({ state: 'attached' });
  assert.equal(await target.evaluate((checkbox: HTMLElementTagNameMap['s-checkbox']) => checkbox.disabled), false);
  assert.ok(Date.now() - started < 10000);
  assert.equal(details, 0, 'Discovery must not hydrate unselected products');
  await target.evaluate((checkbox: HTMLElementTagNameMap['s-checkbox']) => {
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await dialog
    .locator('s-button[slot="primary-action"]')
    .evaluate((button: HTMLElementTagNameMap['s-button']) => button.click());
  await dialog.locator('.placement-setup-copy__review').waitFor();
  await f.page.waitForFunction(
    () =>
      !document
        .querySelector('s-modal .placement-setup-copy__review')
        ?.closest('s-modal')
        ?.querySelector('s-button[slot="primary-action"]')
        ?.hasAttribute('disabled'),
  );
  assert.equal(details, 1);
  assert.equal(f.mutations.length, 0);
});

test('overview-selected targets hydrate alongside the chosen saved source before complete review', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  const targetId = 'gid://shopify/Product/222';
  const reads: string[] = [];
  await f.page.route('**/api/admin/products?*', (route) =>
    route.fulfill({
      json: {
        products: [
          { ...product, configurationSummary: { state: 'draft', methods: ['Printing'], locations: ['Right chest'] } },
          {
            ...product,
            id: targetId,
            title: 'Overview target',
            configurationSummary: { state: 'not_configured', methods: [], locations: [] },
          },
        ],
        nextCursor: null,
      },
    }),
  );
  await f.page.route('**/api/admin/products/*/config', async (route) => {
    assert.equal(route.request().method(), 'GET');
    reads.push(new URL(route.request().url()).pathname);
    await route.fulfill({
      json: route.request().url().includes('/222/')
        ? { product: { ...product, id: targetId, title: 'Overview target' }, config: null }
        : f.view(),
    });
  });
  await f.page.goto(`${f.base}/admin/products?locale=en`);
  await f.page.waitForFunction(() => !!document.querySelector('[data-selected-product-actions]'));
  await f.page.evaluate(
    (id) => document.dispatchEvent(new CustomEvent('insignia:copy-product-setup', { detail: { targetIds: [id] } })),
    targetId,
  );
  const dialog = f.page.locator('s-modal').filter({ has: f.page.locator('.placement-setup-copy') });
  const savedSource = dialog.locator('s-clickable').first();
  await savedSource.waitFor({ state: 'attached' });
  assert.equal(reads.length, 0);
  await savedSource.evaluate((button: HTMLElement) => button.click());
  await dialog.locator('.placement-setup-copy__review').waitFor();
  await f.page.waitForFunction(
    () =>
      !document
        .querySelector('s-modal .placement-setup-copy__review')
        ?.closest('s-modal')
        ?.querySelector('s-button[slot="primary-action"]')
        ?.hasAttribute('disabled'),
  );
  assert.deepEqual(reads.sort(), ['/api/admin/products/111/config', '/api/admin/products/222/config']);
  assert.ok((await dialog.innerText()).includes('Front'));
  assert.ok((await dialog.innerText()).includes('Overview target'));
  assert.equal(f.mutations.length, 0);
});

test('saved source view choices survive removing a blocked target and returning through the chooser', {
  timeout: 30000,
}, async (t) => {
  const f = await fixture(t);
  const view = f.view();
  assert.ok(view.config);
  const draft = MerchantDraftSchema.parse(view.config.draft);
  assert.ok(draft.selectedSetup);
  const front = draft.selectedSetup.product.views[0];
  assert.ok(front);
  draft.selectedSetup.product.views.push({ ...front, id: 'back', name: 'Back', placements: [] });
  const target = 'gid://shopify/Product/222',
    blocked = 'gid://shopify/Product/333';
  await f.page.route('**/api/admin/products?*', (route) =>
    route.fulfill({
      json: {
        products: [
          product,
          {
            ...product,
            id: target,
            title: 'Empty target',
            configurationSummary: { state: 'not_configured', methods: [], locations: [] },
          },
          {
            ...product,
            id: blocked,
            title: 'Blocked target',
            configurationSummary: { state: 'published', methods: ['Printing'], locations: ['Right chest'] },
          },
        ],
        nextCursor: null,
      },
    }),
  );
  await f.page.route('**/api/admin/products/*/config', (route) => {
    assert.equal(route.request().method(), 'GET');
    const id = new URL(route.request().url()).pathname.split('/').at(-2);
    return route.fulfill({
      json:
        id === '222'
          ? { product: { ...product, id: target, title: 'Empty target' }, config: null }
          : {
              product: { ...product, ...(id === '333' ? { id: blocked, title: 'Blocked target' } : {}) },
              config: { ...view.config, draft },
            },
    });
  });
  await f.page.goto(`${f.base}/admin/products?locale=en`);
  await f.page.waitForFunction(() => !!document.querySelector('[data-selected-product-actions]'));
  await f.page.evaluate(
    (targetIds) =>
      document.dispatchEvent(
        new CustomEvent('insignia:copy-product-setup', {
          detail: { targetIds },
        }),
      ),
    [target, blocked],
  );
  const dialog = f.page.locator('s-modal').filter({ has: f.page.locator('.placement-setup-copy') });
  await dialog
    .locator('s-clickable')
    .first()
    .evaluate((button: HTMLElement) => button.click());
  const back = dialog.locator('s-checkbox[name="copySetupViews"]').nth(1);
  await back.waitFor({ state: 'attached' });
  await back.evaluate((checkbox: HTMLElementTagNameMap['s-checkbox']) => {
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(await back.evaluate((checkbox: HTMLElementTagNameMap['s-checkbox']) => checkbox.checked), false);
  const rehydrated = f.page.waitForResponse((response) => response.url().includes('/products/111/config'));
  await dialog.locator('.placement-setup-copy__blocker s-button').evaluate((button: HTMLElement) => button.click());
  await rehydrated;
  await dialog.locator('.placement-setup-copy__review').waitFor();
  await f.page.waitForFunction(
    () => !document.querySelector('s-modal .placement-setup-copy')?.getAttribute('aria-busy')?.includes('true'),
  );
  assert.equal(await back.evaluate((checkbox: HTMLElementTagNameMap['s-checkbox']) => checkbox.checked), false);
  await dialog.locator('s-button[slot="secondary-actions"]').evaluate((button: HTMLElement) => button.click());
  await dialog
    .locator('s-clickable')
    .first()
    .evaluate((button: HTMLElement) => button.click());
  await dialog.locator('.placement-setup-copy__review').waitFor();
  assert.equal(await back.evaluate((checkbox: HTMLElementTagNameMap['s-checkbox']) => checkbox.checked), false);
  assert.equal(f.mutations.length, 0);
});
