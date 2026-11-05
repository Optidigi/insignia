/** UI read models only. These do not extend the server/API contract. */
import { PurchaseListViewSchema as BackendPurchaseListSchema, PurchasePrivateUrlSchema } from '@insignia/contracts';
import { z } from 'zod';

export const PurchaseListViewSchema = BackendPurchaseListSchema.extend({
  timeZone: z
    .string()
    .min(1)
    .max(128)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, 'Invalid time zone')
    .optional(),
});

/** Archive preparation fails closed until the backend supplies verified original metadata. */
export const PurchaseOriginalDownloadSchema = PurchasePrivateUrlSchema.extend({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  byteLength: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024),
  contentType: z.enum(['image/png', 'image/jpeg', 'image/svg+xml']),
});
