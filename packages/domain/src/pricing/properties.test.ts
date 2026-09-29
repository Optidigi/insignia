import { describe, expect, it } from 'vitest';
import type { PricingRule, PublishedConfig } from '../config/model.js';
import type { CustomizationGroup } from '../customization/identity.js';
import { type PricingInput, priceProposal } from './evaluate.js';

const amount = (shopDecimal: string) => ({ shopDecimal, presentmentOverrides: [] });
const revisionContentHash = 'a'.repeat(64);
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('incomplete test fixture');
  return value;
}
const setup = (shopDecimal: string): PricingRule => ({
  id: 'setup',
  role: 'setup',
  scope: { kind: 'general' },
  rate: { kind: 'fixed', amount: amount(shopDecimal) },
});
const method = (
  shopDecimal: string,
  methodUnitMultiplicity: 'perGarment' | 'perPlacement' = 'perGarment',
): PricingRule => ({
  id: 'method-unit',
  role: 'unit',
  scope: { kind: 'method', methodId: 'm' },
  methodUnitMultiplicity,
  rate: { kind: 'fixed', amount: amount(shopDecimal) },
});
function config(rules: PricingRule[]): PublishedConfig {
  return {
    version: 'm2-published-config-v1',
    shopId: 'shop',
    productId: 'p',
    revisionId: 'r',
    revisionContentHash,
    shopCurrency: 'EUR',
    methods: [{ id: 'm' }],
    placements: [
      { id: 'a', allowedMethodIds: ['m'], allowedStepIds: ['s'], logoLaterAllowed: true },
      { id: 'b', allowedMethodIds: ['m'], allowedStepIds: ['s'], logoLaterAllowed: true },
    ],
    productionOptions: [],
    pricingRules: rules,
  };
}
function group(variants: { variantId: string; quantity: number }[], placements = ['a']): CustomizationGroup {
  return {
    version: 'm2-customization-group-v1',
    shopId: 'shop',
    productId: 'p',
    configRevisionId: 'r',
    revisionContentHash,
    design: {
      placements: placements.map((placementId) => ({
        placementId,
        methodId: 'm',
        stepId: 's',
        artwork: { kind: 'revision' as const, revisionId: 'art' },
      })),
      options: [],
    },
    variants,
  };
}
function input(
  groups: CustomizationGroup[],
  rules: PricingRule[],
  bases?: { variantId: string; minor: string }[],
): PricingInput {
  return {
    shopId: 'shop',
    groups,
    configs: [config(rules)],
    bases: (
      bases ?? [
        { variantId: 'a', minor: '2000' },
        { variantId: 'b', minor: '3000' },
      ]
    ).map((b) => ({
      shopId: 'shop',
      productId: 'p',
      variantId: b.variantId,
      currency: 'EUR',
      minor: b.minor,
      contextId: 'ctx',
    })),
    currency: { version: 'm2-currency-resolution-v1', presentmentCurrency: 'EUR', exponents: { EUR: 2 } },
    effectiveAt: '2026-09-29T12:00:00.000Z',
    marketContext: 'DE',
    roundingPolicy: 'm2-half-even-v1',
  };
}

