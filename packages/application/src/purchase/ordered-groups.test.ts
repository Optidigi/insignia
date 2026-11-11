import { describe, expect, it } from 'vitest';
import { type OrderedGroupsBinding, orderedGroups, orderedGroupVariants } from './ordered-groups.js';

const group = (productId: string, variants: { variantId: string; quantity: number }[]) => ({
  group: { productId, configRevisionId: 'r', variants },
});
const economics = (lines: { productId: string; variantId: string; quantity: number }[]) => ({
  economics: { lines: lines.map((line, lineIndex) => ({ ...line, lineIndex, configRevisionId: 'r' })) },
});
function binding(lines: OrderedGroupsBinding['lines']): OrderedGroupsBinding {
  return {
    designPayload: {
      request: {
        groups: [group('p', [{ variantId: '1', quantity: 2 }]), group('p', [{ variantId: '2', quantity: 1 }])],
      },
    },
    economics: economics([
      { productId: 'p', variantId: '1', quantity: 2 },
      { productId: 'p', variantId: '2', quantity: 1 },
    ]),
    lines,
  };
}

describe('ordered designs', () => {
  it('a whole-set order contains every design', () => {
    const whole = binding([
      { lineIndex: 0, productId: 'p', variantId: '1', quantity: 2 },
      { lineIndex: 1, productId: 'p', variantId: '2', quantity: 1 },
    ]);
    expect(orderedGroups(whole)).toEqual([true, true]);
  });
  it('a subset order marks unordered designs at their signed position', () => {
    const subset = binding([{ lineIndex: 1, productId: 'p', variantId: '2', quantity: 7 }]);
    expect(orderedGroups(subset)).toEqual([false, true]);
    expect(orderedGroupVariants(subset)).toEqual([[], [{ variantId: '2', quantity: 7 }]]);
  });
  it('an unverifiable mapping or malformed historical payload counts every design', () => {
    const malformed = binding([{ lineIndex: 1, productId: 'p', variantId: '2', quantity: 1 }]);
    malformed.economics = {};
    expect(orderedGroups(malformed)).toEqual([true, true]);
    const shapeless = {
      ...binding([{ lineIndex: 1, productId: 'p', variantId: '2', quantity: 1 }]),
      designPayload: { request: { groups: [{ group: { design: {} } }] } },
    } as unknown as OrderedGroupsBinding;
    expect(orderedGroups(shapeless)).toEqual([true]);
  });
});
