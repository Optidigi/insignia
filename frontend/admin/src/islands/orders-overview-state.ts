import type { PurchaseView } from '@insignia/contracts';
import type { OrderDateRange } from '../components/OrdersDateFilter.js';
import type { OrderSort } from '../components/OrdersDisplayOptions.js';
import type { ArtworkFilter } from '../shared/artwork-status.js';
import { initialRemoteReadState, type RemoteReadState, remoteReadReducer } from '../shared/remote-read-state.ts';
export type OrdersPage = {
  items: PurchaseView[];
  nextCursor: string | null;
  timeZone?: string;
  cursors: (string | undefined)[];
};
export type ServerQuery = OrderDateRange & { sort: OrderSort };
export type OrdersState = {
  read: RemoteReadState<OrdersPage>;
  selectedIds: string[];
  artworkFilter: ArtworkFilter;
  search: string;
  serverQuery: ServerQuery;
};
export type OrdersEvent =
  | { type: 'query-restored'; artwork: ArtworkFilter; search: string; server: ServerQuery }
  | { type: 'filter-changed'; value: ArtworkFilter }
  | { type: 'search-changed'; value: string }
  | { type: 'server-query-changed'; value: ServerQuery; request: number }
  | { type: 'read-started'; request: number }
  | { type: 'read-succeeded'; request: number; page: OrdersPage }
  | { type: 'read-failed'; request: number; denied: boolean }
  | { type: 'access-revoked'; request: number }
  | { type: 'selection-cleared' }
  | { type: 'page-selection-changed'; ids: string[] }
  | { type: 'row-selection-changed'; id: string; checked: boolean };
export function initialOrdersState(): OrdersState {
  return {
    read: initialRemoteReadState<OrdersPage>(),
    selectedIds: [],
    artworkFilter: 'all',
    search: '',
    serverQuery: { sort: 'date-desc' },
  };
}
export function ordersReducer(state: OrdersState, event: OrdersEvent): OrdersState {
  if ('request' in event && event.request < state.read.request) return state;
  if (
    (event.type === 'read-succeeded' || event.type === 'read-failed') &&
    (event.request !== state.read.request || state.read.phase !== 'loading')
  )
    return state;
  switch (event.type) {
    case 'query-restored':
      return {
        ...state,
        selectedIds: [],
        artworkFilter: event.artwork,
        search: event.search,
        serverQuery: event.server,
      };
    case 'filter-changed':
      return { ...state, artworkFilter: event.value, selectedIds: [] };
    case 'search-changed':
      return { ...state, search: event.value, selectedIds: [] };
    case 'server-query-changed':
      return {
        ...state,
        serverQuery: event.value,
        selectedIds: [],
        read: remoteReadReducer(state.read, { type: 'read-started', request: event.request, clear: true }),
      };
    case 'read-started':
      return { ...state, selectedIds: [], read: remoteReadReducer(state.read, event) };
    case 'read-succeeded':
      return {
        ...state,
        read: remoteReadReducer(state.read, { type: 'read-succeeded', request: event.request, value: event.page }),
      };
    case 'read-failed':
      return {
        ...state,
        selectedIds: [],
        read: remoteReadReducer(state.read, {
          type: 'read-failed',
          request: event.request,
          status: event.denied ? 403 : undefined,
          message: '',
        }),
      };
    case 'access-revoked':
      return {
        ...state,
        selectedIds: [],
        read: remoteReadReducer(state.read, {
          type: 'access-revoked',
          request: event.request,
          status: 403,
          message: '',
        }),
      };
    case 'selection-cleared':
      return { ...state, selectedIds: [] };
    case 'page-selection-changed': {
      if (state.read.phase !== 'ready') return state;
      const ids = new Set(state.read.value.items.map((item) => item.purchaseId));
      return { ...state, selectedIds: [...new Set(event.ids)].filter((id) => ids.has(id)) };
    }
    case 'row-selection-changed':
      if (state.read.phase !== 'ready' || !state.read.value.items.some((item) => item.purchaseId === event.id))
        return state;
      return {
        ...state,
        selectedIds: event.checked
          ? [...new Set([...state.selectedIds, event.id])]
          : state.selectedIds.filter((id) => id !== event.id),
      };
  }
}
