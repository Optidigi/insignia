import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalog, fixture, hostSave, methodId, storedIntent } from './support/selected-browser.mts';

const reviewName = 'Review deleted methods before publication.';

test('a legacy tag rule the product does not match asks for no review: every library method is available', {
  timeout: 20000,
}, async (t) => {
  const f = await fixture(t);
  await f.page.route('**/api/admin/methods?view=catalog', (route) =>
    route.fulfill({
      json: {
        ...catalog,
        methods: catalog.methods.map((method) => ({
          ...method,
          configuration: {
            ...method.configuration,
            assignment: 'tags',
            productIds: [],
            tags: ['shirts'],
            tagMatch: 'all',
          },
        })),
      },
    }),
  );
  await f.open();
  await f.page.getByRole('button', { name: 'Manage methods', exact: true }).waitFor();
  assert.equal(await f.page.getByRole('region', { name: reviewName, exact: true }).count(), 0);
  assert.equal(f.mutations.length, 0);
});

test('deleting a library method is shown before any write and explicit Keep saves only the draft review', {
  timeout: 20000,
}, async (t) => {
  const f = await fixture(t);
  await f.page.route('**/api/admin/methods?view=catalog', (route) =>
    route.fulfill({ json: { ...catalog, methods: [] } }),
  );
  await f.open();
  const review = f.page.getByRole('region', { name: reviewName, exact: true });
  await review.waitFor();
  assert.equal(f.mutations.length, 0);
  assert.equal(await storedIntent(f.page), null);
  await review.getByRole('button', { name: 'Keep method', exact: true }).click();
  await review.waitFor({ state: 'detached' });
  await f.page.waitForFunction(() => {
    const button = document.querySelector('ui-save-bar button[variant="primary"]');
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  const response = f.page.waitForResponse((response) => response.request().method() === 'PUT');
  await hostSave(f.page);
  await response;
  await f.page.waitForFunction(
    () =>
      !sessionStorage.getItem(
        'insignia:selected-product-write:v1:selected-browser.myshopify.com:gid://shopify/Product/111',
      ),
  );
  assert.equal(f.read().selectedSetup?.methodBindings[methodId]?.review?.reason, 'deleted');
  assert.equal(f.read().selectedSetup?.methodBindings[methodId]?.review?.decision, 'keep');
  assert.equal(f.read().selectedSetup?.product.methods[0]?.amount, '3.50');
  assert.equal(f.mutations.length, 1);
  assert.equal(f.mutations[0]?.method, 'PUT');
});
