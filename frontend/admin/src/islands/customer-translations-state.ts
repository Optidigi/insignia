export const customerTranslationDefaultLocale = 'en' as const;

export type CustomerWordingForm = 'message' | 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
export type CustomerWordingMessages = Partial<Record<string, Partial<Record<CustomerWordingForm, string>>>>;
export type CustomerWordingOverlay = { locale: string; messages: CustomerWordingMessages };
export type CustomerWordingValidationIssue = { code: string; key?: string; form?: string };
export type CustomerWordingValidation =
  | { status: 'valid'; overlay: CustomerWordingOverlay }
  | { status: 'invalid'; issues: readonly CustomerWordingValidationIssue[] };

export type CustomerTranslationsLoadError =
  | 'invalid-shop'
  | 'storage-unavailable'
  | 'storage-read-failed'
  | 'invalid-record'
  | 'storage-clear-failed';
export type CustomerTranslationsSaveError = 'storage-write-failed';
export type CustomerTranslationsIssue = CustomerWordingValidationIssue & { locale: string };
export type CustomerTranslationsPhase = 'loading' | 'ready' | 'error';

export type CustomerTranslationsState = {
  phase: CustomerTranslationsPhase;
  shop: string | null;
  selectedLocale: string;
  savedByLocale: Record<string, CustomerWordingOverlay>;
  draftByLocale: Record<string, CustomerWordingOverlay>;
  loadRequestId: number;
  saveRequestId: number;
  revision: number;
  saveSnapshot: { requestId: number; revision: number; overlays: Record<string, CustomerWordingOverlay> } | null;
  error: CustomerTranslationsLoadError | null;
  saveError: CustomerTranslationsSaveError | null;
  validationIssues: CustomerTranslationsIssue[];
};

export type CustomerTranslationsEvent =
  | { type: 'load-started'; request: number }
  | { type: 'load-succeeded'; request: number; shop?: string; overlays: Record<string, CustomerWordingOverlay> }
  | { type: 'load-failed'; request: number; reason: CustomerTranslationsLoadError }
  | { type: 'language-added'; locale: string }
  | { type: 'language-selected'; locale: string; discardChanges?: boolean }
  | { type: 'message-edited'; locale: string; key: string; form: CustomerWordingForm; value: string }
  | { type: 'message-reset'; locale: string; key: string; form: CustomerWordingForm }
  | { type: 'language-reset'; locale: string; confirmed: boolean }
  | { type: 'language-removed'; locale: string; confirmed: boolean }
  | { type: 'discarded' }
  | { type: 'validation-failed'; locale: string; issues: readonly CustomerWordingValidationIssue[] }
  | { type: 'validation-cleared'; locale: string }
  | { type: 'save-started'; request: number; revision: number; overlays: Record<string, CustomerWordingOverlay> }
  | { type: 'save-succeeded'; request: number }
  | { type: 'save-failed'; request: number }
  | { type: 'invalid-record-cleared' }
  | { type: 'invalid-record-clear-failed' };

export function customerTranslationShopDomain(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(value)
    ? value
    : null;
}

export function canonicalCustomerTranslationLocale(value: unknown): string | null {
  if (typeof value !== 'string' || value === '' || value.trim() !== value) return null;
  try {
    const canonical = Intl.getCanonicalLocales(value);
    return canonical.length === 1 ? (canonical[0] ?? null) : null;
  } catch {
    return null;
  }
}

export function initialCustomerTranslationsState(shop: unknown): CustomerTranslationsState {
  const english = emptyOverlay(customerTranslationDefaultLocale);
  return {
    phase: 'loading',
    shop: customerTranslationShopDomain(shop),
    selectedLocale: customerTranslationDefaultLocale,
    savedByLocale: { en: english },
    draftByLocale: { en: emptyOverlay(customerTranslationDefaultLocale) },
    loadRequestId: 0,
    saveRequestId: 0,
    revision: 0,
    saveSnapshot: null,
    error: null,
    saveError: null,
    validationIssues: [],
  };
}

