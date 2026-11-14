import { parseDecimalText } from './decimal-input.mts';

export type PriceResult = { kind: 'valid'; minor: bigint } | { kind: 'invalid' };

export function cellKey(locationId: string, sizeId: string): string {
  return JSON.stringify([locationId, sizeId]);
}

export function parsePrice(value: string): PriceResult {
  const parts = parseDecimalText(value);
  if (!parts || parts.integer.length > 5 || parts.fraction.length > 2) return { kind: 'invalid' };
  const minor = BigInt(parts.integer) * 100n + BigInt(parts.fraction.padEnd(2, '0') || '0');
  return minor <= 9_999_999n ? { kind: 'valid', minor } : { kind: 'invalid' };
}

/** A valid price becomes exact two-decimal text ("7,5" is "7.50"); invalid text is never turned into an amount. */
export function canonicalPriceText(value: string): string {
  const price = parsePrice(value);
  return price.kind === 'valid' ? `${price.minor / 100n}.${String(price.minor % 100n).padStart(2, '0')}` : value;
}

/** The qualified shop currencies are EUR and USD. */
export function currencyPrefix(currency: string): string {
  return currency === 'USD' ? '$' : '€';
}

export function formatPrice(minor: bigint, locale = 'en-GB', currency = 'EUR'): string {
  if (minor < 0n || minor > 9_999_999n) throw new RangeError('Price is outside the demo limit');
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(minor) / 100);
}
