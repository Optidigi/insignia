/**
 * Merchant Settings Service
 *
 * Shop-level settings (placeholder logo for "Logo later").
 * Canonical: docs/core/api-contracts/admin.md, docs/core/storefront-config.md
 */

import { z } from "zod";
import db from "../../db.server";

// ============================================================================
// Validation Schemas
// ============================================================================

export const UpdateSettingsSchema = z.object({
  placeholderLogoImageUrl: z.string().url().nullable().optional(),
});

export type UpdateSettingsInput = z.infer<typeof UpdateSettingsSchema>;

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Get merchant settings for a shop (creates default if missing)
 */
export async function getMerchantSettings(shopId: string) {
  let settings = await db.merchantSettings.findUnique({
    where: { shopId },
  });

  if (!settings) {
    settings = await db.merchantSettings.create({
      data: { shopId },
    });
  }

  return settings;
}

/**
 * Update merchant settings
 */
export async function updateMerchantSettings(
  shopId: string,
  input: UpdateSettingsInput
) {
  await getMerchantSettings(shopId);

  return db.merchantSettings.update({
    where: { shopId },
    data: {
      ...(input.placeholderLogoImageUrl !== undefined && {
        placeholderLogoImageUrl: input.placeholderLogoImageUrl,
      }),
    },
  });
}
