/** UI read models only. These do not extend the server/API contract. */
import { PurchaseListViewSchema as BackendPurchaseListSchema } from '@insignia/contracts';
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

/** Verified original metadata is owned by the same server wire contract. */
export { PurchaseOriginalDownloadSchema } from '@insignia/contracts';
