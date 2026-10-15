import { describe, expect, it } from 'vitest';
import type { PublishedConfig } from '../config/model.js';
import type { PricingInput } from './evaluate.js';
import { priceLeanProposal, validateLeanConfig } from './lean.js';

const config: PublishedConfig = {
  version: 'm2-published-config-v1',
  shopId: 'shop',
  productId: 'shirt',
  revisionId: 'r1',
  revisionContentHash: 'a'.repeat(64),
  shopCurrency: 'EUR',
  methods: [{ id: 'print' }],
  placements: [
    { id: 'front', allowedMethodIds: ['print'], allowedStepIds: ['small'], logoLaterAllowed: true },
    { id: 'back', allowedMethodIds: ['print'], allowedStepIds: ['large'], logoLaterAllowed: true },
  ],
  productionOptions: [],
  pricingRules: [
    {
      id: 'front-price',
      role: 'unit',
      scope: { kind: 'step', placementId: 'front', stepId: 'small', methodId: 'print' },
      rate: { kind: 'fixed', amount: { shopDecimal: '3.00', presentmentOverrides: [] } },
    },
    {
      id: 'back-price',
      role: 'unit',
      scope: { kind: 'step', placementId: 'back', stepId: 'large', methodId: 'print' },
      rate: { kind: 'fixed', amount: { shopDecimal: '6.00', presentmentOverrides: [] } },
    },
  ],
};
function input(): PricingInput {
  return {
    shopId: 'shop',
    configs: [config],
    groups: [
      {
        version: 'm2-customization-group-v1',
        shopId: 'shop',
        productId: 'shirt',
        configRevisionId: 'r1',
        revisionContentHash: config.revisionContentHash,
        design: {
          placements: [
            {
              placementId: 'front',
              methodId: 'print',
              stepId: 'small',
              artwork: { kind: 'deferred', intentId: 'front-art' },
            },
            {
              placementId: 'back',
              methodId: 'print',
              stepId: 'large',
              artwork: { kind: 'deferred', intentId: 'back-art' },
            },
          ],
          options: [],
        },
        variants: [{ variantId: 'red-small', quantity: 10 }],
      },
    ],
    bases: [
      {
        shopId: 'shop',
        productId: 'shirt',
        variantId: 'red-small',
        currency: 'EUR',
        minor: '2000',
        contextId: 'qualified-context',
      },
    ],
    currency: { version: 'm2-currency-resolution-v1', presentmentCurrency: 'EUR', exponents: { EUR: 2 } },
    effectiveAt: '2026-10-15T22:00:00.000Z',
    marketContext: 'qualified-context',
    roundingPolicy: 'm2-half-even-v1',
  };
}
describe('Lean final per-garment surcharges through the existing engine', () => {
  it('prices ten garments with front3/back6 and base20 at290, without setup', () => {
    expect(priceLeanProposal(input()).totalMinor).toBe('29000');
  });
  it('rejects an absent selected price and permits an explicit zero', () => {
    const missing = { ...input(), configs: [{ ...config, pricingRules: config.pricingRules.slice(0, 1) }] };
    expect(() => priceLeanProposal(missing)).toThrow(/unavailable.*price/i);
    const zero: PricingInput = {
      ...input(),
      configs: [
        {
          ...config,
          pricingRules: config.pricingRules.map((rule) => ({
            ...rule,
            rate: { kind: 'fixed', amount: { shopDecimal: '0', presentmentOverrides: [] } },
          })),
        },
      ],
    };
    expect(priceLeanProposal(zero).totalMinor).toBe('20000');
  });
  it('keeps advanced revisions readable but excludes their new offers', () => {
    const advanced = {
      ...config,
      pricingRules: [
        ...config.pricingRules,
        {
          id: 'setup',
          role: 'setup' as const,
          scope: { kind: 'general' as const },
          rate: { kind: 'fixed' as const, amount: { shopDecimal: '5', presentmentOverrides: [] } },
        },
      ],
    };
    expect(() => validateLeanConfig(advanced)).toThrow(/Lean/);
    expect(advanced.pricingRules.at(-1)?.role).toBe('setup');
  });
});
