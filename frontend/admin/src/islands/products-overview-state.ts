import type { CatalogProduct } from '../shared/admin-view.js';

export type ProductPage = { products: CatalogProduct[]; nextCursor: string | null };
export type ConfigurationFilter = 'all' | 'not_configured' | 'draft' | 'published' | 'unavailable';
export type ProductNotice = 'preview-failed' | 'summary-download-failed';
type CatalogState =
  | { kind: 'loading'; page?: ProductPage }
  | { kind: 'ready'; page: ProductPage }
  | { kind: 'error'; denied: boolean };
export type ProductsState = {
  catalog: CatalogState;
  request: number;
  search: string;
  appliedSearch: string;
  cursors: (string | null)[];
  configurationFilter: ConfigurationFilter;
  selectedIds: string[];
  selectionNotice: ProductNotice | null;
};
export type ProductsEvent =
  | { type: 'search-typed'; value: string; request: number }
  | { type: 'read-started'; query: string; cursors: (string | null)[]; request: number }
  | { type: 'read-succeeded'; page: ProductPage; request: number }
  | { type: 'read-failed'; denied: boolean; request: number }
  | { type: 'filter-changed'; value: ConfigurationFilter }
  | { type: 'selection-changed'; ids: string[] }
  | { type: 'selection-cleared' }
  | { type: 'selection-notice'; reason: ProductNotice | null }
  | { type: 'page-hidden'; request: number };
export function initialProductsState(): ProductsState {
  return {
    catalog: { kind: 'loading' },
    request: 0,
    search: '',
    appliedSearch: '',
    cursors: [null],
    configurationFilter: 'all',
    selectedIds: [],
    selectionNotice: null,
  };
}
export function productsReducer(state: ProductsState, event: ProductsEvent): ProductsState {
  switch (event.type) {
    case 'search-typed':
      if (event.request < state.request) return state;
      return {
        ...state,
        search: event.value,
        request: event.request,
        selectedIds: [],
        selectionNotice: null,
        catalog: { kind: 'loading', page: state.catalog.kind === 'error' ? undefined : state.catalog.page },
      };
    case 'read-started':
      if (event.request < state.request) return state;
      return {
        ...state,
        request: event.request,
        search: event.query,
        appliedSearch: event.query,
        cursors: event.cursors,
        selectedIds: [],
        selectionNotice: null,
        catalog: { kind: 'loading', page: state.catalog.kind === 'error' ? undefined : state.catalog.page },
      };
    case 'read-succeeded':
      return event.request === state.request && state.catalog.kind === 'loading'
        ? { ...state, catalog: { kind: 'ready', page: event.page } }
        : state;
    case 'read-failed':
      return event.request === state.request && state.catalog.kind === 'loading'
        ? { ...state, catalog: { kind: 'error', denied: event.denied }, selectedIds: [], selectionNotice: null }
        : state;
    case 'filter-changed':
      return { ...state, configurationFilter: event.value, selectedIds: [], selectionNotice: null };
    case 'selection-changed':
      return state.catalog.kind === 'ready'
        ? {
            ...state,
            selectedIds: [...new Set(event.ids)].filter(
              (id) => state.catalog.kind === 'ready' && state.catalog.page.products.some((item) => item.id === id),
            ),
            selectionNotice: null,
          }
        : state;
    case 'selection-cleared':
      return { ...state, selectedIds: [], selectionNotice: null };
    case 'selection-notice':
      return { ...state, selectionNotice: event.reason };
    case 'page-hidden':
      return { ...state, request: event.request, catalog: { kind: 'loading' }, selectedIds: [], selectionNotice: null };
  }
}
