/** Staged method, size-price, and catalog transitions for one placement dialog. */
import { parsePrice } from './method-workflow-prices.mts';
import type { EditorMethod, EditorPlacement } from './placement-workflow-model.mts';

export type PlacementMethodChanges = Pick<EditorPlacement, 'methodIds' | 'sizes'>;
export type PlacementMethodManagerScreen =
  | { kind: 'methods' }
  | { kind: 'prices'; methodId: string }
  | { kind: 'create' };

export type PlacementMethodCatalog =
  | { kind: 'ready'; attempt: number; requestId: number }
  | { kind: 'loading'; attempt: number; requestId: number }
  | { kind: 'error'; attempt: number; requestId: number };
export type PlacementMethodManagerError = 'price-invalid' | 'methods-unavailable';
export type PlacementMethodNameError = 'name-invalid' | 'name-duplicate' | 'method-add-failed';

export interface PlacementMethodManagerState {
  sessionId: string;
  productId: string;
  placementId: string;
  targetRevision: number;
  status: 'open' | 'applied';
  methods: EditorMethod[];
  draft: PlacementMethodChanges;
  editedMethodIds: string[];
  editedPriceCells: { sizeId: string; methodId: string }[];
  catalog: PlacementMethodCatalog;
  screen: PlacementMethodManagerScreen;
  createName: string;
  nameError: PlacementMethodNameError | null;
  errors: Record<string, 'price-invalid'>;
  unavailableError: 'methods-unavailable' | null;
  applied?: {
    change: PlacementMethodChanges;
    choices: EditorMethod[];
    editedIds: string[];
    editedCells: { sizeId: string; methodId: string }[];
  };
}

export interface CreatePlacementMethodManagerOptions {
  sessionId: string;
  productId: string;
  placement: EditorPlacement;
  targetRevision: number;
  methods: EditorMethod[];
  catalogLoaded: boolean;
  initialMethodId?: string;
}

export function createPlacementMethodManagerState(
  options: CreatePlacementMethodManagerOptions,
): PlacementMethodManagerState {
  const initialMethod = options.methods.find(
    (method) => method.id === options.initialMethodId && options.placement.methodIds.includes(method.id),
  );
  return {
    sessionId: options.sessionId,
    productId: options.productId,
    placementId: options.placement.id,
    targetRevision: options.targetRevision,
    status: 'open',
    methods: options.methods.map((method) => ({ ...method })),
    draft: structuredClone({ methodIds: options.placement.methodIds, sizes: options.placement.sizes }),
    editedMethodIds: [],
    editedPriceCells: [],
    catalog: options.catalogLoaded
      ? { kind: 'ready', attempt: 0, requestId: 0 }
      : { kind: 'loading', attempt: 0, requestId: 0 },
    screen: initialMethod ? { kind: 'prices', methodId: initialMethod.id } : { kind: 'methods' },
    createName: '',
    nameError: null,
    errors: {},
    unavailableError: null,
  };
}

export type PlacementMethodManagerEvent =
  | { type: 'catalog-requested'; sessionId: string; requestId: number }
  | { type: 'catalog-loaded'; sessionId: string; requestId: number; methods: EditorMethod[] }
  | { type: 'catalog-failed'; sessionId: string; requestId: number }
  | { type: 'catalog-retry-requested'; sessionId: string; requestId: number }
  | { type: 'method-toggled'; sessionId: string; methodId: string; checked: boolean }
  | { type: 'size-price-edited'; sessionId: string; sizeId: string; methodId: string; value: string }
  | { type: 'fixed-price-edited'; sessionId: string; methodId: string; amount: string }
  | { type: 'methods-screen-selected'; sessionId: string }
  | { type: 'prices-screen-opened'; sessionId: string; methodId: string }
  | { type: 'create-screen-opened'; sessionId: string }
  | { type: 'create-name-edited'; sessionId: string; value: string }
  | { type: 'product-method-created'; sessionId: string; name: string; method: EditorMethod }
  | { type: 'apply-requested'; sessionId: string };

