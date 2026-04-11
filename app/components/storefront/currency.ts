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
