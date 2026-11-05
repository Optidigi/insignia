import type { ProductConfig } from "./config";

function searchText(value: string, locale: string): string {
  return value
    .toLocaleLowerCase(locale)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesSearch(
  label: string,
  query: string,
  locale: string,
): boolean {
  const words = searchText(query, locale).split(" ").filter(Boolean);
  const normalized = searchText(label, locale);
  return words.every((word) => normalized.includes(word));
}

// Search only supplied labels. Colour families, translations and synonyms
// cannot reliably be inferred from merchant names or hex values.
export function filterColors(
  colors: ProductConfig["colors"],
  query: string,
  locale: string,
): ProductConfig["colors"] {
  return colors.filter((color) => matchesSearch(color.name, query, locale));
}