describe('pricing invariants', () => {
  it('matches an independent arithmetic oracle for 200 seeded quantity partitions and reorders', () => {
    let seed = 0x12345678;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let trial = 0; trial < 200; trial++) {
      const a = (next() % 1000) + 1;
      const b = (next() % 1000) + 1;
      const setupMinor = next() % 10000;
      const rules = [
        setup(`${Math.floor(setupMinor / 100)}.${String(setupMinor % 100).padStart(2, '0')}`),
        method('1.25'),
      ];
      const forward = priceProposal(
        input(
          [
            group([
              { variantId: 'b', quantity: b },
              { variantId: 'a', quantity: a },
            ]),
          ],
          rules,
        ),
      );
      const reverse = priceProposal(
        input(
          [
            group([
              { variantId: 'a', quantity: a },
              { variantId: 'b', quantity: b },
            ]),
          ],
          [...rules].reverse(),
        ),
      );
      const expected = BigInt(a) * 2125n + BigInt(b) * 3125n + BigInt(setupMinor);
      expect(BigInt(forward.totalMinor)).toBe(expected);
      expect(forward).toEqual(reverse);
      expect(forward.lines.reduce((sum, line) => sum + BigInt(line.lineTotalMinor), 0n)).toBe(expected);
      expect(
        forward.lines.every(
          (line) => line.quantity > 0 && line.unitOrdinalEnd - line.unitOrdinalStart + 1 === line.quantity,
        ),
      ).toBe(true);
      expect(
        forward.groups[0]?.variants.reduce(
          (sum, v) => sum + v.buckets.reduce((inner, bucket) => inner + bucket.quantity, 0),
          0,
        ),
      ).toBe(a + b);
      expect(forward.groups[0]?.setupComponents).toHaveLength(1);
    }
  });

  it('normalizes equivalent split rows without changing setup, identity or buckets', () => {
    const rules = [setup('0.01'), method('1.00')];
    const whole = priceProposal(input([group([{ variantId: 'a', quantity: 3 }])], rules));
    const split = priceProposal(
      input(
        [
          group([
            { variantId: 'a', quantity: 1 },
            { variantId: 'a', quantity: 2 },
          ]),
        ],
        rules,
      ),
    );
    expect(split).toEqual(whole);
    expect(whole.lines.map((l) => [l.quantity, l.unitPriceMinor])).toEqual([
      [1, '2101'],
      [2, '2100'],
    ]);
  });

  it('uses configurable method multiplicity and method-specific overrides including zero', () => {
    const placementGeneric: PricingRule = {
      id: 'placement-generic',
      role: 'unit',
      scope: { kind: 'placement', placementId: 'a' },
      rate: { kind: 'fixed', amount: amount('3.00') },
    };
    const placementOverride: PricingRule = {
      id: 'placement-override',
      role: 'unit',
      scope: { kind: 'placement', placementId: 'a', methodId: 'm' },
      rate: { kind: 'fixed', amount: amount('0.00') },
    };
    const stepGeneric: PricingRule = {
      id: 'step-generic',
      role: 'unit',
      scope: { kind: 'step', placementId: 'a', stepId: 's' },
      rate: { kind: 'fixed', amount: amount('2.00') },
    };
    const stepOverride: PricingRule = {
      id: 'step-override',
      role: 'unit',
      scope: { kind: 'step', placementId: 'a', stepId: 's', methodId: 'm' },
      rate: { kind: 'fixed', amount: amount('-0.50') },
    };
    const selected = group([{ variantId: 'a', quantity: 1 }], ['a', 'b']);
    const garment = priceProposal(
      input([selected], [method('2.00'), placementGeneric, placementOverride, stepGeneric, stepOverride]),
    );
    const perPlacement = priceProposal(
      input(
        [selected],
        [method('2.00', 'perPlacement'), placementGeneric, placementOverride, stepGeneric, stepOverride],
      ),
    );
    expect(garment.groups[0]?.customizationUnitMinor).toBe('150');
    expect(perPlacement.groups[0]?.customizationUnitMinor).toBe('350');
    expect(garment.groups[0]?.unitComponents.map((c) => c.ruleId)).toEqual([
      'method-unit',
      'placement-override',
      'step-override',
    ]);
    expect(garment.groups[0]?.unitComponents[2]?.resolvedMinor).toBe('-50');
  });

  it('rejects negative aggregate customization and bounded arithmetic overflow', () => {
    const negative: PricingRule = {
      id: 'negative',
      role: 'unit',
      scope: { kind: 'placement', placementId: 'a' },
      rate: { kind: 'fixed', amount: amount('-1.00') },
    };
    expect(() => priceProposal(input([group([{ variantId: 'a', quantity: 1 }])], [negative]))).toThrow();
    const overflow = input(
      [group([{ variantId: 'a', quantity: 2 }])],
      [],
      [{ variantId: 'a', minor: '18446744073709551615' }],
    );
    expect(() => priceProposal(overflow)).toThrow(/range|overflow/);
    const zero = input([group([{ variantId: 'a', quantity: 0 }])], []);
    expect(() => priceProposal(zero)).toThrow();
  });

  it('rejects mixed-shop configuration, groups and contextual bases before computing Q', () => {
    const proposal = input([group([{ variantId: 'a', quantity: 1 }])], []);
    required(proposal.groups[0]).shopId = 'other';
    expect(() => priceProposal(proposal)).toThrow(/mixed-shop/);
    required(proposal.groups[0]).shopId = 'shop';
    required(proposal.configs[0]).shopId = 'other';
    expect(() => priceProposal(proposal)).toThrow(/mixed-shop/);
    required(proposal.configs[0]).shopId = 'shop';
    required(proposal.bases[0]).shopId = 'other';
    expect(() => priceProposal(proposal)).toThrow(/mixed-shop/);
  });

  it('rounds converted components half-even with exact rational input and enforces FX window', () => {
    const proposal = input([group([{ variantId: 'a', quantity: 1 }])], [method('0.01')]);
    proposal.currency = {
      version: 'm2-currency-resolution-v1',
      presentmentCurrency: 'USD',
      exponents: { EUR: 2, USD: 2 },
    };
    required(proposal.bases[0]).currency = 'USD';
    proposal.fx = {
      version: 'm2-fx-resolution-v1',
      fromCurrency: 'EUR',
      toCurrency: 'USD',
      rateDecimal: '0.5',
      sourceId: 'synthetic',
      rateVersion: '1',
      asOf: '2026-09-29T11:00:00.000Z',
      validUntil: '2026-09-29T13:00:00.000Z',
    };
    expect(priceProposal(proposal).groups[0]?.customizationUnitMinor).toBe('0');
    required(required(proposal.configs[0]).pricingRules[0]).rate = { kind: 'fixed', amount: amount('0.03') };
    expect(priceProposal(proposal).groups[0]?.customizationUnitMinor).toBe('2');
    proposal.effectiveAt = '2026-09-29T14:00:00.000Z';
    expect(() => priceProposal(proposal)).toThrow(/FX outside/);
    proposal.effectiveAt = '2026-02-29T12:00:00.000Z';
    expect(() => priceProposal(proposal)).toThrow(/valid fixed-width UTC/);
    proposal.effectiveAt = '2026-09-29T12:00:00.000Z';
    proposal.fx.asOf = '2026-13-01T11:00:00.000Z';
    expect(() => priceProposal(proposal)).toThrow(/FX outside/);
  });
});
