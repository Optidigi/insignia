import { z } from 'zod';

// This is a serialized snapshot boundary, not a verifier for untrusted prices.
// Recompute economics from published inputs before accepting a proposal.
const id = z.string().min(1);
const currency = z.string().regex(/^[A-Z]{3}$/);
const minor = z
  .string()
  .max(20)
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine((value) => /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= (1n << 64n) - 1n);
const signedMinor = z.string().regex(/^-?(0|[1-9][0-9]*)$/);
const positiveQuantity = z.number().int().positive().refine(Number.isSafeInteger);
const nonnegativeOrdinal = z.number().int().nonnegative().refine(Number.isSafeInteger);

const component = z.strictObject({
  ruleId: id,
  applicabilityKey: id,
  role: z.enum(['setup', 'unit']),
  selectedMinQuantity: positiveQuantity.nullable(),
  multiplicity: positiveQuantity,
  sourceDecimal: z.string(),
  resolvedMinor: signedMinor,
  resolution: z.enum(['shop-currency', 'override', 'fx']),
});

const bucket = z.strictObject({
  variantId: id,
  quantity: positiveQuantity,
  unitOrdinalStart: positiveQuantity,
  unitOrdinalEnd: positiveQuantity,
  setupPerUnitMinor: minor,
  unitPriceMinor: minor,
  lineTotalMinor: minor,
});

const pricedVariant = z.strictObject({
  variantId: id,
  quantity: positiveQuantity,
  contextualBaseMinor: minor,
  contextId: id,
  buckets: z.array(bucket).min(1),
});

const pricedGroup = z.strictObject({
  canonicalIdentity: id,
  shopId: id,
  productId: id,
  configRevisionId: id,
  revisionContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  quantity: positiveQuantity,
  setupComponents: z.array(component),
  unitComponents: z.array(component),
  setupMinor: minor,
  customizationUnitMinor: minor,
  baseTotalMinor: minor,
  totalMinor: minor,
  variants: z.array(pricedVariant).min(1),
});

export const QuoteProposalSchema = z.strictObject({
  version: z.literal('m2-proposal-economics-v1'),
  shopId: id,
  pricingEngineVersion: z.literal('m2-pricing-v1'),
  roundingPolicy: z.literal('m2-half-even-v1'),
  currency: z.strictObject({
    version: z.literal('m2-currency-resolution-v1'),
    presentmentCurrency: currency,
    exponents: z.record(currency, z.number().int().min(0).max(3)),
  }),
  fx: z
    .strictObject({
      version: z.literal('m2-fx-resolution-v1'),
      fromCurrency: currency,
      toCurrency: currency,
      rateDecimal: z.string(),
      sourceId: id,
      rateVersion: id,
      asOf: z.string(),
      validUntil: z.string(),
    })
    .nullable(),
  effectiveAt: z.string(),
  marketContext: id,
  customizedQuantity: positiveQuantity,
  totalMinor: minor,
  groups: z.array(pricedGroup).min(1),
  lines: z
    .array(
      bucket.extend({
        lineIndex: nonnegativeOrdinal,
        canonicalIdentity: id,
        shopId: id,
        productId: id,
        configRevisionId: id,
        revisionContentHash: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .min(1),
});

export type QuoteProposalDto = z.infer<typeof QuoteProposalSchema>;
