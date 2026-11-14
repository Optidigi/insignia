import {
  type CustomerTranslationsLoadError,
  type CustomerTranslationsState,
  type CustomerWordingForm,
  type CustomerWordingOverlay,
  type CustomerWordingValidation,
  type CustomerWordingValidationIssue,
  canonicalCustomerTranslationLocale,
  customerTranslationShopDomain,
  customerTranslationsCurrentOverlay,
  customerTranslationsLocales,
  customerTranslationsReducer,
  initialCustomerTranslationsState,
  isCustomerTranslationsDirty,
  isCustomerTranslationsSaving,
} from './customer-translations-state.ts';
import { isShopifyBusy } from '../shared/admin-request.ts';

export type CustomerTranslationsStoredRecord = {
  version: 1;
  shop: string;
  overlays: Record<string, CustomerWordingOverlay>;
};

export interface CustomerTranslationsStoragePort {
  read(): unknown | null | Promise<unknown | null>;
  write(record: CustomerTranslationsStoredRecord): void | Promise<void>;
  remove(): void | Promise<void>;
}

export interface CustomerTranslationsStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type CustomerTranslationsOverlayValidator = (value: unknown) => CustomerWordingValidation;

export type CustomerTranslationsSnapshot = CustomerTranslationsState & {
  currentOverlay: CustomerWordingOverlay;
  locales: string[];
  dirty: boolean;
  pending: 'loading' | 'saving' | null;
};

export type CustomerTranslationsWorkflowOptions = {
  shop: unknown;
  /** Production resolves this through authenticated preferences before any wording read. */
  resolveShop?: () => Promise<unknown>;
  storage: CustomerTranslationsStoragePort | null | undefined;
  validateOverlay: CustomerTranslationsOverlayValidator;
};

export type CustomerTranslationsWorkflow = {
  getSnapshot(): CustomerTranslationsSnapshot;
  subscribe(listener: (snapshot: CustomerTranslationsSnapshot) => void): () => void;
  load(): Promise<boolean>;
  addLanguage(locale: string): boolean;
  selectLanguage(locale: string, options?: { discardChanges?: boolean }): boolean;
  editMessage(key: string, form: CustomerWordingForm, value: string): void;
  resetMessage(key: string, form: CustomerWordingForm): void;
  validateCurrent(): readonly CustomerWordingValidationIssue[];
  save(): Promise<boolean>;
  discard(): void;
  resetLanguage(locale: string, confirmed: boolean): void;
  removeLanguage(locale: string, confirmed: boolean): void;
  clearInvalidStorage(confirmed: boolean): Promise<boolean>;
  dispose(): void;
};

export const customerTranslationsStorageKey = (shop: unknown): string | null => {
  const domain = customerTranslationShopDomain(shop);
  return domain ? `insignia:customer-translations:v1:${domain}` : null;
};

export class CustomerTranslationsMalformedStorageError extends Error {
  constructor() {
    super('Stored customer translations are not valid JSON.');
    this.name = 'CustomerTranslationsMalformedStorageError';
  }
}

/** Binds browser Storage to one validated shop and stores only versioned JSON records. */
export function createCustomerTranslationsStoragePort(
  shop: unknown,
  storage: CustomerTranslationsStorageLike,
): CustomerTranslationsStoragePort | null {
  const key = customerTranslationsStorageKey(shop);
  if (!key) return null;
  return {
    read() {
      const raw = storage.getItem(key);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        throw new CustomerTranslationsMalformedStorageError();
      }
    },
    write(record) {
      storage.setItem(key, JSON.stringify(record));
    },
    remove() {
      storage.removeItem(key);
    },
  };
}

/** Uses the embedded Shopify shop identity; returns null where browser storage is unavailable. */
export function createBrowserCustomerTranslationsStorage(): CustomerTranslationsStoragePort | null {
  if (typeof window === 'undefined') return null;
  const shop = (window as unknown as { shopify?: { config?: { shop?: unknown } } }).shopify?.config?.shop;
  try {
    return createCustomerTranslationsStoragePort(shop, window.localStorage);
  } catch {
    return null;
  }
}