export function customerTranslationsReducer(
  state: CustomerTranslationsState,
  event: CustomerTranslationsEvent,
): CustomerTranslationsState {
  switch (event.type) {
    case 'load-started':
      if (
        event.request <= state.loadRequestId ||
        (state.phase === 'ready' && (isCustomerTranslationsDirty(state) || state.saveSnapshot))
      )
        return state;
      return { ...state, phase: 'loading', loadRequestId: event.request, error: null };
    case 'load-succeeded':
      if (state.phase !== 'loading' || event.request !== state.loadRequestId) return state;
      {
        const overlays = withEnglishOverlay(event.overlays);
        const selectedLocale = Object.hasOwn(overlays, state.selectedLocale) ? state.selectedLocale : 'en';
        return {
          ...state,
          phase: 'ready',
          shop: event.shop ?? state.shop,
          selectedLocale,
          savedByLocale: cloneOverlays(overlays),
          draftByLocale: cloneOverlays(overlays),
          error: null,
          saveError: null,
          validationIssues: [],
        };
      }
    case 'load-failed':
      return state.phase === 'loading' && event.request === state.loadRequestId
        ? { ...state, phase: 'error', error: event.reason }
        : state;
    case 'language-added': {
      if (state.phase !== 'ready' || state.saveSnapshot || isCustomerTranslationsDirty(state)) return state;
      const locale = canonicalCustomerTranslationLocale(event.locale);
      if (!locale || locale === 'en' || Object.hasOwn(state.draftByLocale, locale)) return state;
      const nextDraft = { ...state.draftByLocale, [locale]: emptyOverlay(locale) };
      return {
        ...state,
        selectedLocale: locale,
        draftByLocale: nextDraft,
        revision: state.revision + 1,
        saveError: null,
        validationIssues: [],
      };
    }
    case 'language-selected': {
      if (state.phase !== 'ready' || state.saveSnapshot) return state;
      const locale = canonicalCustomerTranslationLocale(event.locale);
      if (!locale || !Object.hasOwn(state.draftByLocale, locale)) return state;
      const dirty = isCustomerTranslationsDirty(state);
      if (dirty && event.discardChanges !== true) return state;
      if (dirty && !Object.hasOwn(state.savedByLocale, locale)) return state;
      return {
        ...state,
        selectedLocale: locale,
        draftByLocale: dirty ? cloneOverlays(state.savedByLocale) : state.draftByLocale,
        revision: dirty ? state.revision + 1 : state.revision,
        saveError: null,
        validationIssues: [],
      };
    }
    case 'message-edited': {
      if (state.phase !== 'ready' || event.locale !== state.selectedLocale || !isCustomerMessageKey(event.key))
        return state;
      const overlay = state.draftByLocale[event.locale];
      if (!overlay) return state;
      const messages = cloneMessages(overlay.messages);
      const variants = { ...(messages[event.key] ?? {}) };
      if (event.value.trim() === '') delete variants[event.form];
      else variants[event.form] = event.value;
      if (Object.keys(variants).length === 0) delete messages[event.key];
      else messages[event.key] = variants;
      return {
        ...state,
        draftByLocale: { ...state.draftByLocale, [event.locale]: { locale: event.locale, messages } },
        revision: state.revision + 1,
        saveError: null,
        validationIssues: withoutIssue(state.validationIssues, event.locale, event.key, event.form),
      };
    }
    case 'message-reset': {
      if (state.phase !== 'ready' || event.locale !== state.selectedLocale || !isCustomerMessageKey(event.key))
        return state;
      const overlay = state.draftByLocale[event.locale];
      if (!overlay || !Object.hasOwn(overlay.messages[event.key] ?? {}, event.form)) return state;
      const messages = cloneMessages(overlay.messages);
      const variants = { ...(messages[event.key] ?? {}) };
      delete variants[event.form];
      if (Object.keys(variants).length === 0) delete messages[event.key];
      else messages[event.key] = variants;
      return {
        ...state,
        draftByLocale: { ...state.draftByLocale, [event.locale]: { locale: event.locale, messages } },
        revision: state.revision + 1,
        saveError: null,
        validationIssues: withoutIssue(state.validationIssues, event.locale, event.key, event.form),
      };
    }
    case 'language-reset': {
      if (state.phase !== 'ready' || state.saveSnapshot || !event.confirmed || event.locale !== state.selectedLocale)
        return state;
      const locale = canonicalCustomerTranslationLocale(event.locale);
      const overlay = locale ? state.draftByLocale[locale] : undefined;
      if (!locale || !overlay || Object.keys(overlay.messages).length === 0) return state;
      return {
        ...state,
        draftByLocale: { ...state.draftByLocale, [locale]: emptyOverlay(locale) },
        revision: state.revision + 1,
        saveError: null,
        validationIssues: state.validationIssues.filter((issue) => issue.locale !== locale),
      };
    }
    case 'language-removed': {
      if (
        state.phase !== 'ready' ||
        state.saveSnapshot ||
        !event.confirmed ||
        event.locale === 'en' ||
        !overlaysEqualExceptLocale(state.savedByLocale, state.draftByLocale, event.locale)
      )
        return state;
      const locale = canonicalCustomerTranslationLocale(event.locale);
      if (!locale || !Object.hasOwn(state.draftByLocale, locale)) return state;
      const draftByLocale = { ...state.draftByLocale };
      delete draftByLocale[locale];
      return {
        ...state,
        selectedLocale: state.selectedLocale === locale ? 'en' : state.selectedLocale,
        draftByLocale,
        revision: state.revision + 1,
        saveError: null,
        validationIssues: state.validationIssues.filter((issue) => issue.locale !== locale),
      };
    }
    case 'discarded':
      if (state.phase !== 'ready' || state.saveSnapshot || !isCustomerTranslationsDirty(state)) return state;
      return {
        ...state,
        selectedLocale: Object.hasOwn(state.savedByLocale, state.selectedLocale) ? state.selectedLocale : 'en',
        draftByLocale: cloneOverlays(state.savedByLocale),
        revision: state.revision + 1,
        saveError: null,
        validationIssues: [],
      };
    case 'validation-failed':
      if (state.phase !== 'ready' || !Object.hasOwn(state.draftByLocale, event.locale)) return state;
      return {
        ...state,
        validationIssues: [
          ...state.validationIssues.filter((issue) => issue.locale !== event.locale),
          ...event.issues.map((issue) => ({ ...issue, locale: event.locale })),
        ],
      };
    case 'validation-cleared':
      return { ...state, validationIssues: state.validationIssues.filter((issue) => issue.locale !== event.locale) };
    case 'save-started':
      if (state.phase !== 'ready' || event.request <= state.saveRequestId || event.revision !== state.revision)
        return state;
      return {
        ...state,
        saveRequestId: event.request,
        saveSnapshot: { requestId: event.request, revision: event.revision, overlays: cloneOverlays(event.overlays) },
        saveError: null,
      };
    case 'save-succeeded':
      if (
        !state.saveSnapshot ||
        event.request !== state.saveRequestId ||
        event.request !== state.saveSnapshot.requestId
      )
        return state;
      return {
        ...state,
        savedByLocale: cloneOverlays(state.saveSnapshot.overlays),
        draftByLocale:
          state.revision === state.saveSnapshot.revision
            ? cloneOverlays(state.saveSnapshot.overlays)
            : state.draftByLocale,
        saveSnapshot: null,
        saveError: null,
        validationIssues: state.revision === state.saveSnapshot.revision ? [] : state.validationIssues,
      };
    case 'save-failed':
      return state.saveSnapshot &&
        event.request === state.saveRequestId &&
        event.request === state.saveSnapshot.requestId
        ? { ...state, saveSnapshot: null, saveError: 'storage-write-failed' }
        : state;
    case 'invalid-record-cleared':
      if (state.phase !== 'error' || (state.error !== 'invalid-record' && state.error !== 'storage-clear-failed'))
        return state;
      {
        const english = emptyOverlay('en');
        return {
          ...state,
          phase: 'ready',
          selectedLocale: 'en',
          savedByLocale: { en: english },
          draftByLocale: { en: emptyOverlay('en') },
          error: null,
          saveError: null,
          saveSnapshot: null,
          validationIssues: [],
          revision: state.revision + 1,
        };
      }
    case 'invalid-record-clear-failed':
      return state.phase === 'error' && (state.error === 'invalid-record' || state.error === 'storage-clear-failed')
        ? { ...state, error: 'storage-clear-failed' }
        : state;
  }
}

