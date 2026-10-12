import { z } from 'zod';
import { CustomizationGroupSchema } from './pricing-config.js';

export const BuyerIdSchema = z.string().uuid();
export const BuyerHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const BuyerCapabilitySchema = z
  .string()
  .max(2048)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
export const BuyerDesiredGroupSchema = CustomizationGroupSchema.omit({ shopId: true, version: true }).extend({
  productId: z.string().regex(/^[1-9][0-9]{0,19}$/),
  design: CustomizationGroupSchema.shape.design.extend({
    placements: CustomizationGroupSchema.shape.design.shape.placements.max(32),
    options: CustomizationGroupSchema.shape.design.shape.options.max(32),
  }),
  variants: CustomizationGroupSchema.shape.variants.max(32),
});
export const BuyerDesiredSchema = z.strictObject({
  country: z.string().regex(/^[A-Z]{2}$/),
  marketId: z.string().regex(/^(?:gid:\/\/shopify\/Market\/)?[1-9][0-9]{0,19}$/),
  groups: z.array(BuyerDesiredGroupSchema).min(1).max(32),
  capacity: z.strictObject({
    ordinaryLineCount: z.number().int().min(0).max(200),
    inputBytes: z.number().int().min(0).max(128000),
  }),
});
export const BuyerProposalRequestSchema = BuyerDesiredSchema.extend({
  capability: BuyerCapabilitySchema,
  observedFingerprint: z.string().max(2048).optional(),
});
export const BuyerAcceptanceSchema = z.strictObject({
  capability: BuyerCapabilitySchema,
  hash: BuyerHashSchema,
  idempotencyKey: BuyerIdSchema,
});
export const BuyerRenewalSchema = BuyerDesiredSchema.extend({
  capability: BuyerCapabilitySchema,
  idempotencyKey: BuyerIdSchema,
});
export const BuyerDesignSchema = z.strictObject({
  capability: BuyerCapabilitySchema,
  expectedVersion: z.number().int().min(0).max(2147483646),
  group: BuyerDesiredGroupSchema,
});
export const BuyerCartBucketSchema = z.strictObject({
  variantId: z.string().regex(/^[1-9][0-9]{0,19}$/),
  quantity: z.number().int().min(1).max(10000),
  properties: z.record(z.string().max(128), z.string().max(2048)),
});
export const BuyerConfirmationSchema = z.strictObject({
  capability: BuyerCapabilitySchema,
  fingerprint: z.string().max(2048),
  vector: z.array(BuyerCartBucketSchema).max(32),
});
export const BuyerCartStateSchema = z.strictObject({
  capability: BuyerCapabilitySchema,
  lines: z
    .array(
      z.strictObject({
        key: z.string().max(256),
        variantId: z.string().regex(/^[1-9][0-9]{0,19}$/),
        quantity: z.number().int().min(1).max(10000),
        properties: z.record(
          z.string().max(128),
          z.union([z.string().max(2048), z.number().finite(), z.boolean(), z.null()]),
        ),
        sellingPlan: z.string().nullable(),
      }),
    )
    .max(32),
});
export type BuyerDesired = z.infer<typeof BuyerDesiredSchema>;
export type BuyerDesiredGroup = z.infer<typeof BuyerDesiredGroupSchema>;

const label = z.string().min(1).max(256);
const choice = z.strictObject({ id: z.string().min(1).max(128), label });
const minor = z
  .string()
  .max(20)
  .regex(/^(0|[1-9][0-9]*)$/);
export const BuyerConfigSchema = z.strictObject({
  version: z.literal('m7-config-v1'),
  productId: z.string().regex(/^[1-9][0-9]{0,19}$/),
  revisionId: z.string().min(1).max(128),
  contentHash: BuyerHashSchema,
  methods: z.array(choice).max(32),
  placements: z
    .array(
      choice.extend({
        allowedMethodIds: z.array(z.string().max(128)).max(32),
        allowedStepIds: z.array(z.string().max(128)).max(32),
        logoLaterAllowed: z.boolean(),
      }),
    )
    .max(32),
  steps: z.array(choice).max(64),
  options: z.array(choice.extend({ values: z.array(choice).max(64) })).max(32),
  variants: z.array(choice.extend({ available: z.boolean() })).max(250),
  geometry: z.unknown(),
  imageUrls: z.record(z.string().max(128), z.url().max(4096)),
  ready: z.boolean(),
});
export const BuyerSessionSchema = z.strictObject({
  capability: BuyerCapabilitySchema,
  sessionId: BuyerIdSchema,
  expiresAt: z.iso.datetime(),
});
export const BuyerProposalSchema = z.strictObject({
  proposalId: BuyerIdSchema,
  hash: BuyerHashSchema,
  expiresAt: z.iso.datetime(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  exponent: z.number().int().min(0).max(3),
  customizedQuantity: z.number().int().min(1).max(10000),
  totalMinor: minor,
  groups: z
    .array(
      z.strictObject({
        productId: z.string().max(128),
        quantity: z.number().int().min(1).max(10000),
        setupMinor: minor,
        customizationUnitMinor: z
          .string()
          .max(21)
          .regex(/^(0|-?[1-9][0-9]*)$/),
        baseTotalMinor: minor,
        totalMinor: minor,
      }),
    )
    .min(1)
    .max(32),
  changedGroups: z.array(BuyerHashSchema).max(32),
});
export const BuyerAcceptedCartSchema = z.strictObject({
  quoteId: BuyerIdSchema,
  setId: BuyerIdSchema,
  validThroughDay: z.number().int(),
  applicationId: BuyerIdSchema,
  buckets: z.array(BuyerCartBucketSchema).min(1).max(32),
  desired: z.array(BuyerDesiredGroupSchema).min(1).max(32),
});
export const BuyerCartRestorationSchema = z.strictObject({
  groups: z.array(BuyerDesiredGroupSchema).max(32),
  quoteId: BuyerIdSchema.optional(),
  repairRequired: z.boolean(),
});
export const BuyerConfirmationResultSchema = z.strictObject({
  id: BuyerIdSchema,
  status: z.enum(['APPLIED', 'REVIEW_REQUIRED']),
});
export const BuyerDesignResultSchema = z.strictObject({
  id: BuyerIdSchema,
  version: z.number().int().positive(),
  value: BuyerDesiredGroupSchema,
});
/** The browser and HTTP composition share these versioned JSON boundaries. Geometry is validated by the visualizer. */
export function parseBuyerResponse(route: string, value: unknown): unknown {
  if (route === 'config') return BuyerConfigSchema.parse(value);
  if (route === 'sessions') return BuyerSessionSchema.parse(value);
  if (route === 'quote-proposals') return BuyerProposalSchema.parse(value);
  if (/^(?:quote-proposals\/[a-f0-9-]+\/accept|quotes\/[a-f0-9-]+\/renew)$/.test(route))
    return BuyerAcceptedCartSchema.parse(value);
  if (route === 'cart-state') return BuyerCartRestorationSchema.parse(value);
  if (/^cart-applications\/[a-f0-9-]+\/confirm$/.test(route)) return BuyerConfirmationResultSchema.parse(value);
  if (/^designs\/[a-f0-9-]+$/.test(route)) return BuyerDesignResultSchema.parse(value);
  throw new Error('Unknown buyer response');
}
