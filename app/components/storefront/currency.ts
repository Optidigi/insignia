/**
 * Format cents as a currency string using the shop's currency code.
 * Falls back to ISO code prefix if Intl is unavailable.
 */
export function formatCurrency(cents: number, currencyCode = "USD"): string {
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Fallback for environments without Intl
    return `${currencyCode} ${amount.toFixed(2)}`;
  }
}

/**
 * Format a price delta (adjustment) with an explicit `+` prefix for positive
 * values. Negative values are formatted naturally by `formatCurrency` (which
 * produces the locale's minus sign). Zero returns the bare formatted zero
 * string — callers that want "Included" for zero should handle that branch
 * themselves before calling this helper.
 */
export function formatPriceDelta(cents: number, currencyCode = "USD"): string {
  if (cents > 0) return `+${formatCurrency(cents, currencyCode)}`;
  return formatCurrency(cents, currencyCode);
}
