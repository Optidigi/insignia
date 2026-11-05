export type PriceResult = { kind: 'valid'; minor: bigint } | { kind: 'invalid' };

export function cellKey(locationId: string, sizeId: string): string {
  return JSON.stringify([locationId, sizeId]);
}

export function parsePrice(value: string): PriceResult {
  const match = /^(0|[1-9]\d{0,4})(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match?.[1]) return { kind: 'invalid' };
  const minor = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0');
  return minor <= 9_999_999n ? { kind: 'valid', minor } : { kind: 'invalid' };
}

export function formatPrice(minor: bigint, locale = 'en-GB'): string {
  if (minor < 0n || minor > 9_999_999n) throw new RangeError('Price is outside the demo limit');
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(Number(minor) / 100);
}
