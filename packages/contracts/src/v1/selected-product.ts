/** Selected editor authoring contract, shared by the browser and authenticated persistence boundary. */

import { sha256 } from '@noble/hashes/sha2.js';
import { z } from 'zod';
import { PublishedConfigSchema } from './pricing-config.js';

const normalizedPointSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
  })
  .strict();

export const placementCalibrationSchema = z
  .object({
    imageUrl: z.string().url(),
    imageWidth: z.number().int().positive().finite(),
    imageHeight: z.number().int().positive().finite(),
    a: normalizedPointSchema,
    b: normalizedPointSchema,
    distanceCm: z.number().finite().positive(),
  })
  .strict()
  .refine(
    ({ imageWidth, imageHeight, a, b }) => Math.hypot((b.x - a.x) * imageWidth, (b.y - a.y) * imageHeight) > 0,
    'Calibration points must be different.',
  );

export type PlacementCalibration = z.infer<typeof placementCalibrationSchema>;
export type CalibrationPoint = PlacementCalibration['a'];
export type CalibrationImage = Pick<PlacementCalibration, 'imageUrl' | 'imageWidth' | 'imageHeight'>;

const idSchema = z.string().min(1).max(1000);
export const photoRectSchema = z
  .object({
    centerX: z.number().finite().min(0).max(1),
    centerY: z.number().finite().min(0).max(1),
    width: z.number().finite().min(0.02).max(1),
    height: z.number().finite().min(0.02).max(1),
  })
  .strict()
  .refine(rectInImage, 'Keep the artwork area inside the image.');

function rectInImage(rect: PlacementRect): boolean {
  return (
    rect.centerX - rect.width / 2 >= -1e-9 &&
    rect.centerX + rect.width / 2 <= 1 + 1e-9 &&
    rect.centerY - rect.height / 2 >= -1e-9 &&
    rect.centerY + rect.height / 2 <= 1 + 1e-9
  );
}

const assignmentSchema = z
  .object({
    groupKey: idSchema,
    viewId: idSchema,
    imageId: idSchema.optional(),
    useShared: z.boolean().optional(),
    needsAlignmentReview: z.boolean().optional(),
    placementRects: z.record(z.string(), photoRectSchema).optional(),
  })
  .strict()
  .refine((value) => !(value.imageId && value.useShared), 'Choose an image or the shared image.');

export const variantPhotoSetupSchema = z
  .object({
    options: z
      .array(
        z
          .object({
            id: idSchema,
            name: z.string().min(1).max(200),
            values: z
              .array(
                z
                  .object({
                    id: idSchema,
                    label: z.string().min(1).max(200),
                    swatch: z
                      .string()
                      .regex(/^#[0-9a-fA-F]{6}$/)
                      .optional(),
                  })
                  .strict(),
              )
              .min(1)
              .max(500),
          })
          .strict(),
      )
      .max(3),
    variants: z
      .array(
        z
          .object({
            id: idSchema,
            label: z.string().max(300).optional(),
            optionValues: z.record(z.string(), z.string()),
          })
          .strict(),
      )
      .max(500),
    groupingOptionIds: z.array(idSchema).max(3),
    assignments: z.array(assignmentSchema).max(2000),
  })
  .strict()
  .superRefine((value, context) => {
    const options = new Map(value.options.map((option) => [option.id, option]));
    if (options.size !== value.options.length)
      context.addIssue({ code: 'custom', path: ['options'], message: 'Option IDs must be unique.' });
    for (const [index, option] of value.options.entries()) {
      if (new Set(option.values.map((item) => item.id)).size !== option.values.length)
        context.addIssue({
          code: 'custom',
          path: ['options', index, 'values'],
          message: 'Option value IDs must be unique.',
        });
    }
    if (
      new Set(value.groupingOptionIds).size !== value.groupingOptionIds.length ||
      value.groupingOptionIds.some((id) => !options.has(id))
    )
      context.addIssue({
        code: 'custom',
        path: ['groupingOptionIds'],
        message: 'Choose each product option at most once.',
      });
    if (new Set(value.variants.map((variant) => variant.id)).size !== value.variants.length)
      context.addIssue({ code: 'custom', path: ['variants'], message: 'Variant IDs must be unique.' });
    for (const [index, variant] of value.variants.entries()) {
      if (
        Object.keys(variant.optionValues).length !== options.size ||
        value.options.some((option) => !option.values.some((item) => item.id === variant.optionValues[option.id])) ||
        Object.keys(variant.optionValues).some((id) => !options.has(id))
      )
        context.addIssue({
          code: 'custom',
          path: ['variants', index, 'optionValues'],
          message: 'Match this variant to the product option values.',
        });
    }
    const seen = new Set<string>();
    for (const [index, assignment] of value.assignments.entries()) {
      const key = JSON.stringify([assignment.groupKey, assignment.viewId]);
      if (seen.has(key))
        context.addIssue({
          code: 'custom',
          path: ['assignments', index],
          message: 'Assign this group and view only once.',
        });
      seen.add(key);
      if (!validGroupKey(value, assignment.groupKey))
        context.addIssue({
          code: 'custom',
          path: ['assignments', index, 'groupKey'],
          message: 'Choose an existing product image group.',
        });
    }
  });

export type VariantPhotoSetup = z.infer<typeof variantPhotoSetupSchema>;
export type VariantPhotoAssignment = VariantPhotoSetup['assignments'][number];
function validGroupKey(setup: VariantPhotoSetup, key: string): boolean {
  let pairs: unknown;
  try {
    pairs = JSON.parse(key);
  } catch {
    return false;
  }
  if (!Array.isArray(pairs) || pairs.length === 0 || pairs.length > setup.options.length) return false;
  const seen = new Set<string>();
  const values: [string, string][] = [];
  for (const pair of pairs) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      typeof pair[0] !== 'string' ||
      typeof pair[1] !== 'string' ||
      seen.has(pair[0])
    )
      return false;
    const option = setup.options.find((item) => item.id === pair[0]);
    if (!option?.values.some((value) => value.id === pair[1])) return false;
    seen.add(pair[0]);
    values.push([pair[0], pair[1]]);
  }
  return setup.variants.some((variant) => values.every(([id, value]) => variant.optionValues[id] === value));
}

