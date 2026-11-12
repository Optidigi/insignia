import { describe, expect, it } from 'vitest';
import {
  BuyerDesiredSchema,
  BuyerProposalRequestSchema,
  BuyerRenewalSchema,
  exceedsBuyerCartCapacity,
  isBuyerCartCapacityIssue,
} from './buyer.js';

const group = (variants: { variantId: string; quantity: number }[]) => ({
  productId: '111',
  configRevisionId: 'revision',
  revisionContentHash: 'a'.repeat(64),
  design: {
    placements: [
      { placementId: 'front', methodId: 'print', stepId: 'small', artwork: { kind: 'deferred', intentId: 'later' } },
    ],
    options: [],
  },
  variants,
});
const variants = (count: number, quantity = 1) =>
  Array.from({ length: count }, (_, index) => ({ variantId: String(index + 1), quantity }));
const desired = (groups: unknown[]) => ({
  country: 'US',
  marketId: '42',
  groups,
  capacity: { ordinaryLineCount: 0, inputBytes: 100 },
});
const capability = 'synthetic.signature';
const idempotencyKey = '11111111-1111-4111-8111-111111111111';

describe('whole-cart capacity of one signed set (#335)', () => {
  it('admits exactly 32 variant entries and 10,000 garments across all groups', () => {
    expect(BuyerDesiredSchema.safeParse(desired([group(variants(16)), group(variants(16))])).success).toBe(true);
    expect(BuyerDesiredSchema.safeParse(desired([group(variants(2, 5000))])).success).toBe(true);
  });

  it('marks more than 32 variant entries or 10,000 garments in total as a capacity issue', () => {
    for (const groups of [
      [group(variants(16)), group(variants(17))],
      [group(variants(33))],
      Array.from({ length: 33 }, () => group(variants(1))),
      [group(variants(2, 6000))],
      [group(variants(1, 10000)), group(variants(1))],
    ]) {
      for (const parsed of [
        BuyerDesiredSchema.safeParse(desired(groups)),
        BuyerProposalRequestSchema.safeParse({ ...desired(groups), capability }),
        BuyerRenewalSchema.safeParse({ ...desired(groups), capability, idempotencyKey }),
      ]) {
        expect(parsed.success).toBe(false);
        expect(parsed.error?.issues.some(isBuyerCartCapacityIssue)).toBe(true);
      }
    }
  });

  it('keeps malformed requests distinct from capacity', () => {
    const parsed = BuyerDesiredSchema.safeParse(desired([group([{ variantId: '1', quantity: '1' }] as never)]));
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.some(isBuyerCartCapacityIssue)).toBe(false);
  });

  it('exposes the same rule for the storefront pre-check', () => {
    expect(exceedsBuyerCartCapacity([{ variants: variants(32) }])).toBe(false);
    expect(exceedsBuyerCartCapacity([{ variants: variants(31) }, { variants: variants(2) }])).toBe(true);
    expect(exceedsBuyerCartCapacity([{ variants: variants(2, 6000) }])).toBe(true);
  });
});
