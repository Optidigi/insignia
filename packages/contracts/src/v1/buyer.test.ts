import { describe, expect, it } from 'vitest';
import {
  BuyerDesignRestorationSchema,
  BuyerDesignResultSchema,
  BuyerDesignSchema,
  BuyerDesiredSchema,
  BuyerProposalRequestSchema,
  BuyerRenewalSchema,
  buyerCartCapacityExceeded,
  buyerCartCapacityViolation,
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
const desired = (groups: unknown[], ordinaryLineCount = 0) => ({
  country: 'US',
  marketId: '42',
  groups,
  capacity: { ordinaryLineCount, inputBytes: 100 },
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
    expect(buyerCartCapacityExceeded([{ variants: variants(32) }])).toBeUndefined();
    expect(buyerCartCapacityExceeded([{ variants: variants(31) }, { variants: variants(2) }])).toBe('SIGNED_SET');
    expect(buyerCartCapacityExceeded([{ variants: variants(2, 6000) }])).toBe('SIGNED_SET');
    expect(buyerCartCapacityExceeded([{ variants: variants(10) }], 190)).toBeUndefined();
    expect(buyerCartCapacityExceeded([{ variants: variants(11) }], 190)).toBe('CART_LINES');
  });

  it('answers capacity only when every issue is the capacity or a bound it implies', () => {
    const violation = (body: unknown) => {
      const parsed = BuyerDesiredSchema.safeParse(body);
      expect(parsed.success).toBe(false);
      return buyerCartCapacityViolation(parsed.error?.issues ?? []);
    };
    expect(violation(desired([group(variants(16)), group(variants(17))]))).toBe('SIGNED_SET');
    expect(violation(desired([group(variants(33))]))).toBe('SIGNED_SET');
    expect(violation(desired(Array.from({ length: 33 }, () => group(variants(1)))))).toBe('SIGNED_SET');
    // More than 200 cart lines in total: customized lines added to the ordinary ones.
    expect(violation(desired([group(variants(11))], 190))).toBe('CART_LINES');
    expect(violation(desired([group(variants(1))], 201))).toBe('CART_LINES');
    // Any other defect keeps the generic 400.
    expect(violation({ ...desired([group(variants(33))]), country: 'us' })).toBeUndefined();
    expect(violation({ ...desired([group(variants(2, 6000))]), marketId: 'x' })).toBeUndefined();
    expect(violation(desired([group([{ variantId: '', quantity: 1 }])]))).toBeUndefined();
  });
});

describe('saved drafts before quantities (#366)', () => {
  it('stores a design that has artwork and a placement but no sizes or colours yet', () => {
    expect(BuyerDesignSchema.safeParse({ capability, expectedVersion: 0, group: group([]) }).success).toBe(true);
    const saved = { id: idempotencyKey, version: 1, value: group([]) };
    expect(BuyerDesignResultSchema.safeParse(saved).success).toBe(true);
    expect(
      BuyerDesignRestorationSchema.safeParse({
        ...saved,
        expiresAt: '2026-11-12T12:00:00.000Z',
        compatibility: 'current',
        retained: null,
      }).success,
    ).toBe(true);
  });

  it('keeps a draft bounded and its quantities positive', () => {
    expect(BuyerDesignSchema.safeParse({ capability, expectedVersion: 0, group: group(variants(33)) }).success).toBe(
      false,
    );
    expect(
      BuyerDesignSchema.safeParse({ capability, expectedVersion: 0, group: group([{ variantId: '1', quantity: 0 }]) })
        .success,
    ).toBe(false);
    const placementless = { ...group([]), design: { placements: [], options: [] } };
    expect(BuyerDesignSchema.safeParse({ capability, expectedVersion: 0, group: placementless }).success).toBe(false);
  });

  it('still requires at least one size or colour with a quantity for quotes and renewal', () => {
    expect(BuyerProposalRequestSchema.safeParse({ ...desired([group([])]), capability }).success).toBe(false);
    expect(BuyerRenewalSchema.safeParse({ ...desired([group([])]), capability, idempotencyKey }).success).toBe(false);
  });
});
