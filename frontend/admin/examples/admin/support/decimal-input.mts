/**
 * The one owner of merchant decimal text. A merchant may type either "." or "," as the decimal separator
 * ("7,5" and "7.5" mean the same amount); anything ambiguous or unreadable ("1.234,5", "7,5,0", "1e3", letters,
 * signs) is rejected so no field can silently store a different number than the one typed.
 */
const decimal = /^(0|[1-9]\d*)(?:[.,](\d+))?$/;

export type DecimalParts = { integer: string; fraction: string };

export function parseDecimalText(value: string): DecimalParts | null {
  const match = decimal.exec(value.trim());
  return match?.[1] === undefined ? null : { integer: match[1], fraction: match[2] ?? '' };
}

export function parseDecimalNumber(value: string): number | null {
  const parts = parseDecimalText(value);
  if (!parts) return null;
  const number = Number(parts.fraction ? `${parts.integer}.${parts.fraction}` : parts.integer);
  return Number.isFinite(number) ? number : null;
}

/** Valid text becomes its dot-separated form; invalid text is returned unchanged so it can never turn into a number. */
export function canonicalDecimalText(value: string): string {
  const parts = parseDecimalText(value);
  return parts ? (parts.fraction ? `${parts.integer}.${parts.fraction}` : parts.integer) : value;
}
