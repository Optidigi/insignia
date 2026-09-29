import { describe, expect, it } from 'vitest';
import { CustomizationGroupSchema, MoneyDtoSchema, PublishedConfigSchema } from './pricing-config.js';

const config = {
  version: 'm2-published-config-v1',
  shopId: 'shop',
  productId: 'shirt',
  revisionId: 'rev',
  revisionContentHash: 'a'.repeat(64),
  shopCurrency: 'EUR',
  methods: [{ id: 'print' }],
  placements: [{ id: 'front', allowedMethodIds: ['print'], allowedStepIds: ['small'], logoLaterAllowed: true }],
  productionOptions: [],
  pricingRules: [],
};
const group = {
  version: 'm2-customization-group-v1',
  shopId: 'shop',
  productId: 'shirt',
  configRevisionId: 'rev',
  revisionContentHash: 'a'.repeat(64),
  design: {
    placements: [
      { placementId: 'front', methodId: 'print', stepId: 'small', artwork: { kind: 'deferred', intentId: 'nonce-1' } },
    ],
    options: [],
  },
  variants: [{ variantId: 'red-s', quantity: 2 }],
};

describe('v1 serialized browser contracts', () => {
  it('round trips versioned JSON values', () => {
    expect(PublishedConfigSchema.parse(JSON.parse(JSON.stringify(config)))).toEqual(config);
    expect(CustomizationGroupSchema.parse(JSON.parse(JSON.stringify(group)))).toEqual(group);
    expect(MoneyDtoSchema.parse({ version: 'm2-money-v1', currency: 'EUR', minor: '1234' })).toEqual({
      version: 'm2-money-v1',
      currency: 'EUR',
      minor: '1234',
    });
  });

  it('rejects unknown versions, extra fields and malformed deferred intent', () => {
    expect(PublishedConfigSchema.safeParse({ ...config, version: 'future' }).success).toBe(false);
    expect(CustomizationGroupSchema.safeParse({ ...group, version: 'future' }).success).toBe(false);
    expect(CustomizationGroupSchema.safeParse({ ...group, hidden: true }).success).toBe(false);
    expect(CustomizationGroupSchema.safeParse({ ...group, shopId: undefined }).success).toBe(false);
    expect(MoneyDtoSchema.safeParse({ version: 'future', currency: 'EUR', minor: '1' }).success).toBe(false);
    expect(
      CustomizationGroupSchema.safeParse({
        ...group,
        design: { ...group.design, placements: [{ ...group.design.placements[0], artwork: { kind: 'deferred' } }] },
      }).success,
    ).toBe(false);
  });

  it('rejects non-JSON-safe or overflowing economic values and quantities', () => {
    expect(MoneyDtoSchema.safeParse({ version: 'm2-money-v1', currency: 'EUR', minor: 1234n }).success).toBe(false);
    expect(
      MoneyDtoSchema.safeParse({ version: 'm2-money-v1', currency: 'EUR', minor: '18446744073709551616' }).success,
    ).toBe(false);
    expect(
      CustomizationGroupSchema.safeParse({
        ...group,
        variants: [{ variantId: 'red-s', quantity: Number.MAX_SAFE_INTEGER + 1 }],
      }).success,
    ).toBe(false);
  });
});
