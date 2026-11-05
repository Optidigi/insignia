import { createInstance, type Resource, type TOptions } from 'i18next';
import {
  type LocaleInput,
  type LocaleResolutionOptions,
  type LocaleSnapshot,
  resolveLocale,
  type SupportedLanguage,
  type TypedTranslator,
} from '../core.js';

export interface TranslatorOptions extends LocaleResolutionOptions {
  readonly onMissingKey?: (qualifiedKey: string) => void;
}

/** One explicit locale resource supplied by an audience-specific translator. */
export interface FixedLocaleResource {
  readonly locale: string;
  readonly catalog: TranslationCatalog;
}

type TranslationNode = string | { readonly [key: string]: TranslationNode };
export type TranslationCatalog = Readonly<Record<string, TranslationNode>>;
export type RuntimeParameterContract = Readonly<Record<string, 'number' | 'string'>>;
export type RuntimeParameterContracts = Readonly<Record<string, RuntimeParameterContract>>;

interface I18nextStringRuntime {
  t(key: string, options?: TOptions): unknown;
  exists(key: string, options?: TOptions): boolean;
}

const accentedCharacters: Readonly<Record<string, string>> = {
  a: 'à',
  e: 'ë',
  i: 'ï',
  o: 'ô',
  u: 'ü',
  A: 'À',
  E: 'Ë',
  I: 'Ï',
  O: 'Ô',
  U: 'Ü',
};

function pseudoMessage(message: string): string {
  const pieces = message.split(/(\{\{\s*[A-Za-z][A-Za-z0-9_]*\s*\}\})/g);
  const expanded = pieces.map((piece) => {
    if (/^\{\{/.test(piece)) return piece;
    let output = '';
    for (const character of piece) {
      const accented = accentedCharacters[character] ?? character;
      output += accented;
      if ('aeiouAEIOU'.includes(character)) output += accented;
    }
    return output;
  });
  return `［${expanded.join('')}～～］`;
}

function pseudoCatalogNode(value: TranslationNode): TranslationNode {
  if (typeof value === 'string') return pseudoMessage(value);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, pseudoCatalogNode(child)]));
}

function pseudoCatalog(catalog: TranslationCatalog): TranslationCatalog {
  return Object.fromEntries(Object.entries(catalog).map(([key, value]) => [key, pseudoCatalogNode(value)]));
}

function notifyMissing(options: TranslatorOptions, key: string): void {
  try {
    options.onMissingKey?.(key);
  } catch {
    // Diagnostics must not turn a missing message into a render failure.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasValidParameters(
  key: string,
  values: unknown,
  contracts: RuntimeParameterContracts,
): values is Readonly<Record<string, string | number>> {
  const contract = contracts[key];
  if (contract === undefined) return false;

  const expectedNames = Object.keys(contract);
  if (expectedNames.length === 0) return values === undefined;
  if (!isRecord(values)) return false;

  const receivedNames = Object.keys(values);
  if (receivedNames.length !== expectedNames.length) return false;

  for (const name of expectedNames) {
    if (!Object.hasOwn(values, name)) return false;
    const value = values[name];
    if (contract[name] === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) return false;
      if (name === 'count' && (!Number.isSafeInteger(value) || value < 0)) return false;
    } else if (typeof value !== 'string') {
      return false;
    }
  }

  return receivedNames.every((name) => Object.hasOwn(contract, name));
}

function safeFallback(engine: I18nextStringRuntime): string {
  const fallback = engine.t('common:summary.unavailable', {
    nest: false,
    lng: 'en',
    fallbackLng: false,
  });
  return typeof fallback === 'string' && fallback.length > 0 && fallback !== 'summary.unavailable'
    ? fallback
    : 'Unavailable';
}

/** Creates a request- or component-scoped synchronous i18next translator. */
export function createFixedTranslator<MessageTable extends object>(
  catalogs: Readonly<Record<SupportedLanguage, TranslationCatalog>>,
  namespaces: readonly string[],
  parameterContracts: RuntimeParameterContracts,
  requestedLocale: LocaleInput,
  options: TranslatorOptions = {},
  localeResource?: FixedLocaleResource,
): LocaleSnapshot<TypedTranslator<MessageTable>> {
  const resolved = resolveLocale(requestedLocale, options);
  const catalog = catalogs.en;
  const selectedCatalog =
    resolved.activeLanguage === 'en-XA' ? pseudoCatalog(catalog) : catalogs[resolved.activeLanguage];
  const useLocaleResource = localeResource?.locale === resolved.canonicalRequestedLocale;
  const activeLanguage = useLocaleResource ? localeResource.locale : resolved.activeLanguage;
  const instance = createInstance();
  const resources: Resource = {
    en: { ...catalog },
    [resolved.activeLanguage]: { ...selectedCatalog },
    ...(useLocaleResource && localeResource ? { [localeResource.locale]: { ...localeResource.catalog } } : {}),
  };
  const initialization = instance.init({
    resources,
    lng: activeLanguage,
    fallbackLng: 'en',
    supportedLngs: [
      'en',
      resolved.activeLanguage,
      ...(useLocaleResource && localeResource ? [localeResource.locale] : []),
    ],
    ns: namespaces,
    defaultNS: 'common',
    keySeparator: '.',
    nsSeparator: ':',
    returnNull: false,
    returnEmptyString: false,
    saveMissing: false,
    initAsync: false,
    interpolation: { escapeValue: false, skipOnVariables: true },
  });
  void initialization.catch(() => undefined);

  // i18next's broad overloads model selectors, objects, and optional options.
  // This wrapper only uses qualified string keys and already-validated text params.
  const engine = instance as unknown as I18nextStringRuntime;

  const translate = ((qualifiedKey: string, values?: unknown) => {
    if (!hasValidParameters(qualifiedKey, values, parameterContracts)) {
      notifyMissing(options, qualifiedKey);
      return safeFallback(engine);
    }

    const hasEnglishMessage = engine.exists(qualifiedKey, {
      ...values,
      lng: 'en',
      fallbackLng: false,
    });
    if (!hasEnglishMessage) {
      notifyMissing(options, qualifiedKey);
      return safeFallback(engine);
    }
    const result = engine.t(qualifiedKey, { ...values, nest: false });
    if (typeof result !== 'string') {
      notifyMissing(options, qualifiedKey);
      return safeFallback(engine);
    }
    return result.length > 0 ? result : safeFallback(engine);
  }) as TypedTranslator<MessageTable>;

  return Object.freeze({ ...resolved, t: translate });
}
