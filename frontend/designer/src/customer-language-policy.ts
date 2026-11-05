import { parseLanguagePreference } from "@insignia/ui-localization/core";

function canonicalLocale(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length > 128 || !value.trim()) return null;
  try { return Intl.getCanonicalLocales(value)[0] ?? null; } catch { return null; }
}

/** Shopify owns the page language. Browser negotiation is only a missing-context fallback. */
export function resolveCustomerHostLocale(
  hostLocale: string | null | undefined,
  browserLanguages: readonly string[],
): string {
  const host = canonicalLocale(hostLocale);
  if (host) return host;
  for (const candidate of browserLanguages) {
    const locale = canonicalLocale(candidate);
    if (locale && locale !== "en-XA" && parseLanguagePreference(locale.split("-")[0])) return locale;
  }
  return "en";
}

export function customerBrowserLanguages(): readonly string[] {
  try {
    return navigator.languages.length ? [...navigator.languages] : [navigator.language];
  } catch {
    return [];
  }
}
