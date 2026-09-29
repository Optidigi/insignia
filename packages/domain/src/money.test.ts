import { describe, expect, it } from 'vitest';
import { formatMinor, parseMinor, parsePositiveDecimalRational } from './money.js';

describe('exact nonnegative money', () => {
  it('keeps exact cent and zero-exponent values', () => {
    expect(parseMinor('91.00', 2)).toBe(9100n);
    expect(formatMinor(9100n, 2)).toBe('91.00');
    expect(parseMinor('8', 0)).toBe(8n);
  });

  it('rejects fractions, signs and overflow rather than rounding', () => {
    expect(() => parseMinor('1.001', 2)).toThrow();
    expect(() => parseMinor('1.000', 2)).toThrow();
    expect(() => parseMinor('-1.00', 2)).toThrow();
    expect(() => parseMinor('18446744073709551616', 0)).toThrow();
    expect(() => parseMinor('9'.repeat(10_000), 0)).toThrow();
    expect(() => parsePositiveDecimalRational(`1.${'0'.repeat(10_000)}`)).toThrow();
  });
});
