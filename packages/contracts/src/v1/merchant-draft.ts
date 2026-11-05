import { z } from 'zod';
import { MethodDraftBindingSchema } from './method-catalog.js';
import { PublishedConfigSchema } from './pricing-config.js';
import { placementProductSchema } from './selected-product.js';

const labelMap = z.record(
  z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((value) =>
      [...value].every((character) => {
        const code = character.charCodeAt(0);
        return code >= 32 && code !== 127;
      }),
    ),
);

export const MerchantLabelsSchema = z.strictObject({
  methods: labelMap.optional(),
  placements: labelMap.optional(),
  steps: labelMap.optional(),
  views: labelMap.optional(),
  options: labelMap.optional(),
  // A value ID is only unique within its option in the M2 contract.
  values: z.record(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/), labelMap).optional(),
  prices: labelMap.optional(),
});

export const SelectedProductSetupSchema = z.strictObject({
  version: z.literal('selected-product-setup-v1'),
  product: placementProductSchema,
  methodBindings: z.record(z.string(), MethodDraftBindingSchema),
});
export type SelectedProductSetup = z.infer<typeof SelectedProductSetupSchema>;

export const MerchantPresentationSchema = z.strictObject({
  version: z.literal('m5-presentation-v1'),
  labels: MerchantLabelsSchema,
  selectedSetup: SelectedProductSetupSchema.optional(),
});
export type MerchantPresentation = z.infer<typeof MerchantPresentationSchema>;

/** Merchant input omits tenant, product and revision authority; the server binds those. */
export const MerchantDraftSchema = z.strictObject({
  version: z.literal('m5-merchant-draft-v1'),
  mode: z.enum(['required', 'optional']),
  shopCurrency: PublishedConfigSchema.shape.shopCurrency,
  methods: PublishedConfigSchema.shape.methods,
  placements: PublishedConfigSchema.shape.placements,
  productionOptions: PublishedConfigSchema.shape.productionOptions,
  pricingRules: PublishedConfigSchema.shape.pricingRules,
  // Editor presentation only. Published M2 economics use stable IDs, not these labels.
  labels: MerchantLabelsSchema.optional(),
  geometry: z.unknown(),
  selectedSetup: SelectedProductSetupSchema.optional(),
});

export type MerchantDraft = z.infer<typeof MerchantDraftSchema>;
