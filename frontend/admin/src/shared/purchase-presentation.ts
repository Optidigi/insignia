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

/**
 * The variant label for a purchased line, or null for none. Shopify gives a product's only ("Default Title")
 * variant no variant title, so a resolved line (its product title is known) shows no variant label, as Shopify
 * admin does. Only a failed lookup, which also lacks the product title, shows `unavailable`.
 */
export function purchasedVariantLabel(
  line: { title?: string | null; variantTitle?: string | null } | undefined,
  unavailable: string,
): string | null {
  if (line?.variantTitle) return line.variantTitle;
  return line?.title ? null : unavailable;
}

/** Verified original metadata is owned by the same server wire contract. */
export { PurchaseOriginalDownloadSchema } from '@insignia/contracts';

/**
 * An order-related time in the shop's time zone, labelled with that zone (e.g. "16 Nov 2026, 16:46 EST").
 * Without a known shop zone it falls back to UTC, labelled by `utcLabel`. The Orders list and the order
 * detail use this one format so the same order shows the same time everywhere.
 */
export function formatShopDateTime(
  locale: string,
  value: string | Date,
  timeZone: string | undefined,
  utcLabel: (date: string) => string,
): string {
  const instant = typeof value === 'string' ? new Date(value) : value;
  if (!timeZone)
    return utcLabel(
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(instant),
    );
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  }).format(instant);
}
