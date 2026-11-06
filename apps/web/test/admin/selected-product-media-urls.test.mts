import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectedMediaUrlsValid } from '../../src/server/selected-product-media-urls.ts';

const id = 'upload_11111111-1111-4111-8111-111111111111';
function draft(url: string) {
  return {
    version: 'm5-merchant-draft-v1',
    mode: 'required',
    shopCurrency: 'USD',
    methods: [],
    placements: [],
    productionOptions: [],
    pricingRules: [],
    geometry: {},
    selectedSetup: {
      version: 'selected-product-setup-v1',
      methodBindings: {},
      product: {
        id: 'gid://shopify/Product/111',
        title: 'T-shirt',
        methods: [],
        views: [],
        images: [{ id, url, width: 100, height: 100, alt: '' }],
      },
    },
  };
}
test('uploaded authoring media accepts only stable current app/product identity URLs, never signed, foreign or blob delivery URLs', () => {
  assert.equal(
    selectedMediaUrlsValid(
      draft(`https://app.example/api/admin/products/111/media/${id}`),
      'https://app.example',
      'gid://shopify/Product/111',
    ),
    true,
  );
  for (const url of [
    `https://other.example/api/admin/products/111/media/${id}`,
    `https://app.example/api/admin/products/222/media/${id}`,
    `https://app.example/api/admin/products/111/media/${id}?token=synthetic-test-only`,
    'blob:https://app.example/temporary',
  ])
    assert.equal(selectedMediaUrlsValid(draft(url), 'https://app.example', 'gid://shopify/Product/111'), false);
});
