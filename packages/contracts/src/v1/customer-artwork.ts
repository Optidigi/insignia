import { z } from 'zod';
import { SelectedProductSetupSchema } from './merchant-draft.js';
import { MerchantCustomerWordingViewSchema } from './merchant-preferences.js';
import { placementProductSchema, placementRectSchema, variantPhotoSetupSchema } from './selected-product.js';

// Accepted size footprints can be smaller than merchant authoring handles.
// Keep positive, bounded geometry and all remaining selected product validation.
const effectiveRect = placementRectSchema.safeExtend({
  width: z.number().finite().positive().max(1),
  height: z.number().finite().positive().max(1),
});
const sourceView = placementProductSchema.shape.views.element;
const effectivePlacement = sourceView.shape.placements.element.safeExtend({
  rect: effectiveRect,
  movementRect: effectiveRect.optional(),
});
export const CustomerSelectedSetupSchema = SelectedProductSetupSchema.safeExtend({
  product: placementProductSchema.safeExtend({
    views: z.array(sourceView.safeExtend({ placements: z.array(effectivePlacement) })),
    variantPhotos: variantPhotoSetupSchema
      .safeExtend({
        assignments: z
          .array(
            variantPhotoSetupSchema.shape.assignments.element.safeExtend({
              placementRects: z.record(z.string(), effectiveRect).optional(),
            }),
          )
          .max(2000),
      })
      .optional(),
  }),
});
/** Frozen read projection; absent pixel metadata never invents a garment image. */
export const CustomerCanonicalProductSchema = z.strictObject({
  ...CustomerSelectedSetupSchema.shape.product.shape,
  views: z.array(
    z.strictObject({
      ...CustomerSelectedSetupSchema.shape.product.shape.views.element.shape,
      imageWidth: z.number().int().positive().optional(),
      imageHeight: z.number().int().positive().optional(),
    }),
  ),
});
export type CustomerCanonicalProduct = z.infer<typeof CustomerCanonicalProductSchema>;
export const CustomerArtworkSlotSchema = z.strictObject({
  groupIndex: z.number().int().min(0).max(31),
  placementId: z.string().min(1).max(128),
  productId: z.string().min(1).max(128),
  revisionId: z.string().min(1).max(128),
  methodId: z.string().min(1).max(128),
  stepId: z.string().min(1).max(128),
});
export const CustomerArtworkPublicViewSchema = z.strictObject({
  purchaseId: z.uuid(),
  expiresAt: z.iso.datetime(),
  currency: z.enum(['USD', 'EUR']).optional(),
  wording: MerchantCustomerWordingViewSchema.optional(),
  artworkVersion: z.number().int().nonnegative(),
  slots: z.array(CustomerArtworkSlotSchema).max(1024),
  configurations: z
    .array(
      z
        .strictObject({
          groupIndex: z.number().int().min(0).max(31),
          productId: z.string().min(1).max(128),
          revisionId: z.string().min(1).max(128),
          selectedSetup: CustomerSelectedSetupSchema.optional(),
          readProduct: CustomerCanonicalProductSchema.optional(),
          stepBindings: z
            .array(
              z.strictObject({
                placementId: z.string().min(1).max(128),
                sizeId: z.string().min(1).max(128),
                stepId: z.string().min(1).max(128),
              }),
            )
            .max(32)
            .optional(),
          contentHash: z.string().regex(/^[a-f0-9]{64}$/),
          geometry: z.unknown(),
          variantIds: z
            .array(z.string().regex(/^[1-9][0-9]{0,19}$/))
            .min(1)
            .max(32),
          positions: z
            .array(
              z.strictObject({
                placementId: z.string().min(1).max(128),
                position: z.strictObject({
                  xMicros: z.number().int().min(0).max(1000000),
                  yMicros: z.number().int().min(0).max(1000000),
                }),
              }),
            )
            .max(32),
          slots: z.array(CustomerArtworkSlotSchema).max(32),
        })
        .refine(
          (value) => !!value.selectedSetup !== !!value.readProduct,
          'Provide exactly one frozen customer presentation.',
        ),
    )
    .max(32),
});
export type CustomerArtworkPublicViewDto = z.infer<typeof CustomerArtworkPublicViewSchema>;
