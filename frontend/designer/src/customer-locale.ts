import { type CustomerTranslator, type CustomerMessage, createCustomerLocaleController, createCustomerTranslator } from "@insignia/ui-localization/customer";
import { createPreactLocaleBindings } from "@insignia/ui-localization/preact";

/** Bind one customer catalog audience once; each mounted Designer owns its own controller. */
export const { LocaleProvider, useLocale } =
  createPreactLocaleBindings<CustomerTranslator, CustomerMessage>(createCustomerTranslator);

export { createCustomerLocaleController };
