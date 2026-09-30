import { z } from 'zod';
import { PublishedConfigSchema } from './pricing-config.js';

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
  labels: z
    .strictObject({
      methods: labelMap.optional(),
      placements: labelMap.optional(),
      steps: labelMap.optional(),
      views: labelMap.optional(),
      options: labelMap.optional(),
      values: labelMap.optional(),
      prices: labelMap.optional(),
    })
    .optional(),
  geometry: z.unknown(),
});

export type MerchantDraft = z.infer<typeof MerchantDraftSchema>;
