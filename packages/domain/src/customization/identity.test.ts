import { describe, expect, it } from 'vitest';
import type { PublishedConfig } from '../config/model.js';
import { canonicalDesignIdentity, normalizeCustomizationGroups } from './identity.js';

const config: PublishedConfig = {
  version: 'm2-published-config-v1',
  shopId: 'shop',
  productId: 'shirt',
  revisionId: 'rev-1',
  revisionContentHash: 'a'.repeat(64),
  shopCurrency: 'EUR',
  methods: [{ id: 'print' }, { id: 'stitch' }],
  placements: [
    { id: 'back', allowedMethodIds: ['print'], allowedStepIds: ['large'], logoLaterAllowed: true },
    { id: 'front', allowedMethodIds: ['print', 'stitch'], allowedStepIds: ['small'], logoLaterAllowed: true },
  ],
  productionOptions: [{ id: 'thread', allowedValueIds: ['blue', 'red'] }],
  pricingRules: [],
};

const design = {
  placements: [
    {
      placementId: 'front',
      methodId: 'stitch',
      stepId: 'small',
      artwork: { kind: 'revision' as const, revisionId: 'art-1' },
    },
    {
      placementId: 'back',
      methodId: 'print',
      stepId: 'large',
      artwork: { kind: 'deferred' as const, intentId: 'intent-1' },
    },
  ],
  options: [{ optionId: 'thread', valueId: 'blue' }],
};
const front = design.placements[0] as (typeof design.placements)[number];
const back = design.placements[1] as (typeof design.placements)[number];

const group = {
  version: 'm2-customization-group-v1' as const,
  productId: 'shirt',
  configRevisionId: 'rev-1',
  revisionContentHash: 'a'.repeat(64),
  design,
  variants: [
    { variantId: 'red-s', quantity: 10 },
    { variantId: 'black-l', quantity: 15 },
  ],
};

describe('canonical production identity and quantity vectors', () => {
  it('is stable under selection order and quantity changes', () => {
    const reversed = {
      ...group,
      design: { ...design, placements: [...design.placements].reverse() },
      variants: [...group.variants].reverse(),
    };
    expect(canonicalDesignIdentity(group)).toBe(canonicalDesignIdentity(reversed));
    expect(canonicalDesignIdentity(group)).toBe(
      canonicalDesignIdentity({ ...group, variants: [{ variantId: 'red-s', quantity: 1 }] }),
    );
  });

  it('changes for each production selection and isolates independent logo-later intents', () => {
    const changed = (placement: (typeof design.placements)[number]) => ({
      ...group,
      design: { ...design, placements: [placement, back] },
    });
    expect(canonicalDesignIdentity(changed({ ...front, artwork: { kind: 'revision', revisionId: 'art-2' } }))).not.toBe(
      canonicalDesignIdentity(group),
    );
    expect(canonicalDesignIdentity(changed({ ...front, methodId: 'print' }))).not.toBe(canonicalDesignIdentity(group));
    expect(
      canonicalDesignIdentity({
        ...group,
        design: {
          ...design,
          placements: [front, { ...back, artwork: { kind: 'deferred', intentId: 'intent-2' } }],
        },
      }),
    ).not.toBe(canonicalDesignIdentity(group));
    expect(
      canonicalDesignIdentity({ ...group, design: { ...design, options: [{ optionId: 'thread', valueId: 'red' }] } }),
    ).not.toBe(canonicalDesignIdentity(group));
    expect(
      canonicalDesignIdentity({
        ...group,
        design: { ...design, placements: [{ ...front, stepId: 'other' }, back] },
      }),
    ).not.toBe(canonicalDesignIdentity(group));
  });

  it('merges recognized identical groups and variant splits without setup duplication', () => {
    const result = normalizeCustomizationGroups(
      [
        { ...group, variants: [{ variantId: 'red-s', quantity: 4 }] },
        {
          ...group,
          variants: [
            { variantId: 'red-s', quantity: 6 },
            { variantId: 'black-l', quantity: 15 },
          ],
        },
      ],
      [config],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.variants).toEqual([
      { variantId: 'black-l', quantity: 15 },
      { variantId: 'red-s', quantity: 10 },
    ]);
  });

  it('rejects unsupported references, versions, duplicate selections and quantity overflow', () => {
    expect(() => normalizeCustomizationGroups([{ ...group, configRevisionId: 'unknown' }], [config])).toThrow();
    expect(() => normalizeCustomizationGroups([{ ...group, revisionContentHash: 'b'.repeat(64) }], [config])).toThrow();
    expect(() => normalizeCustomizationGroups([{ ...group, version: 'future' as never }], [config])).toThrow();
    expect(() =>
      normalizeCustomizationGroups([{ ...group, design: { ...design, placements: [front, front] } }], [config]),
    ).toThrow();
    expect(() =>
      normalizeCustomizationGroups(
        [
          {
            ...group,
            variants: [
              { variantId: 'red-s', quantity: Number.MAX_SAFE_INTEGER },
              { variantId: 'red-s', quantity: 1 },
            ],
          },
        ],
        [config],
      ),
    ).toThrow();
    expect(() =>
      normalizeCustomizationGroups(
        [
          {
            ...group,
            variants: [
              { variantId: 'red-s', quantity: Number.MAX_SAFE_INTEGER },
              { variantId: 'black-l', quantity: 1 },
            ],
          },
        ],
        [config],
      ),
    ).toThrow();
    expect(() =>
      normalizeCustomizationGroups(
        [
          {
            ...group,
            design: {
              ...design,
              placements: [{ ...front, stepId: 'not-published' }, back],
            },
          },
        ],
        [config],
      ),
    ).toThrow();
    expect(() =>
      normalizeCustomizationGroups(
        [
          {
            ...group,
            design: {
              ...design,
              placements: [front, { ...back, artwork: { kind: 'deferred', intentId: 'intent-1' } }],
            },
          },
        ],
        [
          {
            ...config,
            placements: config.placements.map((p) => (p.id === 'back' ? { ...p, logoLaterAllowed: false } : p)),
          },
        ],
      ),
    ).toThrow();
  });
});
