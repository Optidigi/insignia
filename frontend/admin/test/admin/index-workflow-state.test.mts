import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialOrdersState, ordersReducer } from '../../src/islands/orders-overview-state.ts';
import { initialProductsState, productsReducer } from '../../src/islands/products-overview-state.ts';

test('Products search and paging clear page selection and ignore an old result', () => {
  const initial = {
    ...initialProductsState(),
    selectedIds: ['old-page-product'],
    selectionNotice: 'summary-download-failed' as const,
  };
  const typed = productsReducer(initial, { type: 'search-typed', value: 'shirt', request: 2 });
  assert.deepEqual(typed.selectedIds, []);
  assert.equal(typed.selectionNotice, null);
  assert.equal(typed.search, 'shirt');
  assert.equal(
    productsReducer(typed, { type: 'read-succeeded', request: 1, page: { products: [], nextCursor: null } }),
    typed,
  );
  const reading = productsReducer(typed, {
    type: 'read-started',
    query: 'shirt',
    request: 3,
    cursors: [null, 'second'],
  });
  assert.deepEqual(reading.cursors, [null, 'second']);
  const denied = productsReducer(reading, { type: 'read-failed', request: 3, denied: true });
  assert.deepEqual(denied.catalog, { kind: 'error', denied: true });
  assert.deepEqual(productsReducer(denied, { type: 'selection-changed', ids: ['old-page-product'] }), denied);
});

test('Products notices retain only semantic reasons in reducer state', () => {
  const start = {
    ...initialProductsState(),
    catalog: { kind: 'ready' as const, page: { products: [], nextCursor: null } },
  };
  const failed = productsReducer(start, { type: 'selection-notice', reason: 'preview-failed' });
  assert.equal(failed.selectionNotice, 'preview-failed');
  const cleared = productsReducer(failed, { type: 'selection-notice', reason: null });
  assert.equal(cleared.selectionNotice, null);
});

test('Orders filters clear selection while display query and read ownership remain distinct', () => {
  const state = { ...initialOrdersState(), selectedIds: ['old-order'] };
  const filtered = ordersReducer(state, { type: 'filter-changed', value: 'needed' });
  assert.deepEqual(filtered.selectedIds, []);
  assert.equal(filtered.artworkFilter, 'needed');
  const reading = ordersReducer(filtered, { type: 'read-started', request: 5 });
  const denied = ordersReducer(reading, { type: 'access-revoked', request: 6 });
  assert.equal(denied.read.value, null);
  const late = ordersReducer(denied, {
    type: 'read-succeeded',
    request: 5,
    page: { items: [], nextCursor: null, cursors: [undefined] },
  });
  assert.equal(late.read, denied.read);
  const restored = ordersReducer(denied, {
    type: 'query-restored',
    search: '1042',
    artwork: 'complete',
    server: { sort: 'date-asc' },
  });
  assert.equal(restored.search, '1042');
  assert.equal(restored.serverQuery.sort, 'date-asc');
  assert.equal(restored.read.phase, 'denied');
});

test('Orders changing server query clears rows while preserving the mounted filter toolbar', () => {
  const loaded = ordersReducer(initialOrdersState(), {
    type: 'read-succeeded',
    request: 0,
    page: { items: [], nextCursor: null, cursors: [undefined] },
  });
  const changed = ordersReducer(loaded, {
    type: 'server-query-changed',
    value: { sort: 'date-asc' },
    request: 1,
  });
  assert.equal(changed.read.hasLoaded, true, 'query changes must not remount the initial-page skeleton');
  assert.equal(changed.read.value, null, 'previous query rows cannot remain actionable');
  assert.equal(changed.read.phase, 'loading');
  const failed = ordersReducer(changed, { type: 'read-failed', request: 1, denied: false });
  assert.equal(failed.read.hasLoaded, true, 'query failure keeps the recovery controls mounted');
});
