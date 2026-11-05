import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filteredCatalogPage } from '../../src/server/admin/catalog-query.ts';
import type { CatalogProduct } from '../../src/shared/admin-view.ts';

const product = (index: number, state: 'not_configured' | 'published'): CatalogProduct => ({
  id: `gid://shopify/Product/${index}`,
  title: `Product ${index}`,
  status: 'ACTIVE',
  imageUrl: null,
  variants: [],
  configurationSummary: { state, methods: [], locations: [] },
});
test('configuration filters find matches beyond page one and resume inside a provider page without dropping matches', async () => {
  const first = Array.from({ length: 20 }, (_, index) => product(index + 1, 'not_configured'));
  const second = [
    product(21, 'published'),
    product(22, 'not_configured'),
    product(23, 'published'),
    product(24, 'published'),
  ];
  const read = async (cursor: string | null) =>
    cursor === null ? { products: first, nextCursor: 'second' } : { products: second, nextCursor: null };
  const query = { query: '', cursor: null, limit: 2, configuration: 'published' as const };
  const page = await filteredCatalogPage('shop:1', query, read);
  assert.deepEqual(
    page.products.map((item) => item.id),
    ['gid://shopify/Product/21', 'gid://shopify/Product/23'],
  );
  assert.ok(page.nextCursor);
  const next = await filteredCatalogPage('shop:1', { ...query, cursor: page.nextCursor }, read);
  assert.deepEqual(
    next.products.map((item) => item.id),
    ['gid://shopify/Product/24'],
  );
  assert.equal(next.nextCursor, null);
  await assert.rejects(
    () => filteredCatalogPage('other-shop:1', { ...query, cursor: page.nextCursor }, read),
    /cursor/,
  );
  await assert.rejects(
    () => filteredCatalogPage('shop:1', { ...query, query: 'different', cursor: page.nextCursor }, read),
    /cursor/,
  );
});
test('unfiltered reads preserve provider cursor behavior and repeated scans fail explicitly', async () => {
  let observed: unknown;
  await filteredCatalogPage('shop:1', { query: '', cursor: 'original', limit: 10 }, async (...args) => {
    observed = args;
    return { products: [], nextCursor: null };
  });
  assert.deepEqual(observed, ['original', 10]);
  await assert.rejects(
    () =>
      filteredCatalogPage('shop:1', { query: '', cursor: null, limit: 20, configuration: 'published' }, async () => ({
        products: [],
        nextCursor: 'repeat',
      })),
    /advance/,
  );
});
