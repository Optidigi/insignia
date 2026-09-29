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
const signedMinor = z
  .string()
  .max(21)
  .regex(/^(0|-?[1-9][0-9]*)$/)
  .refine((value) => /^(0|-?[1-9][0-9]*)$/.test(value) && BigInt(value.replace('-', '')) <= (1n << 64n) - 1n);
const componentDecimal = z
  .string()
  .max(26)
  .regex(/^-?(0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/);
const rateDecimal = z
  .string()
  .max(64)
  .regex(/^(0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/)
  .refine((value) => /[1-9]/.test(value));
const fixedUtc = z.string().refine((value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  )
    return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    year > 0 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (monthDays[month - 1] ?? 0) &&
    hour < 24 &&
    minute < 60 &&
    second < 60
  );
});
const positiveQuantity = z.number().int().positive().refine(Number.isSafeInteger);
const nonnegativeOrdinal = z.number().int().nonnegative().refine(Number.isSafeInteger);

const component = z.strictObject({
  ruleId: id,
  applicabilityKey: id,
  role: z.enum(['setup', 'unit']),
  selectedMinQuantity: positiveQuantity.nullable(),
  multiplicity: positiveQuantity,
  sourceDecimal: componentDecimal,
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
  customizationUnitMinor: signedMinor,
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
      rateDecimal,
      sourceId: id,
      rateVersion: id,
      asOf: fixedUtc,
      validUntil: fixedUtc,
    })
    .nullable(),
  effectiveAt: fixedUtc,
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