export function isCustomerTranslationsDirty(state: CustomerTranslationsState): boolean {
  return !overlaysEqual(state.savedByLocale, state.draftByLocale);
}

export function customerTranslationsLocales(state: CustomerTranslationsState): string[] {
  return Object.keys(state.draftByLocale).sort((left, right) =>
    left === 'en' ? -1 : right === 'en' ? 1 : left.localeCompare(right),
  );
}

export function customerTranslationsCurrentOverlay(state: CustomerTranslationsState): CustomerWordingOverlay {
  return state.draftByLocale[state.selectedLocale] ?? emptyOverlay('en');
}

export function customerTranslationsFieldIssues(
  state: CustomerTranslationsState,
  key: string,
  form: CustomerWordingForm,
): CustomerTranslationsIssue[] {
  return state.validationIssues.filter(
    (issue) => issue.locale === state.selectedLocale && issue.key === key && issue.form === form,
  );
}

export function isCustomerTranslationsSaving(state: CustomerTranslationsState): boolean {
  return state.saveSnapshot !== null;
}

function isCustomerMessageKey(key: string): boolean {
  return (key.startsWith('customer:') || key.startsWith('common:')) && key.length > key.indexOf(':') + 1;
}

function emptyOverlay(locale: string): CustomerWordingOverlay {
  return { locale, messages: {} };
}

