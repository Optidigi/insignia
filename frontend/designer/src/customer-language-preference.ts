import { parseLanguagePreference, type SupportedLanguage } from "@insignia/ui-localization/core";

export const CUSTOMER_LANGUAGE_PREFERENCE_KEY = "insignia.customer.language.v1";

/** Read a valid manual choice. Component state remains the session fallback if storage is blocked. */
export function readCustomerLanguagePreference(): SupportedLanguage | null {
  try {
    return parseLanguagePreference(window.localStorage.getItem(CUSTOMER_LANGUAGE_PREFERENCE_KEY));
  } catch {
    // Some storefront privacy settings block access to localStorage.
  }
  return null;
}

/** Store a manual choice durably when possible; the mounted Designer keeps it in state otherwise. */
export function writeCustomerLanguagePreference(
  language: SupportedLanguage | null,
): void {
  try {
    if (language === null) {
      window.localStorage.removeItem(CUSTOMER_LANGUAGE_PREFERENCE_KEY);
    } else {
      window.localStorage.setItem(CUSTOMER_LANGUAGE_PREFERENCE_KEY, language);
    }
  } catch {
    // Component state still retains the selection for this mounted session.
  }
}
