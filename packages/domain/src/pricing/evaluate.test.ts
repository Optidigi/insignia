import { describe, expect, it } from 'vitest';
import type { PricingRule, PublishedConfig } from '../config/model.js';
import type { CustomizationGroup } from '../customization/identity.js';
import { type PricingInput, priceProposal } from './evaluate.js';

const at = '2026-09-29T12:00:00.000Z';
const revisionContentHash = 'a'.repeat(64);
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('incomplete test fixture');
  return value;
}
const amount = (shopDecimal: string, presentmentOverrides: { currency: string; decimal: string }[] = []) => ({
  shopDecimal,
  presentmentOverrides,
});
const fixed = (
  id: string,
  role: 'setup' | 'unit',
  scope: PricingRule['scope'],
  shopDecimal: string,
  overrides: { currency: string; decimal: string }[] = [],
  methodUnitMultiplicity?: 'perGarment' | 'perPlacement',
): PricingRule => ({
  id,
  role,
  scope,
  rate: { kind: 'fixed', amount: amount(shopDecimal, overrides) },
  ...(methodUnitMultiplicity ? { methodUnitMultiplicity } : {}),
});
const tier = (id: string, scope: PricingRule['scope'], low: string, high: string): PricingRule => ({
  id,
  role: 'unit',
  scope,
  methodUnitMultiplicity: scope.kind === 'method' ? 'perGarment' : undefined,
  rate: {
    kind: 'allUnits',
    tiers: [
      { minQuantity: 1, amount: amount(low) },
      { minQuantity: 500, amount: amount(high) },
    ],
  },
});
function config(productId = 'shirt', rules: PricingRule[] = [], shopCurrency = 'EUR'): PublishedConfig {
  return {
    version: 'm2-published-config-v1',
    shopId: 'shop',
    productId,
    revisionId: 'r1',
    revisionContentHash,
    shopCurrency,
    methods: [{ id: 'embroidery' }],
    placements: [
      { id: 'front', allowedMethodIds: ['embroidery'], allowedStepIds: ['small'], logoLaterAllowed: true },
      { id: 'back', allowedMethodIds: ['embroidery'], allowedStepIds: ['small'], logoLaterAllowed: true },
    ],
    productionOptions: [],
    pricingRules: rules,
  };
}
function group(
  productId = 'shirt',
  variants = [
    { variantId: 'red-small', quantity: 10 },
    { variantId: 'black-large', quantity: 15 },
  ],
  artwork = 'art1',
  placements = ['front'],
): CustomizationGroup {
  return {
    version: 'm2-customization-group-v1',
    shopId: 'shop',
    productId,
    configRevisionId: 'r1',
    revisionContentHash,
    design: {
      placements: placements.map((placementId) => ({
        placementId,
        methodId: 'embroidery',
        stepId: 'small',
        artwork: { kind: 'revision' as const, revisionId: artwork },
      })),
      options: [],
    },
    variants,
  };
}
function input(groups: CustomizationGroup[], configs: PublishedConfig[], base = '2000'): PricingInput {
  const bases = [...new Set(groups.flatMap((g) => g.variants.map((v) => `${g.productId}\u0000${v.variantId}`)))].map(
    (key) => {
      const [productId, variantId] = key.split('\u0000');
      return {
        shopId: 'shop',
        productId: required(productId),
        variantId: required(variantId),
        currency: 'EUR',
        minor: base,
        contextId: 'market-1',
      };
    },
  );
  return {
    shopId: 'shop',
    groups,
    configs,
    bases,
    currency: { version: 'm2-currency-resolution-v1', presentmentCurrency: 'EUR', exponents: { EUR: 2 } },
    effectiveAt: at,
    marketContext: 'DE/B2C',
    roundingPolicy: 'm2-half-even-v1',
  };
}