function withEnglishOverlay(overlays: Record<string, CustomerWordingOverlay>): Record<string, CustomerWordingOverlay> {
  const result = cloneOverlays(overlays);
  if (!Object.hasOwn(result, 'en')) result.en = emptyOverlay('en');
  return result;
}

function cloneMessages(messages: CustomerWordingMessages): CustomerWordingMessages {
  const result: CustomerWordingMessages = {};
  for (const [key, forms] of Object.entries(messages)) result[key] = { ...forms };
  return result;
}

function cloneOverlays(overlays: Record<string, CustomerWordingOverlay>): Record<string, CustomerWordingOverlay> {
  const result: Record<string, CustomerWordingOverlay> = {};
  for (const [locale, overlay] of Object.entries(overlays)) {
    result[locale] = { locale: overlay.locale, messages: cloneMessages(overlay.messages) };
  }
  return result;
}

function withoutIssue(
  issues: CustomerTranslationsIssue[],
  locale: string,
  key: string,
  form: CustomerWordingForm,
): CustomerTranslationsIssue[] {
  return issues.filter((issue) => issue.locale !== locale || issue.key !== key || issue.form !== form);
}

function overlaysEqual(
  left: Record<string, CustomerWordingOverlay>,
  right: Record<string, CustomerWordingOverlay>,
): boolean {
  const leftLocales = Object.keys(left);
  const rightLocales = Object.keys(right);
  if (leftLocales.length !== rightLocales.length || leftLocales.some((locale) => !Object.hasOwn(right, locale)))
    return false;

  for (const locale of leftLocales) {
    const leftOverlay = left[locale];
    const rightOverlay = right[locale];
    if (!leftOverlay || !rightOverlay || leftOverlay.locale !== rightOverlay.locale) return false;
    const leftKeys = Object.keys(leftOverlay.messages);
    const rightKeys = Object.keys(rightOverlay.messages);
    if (leftKeys.length !== rightKeys.length || leftKeys.some((key) => !Object.hasOwn(rightOverlay.messages, key)))
      return false;
    for (const key of leftKeys) {
      const leftForms = leftOverlay.messages[key] ?? {};
      const rightForms = rightOverlay.messages[key] ?? {};
      const forms = Object.keys(leftForms);
      if (forms.length !== Object.keys(rightForms).length) return false;
      for (const form of forms) {
        if (leftForms[form as CustomerWordingForm] !== rightForms[form as CustomerWordingForm]) return false;
      }
    }
  }
  return true;
}

function overlaysEqualExceptLocale(
  left: Record<string, CustomerWordingOverlay>,
  right: Record<string, CustomerWordingOverlay>,
  excludedLocale: string,
): boolean {
  const leftWithoutLocale = { ...left };
  const rightWithoutLocale = { ...right };
  delete leftWithoutLocale[excludedLocale];
  delete rightWithoutLocale[excludedLocale];
  return overlaysEqual(leftWithoutLocale, rightWithoutLocale);
}
