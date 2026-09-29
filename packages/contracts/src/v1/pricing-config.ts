import { z } from 'zod';

// Browser/process payloads are JSON-safe; exact economic arithmetic stays in domain.
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const currency = z.string().regex(/^[A-Z]{3}$/);
const revisionContentHash = z.string().regex(/^[a-f0-9]{64}$/);
const decimal = z
  .string()
  .max(25)
  .regex(/^-?(0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/);
const positiveQuantity = z.number().int().positive().refine(Number.isSafeInteger);

export const MoneyDtoSchema = z.strictObject({
  version: z.literal('m2-money-v1'),
  currency,
  minor: z
    .string()
    .max(20)
    .regex(/^(0|[1-9][0-9]*)$/)
    .refine((value) => BigInt(value) <= (1n << 64n) - 1n),
});

export const ComponentAmountSchema = z.strictObject({
  shopDecimal: decimal,
  presentmentOverrides: z.array(z.strictObject({ currency, decimal })),
});

export const PricingScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('general') }),
  z.strictObject({ kind: z.literal('method'), methodId: id }),
  z.strictObject({ kind: z.literal('placement'), placementId: id, methodId: id.optional() }),
  z.strictObject({ kind: z.literal('step'), placementId: id, stepId: id, methodId: id.optional() }),
]);

export const PricingRateSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('fixed'), amount: ComponentAmountSchema }),
  z.strictObject({
    kind: z.literal('allUnits'),
    tiers: z.array(z.strictObject({ minQuantity: positiveQuantity, amount: ComponentAmountSchema })).min(1),
  }),
]);

export const PricingRuleSchema = z.strictObject({
  id,
  scope: PricingScopeSchema,
  role: z.enum(['setup', 'unit']),
  methodUnitMultiplicity: z.enum(['perGarment', 'perPlacement']).optional(),
  rate: PricingRateSchema,
});

export const PublishedConfigSchema = z.strictObject({
  version: z.literal('m2-published-config-v1'),
  shopId: id,
  productId: id,
  revisionId: id,
  revisionContentHash,
  shopCurrency: currency,
  methods: z.array(z.strictObject({ id })),
  placements: z.array(
    z.strictObject({ id, allowedMethodIds: z.array(id), allowedStepIds: z.array(id), logoLaterAllowed: z.boolean() }),
  ),
  productionOptions: z.array(z.strictObject({ id, allowedValueIds: z.array(id) })),
  pricingRules: z.array(PricingRuleSchema),
});

export const ArtworkChoiceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('revision'), revisionId: id }),
  z.strictObject({ kind: z.literal('deferred'), intentId: id }),
]);

export const CustomizationGroupSchema = z.strictObject({
  version: z.literal('m2-customization-group-v1'),
  shopId: id,
  productId: id,
  configRevisionId: id,
  revisionContentHash,
  design: z.strictObject({
    placements: z
      .array(z.strictObject({ placementId: id, methodId: id, stepId: id, artwork: ArtworkChoiceSchema }))
      .min(1),
    options: z.array(z.strictObject({ optionId: id, valueId: id })),
  }),
  variants: z.array(z.strictObject({ variantId: id, quantity: positiveQuantity })).min(1),
});

export type MoneyDto = z.infer<typeof MoneyDtoSchema>;
export type PublishedConfigDto = z.infer<typeof PublishedConfigSchema>;
export type CustomizationGroupDto = z.infer<typeof CustomizationGroupSchema>;
