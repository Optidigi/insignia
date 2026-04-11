/**
 * Server-side i18n utility for the Insignia storefront modal.
 * Merges merchant-override strings (from StorefrontTranslation table) with
 * built-in defaults from the client-side i18n module.
 */
import db from "../../db.server";
import { getTranslations, SUPPORTED_LOCALE_CODES, type TranslationStrings } from "../../components/storefront/i18n";

/**
 * Maps the flat setting keys (used in the admin translations UI) to the
 * nested path in TranslationStrings where they should be applied.
 * Format: [section, field]
 */
const SETTING_KEY_MAP: Record<string, [keyof TranslationStrings, string]> = {
  "upload.title":          ["upload", "title"],
  "upload.subtitle":       ["upload", "subtitle"],
  "upload.button":         ["upload", "btnNext"],
  "upload.artwork_later":  ["upload", "laterTitle"],
  "placement.title":       ["placement", "title"],
  "placement.button_next": ["placement", "btnNext"],
  "placement.button_back": ["placement", "btnBack"],
  "size.title":            ["size", "title"],
  "size.button_next":      ["size", "btnNextStep"],
  "size.button_back":      ["size", "btnBack"],
  "review.title":          ["review", "title"],
  "review.button_add":     ["review", "btnCart"],
  "review.button_back":    ["review", "btnBack"],
  "common.close":          ["common", "close"],
  "common.loading":        ["common", "loading"],
  "common.method_label":   ["upload", "methodLabel"],
};

/**
 * Parse an Accept-Language header and return the best supported locale code.
 * Falls back to "en".
 */
export function parseAcceptLanguage(acceptLanguage: string | null): string {
  if (!acceptLanguage) return "en";
  // Take the first language tag (before comma), extract primary subtag
  const primary = acceptLanguage.split(",")[0].trim().split(";")[0].trim();
  const lang = primary.split("-")[0].toLowerCase();
  return (SUPPORTED_LOCALE_CODES as readonly string[]).includes(lang) ? lang : "en";
}

/**
 * Get the merged translation strings for a shop and locale.
 * Defaults come from the built-in translations; merchant overrides from the DB.
 */
export async function getStorefrontTranslations(
  shopId: string,
  locale: string
): Promise<TranslationStrings> {
  // Deep-clone the base translations (avoid mutating the shared object)
  const base = getTranslations(locale);
  const merged: TranslationStrings = JSON.parse(JSON.stringify(base));

  // Load merchant overrides for this shop + locale
  const overrides = await db.storefrontTranslation.findMany({
    where: { shopId, locale },
    select: { key: true, value: true },
  });

  // Apply overrides using the key map
  for (const { key, value } of overrides) {
    const path = SETTING_KEY_MAP[key];
    if (!path) continue;
    const [section, field] = path;
    const section_obj = merged[section] as Record<string, string>;
    if (section_obj && field in section_obj) {
      section_obj[field] = value;
    }
  }

  return merged;
}
