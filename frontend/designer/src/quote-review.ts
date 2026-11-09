export type DesignerQuoteReview = {
  intentId?: string;
  currency: string;
  exponent: number;
  totalMinor?: string;
  customizedQuantity: number;
  /** Host navigation identity only; never purchase authority. */
  currentGroupId?: string;
  groups: { id: string; label: string; quantity: number; totalMinor?: string; editable?: boolean }[];
};
/** Format server minor-unit strings without converting authoritative amounts to floating point. */
export function quoteReviewMoney(minor: string, currency: string, exponent: number, locale: string): string {
  if (!/^(0|[1-9][0-9]*)$/.test(minor) || minor.length > 20 || exponent !== 2 || !['USD', 'EUR'].includes(currency))
    throw new Error('Invalid reviewed quote amount');
  const value = BigInt(minor);
  const fraction = (value % 100n).toString().padStart(2, '0');
  return new Intl.NumberFormat(locale, { style: 'currency', currency })
    .formatToParts(value / 100n)
    .map((part) => (part.type === 'fraction' ? fraction : part.value))
    .join('');
}
