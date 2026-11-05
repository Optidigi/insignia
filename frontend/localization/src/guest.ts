import { guestCatalogs } from './catalogs/guest.js';
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
import type { GuestMessageTable } from './generated/catalog-types.js';
import { guestParameterContracts } from './generated/guest-parameters.js';
import { createFixedTranslator, type TranslatorOptions } from './internal/fixed-translator.js';

const namespaces = ['common', 'guest-artwork'] as const;

export type GuestTranslator = TypedTranslator<GuestMessageTable>;
export type GuestMessageKey = keyof GuestMessageTable & string;
export type GuestTranslationParams<Key extends GuestMessageKey> = GuestMessageTable[Key];
export type GuestMessage = MessageDescriptor<GuestMessageTable>;
export type GuestLocaleSnapshot = LocaleSnapshot<GuestTranslator, GuestMessage>;
export type GuestLocaleController = LocaleController<GuestTranslator, GuestMessage>;
export type GuestTranslatorOptions = TranslatorOptions;
export type GuestControllerOptions = LocaleControllerOptions & TranslatorOptions;

export const guestMessage = createMessageFactory<GuestMessageTable>();

/** Returns a fresh, synchronous i18next instance for one guest upload surface. */
export function createGuestTranslator(
  requestedLocale: LocaleInput = null,
  options: GuestTranslatorOptions = {},
): GuestLocaleSnapshot {
  const fixed = createFixedTranslator<GuestMessageTable>(
    guestCatalogs,
    namespaces,
    guestParameterContracts,
    requestedLocale,
    options,
  );
  return Object.freeze({
    ...fixed,
    message: (descriptor: GuestMessage) => renderMessage(fixed.t, descriptor),
  });
}

/** Creates an isolated controller for one guest upload surface. */
export function createGuestLocaleController(
  initialLocale: LocaleInput = null,
  options: GuestControllerOptions = {},
): GuestLocaleController {
  return createLocaleController(
    initialLocale,
    (requestedLocale) => createGuestTranslator(requestedLocale, options),
    options,
  );
}