function isCurrentOpenSession(state: PlacementMethodManagerState, sessionId: string): boolean {
  return state.status === 'open' && state.sessionId === sessionId;
}

function addEditedMethodId(state: PlacementMethodManagerState, methodId: string): string[] {
  return state.editedMethodIds.includes(methodId) ? state.editedMethodIds : [...state.editedMethodIds, methodId];
}

function normalizedUniqueName(name: string, methods: readonly EditorMethod[]): boolean {
  const normalized = name.trim().toLocaleLowerCase();
  return !methods.some((method) => method.name.trim().toLocaleLowerCase() === normalized);
}

function applyStagedMethods(state: PlacementMethodManagerState): PlacementMethodManagerState {
  const unavailableIds = state.draft.methodIds.filter((id) => !state.methods.some((method) => method.id === id));
  if (unavailableIds.length) {
    return { ...state, unavailableError: 'methods-unavailable' };
  }

  const errors: Record<string, 'price-invalid'> = {};
  let firstInvalidMethodId: string | undefined;
  for (const method of state.methods) {
    if (!state.draft.methodIds.includes(method.id)) continue;
    if (method.pricing === 'fixed') {
      if (parsePrice(method.amount).kind === 'invalid') {
        errors[method.id] = 'price-invalid';
        firstInvalidMethodId ??= method.id;
      }
      continue;
    }
    for (const size of state.draft.sizes) {
      const value = size.prices[method.id] ?? '';
      if (value.trim() && parsePrice(value).kind === 'invalid') {
        errors[`${size.id}:${method.id}`] = 'price-invalid';
        firstInvalidMethodId ??= method.id;
      }
    }
  }
  if (firstInvalidMethodId)
    return {
      ...state,
      errors,
      screen: { kind: 'prices', methodId: firstInvalidMethodId },
      unavailableError: null,
    };

  return {
    ...state,
    status: 'applied',
    unavailableError: null,
    errors: {},
    applied: {
      change: structuredClone(state.draft),
      choices: state.methods.map((method) => ({ ...method })),
      editedIds: [...state.editedMethodIds],
      editedCells: state.editedPriceCells.map((cell) => ({ ...cell })),
    },
  };
}

