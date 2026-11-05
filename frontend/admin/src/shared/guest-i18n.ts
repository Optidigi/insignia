import {
  createGuestLocaleController,
  createGuestTranslator,
  type GuestLocaleController,
} from '@insignia/ui-localization/guest';
import { createPreactLocaleBindings } from '@insignia/ui-localization/preact';

const bindings = createPreactLocaleBindings(() => createGuestTranslator());
export const GuestLocaleProvider = bindings.LocaleProvider;
export const useGuestLocale = bindings.useLocale;
export function guestLocaleController(locale?: string | null): GuestLocaleController {
  return createGuestLocaleController(
    locale ?? (typeof document === 'undefined' ? null : document.documentElement.lang),
  );
}
