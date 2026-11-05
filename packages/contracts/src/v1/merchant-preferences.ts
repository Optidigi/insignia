import { z } from 'zod';

const version = z.string().regex(/^(0|[1-9][0-9]{0,17})$/);
const locale = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/);
const form = z.enum(['message', 'zero', 'one', 'two', 'few', 'many', 'other']);
const forms = z.partialRecord(form, z.string().max(4000));
export const MerchantCustomerWordingOverlaySchema = z
  .object({
    locale,
    messages: z.record(z.string().regex(/^(?:common|customer):[A-Za-z0-9_.-]+$/), forms),
  })
  .strict();
export const MerchantCustomerWordingOverlaysSchema = z
  .record(locale, MerchantCustomerWordingOverlaySchema)
  .refine(
    (value) => Object.keys(value).length <= 32 && Object.hasOwn(value, 'en'),
    'English fallback and at most 32 locales required',
  )
  .refine(
    (value) => Object.entries(value).every(([key, overlay]) => key === overlay.locale),
    'Overlay locale must match its key',
  );
export const MerchantGuidanceSchema = z
  .object({
    dismissed: z.boolean(),
    completedSteps: z
      .array(z.enum(['product', 'storefront', 'test']))
      .max(3)
      .refine((steps) => new Set(steps).size === steps.length, 'Duplicate guidance step'),
  })
  .strict();
export const MerchantPreferencesViewSchema = z
  .object({
    version: z.literal('merchant-preferences-v1'),
    authority: z.string().regex(/^[a-f0-9]{64}$/),
    canEdit: z.boolean().optional(),
    canReadPrivacy: z.boolean().optional(),
    shop: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/),
    guidanceVersion: version,
    wordingVersion: version,
    guidance: MerchantGuidanceSchema,
    overlays: MerchantCustomerWordingOverlaysSchema,
  })
  .strict();
export const MerchantPreferencesCommandSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('guidance'),
      authority: z.string().regex(/^[a-f0-9]{64}$/),
      expectedVersion: version,
      guidance: MerchantGuidanceSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('wording'),
      authority: z.string().regex(/^[a-f0-9]{64}$/),
      expectedVersion: version,
      overlays: MerchantCustomerWordingOverlaysSchema,
    })
    .strict(),
]);
export const MerchantCustomerWordingViewSchema = z
  .object({ wordingVersion: version, overlays: MerchantCustomerWordingOverlaysSchema })
  .strict();
export type MerchantCustomerWordingView = z.infer<typeof MerchantCustomerWordingViewSchema>;
export type MerchantPreferencesView = z.infer<typeof MerchantPreferencesViewSchema>;
export type MerchantPreferencesCommand = z.infer<typeof MerchantPreferencesCommandSchema>;
export type MerchantGuidance = z.infer<typeof MerchantGuidanceSchema>;
export type MerchantCustomerWordingOverlays = z.infer<typeof MerchantCustomerWordingOverlaysSchema>;
