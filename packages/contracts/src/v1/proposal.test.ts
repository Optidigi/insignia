import { describe, expect, it } from 'vitest';
import { QuoteProposalSchema } from './proposal.js';

const hash = 'a'.repeat(64);
const identity = '["m2-design-identity-v1","shop","product","revision"]';
const bucket = {
  variantId: 'variant',
  quantity: 1,
  unitOrdinalStart: 1,
  unitOrdinalEnd: 1,
  setupPerUnitMinor: '35',
  unitPriceMinor: '235',
  lineTotalMinor: '235',
};
const proposal = {
  version: 'm2-proposal-economics-v1',
  shopId: 'shop',
  pricingEngineVersion: 'm2-pricing-v1',
  roundingPolicy: 'm2-half-even-v1',
  currency: { version: 'm2-currency-resolution-v1', presentmentCurrency: 'EUR', exponents: { EUR: 2 } },
  fx: null,
  effectiveAt: '2026-09-29T12:00:00.000Z',
  marketContext: 'EU',
  customizedQuantity: 1,
  totalMinor: '235',
  groups: [
    {
      canonicalIdentity: identity,
      shopId: 'shop',
      productId: 'product',
      configRevisionId: 'revision',
      revisionContentHash: hash,
      quantity: 1,
      setupComponents: [],
      unitComponents: [],
      setupMinor: '35',
      customizationUnitMinor: '0',
      baseTotalMinor: '200',
      totalMinor: '235',
      variants: [
        {
          variantId: 'variant',
          quantity: 1,
          contextualBaseMinor: '200',
          contextId: 'market',
          buckets: [bucket],
        },
      ],
    },
  ],
  lines: [
    {
      ...bucket,
      lineIndex: 0,
      canonicalIdentity: identity,
      shopId: 'shop',
      productId: 'product',
      configRevisionId: 'revision',
      revisionContentHash: hash,
    },
  ],
};

describe('versioned quote proposal transport', () => {
  it('round-trips a JSON-safe exact-money shape', () => {
    const parsed = QuoteProposalSchema.parse(JSON.parse(JSON.stringify(proposal)));
    expect(parsed).toEqual(proposal);
  });

  it('rejects unknown versions, extra fields, and malformed economic values', () => {
    expect(QuoteProposalSchema.safeParse({ ...proposal, version: 'm2-proposal-economics-v2' }).success).toBe(false);
    expect(QuoteProposalSchema.safeParse({ ...proposal, unexpected: true }).success).toBe(false);
    expect(QuoteProposalSchema.safeParse({ ...proposal, totalMinor: '2.35' }).success).toBe(false);
    expect(QuoteProposalSchema.safeParse({ ...proposal, lines: [{ ...proposal.lines[0], quantity: 0 }] }).success).toBe(
      false,
    );
  });
});
