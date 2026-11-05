import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homeProductsFromResponse } from '../../src/shared/merchant-home-source.ts';

const product = (state: string) => ({
  id: 'gid://shopify/Product/15464675246464',
  title: 'Organic cotton T-shirt',
  imageUrl: null,
  configurationSummary: { state },
});
test('Home only shows first-use onboarding when the unfiltered product result establishes absence', () => {
  assert.equal(homeProductsFromResponse({ products: [], nextCursor: null }).catalog, 'no-products');
  assert.equal(
    homeProductsFromResponse({ products: [product('not_configured')], nextCursor: 'more' }).catalog,
    'unknown',
  );
  assert.equal(
    homeProductsFromResponse({ products: [product('not_configured')], nextCursor: null }).catalog,
    'unconfigured',
  );
});

test('published configuration does not masquerade as an unpublished product draft', () => {
  const result = homeProductsFromResponse({ products: [product('published')], nextCursor: null });
  assert.equal(result.catalog, 'configured');
  assert.deepEqual(result.drafts, []);
  assert.throws(() =>
    homeProductsFromResponse({ products: [{ ...product('draft'), id: 'other-shop-path' }], nextCursor: null }),
  );
});

test('theme guidance only asks to add the missing feature and never treats unknown as absent', async () => {
  const { homeSetupFromTheme } = await import('../../src/shared/merchant-home-source.ts');
  assert.deepEqual(homeSetupFromTheme({ button: 'active', cart: 'available' }, true)?.tasks[0], {
    id: 'storefront',
    kind: 'storefront',
    reason: 'cart-review-disabled',
    state: 'pending',
    action: { href: '/admin/settings/storefront' },
  });
  assert.deepEqual(homeSetupFromTheme({ button: 'unknown', cart: 'active' }, false)?.tasks[0], {
    id: 'storefront',
    kind: 'storefront',
    reason: 'check',
    state: 'unknown',
    action: { href: '/admin/settings/storefront' },
  });
  assert.equal(
    homeSetupFromTheme({ button: 'active', cart: 'active' }, true)?.tasks[0]?.kind,
    'test',
    'product preview is an invitation, never an automatically confirmed test',
  );
});

test('retention loss stays recent history and never becomes an invented merchant task', async () => {
  const { homeOrdersFromResponse } = await import('../../src/shared/merchant-home-source.ts');
  const { createRichPurchasePreviewFixtures } = await import('../../examples/admin/support/purchase-preview-fixtures.mts');
  const { PurchaseListViewSchema } = await import('../../src/shared/purchase-presentation.ts');
  const list = PurchaseListViewSchema.parse(createRichPurchasePreviewFixtures()['/api/purchases/v1']);
  const now = Date.parse('2031-01-01T00:00:00Z');
  const result = homeOrdersFromResponse(list, now);
  assert.throws(
    () => homeOrdersFromResponse({ ...list, items: [], nextCursor: '10000000-0000-4000-8000-000000000101' }),
    'an empty incomplete page cannot establish absence',
  );
  assert.equal(result.items.length, 5);
  assert.equal(result.timeZone, list.timeZone ?? 'UTC');
  assert.equal(typeof result.items[0]?.itemCount, 'bigint');
  assert.equal(typeof result.items[0]?.orderCreatedAt, 'string');
  assert.equal('placedAt' in (result.items[0] ?? {}), false);
  assert.equal('label' in (result.items[0] ?? {}), false);
  assert.deepEqual(result.tasks, []);
  assert.ok(result.items.some((order) => order.status === 'expired'));
  assert.throws(
    () => homeOrdersFromResponse({ items: [], nextCursor: null }),
    'malformed response must not turn into empty orders',
  );
});

test('Home uses exact whole-store aggregates and cannot present unavailable evidence as zero', async () => {
  const { homeStatisticsFromAggregate } = await import('../../src/shared/merchant-home-source.ts');
  const value = { version: 'purchase-statistics-v1', timeZone: 'Europe/Amsterdam', periodDays: 30, observedAt: '2026-11-05T12:00:00Z', available: true, series: [
    { day: '2026-11-05', orders: '3', items: '9007199254740993', productIds: ['a', 'b'] },
    { day: '2026-11-04', orders: '2', items: '7', productIds: ['a'] },
    { day: '2026-10-01', orders: '1', items: '5', productIds: ['c'] },
  ] };
  const result = homeStatisticsFromAggregate(value);
  assert.equal(result?.state, 'ready');
  if (result?.state !== 'ready') throw new Error('Expected complete aggregate');
  assert.equal(result.customizedOrders, 5);
  assert.equal(result.customizedItems, 9007199254741000n);
  assert.equal(result.productsOrdered, 2);
  assert.equal(result.previousPeriod?.customizedOrders, 1);
  assert.equal(result.series?.length, 30);
  assert.equal(homeStatisticsFromAggregate({ ...value, available: false }), undefined);
  assert.equal(homeStatisticsFromAggregate({ ...value, series: [{ ...value.series[0], orders: '9007199254740993' }] }), undefined);
});