export function validateVariantPhotoReferences(product: {
  views: { id: string; placements: { id: string }[] }[];
  images: { id: string }[];
  variantPhotos?: VariantPhotoSetup;
}): { path: (string | number)[]; message: string }[] {
  return (product.variantPhotos?.assignments ?? []).flatMap((assignment, index) => {
    const errors: { path: (string | number)[]; message: string }[] = [];
    const view = product.views.find((item) => item.id === assignment.viewId);
    if (!view)
      errors.push({
        path: ['variantPhotos', 'assignments', index, 'viewId'],
        message: 'Choose an existing product view.',
      });
    if (assignment.imageId && !product.images.some((item) => item.id === assignment.imageId))
      errors.push({
        path: ['variantPhotos', 'assignments', index, 'imageId'],
        message: 'Choose an image from this product.',
      });
    for (const placementId of Object.keys(assignment.placementRects ?? {})) {
      if (!view?.placements.some((item) => item.id === placementId))
        errors.push({
          path: ['variantPhotos', 'assignments', index, 'placementRects', placementId],
          message: 'Choose a placement in this view.',
        });
    }
    return errors;
  });
}

export const minimumRectSize = 0.02;

export const placementRectSchema = z
  .object({
    centerX: z.number().finite().min(0).max(1),
    centerY: z.number().finite().min(0).max(1),
    width: z.number().finite().min(minimumRectSize).max(1),
    height: z.number().finite().min(minimumRectSize).max(1),
  })
  .strict()
  .refine(
    ({ centerX, centerY, width, height }) =>
      centerX - width / 2 >= 0 && centerX + width / 2 <= 1 && centerY - height / 2 >= 0 && centerY + height / 2 <= 1,
    'The artwork area must fit inside the image.',
  );

type RectShape = z.infer<typeof placementRectSchema>;

/** Whether a movement area contains the complete maximum artwork rectangle. */
export function movementRectContainsPlacementRect(movementRect: RectShape, placementRect: RectShape): boolean {
  const movementLeft = movementRect.centerX - movementRect.width / 2;
  const movementRight = movementRect.centerX + movementRect.width / 2;
  const movementTop = movementRect.centerY - movementRect.height / 2;
  const movementBottom = movementRect.centerY + movementRect.height / 2;
  const artworkLeft = placementRect.centerX - placementRect.width / 2;
  const artworkRight = placementRect.centerX + placementRect.width / 2;
  const artworkTop = placementRect.centerY - placementRect.height / 2;
  const artworkBottom = placementRect.centerY + placementRect.height / 2;

  return (
    movementLeft <= artworkLeft &&
    movementRight >= artworkRight &&
    movementTop <= artworkTop &&
    movementBottom >= artworkBottom
  );
}

const placementSizeSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    widthPercent: z.string(),
    heightPercent: z.string().optional(),
    prices: z.record(z.string(), z.string()),
  })
  .strict();

const editorPlacementSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    rect: placementRectSchema,
    widthCm: z.string(),
    heightCm: z.string(),
    methodIds: z.array(z.string()),
    sizes: z.array(placementSizeSchema),
    logoLaterAllowed: z.boolean(),
    customPlacementAllowed: z.boolean().default(false),
    movementRect: placementRectSchema.optional(),
  })
  .strict()
  .superRefine(({ rect, movementRect, customPlacementAllowed }, context) => {
    if (customPlacementAllowed && movementRect && !movementRectContainsPlacementRect(movementRect, rect)) {
      context.addIssue({
        code: 'custom',
        path: ['movementRect'],
        message: 'movement-area-invalid',
      });
    }
  });

const editorViewSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    imageUrl: z.union([z.string().url(), z.literal('')]),
    imageWidth: z.number().int().positive().finite(),
    imageHeight: z.number().int().positive().finite(),
    placements: z.array(editorPlacementSchema),
    needsAlignmentReview: z.boolean().optional(),
    calibration: placementCalibrationSchema.optional(),
  })
  .strict();

export const editorProductImageSchema = z
  .object({
    id: z.string().min(1),
    url: z.string().url(),
    width: z.number().int().positive().finite(),
    height: z.number().int().positive().finite(),
    alt: z.string(),
  })
  .strict();

const editorMethodSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    explanation: z.string().max(2000).optional(),
    translations: z
      .record(
        z.string(),
        z.strictObject({ name: z.string().max(80).optional(), explanation: z.string().max(2000).optional() }),
      )
      .optional(),
    pricing: z.enum(['fixed', 'product']),
    amount: z.string(),
  })
  .strict();

export const placementProductSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    images: z.array(editorProductImageSchema),
    views: z.array(editorViewSchema),
    methods: z.array(editorMethodSchema),
    /** Retained production-only choices; their absence leaves ordinary selected UI unchanged. */
    productionChoices: z
      .strictObject({
        definitions: PublishedConfigSchema.shape.productionOptions,
        labels: z.strictObject({
          options: z.record(z.string(), z.string().trim().min(1).max(80)).optional(),
          values: z.record(z.string(), z.record(z.string(), z.string().trim().min(1).max(80))).optional(),
        }),
      })
      .optional(),
    variantPhotos: variantPhotoSetupSchema.optional(),
  })
  .strict()
  .superRefine((product, context) => {
    for (const issue of validateVariantPhotoReferences(product))
      context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  });

export type PlacementRect = z.infer<typeof placementRectSchema>;
export type PlacementSize = z.infer<typeof placementSizeSchema>;
export type EditorPlacement = z.infer<typeof editorPlacementSchema>;
export type EditorView = z.infer<typeof editorViewSchema>;
export type EditorMethod = z.infer<typeof editorMethodSchema>;
export type EditorProductImage = z.infer<typeof editorProductImageSchema>;
export type PlacementProduct = z.infer<typeof placementProductSchema>;

/** Decoration sizes are placement-local in the selected editor; commerce steps have stable global identities. */
export function selectedStepIdentity(placementId: string, sizeId: string): string {
  const valid = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
  if (!valid(placementId) || !valid(sizeId)) throw new Error('Unsupported decoration size identity');
  const id = `${placementId}:${sizeId}`;
  if (id.length <= 128 && !placementId.includes(':') && !sizeId.includes(':')) return id;
  // Domain IDs are ASCII. Hash the complete tuple, never truncated source IDs or array positions.
  const bytes = Uint8Array.from(JSON.stringify([placementId, sizeId]), (character) => character.charCodeAt(0));
  return `step_${Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Preserve unambiguous short rule IDs; long or delimiter-bearing methods bind the complete ASCII tuple. */
export function selectedPriceIdentity(stepId: string, methodId: string): string {
  const valid = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
  if (!valid(stepId) || !valid(methodId)) throw new Error('Unsupported decoration price identity');
  const id = `price:${stepId}:${methodId}`;
  if (id.length <= 128 && !methodId.includes(':')) return id;
  const bytes = Uint8Array.from(JSON.stringify([stepId, methodId]), (character) => character.charCodeAt(0));
  return `price_${Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Read retained publications against their actual immutable step binding. New writes always use selectedStepIdentity. */
export function readSelectedStepIdentity(
  placementId: string,
  sizeId: string,
  allowedStepIds: readonly string[],
): string | null {
  const current = selectedStepIdentity(placementId, sizeId),
    legacy = `${placementId}:${sizeId}`;
  const candidates = [...new Set([current, ...(legacy.length <= 128 ? [legacy] : [])])].filter((id) =>
    allowedStepIds.includes(id),
  );
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}
