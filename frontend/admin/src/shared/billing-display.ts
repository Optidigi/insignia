/** Provider decimals remain exact; language only changes their presentation. */
function decimal(amount: string, locale: string, options: Intl.NumberFormatOptions, minimumDigits = 0): string {
  const match = /^(\d+)(?:\.(\d{1,20}))?$/.exec(amount);
  if (!match?.[1]) throw new RangeError('Invalid billing decimal');
  const whole = BigInt(match[1]);
  // Padding with zeros keeps the value exact: Shopify's "0.0" reads as USD 0.00.
  const fraction = (match[2] ?? '').padEnd(minimumDigits, '0');
  const digits = fraction.length;
  const localizedFraction = digits
    ? new Intl.NumberFormat(locale, {
        useGrouping: false,
        minimumIntegerDigits: digits,
        maximumFractionDigits: 0,
      }).format(BigInt(fraction))
    : '';
  return new Intl.NumberFormat(locale, {
    ...options,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
    .formatToParts(whole)
    .map((part) => (part.type === 'fraction' ? localizedFraction : part.value))
    .join('');
}

export function billingMoney(amount: string, currency: string, locale: string): string {
  const options: Intl.NumberFormatOptions = { style: 'currency', currency, currencyDisplay: 'code' };
  const minorDigits = new Intl.NumberFormat(locale, options).resolvedOptions().minimumFractionDigits ?? 0;
  return decimal(amount, locale, options, minorDigits);
}
export function billingPercentage(amount: string, locale: string): string {
  // Provider percentage is already on a 0–100 scale, unlike Intl's percent style.
  return decimal(amount, locale, { style: 'unit', unit: 'percent', unitDisplay: 'short' });
}
