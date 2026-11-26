export type DesignerQuoteReview = {
  intentId?: string;
  expiresAt?: string;
  currency: string;
  exponent: number;
  totalMinor?: string;
  customizedQuantity: number;
  /** Host navigation identity only; never purchase authority. */
  currentGroupId?: string;
  /**
   * `label` is the product's title; without one the Designer words a fallback in its current language (#424).
   * `detail` names the garments of a design of the current product, so same-product designs differ (#503).
   */
  groups: {
    id: string;
    label?: string;
    detail?: string;
    quantity: number;
    totalMinor?: string;
    baseTotalMinor?: string;
    editable?: boolean;
  }[];
};
/** Format server minor-unit strings without converting authoritative amounts to floating point. */
export function quoteReviewMoney(minor: string, currency: string, exponent: number, locale: string): string {
  if (!/^(?:0|-?[1-9][0-9]{0,19})$/.test(minor) || exponent !== 2 || !['USD', 'EUR'].includes(currency))
    throw new Error('Invalid reviewed quote amount');
  const value = BigInt(minor);
  const magnitude = value < 0n ? -value : value;
  const fraction = (magnitude % 100n).toString().padStart(2, '0');
  return new Intl.NumberFormat(locale, { style: 'currency', currency })
    .formatToParts(value < 0n && magnitude < 100n ? -0 : value / 100n)
    .map((part) => (part.type === 'fraction' ? fraction : part.value))
    .join('');
}

export function quoteReviewBreakdown(review: DesignerQuoteReview | undefined) {
  if (review?.totalMinor === undefined || review.groups.length === 0) return undefined;
  let base = 0n;
  for (const { baseTotalMinor } of review.groups) {
    if (baseTotalMinor === undefined || !/^(?:0|[1-9][0-9]{0,19})$/.test(baseTotalMinor)) return undefined;
    base += BigInt(baseTotalMinor);
  }
  return { base: base.toString(), customization: (BigInt(review.totalMinor) - base).toString() };
}
