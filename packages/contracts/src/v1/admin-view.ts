import { z } from 'zod';
import { MerchantDraftSchema, SelectedProductSetupSchema } from './merchant-draft.js';

const version = z.string().regex(/^(0|[1-9][0-9]{0,18})$/);
const nullableText = z.string().max(4000).nullable();
const optionalImage = z.string().url().nullable();
const methodSetup = z.object({
  methodId: z.string(),
  locations: z.number().int().nonnegative(),
  pricedLocations: z.number().int().nonnegative(),
});
export const AdminCatalogProductSchema = z.object({
  id: z.string().regex(/^gid:\/\/shopify\/Product\/[1-9][0-9]*$/),
  title: z.string(),
  status: z.string(),
  imageUrl: optionalImage,
  variants: z
    .array(
      z.object({
        id: z.string().regex(/^gid:\/\/shopify\/ProductVariant\/[1-9][0-9]*$/),
        title: z.string(),
        imageUrl: optionalImage,
        selectedOptions: z.array(z.object({ name: z.string(), value: z.string() })),
      }),
    )
    .max(1000),
  variantsTruncated: z.boolean().optional(),
  images: z
    .array(
      z.object({
        id: z.string(),
        url: z.string().url(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        alt: z.string(),
      }),
    )
    .max(1000)
    .optional(),
  imagesTruncated: z.boolean().optional(),
  options: z
    .array(z.object({ id: z.string(), name: z.string(), values: z.array(z.string()) }))
    .max(3)
    .optional(),
  tags: z.array(z.string()).optional(),
  collections: z.array(z.object({ id: z.string(), title: z.string() })).optional(),
  collectionsTruncated: z.boolean().optional(),
  methodSetup: z.array(methodSetup).optional(),
  configurationSummary: z
    .object({
      state: z.enum(['not_configured', 'draft', 'published']),
      methods: z.array(z.string()).nullable(),
      locations: z.array(z.string()).nullable(),
    })
    .optional(),
});
export const AdminPublicationStateSchema = z.enum([
  'DRAFT',
  'PUBLISH_REQUESTED',
  'REMOTE_PENDING',
  'REMOTE_READY_ACTIVATION_PENDING',
  'ACTIVATION_WAITING_RELEASE',
  'ACTIVATION_WAITING_HOLD',
  'HELD_ACTIVATION_PENDING',
  'ACTIVATED_RESTORATION_PENDING',
  'RESTORATION_CONFLICT',
  'ACTIVE',
  'CONFLICT',
  'OPERATOR_HOLD',
  'FAILED',
]);
export const AdminConfigViewSchema = z.object({
  product: AdminCatalogProductSchema,
  config: z
    .object({
      configId: z.string(),
      installationGeneration: version,
      draftVersion: version,
      draft: MerchantDraftSchema,
      currentShopCurrency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .nullable(),
      publishedSetup: SelectedProductSetupSchema.nullable().optional(),
      publication: z.object({
        state: AdminPublicationStateSchema,
        revisionId: nullableText,
        sourceDraftVersion: version.nullable(),
        requestKey: nullableText,
        activeRevisionId: nullableText.optional(),
        reason: nullableText,
        requiresAllChannelHold: z.boolean().nullable(),
        functionReadiness: nullableText,
      }),
      publishEligibility: z.object({ allowed: z.boolean(), reason: nullableText }),
    })
    .nullable(),
});
