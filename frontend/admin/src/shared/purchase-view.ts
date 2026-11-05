export type { PurchaseGroup, PurchaseView } from '@insignia/contracts';
export function exactPurchaseMoney(minor: string, exponent: number, currency: string): string {
  const digits = minor.padStart(exponent + 1, '0');
  return `${currency} ${exponent ? `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}` : digits}`;
}

export function orderCalendarDay(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Shift a validated Gregorian date without treating a store-local day as 24 hours. */
export function offsetCalendarDay(day: string, amount: number): string {
  const target = Date.parse(`${day}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isSafeInteger(amount) ||
    !Number.isFinite(target) ||
    new Date(target).toISOString().slice(0, 10) !== day
  )
    throw new RangeError('Invalid date');
  const shifted = new Date(target);
  shifted.setUTCDate(shifted.getUTCDate() + amount);
  if (!Number.isFinite(shifted.getTime())) throw new RangeError('Invalid date');
  return shifted.toISOString().slice(0, 10);
}

/** The earliest instant on a civil date, or its next existing date if the date was skipped. */
export function orderDayBoundary(day: string, timeZone: string): string {
  const target = Date.parse(`${day}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(target) ||
    new Date(target).toISOString().slice(0, 10) !== day
  )
    throw new RangeError('Invalid date');
  const formatter = new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const localDayAt = (instant: number): string => {
    const parts = formatter.formatToParts(new Date(instant));
    const part = (type: string) => parts.find((value) => value.type === type)?.value ?? '';
    return `${part('year').padStart(4, '0')}-${part('month').padStart(2, '0')}-${part('day').padStart(2, '0')}`;
  };
  const searchStart = target - 48 * 60 * 60 * 1000;
  const searchEnd = target + 48 * 60 * 60 * 1000;
  const sampleStep = 15 * 60 * 1000;
  let previous = searchStart;
  if (localDayAt(previous) >= day) throw new RangeError('Invalid date in this time zone');
  for (let sample = searchStart + sampleStep; sample <= searchEnd; sample += sampleStep) {
    if (localDayAt(sample) < day) {
      previous = sample;
      continue;
    }
    let low = previous;
    let high = sample;
    while (high - low > 1000) {
      const middle = low + Math.floor((high - low) / 2000) * 1000;
      if (localDayAt(middle) >= day) high = middle;
      else low = middle;
    }
    return new Date(high).toISOString();
  }
  throw new RangeError('Invalid date in this time zone');
}

/** Resolve a single-date filter and identify an actually empty skipped date. */
export function orderDayRange(
  day: string,
  timeZone: string,
): {
  createdFrom: string;
  createdBefore: string;
  isEmpty: boolean;
} {
  const createdFrom = orderDayBoundary(day, timeZone);
  const createdBefore = orderDayBoundary(offsetCalendarDay(day, 1), timeZone);
  return { createdFrom, createdBefore, isEmpty: createdFrom === createdBefore };
}

/** Format integer and fractional parts separately so historical money never passes through Number. */
export function localizedPurchaseMoney(minor: string, exponent: number, currency: string, locale: string): string {
  const scale = 10n ** BigInt(exponent);
  const value = BigInt(minor);
  const fraction = exponent
    ? new Intl.NumberFormat(locale, {
        useGrouping: false,
        minimumIntegerDigits: exponent,
        maximumFractionDigits: 0,
      }).format(value % scale)
    : '';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  })
    .formatToParts(value / scale)
    .map((part) => (part.type === 'fraction' ? fraction : part.value))
    .join('');
}
