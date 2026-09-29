import { describe, expect, it } from 'vitest';
import type { PricingRule, PublishedConfig } from './model.js';
import { publishConfigValue } from './model.js';

const valid: PublishedConfig = {
  version: 'm2-published-config-v1',
  shopId: 's',
  productId: 'p',
  revisionId: 'r',
  revisionContentHash: 'a'.repeat(64),
  shopCurrency: 'EUR',
  methods: [{ id: 'm' }],
  placements: [{ id: 'front', allowedMethodIds: ['m'], allowedStepIds: ['small'], logoLaterAllowed: true }],
  productionOptions: [],
  pricingRules: [
    {
      id: 'general',
      scope: { kind: 'general' },
      role: 'setup',
      rate: { kind: 'fixed', amount: { shopDecimal: '20.00', presentmentOverrides: [] } },
    },
    {
      id: 'method',
      scope: { kind: 'method', methodId: 'm' },
      role: 'unit',
      methodUnitMultiplicity: 'perGarment',
      rate: {
        kind: 'allUnits',
        tiers: [
          { minQuantity: 1, amount: { shopDecimal: '5.00', presentmentOverrides: [] } },
          { minQuantity: 500, amount: { shopDecimal: '3.00', presentmentOverrides: [] } },
        ],
      },
    },
  ],
};
const setupRule = valid.pricingRules[0] as PricingRule;
const methodRule = valid.pricingRules[1] as PricingRule;

describe('immutable published config value', () => {
  it('copies and freezes nested rules and values', () => {
    const source = { ...valid, methods: [{ id: 'm' }] };
    const published = publishConfigValue(source);
    source.methods[0] = { id: 'later' };
    expect(published.methods[0]?.id).toBe('m');
    expect(Object.isFrozen(published.pricingRules[1]?.rate)).toBe(true);
  });

  it('rejects invalid schedules, duplicate identifiers and unsupported versions', () => {
    expect(() => publishConfigValue({ ...valid, version: 'future' as never })).toThrow();
    expect(() => publishConfigValue({ ...valid, methods: [{ id: 'm' }, { id: 'm' }] })).toThrow();
    expect(() =>
      publishConfigValue({
        ...valid,
        pricingRules: [
          {
            ...methodRule,
            rate: {
              kind: 'allUnits',
              tiers: [{ minQuantity: 2, amount: { shopDecimal: '1', presentmentOverrides: [] } }],
            },
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      publishConfigValue({
        ...valid,
        pricingRules: [
          {
            ...setupRule,
            rate: {
              kind: 'allUnits',
              tiers: [{ minQuantity: 1, amount: { shopDecimal: '1', presentmentOverrides: [] } }],
            },
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      publishConfigValue({
        ...valid,
        pricingRules: [{ ...methodRule, methodUnitMultiplicity: undefined }],
      }),
    ).toThrow();
    expect(() =>
      publishConfigValue({
        ...valid,
        pricingRules: [
          {
            ...setupRule,
            rate: { kind: 'fixed', amount: { shopDecimal: '-1', presentmentOverrides: [] } },
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      publishConfigValue({
        ...valid,
        pricingRules: [
          {
            ...methodRule,
            rate: {
              kind: 'allUnits',
              tiers: [
                { minQuantity: 1, amount: { shopDecimal: '1', presentmentOverrides: [] } },
                { minQuantity: 1, amount: { shopDecimal: '2', presentmentOverrides: [] } },
              ],
            },
          },
        ],
      }),
    ).toThrow();
  });

  it('allows signed placement unit adjustment and exact method-specific replacement identities', () => {
    const amount = { shopDecimal: '-0.25', presentmentOverrides: [] };
    const generic = {
      id: 'generic',
      scope: { kind: 'placement' as const, placementId: 'front' },
      role: 'unit' as const,
      rate: { kind: 'fixed' as const, amount },
    };
    const specific = { ...generic, id: 'specific', scope: { ...generic.scope, methodId: 'm' } };
    expect(publishConfigValue({ ...valid, pricingRules: [generic, specific] }).pricingRules).toHaveLength(2);
    expect(() => publishConfigValue({ ...valid, pricingRules: [generic, { ...generic, id: 'duplicate' }] })).toThrow();
  });
});
