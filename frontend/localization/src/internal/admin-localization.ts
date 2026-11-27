import {
  createLocaleController,
  createMessageFactory,
  type LocaleController,
  type LocaleControllerOptions,
  type LocaleInput,
  type LocaleSnapshot,
  type MessageDescriptor,
  type ResolvedLocale,
  renderMessage,
  resolveLocale,
  type SupportedLanguage,
  type TypedTranslator,
} from '../core.js';
import { adminParameterContracts } from '../generated/admin-parameters.js';
import type { AdminMessageTable } from '../generated/catalog-types.js';
import { createFixedTranslator, type TranslationCatalog, type TranslatorOptions } from './fixed-translator.js';

const namespaces = [
  'common',
  'admin-shell',
  'home',
  'products',
  'methods',
  'editor',
  'orders',
  'settings',
  'artwork',
  'exports',
  'admin-preview',
] as const;

export type AdminTranslator = TypedTranslator<AdminMessageTable>;
export type AdminMessageKey = keyof AdminMessageTable & string;
export type AdminTranslationParams<Key extends AdminMessageKey> = AdminMessageTable[Key];
export type AdminMessage = MessageDescriptor<AdminMessageTable>;
export type AdminLocaleSnapshot = LocaleSnapshot<AdminTranslator, AdminMessage>;
export type AdminLocaleController = LocaleController<AdminTranslator, AdminMessage>;
export type AdminTranslatorOptions = TranslatorOptions;
export type AdminControllerOptions = LocaleControllerOptions & TranslatorOptions;

export const adminMessage = createMessageFactory<AdminMessageTable>();

export function createAdminLocalization(
  catalogs: Readonly<Partial<Record<SupportedLanguage, TranslationCatalog>> & { en: TranslationCatalog }>,
  prepareCatalog?: (language: ResolvedLocale['activeLanguage']) => Promise<void>,
) {
  /** Returns a fresh, synchronous i18next instance for one request or island. */
  function createAdminTranslator(
    requestedLocale: LocaleInput = null,
    options: AdminTranslatorOptions = {},
  ): AdminLocaleSnapshot {
    const { activeLanguage } = resolveLocale(requestedLocale, options);
    const languageAvailable = activeLanguage === 'en-XA' || catalogs[activeLanguage] !== undefined;
    const fixed = createFixedTranslator<AdminMessageTable>(
      catalogs,
      namespaces,
      adminParameterContracts,
      languageAvailable ? requestedLocale : 'en',
      options,
    );
    return Object.freeze({
      ...fixed,
      message: (descriptor: AdminMessage) => renderMessage(fixed.t, descriptor),
    });
  }

  /** Creates a client-scoped controller; no language state is shared globally. */
  function createAdminLocaleController(
    initialLocale: LocaleInput = null,
    options: AdminControllerOptions = {},
  ): AdminLocaleController {
    return createLocaleController(initialLocale, (requestedLocale) => createAdminTranslator(requestedLocale, options), {
      ...options,
      async prepareLocale(resolved) {
        await prepareCatalog?.(resolved.activeLanguage);
        await options.prepareLocale?.(resolved);
      },
    });
  }

  return { createAdminTranslator, createAdminLocaleController };
}
