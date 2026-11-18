import { z } from 'zod';

const id = z.uuid().transform((value) => value.toLowerCase());
const version = z.string().regex(/^[1-9][0-9]{0,17}$/);
const name = z
  .string()
  .min(1)
  .max(80)
  .refine(
    (value) =>
      value === value.trim() &&
      [...value].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127),
  );
const description = z
  .string()
  .max(240)
  .refine((value) =>
    [...value].every((character) => {
      const code = character.charCodeAt(0);
      return (code >= 32 && code !== 127) || code === 9 || code === 10 || code === 13;
    }),
  );
const locale = z
  .string()
  .max(35)
  .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);
const amount = z
  .string()
  .trim()
  .regex(/^(?:|(?:0|[1-9][0-9]{0,4})(?:[.,][0-9]{1,2})?)$/)
  .transform((value) => value.replace(',', '.'));
const productId = z
  .string()
  .regex(/^(?:gid:\/\/shopify\/Product\/)?[1-9][0-9]{0,24}$/)
  .transform((value) => value.replace(/^gid:\/\/shopify\/Product\//, ''));
export const MethodTranslationsSchema = z.record(
  locale,
  z.strictObject({
    name: name.optional(),
    explanation: description.refine((value) => value.trim().length > 0).optional(),
  }),
);
export const MethodConfigurationSchema = z
  .strictObject({
    id,
    name,
    explanation: description,
    pricing: z.enum(['fixed', 'product']),
    amount,
    // Legacy assignment fields: accepted and stored, but ignored. Every live library Method is available on every
    // product (owner decision, 18 Nov 2026).
    assignment: z.enum(['manual', 'tags']),
    productIds: z.array(productId).max(10000),
    tags: z.array(z.string().trim().min(1).max(255)).max(100),
    tagMatch: z.enum(['any', 'all']),
    translations: MethodTranslationsSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.pricing === 'fixed' && value.amount === '')
      context.addIssue({ code: 'custom', path: ['amount'], message: 'A fixed method needs a price.' });
    if (value.assignment === 'tags' && value.tags.length === 0)
      context.addIssue({ code: 'custom', path: ['tags'], message: 'Choose matching tags.' });
    if (new Set(value.productIds).size !== value.productIds.length || new Set(value.tags).size !== value.tags.length)
      context.addIssue({ code: 'custom', message: 'Duplicate assignment values.' });
  });
export const VersionedMethodConfigurationSchema = z.strictObject({
  configuration: MethodConfigurationSchema,
  version,
  currency: z.enum(['USD', 'EUR']).optional(),
});
export const MethodCatalogViewSchema = z.strictObject({
  canEdit: z.boolean().optional(),
  methods: z.array(VersionedMethodConfigurationSchema).max(100),
  currency: z.enum(['USD', 'EUR']).optional(),
  shop: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/)
    .optional(),
  authority: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export type MethodConfiguration = z.infer<typeof MethodConfigurationSchema>;
export type VersionedMethodConfiguration = z.infer<typeof VersionedMethodConfigurationSchema>;
export const MethodDraftFieldSchema = z.strictObject({
  source: z.enum(['catalog', 'product']),
  value: z.string().max(2000),
});
export const MethodDraftBindingSchema = z.strictObject({
  catalogMethodId: id,
  observedVersion: version,
  name: MethodDraftFieldSchema,
  explanation: MethodDraftFieldSchema,
  translations: z.record(
    locale,
    z.strictObject({ name: MethodDraftFieldSchema.optional(), explanation: MethodDraftFieldSchema.optional() }),
  ),
  prices: z.record(z.string().min(1).max(256), MethodDraftFieldSchema),
  review: z
    .strictObject({
      // `unassigned` is a legacy stored reason; it is treated as resolved and never blocks publication.
      reason: z.enum(['unassigned', 'deleted']),
      catalogVersion: version,
      decision: z.enum(['pending', 'keep']),
      assignmentKey: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    })
    .nullable(),
});
export type MethodDraftBinding = z.infer<typeof MethodDraftBindingSchema>;
