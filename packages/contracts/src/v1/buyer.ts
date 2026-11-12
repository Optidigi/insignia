import { z } from 'zod';
import { CustomerSelectedSetupSchema } from './customer-artwork.js';
import { MerchantCustomerWordingViewSchema } from './merchant-preferences.js';
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
/**
 * A saved draft (`PUT designs/:id`) may have no sizes or colours yet: artwork and placement chosen before
 * Quantities survive a reload (#366). Quotes, acceptance and renewal keep requiring at least one variant.
 */
export const BuyerDraftGroupSchema = BuyerDesiredGroupSchema.extend({
  variants: z.array(CustomizationGroupSchema.shape.variants.element).max(32),
});
/**
 * One signed set covers the whole cart's customized lines (CART-LINE-V3): at most 32 variant entries and
 * 10,000 garments across every group, and the cart holds at most 200 lines in total. The published
 * Function config and candidate admission enforce the same numbers; the storefront pre-checks them.
 */
export const BUYER_CART_CAPACITY = { variants: 32, quantity: 10000, cartLines: 200 } as const;
/** `SIGNED_SET`: over 32 variant entries or 10,000 garments; `CART_LINES`: over 200 cart lines in total. */
export type BuyerCartCapacityExceeded = 'SIGNED_SET' | 'CART_LINES';
export function buyerCartCapacityExceeded(
  groups: readonly { variants: readonly { quantity: number }[] }[],
  ordinaryLineCount = 0,
): BuyerCartCapacityExceeded | undefined {
  let variants = 0;
  let quantity = 0;
  for (const group of groups) {
    variants += group.variants.length;
    for (const variant of group.variants) quantity += variant.quantity;
  }
  if (variants > BUYER_CART_CAPACITY.variants || quantity > BUYER_CART_CAPACITY.quantity) return 'SIGNED_SET';
  return variants + ordinaryLineCount > BUYER_CART_CAPACITY.cartLines ? 'CART_LINES' : undefined;
}
const CART_CAPACITY_ISSUE = 'BUYER_CART_CAPACITY_EXCEEDED';
type Issue = { code: string; path?: readonly PropertyKey[]; params?: unknown };
function capacityKind(issue: Issue): BuyerCartCapacityExceeded | undefined {
  if (issue.code !== 'custom' || typeof issue.params !== 'object' || issue.params === null) return undefined;
  const params = issue.params as { reason?: unknown; kind?: unknown };
  return params.reason === CART_CAPACITY_ISSUE && (params.kind === 'SIGNED_SET' || params.kind === 'CART_LINES')
    ? params.kind
    : undefined;
}
export function isBuyerCartCapacityIssue(issue: Issue): boolean {
  return capacityKind(issue) !== undefined;
}
/** Bounds that a capacity issue always accompanies: too many groups, variants per group or ordinary lines. */
function impliedByCapacity(issue: Issue): boolean {
  const path = issue.path ?? [];
  return (
    issue.code === 'too_big' &&
    ((path.length === 1 && path[0] === 'groups') ||
      (path.length === 3 && path[0] === 'groups' && typeof path[1] === 'number' && path[2] === 'variants') ||
      (path.length === 2 && path[0] === 'capacity' && path[1] === 'ordinaryLineCount'))
  );
}
/**
 * The buyer API answers 422 CAPACITY_EXCEEDED only when every issue is the cart capacity or a bound it
 * implies; any other defect keeps the request a malformed 400.
 */
export function buyerCartCapacityViolation(issues: readonly Issue[]): BuyerCartCapacityExceeded | undefined {
  const kinds = issues.map(capacityKind).filter((kind) => kind !== undefined);
  if (!kinds.length || !issues.every((issue) => isBuyerCartCapacityIssue(issue) || impliedByCapacity(issue)))
    return undefined;
  return kinds.includes('SIGNED_SET') ? 'SIGNED_SET' : 'CART_LINES';
}
// Runs after the continuable per-group and group-count bounds too, so any oversized cart carries the issue.
export const BuyerDesiredSchema = z
  .strictObject({
    country: z.string().regex(/^[A-Z]{2}$/),
    marketId: z.string().regex(/^(?:gid:\/\/shopify\/Market\/)?[1-9][0-9]{0,19}$/),
    groups: z.array(BuyerDesiredGroupSchema).min(1).max(32),
    capacity: z.strictObject({
      ordinaryLineCount: z.number().int().min(0).max(200),
      inputBytes: z.number().int().min(0).max(128000),
    }),
  })
  .superRefine((value, context) => {
    const kind = buyerCartCapacityExceeded(value.groups, value.capacity.ordinaryLineCount);
    if (kind)
      context.addIssue({
        code: 'custom',
        path: ['groups'],
        message: 'cart capacity exceeded',
        params: { reason: CART_CAPACITY_ISSUE, kind },
      });
  });
