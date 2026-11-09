import assert from 'node:assert/strict';
import { test } from 'node:test';
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
          configurationSummary: { state: 'not_configured', methods: [], locations: [] },
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
