import { customerCatalogs } from './catalogs/customer.js';
import {
  createLocaleController,
  createMessageFactory,
  type LocaleController,
  type LocaleControllerOptions,
  type LocaleInput,
  type LocaleSnapshot,
  type LocaleUpdateResult,
  type MessageDescriptor,
  resolveLocale,
  type TypedTranslator,
} from './core.js';
import {
  CUSTOMER_WORDING_MANIFEST,
  type CustomerWordingForm,
  type CustomerWordingIssue,
  type CustomerWordingIssueCode,
  type CustomerWordingManifestEntry,
  type CustomerWordingOverlay,
  type CustomerWordingParameter,
  type CustomerWordingParameterType,
  type CustomerWordingPluralForm,
  type CustomerWordingValidation,
  customerDirectionForLocale,
  customerIntlSupports,
  customerWordingCatalog,
  customerWordingDefaultText,
  customerWordingFormForCount,
  customerWordingSourceText,
  requiredCustomerWordingForms,
  validateCustomerWordingOverlay,
} from './customer-wording.js';
import type { CustomerMessageTable } from './generated/catalog-types.js';
import { customerParameterContracts } from './generated/customer-parameters.js';
import { createFixedTranslator, type TranslationCatalog, type TranslatorOptions } from './internal/fixed-translator.js';

const namespaces = ['common', 'customer'] as const;
const customerWordingEntryByKey = new Map(CUSTOMER_WORDING_MANIFEST.map((entry) => [entry.key, entry]));

export type CustomerTranslator = TypedTranslator<CustomerMessageTable>;
export type CustomerMessageKey = keyof CustomerMessageTable & string;
export type CustomerTranslationParams<Key extends CustomerMessageKey> = CustomerMessageTable[Key];
export type CustomerMessage = MessageDescriptor<CustomerMessageTable>;
export type CustomerLocaleSnapshot = LocaleSnapshot<CustomerTranslator, CustomerMessage> &
  Readonly<{ wordingLocale: string | null }>;
export type CustomerLocaleController = Omit<LocaleController<CustomerTranslator, CustomerMessage>, 'getSnapshot'> & {
  getSnapshot(): CustomerLocaleSnapshot;
  setWordingOverlay(overlay: CustomerWordingOverlay | null, requestedLocale?: LocaleInput): Promise<LocaleUpdateResult>;
};
export type CustomerTranslatorOptions = TranslatorOptions & {
  /** Sparse merchant-authored customer copy for one exact canonical locale. */
  readonly wordingOverlay?: CustomerWordingOverlay | null;
  /** Optional host direction. If omitted, common RTL tags are inferred for the matching overlay. */
  readonly textDirection?: 'ltr' | 'rtl';
};
export type CustomerControllerOptions = LocaleControllerOptions & CustomerTranslatorOptions;

export const customerMessage = createMessageFactory<CustomerMessageTable>();
export type {
  CustomerWordingForm,
  CustomerWordingIssue,
  CustomerWordingIssueCode,
  CustomerWordingManifestEntry,
  CustomerWordingOverlay,
  CustomerWordingParameter,
  CustomerWordingParameterType,
  CustomerWordingPluralForm,
  CustomerWordingValidation,
};
export {
  CUSTOMER_WORDING_MANIFEST,
  customerDirectionForLocale,
  customerIntlSupports,
  customerWordingDefaultText,
  customerWordingSourceText,
  requiredCustomerWordingForms,
  validateCustomerWordingOverlay,
};

/** Returns a fresh, synchronous i18next instance for one modal or request. */
export function createCustomerTranslator(
  requestedLocale: LocaleInput = null,
  options: CustomerTranslatorOptions = {},
): CustomerLocaleSnapshot {
  const { wordingOverlay, textDirection, ...translatorOptions } = options;
  const validation = wordingOverlay ? validateCustomerWordingOverlay(wordingOverlay) : null;
  const canonicalRequestedLocale = resolveLocale(requestedLocale, translatorOptions).canonicalRequestedLocale;
  const activeOverlay =
    validation?.status === 'valid' && validation.overlay.locale === canonicalRequestedLocale
      ? validation.overlay
      : null;
  const localeResource = activeOverlay
    ? { locale: activeOverlay.locale, catalog: customerWordingCatalog(activeOverlay) as TranslationCatalog }
    : undefined;
  const fixed = createFixedTranslator<CustomerMessageTable>(
    customerCatalogs,
    namespaces,
    customerParameterContracts,
    requestedLocale,
    translatorOptions,
    localeResource,
  );
  const wordingLocale = activeOverlay?.locale ?? null;
  const baselineFallback = activeOverlay
    ? createFixedTranslator<CustomerMessageTable>(
        customerCatalogs,
        namespaces,
        customerParameterContracts,
        requestedLocale,
        translatorOptions,
      )
    : null;
  const fixedTranslate = fixed.t as unknown as (qualifiedKey: string, values?: unknown) => string;
  const baselineTranslate = baselineFallback?.t as unknown as
    | ((qualifiedKey: string, values?: unknown) => string)
    | undefined;
  const t = ((qualifiedKey: string, values?: unknown) => {
    if (activeOverlay && baselineTranslate && values !== null && typeof values === 'object') {
      const entry = customerWordingEntryByKey.get(qualifiedKey as CustomerMessageKey);
      const count = (values as Readonly<Record<string, unknown>>).count;
      if (entry?.kind === 'plural' && typeof count === 'number') {
        const form = customerWordingFormForCount(entry, activeOverlay.locale, count);
        if (form !== null && activeOverlay.messages[entry.key]?.[form] === undefined) {
          return baselineTranslate(qualifiedKey, values);
        }
      }
    }
    return fixedTranslate(qualifiedKey, values);
  }) as CustomerTranslator;
  return Object.freeze({
    ...fixed,
    t,
    ...(activeOverlay
      ? {
          formatLocale: customerIntlSupports(activeOverlay.locale) ? activeOverlay.locale : 'en',
          lang: activeOverlay.locale,
          dir: textDirection ?? customerDirectionForLocale(activeOverlay.locale),
        }
      : {}),
    wordingLocale,
    message: (descriptor: CustomerMessage) => {
      const dynamicTranslator = t as unknown as (key: string, values?: unknown) => string;
      return dynamicTranslator(descriptor.key, descriptor.args[0]);
    },
  });
}

/** Creates an isolated controller for one mounted customer session. */
export function createCustomerLocaleController(
  initialLocale: LocaleInput = null,
  options: CustomerControllerOptions = {},
): CustomerLocaleController {
  let wordingOverlay = options.wordingOverlay ?? null;
  const controller = createLocaleController(
    initialLocale,
    (requestedLocale) => createCustomerTranslator(requestedLocale, { ...options, wordingOverlay }),
    options,
  );
  return {
    getSnapshot: () => controller.getSnapshot() as CustomerLocaleSnapshot,
    subscribe: (listener) => controller.subscribe(listener),
    setLocale: (requestedLocale) => controller.setLocale(requestedLocale),
    async setWordingOverlay(nextOverlay, requestedLocale = controller.getSnapshot().requestedLocale) {
      if (nextOverlay === null) {
        wordingOverlay = null;
      } else {
        const validation = validateCustomerWordingOverlay(nextOverlay);
        if (validation.status !== 'valid') return { status: 'failed' };
        wordingOverlay = validation.overlay;
      }
      return controller.setLocale(requestedLocale);
    },
  };
}
