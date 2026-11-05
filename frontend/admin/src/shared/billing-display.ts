/** Provider decimals remain exact; language only changes their presentation. */
function decimal(amount: string, locale: string, options: Intl.NumberFormatOptions): string {
  const match = /^(\d+)(?:\.(\d{1,20}))?$/.exec(amount);
  if (!match?.[1]) throw new RangeError('Invalid billing decimal');
  const whole = BigInt(match[1]);
  const fraction = match[2] ?? '';
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
  return decimal(amount, locale, { style: 'currency', currency, currencyDisplay: 'code' });
}
export function billingPercentage(amount: string, locale: string): string {
  // Provider percentage is already on a 0–100 scale, unlike Intl's percent style.
  return decimal(amount, locale, { style: 'unit', unit: 'percent', unitDisplay: 'short' });
}
