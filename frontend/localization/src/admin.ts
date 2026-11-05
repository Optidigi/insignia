import { adminCatalogs } from './catalogs/admin.js';
import {
  createLocaleController,
  createMessageFactory,
  type LocaleController,
  type LocaleControllerOptions,
  type LocaleInput,
  type LocaleSnapshot,
  type MessageDescriptor,
  renderMessage,
  type TypedTranslator,
} from './core.js';
import { adminParameterContracts } from './generated/admin-parameters.js';
import type { AdminMessageTable } from './generated/catalog-types.js';
import { createFixedTranslator, type TranslatorOptions } from './internal/fixed-translator.js';

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

/** Returns a fresh, synchronous i18next instance for one request or island. */
export function createAdminTranslator(
  requestedLocale: LocaleInput = null,
  options: AdminTranslatorOptions = {},
): AdminLocaleSnapshot {
  const fixed = createFixedTranslator<AdminMessageTable>(
    adminCatalogs,
    namespaces,
    adminParameterContracts,
    requestedLocale,
    options,
  );
  return Object.freeze({
    ...fixed,
    message: (descriptor: AdminMessage) => renderMessage(fixed.t, descriptor),
  });
}

/** Creates a client-scoped controller; no language state is shared globally. */
export function createAdminLocaleController(
  initialLocale: LocaleInput = null,
  options: AdminControllerOptions = {},
): AdminLocaleController {
  return createLocaleController(
    initialLocale,
    (requestedLocale) => createAdminTranslator(requestedLocale, options),
    options,
  );
}