/** Every event belongs to this dialog session; asynchronous catalog results also carry request identity. */
export function placementMethodManagerReducer(
  state: PlacementMethodManagerState,
  event: PlacementMethodManagerEvent,
): PlacementMethodManagerState {
  if (!isCurrentOpenSession(state, event.sessionId)) return state;

  switch (event.type) {
    case 'catalog-requested':
      return event.requestId <= state.catalog.requestId
        ? state
        : { ...state, catalog: { kind: 'loading', attempt: state.catalog.attempt, requestId: event.requestId } };
    case 'catalog-loaded': {
      if (state.catalog.kind !== 'loading' || state.catalog.requestId !== event.requestId) return state;
      const currentById = new Map(state.methods.map((method) => [method.id, method]));
      const methods = event.methods.map((method) =>
        state.editedMethodIds.includes(method.id) ? (currentById.get(method.id) ?? method) : { ...method },
      );
      const catalogIds = new Set(methods.map((method) => method.id));
      for (const method of state.methods) {
        if (state.editedMethodIds.includes(method.id) && !catalogIds.has(method.id)) methods.push(method);
      }
      return {
        ...state,
        methods,
        catalog: { kind: 'ready', attempt: state.catalog.attempt, requestId: event.requestId },
        unavailableError: null,
      };
    }
    case 'catalog-failed':
      return state.catalog.kind === 'loading' && state.catalog.requestId === event.requestId
        ? { ...state, catalog: { kind: 'error', attempt: state.catalog.attempt, requestId: event.requestId } }
        : state;
    case 'catalog-retry-requested':
      return state.catalog.kind !== 'error' || event.requestId <= state.catalog.requestId
        ? state
        : {
            ...state,
            catalog: { kind: 'loading', attempt: state.catalog.attempt + 1, requestId: event.requestId },
          };
    case 'method-toggled': {
      if (state.screen.kind !== 'methods') return state;
      const methodIds = event.checked
        ? state.draft.methodIds.includes(event.methodId)
          ? state.draft.methodIds
          : [...state.draft.methodIds, event.methodId]
        : state.draft.methodIds.filter((id) => id !== event.methodId);
      return { ...state, draft: { ...state.draft, methodIds }, errors: {}, unavailableError: null };
    }
    case 'size-price-edited': {
      if (state.screen.kind !== 'prices' || state.screen.methodId !== event.methodId) return state;
      if (!state.draft.sizes.some((size) => size.id === event.sizeId)) return state;
      const key = `${event.sizeId}:${event.methodId}`;
      const errors = { ...state.errors };
      delete errors[key];
      return {
        ...state,
        editedPriceCells: state.editedPriceCells.some((cell) => cell.sizeId === event.sizeId && cell.methodId === event.methodId) ? state.editedPriceCells : [...state.editedPriceCells, { sizeId: event.sizeId, methodId: event.methodId }],
        draft: {
          ...state.draft,
          sizes: state.draft.sizes.map((size) =>
            size.id === event.sizeId ? { ...size, prices: { ...size.prices, [event.methodId]: event.value } } : size,
          ),
        },
        errors,
      };
    }
    case 'fixed-price-edited': {
      if (state.screen.kind !== 'prices' || state.screen.methodId !== event.methodId) return state;
      if (!state.methods.some((method) => method.id === event.methodId && method.pricing === 'fixed')) return state;
      const errors = { ...state.errors };
      delete errors[event.methodId];
      return {
        ...state,
        methods: state.methods.map((method) =>
          method.id === event.methodId ? { ...method, amount: event.amount } : method,
        ),
        editedMethodIds: addEditedMethodId(state, event.methodId),
        errors,
      };
    }
    case 'methods-screen-selected':
      return { ...state, screen: { kind: 'methods' }, unavailableError: null };
    case 'prices-screen-opened':
      return state.draft.methodIds.includes(event.methodId)
        ? { ...state, screen: { kind: 'prices', methodId: event.methodId }, unavailableError: null }
        : state;
    case 'create-screen-opened':
      return state.catalog.kind === 'ready'
        ? { ...state, screen: { kind: 'create' }, createName: '', nameError: null }
        : state;
    case 'create-name-edited':
      return state.screen.kind === 'create' ? { ...state, createName: event.value, nameError: null } : state;
    case 'product-method-created': {
      if (state.screen.kind !== 'create' || state.catalog.kind !== 'ready' || event.method.pricing !== 'product')
        return state;
      const name = event.name.trim();
      if (
        !name ||
        name.length > 80 ||
        [...name].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
      )
        return { ...state, nameError: 'name-invalid' };
      if (!normalizedUniqueName(name, state.methods)) return { ...state, nameError: 'name-duplicate' };
      if (state.methods.some((method) => method.id === event.method.id))
        return { ...state, nameError: 'method-add-failed' };
      const method = { ...event.method, name };
      const methodIds = state.draft.methodIds.includes(method.id)
        ? state.draft.methodIds
        : [...state.draft.methodIds, method.id];
      const methods = [...state.methods, method];
      return {
        ...state,
        methods,
        draft: { ...state.draft, methodIds },
        editedMethodIds: addEditedMethodId(state, method.id),
        screen: state.draft.sizes.length ? { kind: 'prices', methodId: method.id } : { kind: 'methods' },
        createName: '',
        nameError: null,
      };
    }
    case 'apply-requested':
      if (state.screen.kind === 'create' || state.catalog.kind === 'loading') return state;
      return applyStagedMethods(state);
  }
}