/** Compatibility name for callers that prefer the explicit browser-port wording. */
export const createBrowserCustomerTranslationsStoragePort = createBrowserCustomerTranslationsStorage;

export function createCustomerTranslationsWorkflow(
  options: CustomerTranslationsWorkflowOptions,
): CustomerTranslationsWorkflow {
  let shop = customerTranslationShopDomain(options.shop);
  let state = initialCustomerTranslationsState(shop);
  let nextRequestId = 0;
  let disposed = false;
  const listeners = new Set<(snapshot: CustomerTranslationsSnapshot) => void>();

  function snapshot(): CustomerTranslationsSnapshot {
    return {
      ...state,
      currentOverlay: customerTranslationsCurrentOverlay(state),
      locales: customerTranslationsLocales(state),
      dirty: isCustomerTranslationsDirty(state),
      pending: state.phase === 'loading' ? 'loading' : isCustomerTranslationsSaving(state) ? 'saving' : null,
    };
  }

  function dispatch(event: Parameters<typeof customerTranslationsReducer>[1]): void {
    if (disposed) return;
    const next = customerTranslationsReducer(state, event);
    if (next === state) return;
    state = next;
    const current = snapshot();
    for (const listener of listeners) listener(current);
  }

  function validateOverlay(overlay: CustomerWordingOverlay): CustomerWordingValidation {
    return options.validateOverlay(overlay);
  }

  function decodeRecord(value: unknown): Record<string, CustomerWordingOverlay> | null {
    if (!isPlainRecord(value) || !hasExactKeys(value, ['version', 'shop', 'overlays'])) return null;
    if (value.version !== 1 || value.shop !== shop || !isPlainRecord(value.overlays)) return null;
    const overlays: Record<string, CustomerWordingOverlay> = {};
    for (const [locale, rawOverlay] of Object.entries(value.overlays)) {
      if (!isPlainRecord(rawOverlay) || rawOverlay.locale !== locale) return null;
      const canonical = canonicalCustomerTranslationLocale(locale);
      if (canonical !== locale) return null;
      const validation = validateOverlay(rawOverlay as unknown as CustomerWordingOverlay);
      if (validation.status !== 'valid' || validation.overlay.locale !== locale) return null;
      overlays[locale] = validation.overlay;
    }
    if (!Object.hasOwn(overlays, 'en') || overlays.en?.locale !== 'en') return null;
    return overlays;
  }

  const isCurrentLoad = (request: number): boolean => !disposed && state.phase === 'loading' && state.loadRequestId === request;

  async function load(): Promise<boolean> {
    const request = ++nextRequestId;
    dispatch({ type: 'load-started', request });
    if (!isCurrentLoad(request)) return false;
    if (options.resolveShop) {
      try {
        const resolved = customerTranslationShopDomain(await options.resolveShop());
        if (!isCurrentLoad(request)) return false;
        if (!resolved || (shop !== null && shop !== resolved)) throw new Error('Customer wording shop authority changed');
        shop = resolved;
      } catch (error) {
        dispatch({ type: 'load-failed', request, reason: isShopifyBusy(error) ? 'busy' : 'storage-read-failed' });
        return false;
      }
    }
    if (!shop) {
      dispatch({ type: 'load-failed', request, reason: 'invalid-shop' });
      return false;
    }
    if (!options.storage) {
      dispatch({ type: 'load-failed', request, reason: 'storage-unavailable' });
      return false;
    }
    try {
      const raw = await options.storage.read();
      if (raw === null) {
        dispatch({ type: 'load-succeeded', request, shop, overlays: { en: emptyOverlay('en') } });
        return !disposed && state.phase === 'ready';
      }
      const value = typeof raw === 'string' ? parseJson(raw) : raw;
      const overlays = decodeRecord(value);
      if (!overlays) {
        dispatch({ type: 'load-failed', request, reason: 'invalid-record' });
        return false;
      }
      dispatch({ type: 'load-succeeded', request, shop, overlays });
      return !disposed && state.phase === 'ready';
    } catch (error) {
      const reason: CustomerTranslationsLoadError =
        error instanceof CustomerTranslationsMalformedStorageError || error instanceof InvalidJsonError
          ? 'invalid-record'
          : isShopifyBusy(error)
            ? 'busy'
            : 'storage-read-failed';
      dispatch({ type: 'load-failed', request, reason });
      return false;
    }
  }

  function addLanguage(locale: string): boolean {
    const canonical = canonicalCustomerTranslationLocale(locale);
    if (!canonical || canonical === 'en') return false;
    const validation = validateOverlay(emptyOverlay(canonical));
    if (validation.status !== 'valid' || validation.overlay.locale !== canonical) return false;
    const previous = state;
    dispatch({ type: 'language-added', locale: canonical });
    return state !== previous;
  }

  function selectLanguage(locale: string, selection: { discardChanges?: boolean } = {}): boolean {
    const previous = state;
    dispatch({ type: 'language-selected', locale, discardChanges: selection.discardChanges });
    return state !== previous;
  }

  function editMessage(key: string, form: CustomerWordingForm, value: string): void {
    dispatch({ type: 'message-edited', locale: state.selectedLocale, key, form, value });
  }

  function resetMessage(key: string, form: CustomerWordingForm): void {
    dispatch({ type: 'message-reset', locale: state.selectedLocale, key, form });
  }

  function validateCurrent(): readonly CustomerWordingValidationIssue[] {
    if (state.phase !== 'ready') return [];
    const overlay = state.draftByLocale[state.selectedLocale];
    if (!overlay) return [];
    const validation = validateOverlay(overlay);
    return validation.status === 'invalid' ? validation.issues : [];
  }

  async function save(): Promise<boolean> {
    if (
      state.phase !== 'ready' ||
      state.saveSnapshot ||
      !options.storage ||
      !shop ||
      !isCustomerTranslationsDirty(state)
    )
      return false;
    const overlays: Record<string, CustomerWordingOverlay> = {};
    let hasIssues = false;
    for (const [locale, overlay] of Object.entries(state.draftByLocale)) {
      const validation = validateOverlay(overlay);
      if (validation.status === 'invalid') {
        dispatch({ type: 'validation-failed', locale, issues: validation.issues });
        hasIssues = true;
      } else {
        dispatch({ type: 'validation-cleared', locale });
        overlays[locale] = validation.overlay;
      }
    }
    if (hasIssues || Object.keys(overlays).length !== Object.keys(state.draftByLocale).length) return false;
    const revision = state.revision;
    const request = ++nextRequestId;
    dispatch({ type: 'save-started', request, revision, overlays });
    const started = snapshot();
    if (!started.saveSnapshot || started.saveSnapshot.requestId !== request) return false;
    try {
      await options.storage.write({ version: 1, shop, overlays });
      dispatch({ type: 'save-succeeded', request });
      return !disposed && state.saveError === null && !isCustomerTranslationsDirty(state);
    } catch (error) {
      dispatch({ type: 'save-failed', request, reason: isShopifyBusy(error) ? 'busy' : 'storage-write-failed' });
      return false;
    }
  }

  function discard(): void {
    dispatch({ type: 'discarded' });
  }

  function resetLanguage(locale: string, confirmed: boolean): void {
    dispatch({ type: 'language-reset', locale, confirmed });
  }

  function removeLanguage(locale: string, confirmed: boolean): void {
    dispatch({ type: 'language-removed', locale, confirmed });
  }

  async function clearInvalidStorage(confirmed: boolean): Promise<boolean> {
    if (!confirmed || !options.storage || (state.error !== 'invalid-record' && state.error !== 'storage-clear-failed'))
      return false;
    try {
      await options.storage.remove();
      dispatch({ type: 'invalid-record-cleared' });
      return state.phase === 'ready';
    } catch {
      dispatch({ type: 'invalid-record-clear-failed' });
      return false;
    }
  }

  function dispose(): void {
    disposed = true;
    listeners.clear();
  }

  return {
    getSnapshot: snapshot,
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load,
    addLanguage,
    selectLanguage,
    editMessage,
    resetMessage,
    validateCurrent,
    save,
    discard,
    resetLanguage,
    removeLanguage,
    clearInvalidStorage,
    dispose,
  };
}

function emptyOverlay(locale: string): CustomerWordingOverlay {
  return { locale, messages: {} };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

class InvalidJsonError extends Error {}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new InvalidJsonError();
  }
}