export const BuyerProposalRequestSchema = BuyerDesiredSchema.safeExtend({
  capability: BuyerCapabilitySchema,
  observedFingerprint: z.string().max(2048).optional(),
});
export const BuyerAcceptanceSchema = z.strictObject({
  capability: BuyerCapabilitySchema,
  hash: BuyerHashSchema,
  idempotencyKey: BuyerIdSchema,
});
export const BuyerRenewalSchema = BuyerDesiredSchema.safeExtend({
  capability: BuyerCapabilitySchema,
  idempotencyKey: BuyerIdSchema,
});
export const BuyerDesignSchema = z.strictObject({
  capability: BuyerCapabilitySchema,
  expectedVersion: z.number().int().min(0).max(2147483646),
  group: BuyerDraftGroupSchema,
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
export type BuyerDraftGroup = z.infer<typeof BuyerDraftGroupSchema>;

const label = z.string().min(1).max(256);
const choice = z.strictObject({ id: z.string().min(1).max(128), label });
const minor = z
  .string()
  .max(20)
  .regex(/^(0|[1-9][0-9]*)$/);
export const BuyerEligibilitySchema = z.strictObject({
  productId: z.string().regex(/^[1-9][0-9]{0,19}$/),
  configured: z.literal(true),
});
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
  variants: z
    .array(
      choice.extend({
        available: z.boolean(),
        selectedOptions: z
          .array(
            z.strictObject({
              name: z.string().min(1).max(200),
              value: z.string().min(1).max(200),
              swatch: z.strictObject({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).optional(),
            }),
          )
          .max(3)
          .optional(),
        baseUnitMinor: minor.optional(),
      }),
    )
    .max(250),
  selectedSetup: CustomerSelectedSetupSchema.optional(),
  wording: MerchantCustomerWordingViewSchema.optional(),
  shopCurrency: z.enum(['USD', 'EUR']).optional(),
  title: label.optional(),
  decorationPrices: z
    .array(
      z.strictObject({
        placementId: z.string().max(128),
        methodId: z.string().max(128),
        stepId: z.string().max(128),
        minor,
      }),
    )
    .max(32768)
    .optional(),
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
        canonicalIdentitySha256: BuyerHashSchema.optional(),
        selection: BuyerDesiredGroupSchema.optional(),
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
  /** The owned complete set is unchanged but past its valid-through day: renewal may restore it. */
  renewable: z.boolean().optional(),
  labels: z.record(z.string().max(128), label).optional(),
});
export const BuyerConfirmationResultSchema = z.strictObject({
  id: BuyerIdSchema,
  status: z.enum(['APPLIED', 'REVIEW_REQUIRED']),
});
export const BuyerDesignResultSchema = z.strictObject({
  id: BuyerIdSchema,
  version: z.number().int().positive(),
  value: BuyerDraftGroupSchema,
});
export const BuyerDesignRestoreRequestSchema = z.strictObject({ capability: BuyerCapabilitySchema });
export const BuyerDesignRestorationSchema = BuyerDesignResultSchema.extend({
  expiresAt: z.iso.datetime(),
  compatibility: z.enum([
    'current',
    'publication-changed',
    'choice-unavailable',
    'configuration-unavailable',
    'legacy',
  ]),
  retained: z
    .strictObject({
      revisionId: z.string().min(1).max(128),
      contentHash: BuyerHashSchema,
      selectedSetup: CustomerSelectedSetupSchema,
      geometry: z.unknown(),
      imageUrls: z.record(
        z.string().min(1).max(128),
        z.url().refine((value) => value.startsWith('https://')),
      ),
    })
    .nullable(),
});
/** The browser and HTTP composition share these versioned JSON boundaries. Geometry is validated by the visualizer. */
export function parseBuyerResponse(route: string, value: unknown): unknown {
  if (route === 'eligibility') return BuyerEligibilitySchema.parse(value);
  if (route === 'config') return BuyerConfigSchema.parse(value);
  if (route === 'sessions') return BuyerSessionSchema.parse(value);
  if (route === 'quote-proposals') return BuyerProposalSchema.parse(value);
  if (/^(?:quote-proposals\/[a-f0-9-]+\/accept|quotes\/[a-f0-9-]+\/renew)$/.test(route))
    return BuyerAcceptedCartSchema.parse(value);
  if (route === 'cart-state') return BuyerCartRestorationSchema.parse(value);
  if (/^cart-applications\/[a-f0-9-]+\/confirm$/.test(route)) return BuyerConfirmationResultSchema.parse(value);
  if (/^designs\/[a-f0-9-]+\/restore$/.test(route)) return BuyerDesignRestorationSchema.parse(value);
  if (/^designs\/[a-f0-9-]+$/.test(route)) return BuyerDesignResultSchema.parse(value);
  throw new Error('Unknown buyer response');
}
