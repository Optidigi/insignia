import { describe, expect, it } from 'vitest';
import { allocateGroups, formatMinor, parseMinor } from './allocation.ts';

describe('fixed accepted-price setup allocation', () => {
  it('preserves the plan EUR 91 example without per-unit records', () => {
    const result = allocateGroups([{ groupId: 'one', setupMinor: '100', variants: [
      { variantId: '20', quantity: 3, acceptedBaseUnitMinor: '3000' },
    ] }]);
    expect(result).toEqual({
      totalQuantity: 3,
      totalMinor: '9100',
      buckets: [
        { groupId: 'one', variantId: '20', quantity: 1, unitMinor: '3034' },
        { groupId: 'one', variantId: '20', quantity: 2, unitMinor: '3033' },
      ],
    });
  });

  it('uses one setup per group and a quote-wide 500-unit accepted tier result', () => {
    const result = allocateGroups([
      { groupId: 'shirts', setupMinor: '3500', variants: [{ variantId: '10', quantity: 250, acceptedBaseUnitMinor: '2300' }] },
      { groupId: 'hoodies', setupMinor: '5000', variants: [{ variantId: '20', quantity: 250, acceptedBaseUnitMinor: '3500' }] },
    ]);
    expect(result.totalQuantity).toBe(500);
    expect(result.totalMinor).toBe('1458500');
    expect(result.buckets).toEqual([
      { groupId: 'shirts', variantId: '10', quantity: 250, unitMinor: '2314' },
      { groupId: 'hoodies', variantId: '20', quantity: 250, unitMinor: '3520' },
    ]);
  });

  it('assigns remainder in stable numeric variant order even if input order changes', () => {
    const groups = [{ groupId: 'g', setupMinor: '1', variants: [
      { variantId: '200', quantity: 2, acceptedBaseUnitMinor: '5000' },
      { variantId: '10', quantity: 1, acceptedBaseUnitMinor: '4000' },
    ] }];
    const expected = [
      { groupId: 'g', variantId: '10', quantity: 1, unitMinor: '4001' },
      { groupId: 'g', variantId: '200', quantity: 2, unitMinor: '5000' },
    ];
    expect(allocateGroups(groups).buckets).toEqual(expected);
    expect(allocateGroups([{ ...groups[0]!, variants: [...groups[0]!.variants].reverse() }]).buckets).toEqual(expected);
    expect(allocateGroups([{ ...groups[0]!, setupMinor: '0' }]).totalMinor).toBe('14000');
  });

  it('allocates 10,000 logical units using only two buckets', () => {
    const result = allocateGroups([{ groupId: 'large', setupMinor: '3500', variants: [
      { variantId: '1', quantity: 10_000, acceptedBaseUnitMinor: '2300' },
    ] }]);
    expect(result.totalQuantity).toBe(10_000);
    expect(result.totalMinor).toBe('23003500');
    expect(result.buckets).toEqual([
      { groupId: 'large', variantId: '1', quantity: 3500, unitMinor: '2301' },
      { groupId: 'large', variantId: '1', quantity: 6500, unitMinor: '2300' },
    ]);
  });

  it('keeps lexical decimals exact for 0, 2 and 3 exponent vectors', () => {
    expect(parseMinor('30.33', 2)).toBe(3033n);
    expect(parseMinor('30.3300', 2)).toBe(3033n);
    expect(formatMinor(3033n, 2)).toBe('30.33');
    expect(parseMinor('12', 0)).toBe(12n);
    expect(formatMinor(12n, 0)).toBe('12');
    expect(parseMinor('0.001', 3)).toBe(1n);
    expect(formatMinor(1n, 3)).toBe('0.001');
    expect(() => parseMinor('30.331', 2)).toThrow();
    expect(() => parseMinor('90071992547409.93', 2)).not.toThrow();
  });

  it('conserves accepted price plus setup in 128 reproducible varied vectors', () => {
    let state = 0x51a7c0de;
    const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
    for (let caseIndex = 0; caseIndex < 128; caseIndex++) {
      const count = 1 + next() % 7;
      const setup = BigInt(next() % 10_000);
      const variants = Array.from({ length: count }, (_, i) => ({
        variantId: String(100 + i), quantity: 1 + next() % 500,
        acceptedBaseUnitMinor: String(next() % 500_000),
      }));
      const expectedQuantity = variants.reduce((sum, v) => sum + v.quantity, 0);
      const expectedMinor = variants.reduce((sum, v) =>
        sum + BigInt(v.quantity) * BigInt(v.acceptedBaseUnitMinor), setup);
      const groups = [{ groupId: 'property', setupMinor: setup.toString(), variants }];
      const result = allocateGroups(groups);
      expect(result.totalQuantity).toBe(expectedQuantity);
      expect(result.totalMinor).toBe(expectedMinor.toString());
      expect(result.buckets.reduce((sum, b) => sum + b.quantity, 0)).toBe(expectedQuantity);
      expect(result.buckets.reduce((sum, b) =>
        sum + BigInt(b.quantity) * BigInt(b.unitMinor), 0n)).toBe(expectedMinor);
      expect(allocateGroups([{ ...groups[0]!, variants: [...variants].reverse() }]).buckets).toEqual(result.buckets);
    }
  });
});