describe('pure pricing proposal', () => {
  const signedAdjustmentInput = (base: string, adjustment: string, setup: string, quantity: number) =>
    input(
      [group('shirt', [{ variantId: 'v', quantity }])],
      [
        config('shirt', [
          fixed('signed-placement', 'unit', { kind: 'placement', placementId: 'front' }, adjustment),
          fixed('setup-once', 'setup', { kind: 'general' }, setup),
        ]),
      ],
      base,
    );

  it('accepts setup that rescues a negative intermediate for one unit', () => {
    const result = priceProposal(signedAdjustmentInput('100', '-1.50', '1.00', 1));
    expect(result.groups[0]?.customizationUnitMinor).toBe('-150');
    expect(result.groups[0]?.setupMinor).toBe('100');
    expect(result.lines.map((line) => [line.quantity, line.unitPriceMinor, line.lineTotalMinor])).toEqual([
      [1, '50', '50'],
    ]);
    expect(result.totalMinor).toBe('50');
  });

  it('allocates an uneven setup before validating both final signed-adjustment buckets', () => {
    const result = priceProposal(signedAdjustmentInput('0', '-0.01', '0.03', 2));
    expect(
      result.lines.map((line) => [line.quantity, line.unitOrdinalStart, line.setupPerUnitMinor, line.unitPriceMinor]),
    ).toEqual([
      [1, 1, '2', '1'],
      [1, 2, '1', '0'],
    ]);
    expect(result.groups[0]?.totalMinor).toBe('1');
    expect(result.totalMinor).toBe('1');
    expect(result.lines.reduce((sum, line) => sum + BigInt(line.lineTotalMinor), 0n)).toBe(1n);
  });

  it('rejects when setup leaves a final signed-adjustment bucket negative', () => {
    expect(() => priceProposal(signedAdjustmentInput('0', '-0.02', '0.03', 2))).toThrow(
      /final allocated unit price out of u64 range/,
    );
  });

  it('A: charges general, method and placement setup once across real variants', () => {
    const rules = [
      fixed('setup-general', 'setup', { kind: 'general' }, '20.00'),
      fixed('setup-method', 'setup', { kind: 'method', methodId: 'embroidery' }, '10.00'),
      fixed('setup-front', 'setup', { kind: 'placement', placementId: 'front' }, '5.00'),
      fixed('unit-method', 'unit', { kind: 'method', methodId: 'embroidery' }, '3.00', [], 'perGarment'),
    ];
    const result = priceProposal(input([group()], [config('shirt', rules)]));
    expect(result.customizedQuantity).toBe(25);
    expect(result.groups[0]?.setupMinor).toBe('3500');
    expect(result.totalMinor).toBe('61000');
    expect(result.lines.map((l) => [l.variantId, l.quantity, l.unitPriceMinor])).toEqual([
      ['black-large', 15, '2440'],
      ['red-small', 10, '2440'],
    ]);
    expect(Object.isFrozen(result.groups[0]?.variants[0]?.buckets)).toBe(true);
  });

  it('B: resolves every all-units component against complete customized Q, excluding plain merchandise', () => {
    const shirt = config('shirt', [
      tier('shirt-unit', { kind: 'method', methodId: 'embroidery' }, '4.00', '3.00'),
      fixed('shirt-setup', 'setup', { kind: 'general' }, '35.00'),
    ]);
    const hoodie = config('hoodie', [
      tier('hoodie-unit', { kind: 'method', methodId: 'embroidery' }, '7.00', '5.00'),
      fixed('hoodie-setup', 'setup', { kind: 'general' }, '50.00'),
    ]);
    const s = group('shirt', [{ variantId: 's', quantity: 250 }]);
    const h = group('hoodie', [{ variantId: 'h', quantity: 250 }]);
    const initial = input([h, s], [shirt, hoodie]);
    required(initial.bases[0]).minor = '3000';
    required(initial.bases[1]).minor = '2000';
    const result = priceProposal(initial);
    expect(result.customizedQuantity).toBe(500);
    expect(result.totalMinor).toBe('1458500');
    expect(result.groups.flatMap((g) => g.unitComponents.map((c) => c.selectedMinQuantity))).toEqual([500, 500]);
    initial.bases.push({
      shopId: 'shop',
      productId: 'ordinary',
      variantId: 'plain',
      currency: 'EUR',
      minor: '999999',
      contextId: 'market-1',
    });
    expect(priceProposal(initial).totalMinor).toBe(result.totalMinor);
    expect(priceProposal(initial).customizedQuantity).toBe(500);
    const less = input([s], [shirt]);
    const repriced = priceProposal(less);
    expect(repriced.groups[0]?.unitComponents[0]?.selectedMinQuantity).toBe(1);
    expect(repriced.totalMinor).toBe('603500');
  });

  it('C: allocates one minor-unit remainder to the earliest real variant ordinal', () => {
    const single = group('shirt', [{ variantId: 'v', quantity: 3 }]);
    const result = priceProposal(
      input([single], [config('shirt', [fixed('s', 'setup', { kind: 'general' }, '1.00')])], '3000'),
    );
    expect(result.totalMinor).toBe('9100');
    expect(result.lines.map((l) => [l.quantity, l.unitOrdinalStart, l.unitOrdinalEnd, l.unitPriceMinor])).toEqual([
      [1, 1, 1, '3034'],
      [2, 2, 3, '3033'],
    ]);
    expect(result.lines.reduce((sum, l) => sum + BigInt(l.lineTotalMinor), 0n)).toBe(9100n);
  });

  it('D/E: separate designs and separate deferred intents keep separate setup', () => {
    const rules = [fixed('s', 'setup', { kind: 'general' }, '2.00')];
    const first = group('shirt', [{ variantId: 'v', quantity: 1 }], 'art1');
    const second = group('shirt', [{ variantId: 'v', quantity: 1 }], 'art2');
    const result = priceProposal(input([first, second], [config('shirt', rules)]));
    expect(result.groups).toHaveLength(2);
    expect(result.groups.map((g) => g.setupMinor)).toEqual(['200', '200']);
    const later = (intentId: string) => ({
      ...group('shirt', [{ variantId: 'v', quantity: 1 }]),
      design: {
        placements: [
          {
            placementId: 'front',
            methodId: 'embroidery',
            stepId: 'small',
            artwork: { kind: 'deferred' as const, intentId },
          },
        ],
        options: [],
      },
    });
    expect(priceProposal(input([later('one'), later('two')], [config('shirt', rules)])).groups).toHaveLength(2);
    expect(priceProposal(input([later('one'), later('one')], [config('shirt', rules)])).groups).toHaveLength(1);
  });

  it('F: converts exact FX components, bypasses an explicit setup override, stores provenance', () => {
    const rules = [
      fixed('unit', 'unit', { kind: 'method', methodId: 'embroidery' }, '3.00', [], 'perGarment'),
      fixed('setup', 'setup', { kind: 'general' }, '20.00', [{ currency: 'USD', decimal: '21.00' }]),
    ];
    const quote = input([group('shirt', [{ variantId: 'v', quantity: 4 }])], [config('shirt', rules)]);
    quote.currency = {
      version: 'm2-currency-resolution-v1',
      presentmentCurrency: 'USD',
      exponents: { EUR: 2, USD: 2 },
    };
    required(quote.bases[0]).currency = 'USD';
    required(quote.bases[0]).minor = '2250';
    quote.fx = {
      version: 'm2-fx-resolution-v1',
      fromCurrency: 'EUR',
      toCurrency: 'USD',
      rateDecimal: '1.10',
      sourceId: 'synthetic-fx',
      rateVersion: 'v1',
      asOf: '2026-09-29T11:00:00.000Z',
      validUntil: '2026-09-29T13:00:00.000Z',
    };
    const result = priceProposal(quote);
    expect(result.totalMinor).toBe('12420');
    expect(result.lines[0]?.unitPriceMinor).toBe('3105');
    expect(result.groups[0]?.unitComponents[0]?.resolution).toBe('fx');
    expect(result.groups[0]?.setupComponents[0]?.resolution).toBe('override');
    expect(result.fx?.rateDecimal).toBe('1.10');
  });

  it('G/H: handles zero and three decimal exponents and differing contextual variant bases', () => {
    const zero = input(
      [group('shirt', [{ variantId: 'v', quantity: 1 }])],
      [config('shirt', [fixed('s', 'setup', { kind: 'general' }, '2')], 'JPY')],
    );
    zero.currency = { version: 'm2-currency-resolution-v1', presentmentCurrency: 'JPY', exponents: { JPY: 0 } };
    required(zero.bases[0]).currency = 'JPY';
    required(zero.bases[0]).minor = '10';
    expect(priceProposal(zero).totalMinor).toBe('12');
    zero.currency = { version: 'm2-currency-resolution-v1', presentmentCurrency: 'JPY', exponents: { JPY: 2 } };
    expect(() => priceProposal(zero)).toThrow(/unsupported currency exponent/);
    const three = input(
      [
        group('shirt', [
          { variantId: 'a', quantity: 1 },
          { variantId: 'b', quantity: 1 },
        ]),
      ],
      [config('shirt', [fixed('s', 'setup', { kind: 'general' }, '0.001')], 'KWD')],
    );
    three.currency = { version: 'm2-currency-resolution-v1', presentmentCurrency: 'KWD', exponents: { KWD: 3 } };
    required(three.bases[0]).currency = 'KWD';
    required(three.bases[0]).minor = '1000';
    required(three.bases[1]).currency = 'KWD';
    required(three.bases[1]).minor = '2000';
    const result = priceProposal(three);
    expect(result.totalMinor).toBe('3001');
    expect(result.lines.map((l) => [l.variantId, l.unitPriceMinor])).toEqual([
      ['a', '1001'],
      ['b', '2000'],
    ]);
    required(required(three.configs[0]).pricingRules[0]).rate = { kind: 'fixed', amount: amount('0.0001') };
    expect(() => priceProposal(three)).toThrow();
  });
});
