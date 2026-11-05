/** Preview-only merchant placement schemas and editing helpers. Safe to import in the browser bundle. */
import { z } from 'zod';
import { parsePrice } from './method-workflow-prices.mts';
import { placementCalibrationSchema } from './placement-calibration.mts';
import { validateVariantPhotoReferences, variantPhotoSetupSchema } from './placement-variant-photos.mts';

const minimumRectSize = 0.02;

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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function clampPlacementRect(rect: PlacementRect): PlacementRect {
  const width = clamp(finiteOr(rect.width, minimumRectSize), minimumRectSize, 1);
  const height = clamp(finiteOr(rect.height, minimumRectSize), minimumRectSize, 1);
  return {
    centerX: clamp(finiteOr(rect.centerX, 0.5), width / 2, 1 - width / 2),
    centerY: clamp(finiteOr(rect.centerY, 0.5), height / 2, 1 - height / 2),
    width,
    height,
  };
}

export function addPlacement(view: EditorView, name: string, id: string): EditorView {
  return {
    ...view,
    placements: [
      ...view.placements,
      {
        id,
        name,
        rect: { centerX: 0.5, centerY: 0.4, width: 0.24, height: 0.28 },
        widthCm: '',
        heightCm: '',
        methodIds: [],
        sizes: [{ id: `${id}:standard`, name: 'Standard', widthPercent: '100', prices: {} }],
        logoLaterAllowed: false,
        customPlacementAllowed: false,
      },
    ],
  };
}

/** Names remain editable; generated defaults never collide after removal. */
export function nextItemName(base: string, names: readonly string[]): string {
  const existing = new Set(names.map((name) => name.trim().toLowerCase()));
  let number = 1;
  while (existing.has(`${base} ${number}`.toLowerCase())) number += 1;
  return `${base} ${number}`;
}

export function duplicatePlacement(view: EditorView, sourceId: string, id: string): EditorView {
  const index = view.placements.findIndex((area) => area.id === sourceId);
  const source = view.placements[index];
  if (!source || !id || view.placements.some((area) => area.id === id))
    throw new Error('Choose a placement and a new ID.');
  const base = `${source.name.slice(0, 65)} (copy)`;
  const names = new Set(view.placements.map((area) => area.name.trim().toLowerCase()));
  let name = base;
  let number = 2;
  while (names.has(name.toLowerCase())) name = `${base} ${number++}`;
  const copy: EditorPlacement = {
    ...source,
    id,
    name,
    rect: { ...source.rect },
    ...(source.movementRect ? { movementRect: { ...source.movementRect } } : {}),
    methodIds: [...source.methodIds],
    sizes: source.sizes.map((size, index) => ({ ...size, id: `${id}:size:${index}`, prices: { ...size.prices } })),
  };
  const placements = [...view.placements];
  placements.splice(index + 1, 0, copy);
  return { ...view, placements };
}

/** Duplicate within the same photo view, including its existing group alignment exceptions. */
export function duplicateProductPlacement(
  product: PlacementProduct,
  viewId: string,
  sourceId: string,
  id: string,
): PlacementProduct {
  const sourceView = product.views.find((view) => view.id === viewId);
  if (!sourceView) throw new Error('Choose an existing view.');
  const usedIds = productViewAreaIds(product);
  requireNewId(id, usedIds, 'placement');
  const updated = duplicatePlacement(sourceView, sourceId, id);
  const copy = updated.placements.find((placement) => placement.id === id);
  if (!copy) throw new Error('Choose an existing placement.');
  for (const size of copy.sizes) requireNewId(size.id, usedIds, 'size');
  const variantPhotos = product.variantPhotos
    ? {
        ...product.variantPhotos,
        assignments: product.variantPhotos.assignments.map((assignment) => {
          const rect = assignment.viewId === viewId ? assignment.placementRects?.[sourceId] : undefined;
          return rect
            ? { ...assignment, placementRects: { ...assignment.placementRects, [id]: { ...rect } } }
            : assignment;
        }),
      }
    : undefined;
  return {
    ...product,
    views: product.views.map((view) => (view.id === viewId ? updated : view)),
    ...(variantPhotos ? { variantPhotos } : {}),
  };
}

function productViewAreaIds(product: PlacementProduct): Set<string> {
  const ids = new Set<string>();
  for (const view of product.views) {
    ids.add(view.id);
    for (const placement of view.placements) {
      ids.add(placement.id);
      for (const size of placement.sizes) ids.add(size.id);
    }
  }
  return ids;
}

function requireNewId(id: string, usedIds: Set<string>, label: string): void {
  if (!nonblank(id)) throw new Error(`Enter a ${label} ID.`);
  if (usedIds.has(id)) throw new Error(`Choose a unique ${label} ID.`);
  usedIds.add(id);
}

function boundedCopyName(name: string, suffix: string, maxLength: number): string {
  const stem = (name.trim() || 'Placement').slice(0, Math.max(1, maxLength - suffix.length)).trimEnd();
  return `${stem}${suffix}`.slice(0, maxLength);
}

function uniqueCopyName(
  sourceName: string,
  existingNames: readonly string[],
  maxLength: number,
  alwaysCopy: boolean,
  fallback: string,
): string {
  const existing = new Set(existingNames.map((name) => name.trim().toLowerCase()));
  const trimmed = sourceName.trim() || fallback;
  const plain = trimmed.slice(0, maxLength).trimEnd();
  if (!alwaysCopy && !existing.has(plain.toLowerCase())) return plain;

  let suffix = ' (copy)';
  let candidate = boundedCopyName(trimmed, suffix, maxLength);
  let counter = 2;
  while (existing.has(candidate.toLowerCase())) {
    suffix = ` (copy ${counter++})`;
    candidate = boundedCopyName(trimmed, suffix, maxLength);
  }
  return candidate;
}

function copyPlacementRecord(
  source: EditorPlacement,
  id: string,
  sizesId: (sizeIndex: number) => string,
  name = source.name,
): EditorPlacement {
  return {
    ...source,
    id,
    name,
    rect: clampPlacementRect({ ...source.rect }),
    ...(source.movementRect ? { movementRect: { ...source.movementRect } } : {}),
    methodIds: [...source.methodIds],
    sizes: source.sizes.map((size, index) => ({
      ...size,
      id: sizesId(index + 1),
      prices: { ...size.prices },
    })),
  };
}

/** Snapshot a view after its source with independent placement and size records. */
export function cloneProductView(product: PlacementProduct, sourceViewId: string, newViewId: string): PlacementProduct {
  const sourceIndex = product.views.findIndex((view) => view.id === sourceViewId);
  const source = product.views[sourceIndex];
  if (!source) throw new Error('Choose an existing view to copy.');

  const usedIds = productViewAreaIds(product);
  requireNewId(newViewId, usedIds, 'view');
  const name = uniqueCopyName(
    source.name,
    product.views.map((view) => view.name),
    60,
    true,
    'View',
  );
  const placementIds = new Map<string, string>();
  const placements = source.placements.map((placement, placementIndex) => {
    const placementId = `${newViewId}:placement:${placementIndex + 1}`;
    requireNewId(placementId, usedIds, 'placement');
    placementIds.set(placement.id, placementId);
    return copyPlacementRecord(placement, placementId, (sizeIndex) => {
      const sizeId = `${placementId}:size:${sizeIndex}`;
      requireNewId(sizeId, usedIds, 'size');
      return sizeId;
    });
  });
  const cloned: EditorView = { ...source, id: newViewId, name, placements };
  const views = [...product.views];
  views.splice(sourceIndex + 1, 0, cloned);
  const variantPhotos = product.variantPhotos
    ? {
        ...product.variantPhotos,
        assignments: [
          ...product.variantPhotos.assignments,
          ...product.variantPhotos.assignments
            .filter((assignment) => assignment.viewId === sourceViewId)
            .map((assignment) => ({
              ...assignment,
              viewId: newViewId,
              ...(assignment.placementRects
                ? {
                    placementRects: Object.fromEntries(
                      Object.entries(assignment.placementRects).flatMap(([placementId, rect]) => {
                        const clonedPlacementId = placementIds.get(placementId);
                        return clonedPlacementId ? [[clonedPlacementId, rect] as const] : [];
                      }),
                    ),
                  }
                : {}),
            })),
        ],
      }
    : undefined;
  return { ...product, views, ...(variantPhotos ? { variantPhotos } : {}) };
}

/** Copy a placement into a view with independent settings and collision-free IDs. */
export function copyPlacementToView(
  product: PlacementProduct,
  sourceViewId: string,
  placementId: string,
  targetViewId: string,
  newPlacementId: string,
): PlacementProduct {
  const sourceView = product.views.find((view) => view.id === sourceViewId);
  const source = sourceView?.placements.find((placement) => placement.id === placementId);
  if (!source) throw new Error('Choose an existing placement to copy.');
  const targetIndex = product.views.findIndex((view) => view.id === targetViewId);
  const target = product.views[targetIndex];
  if (!target) throw new Error('Choose an existing target view.');

  const usedIds = productViewAreaIds(product);
  requireNewId(newPlacementId, usedIds, 'placement');
  const name = uniqueCopyName(
    source.name,
    target.placements.map((placement) => placement.name),
    80,
    false,
    'Placement',
  );
  const copy = copyPlacementRecord(
    source,
    newPlacementId,
    (sizeIndex) => {
      const sizeId = `${newPlacementId}:size:${sizeIndex}`;
      requireNewId(sizeId, usedIds, 'size');
      return sizeId;
    },
    name,
  );
  const views = [...product.views];
  views[targetIndex] = { ...target, placements: [...target.placements, copy] };
  return { ...product, views };
}

export function moveEditorItem<T extends { id: string }>(items: T[], id: string, direction: -1 | 1): T[] {
  const index = items.findIndex((item) => item.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const result = [...items];
  const [item] = result.splice(index, 1);
  if (item) result.splice(target, 0, item);
  return result;
}

/** Move an item before or after a stable target ID in the same ordered list. */
export function moveEditorItemTo<T extends { id: string }>(
  items: T[],
  id: string,
  targetId: string,
  position: 'before' | 'after',
): T[] {
  if (id === targetId) return items;
  if (items.filter((item) => item.id === id).length !== 1 || items.filter((item) => item.id === targetId).length !== 1)
    return items;

  const sourceIndex = items.findIndex((item) => item.id === id);
  const result = [...items];
  const [item] = result.splice(sourceIndex, 1);
  if (!item) return items;
  const targetIndex = result.findIndex((entry) => entry.id === targetId);
  if (targetIndex === -1) return items;
  result.splice(targetIndex + (position === 'after' ? 1 : 0), 0, item);
  return result.every((entry, index) => entry === items[index]) ? items : result;
}

export type PlacementSetupIssue =
  | 'name-required'
  | 'method-required'
  | 'size-required'
  | 'price-required'
  | 'movement-area-required'
  | 'movement-area-invalid';

/** Placement readiness for the outline. A blank price excludes only that size. */
export function placementSetupIssue(product: PlacementProduct, area: EditorPlacement): PlacementSetupIssue | null {
  if (!area.name.trim()) return 'name-required';
  if (!area.methodIds.length) return 'method-required';
  if (!area.sizes.length) return 'size-required';
  const available = product.methods.some(
    (method) =>
      area.methodIds.includes(method.id) &&
      (method.pricing === 'fixed'
        ? parsePrice(method.amount).kind === 'valid'
        : area.sizes.some((size) => parsePrice(size.prices[method.id] ?? '').kind === 'valid')),
  );
  if (!available) return 'price-required';
  if (area.customPlacementAllowed) {
    if (!area.movementRect) return 'movement-area-required';
    if (!movementRectContainsPlacementRect(area.movementRect, area.rect)) return 'movement-area-invalid';
  }
  return null;
}

export function addProductView(product: PlacementProduct, imageId: string, name: string, id: string): PlacementProduct {
  const image = product.images.find((candidate) => candidate.id === imageId);
  if (!image) throw new Error('Choose an image from the product image library.');
  if (!nonblank(name)) throw new Error('view-name-required');
  if (!nonblank(id)) throw new Error('Enter a view ID.');
  if (product.views.some((view) => view.id === id)) throw new Error('Choose a unique view ID.');

  return {
    ...product,
    views: [
      ...product.views,
      {
        id,
        name: name.trim(),
        imageUrl: image.url,
        imageWidth: image.width,
        imageHeight: image.height,
        placements: [],
      },
    ],
  };
}

export function defaultViewName(product: PlacementProduct): string {
  const existingNames = new Set(product.views.map((view) => view.name.trim().toLowerCase()));
  let number = product.views.length + 1;
  while (existingNames.has(`view ${number}`)) number += 1;
  return `View ${number}`;
}

export function addViewsFromImages(
  product: PlacementProduct,
  selections: readonly { imageId: string; id: string }[],
): PlacementProduct {
  return selections.reduce(
    (currentProduct, { imageId, id }) => addProductView(currentProduct, imageId, defaultViewName(currentProduct), id),
    product,
  );
}

export type PlacementValidationError =
  | 'product-name-required'
  | 'method-name-required'
  | 'method-ids-not-unique'
  | 'fixed-price-invalid'
  | 'view-required'
  | 'view-name-required'
  | 'placement-required'
  | 'placement-name-required'
  | 'artwork-area-invalid'
  | 'movement-area-invalid'
  | 'method-required'
  | 'method-unavailable'
  | 'size-required'
  | 'physical-width-invalid'
  | 'physical-height-invalid'
  | 'physical-dimensions-required'
  | 'size-name-required'
  | 'size-factor-invalid'
  | 'size-unavailable'
  | 'price-invalid';

function addError(
  errors: Record<string, PlacementValidationError>,
  path: string,
  reason: PlacementValidationError,
): void {
  if (errors[path] === undefined) errors[path] = reason;
}

function nonblank(value: string): boolean {
  return value.trim().length > 0;
}

function positiveDecimal(value: string): boolean {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.trim())) return false;
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

export function validatePlacementProduct(product: PlacementProduct): Record<string, PlacementValidationError> {
  const errors: Record<string, PlacementValidationError> = {};
  if (!nonblank(product.title)) addError(errors, 'title', 'product-name-required');

  const methodsById = new Map<string, EditorMethod>();
  for (const method of product.methods) {
    if (!nonblank(method.name)) addError(errors, `methods.${method.id}.name`, 'method-name-required');
    if (methodsById.has(method.id)) addError(errors, 'methods', 'method-ids-not-unique');
    methodsById.set(method.id, method);
    if (method.pricing === 'fixed' && parsePrice(method.amount).kind === 'invalid')
      addError(errors, `methods.${method.id}.amount`, 'fixed-price-invalid');
  }

  if (product.views.length === 0) addError(errors, 'views', 'view-required');
  for (const view of product.views) {
    if (!nonblank(view.name)) addError(errors, `views.${view.id}.name`, 'view-name-required');
    if (view.placements.length === 0) addError(errors, `views.${view.id}.placements`, 'placement-required');
    for (const placement of view.placements) {
      const placementPath = `views.${view.id}.placements.${placement.id}`;
      if (!nonblank(placement.name)) addError(errors, `${placementPath}.name`, 'placement-name-required');
      if (!placementRectSchema.safeParse(placement.rect).success)
        addError(errors, `${placementPath}.rect`, 'artwork-area-invalid');
      if (
        placement.customPlacementAllowed &&
        placement.movementRect &&
        !movementRectContainsPlacementRect(placement.movementRect, placement.rect)
      )
        addError(errors, `${placementPath}.movementRect`, 'movement-area-invalid');
      if (placement.methodIds.length === 0) addError(errors, `${placementPath}.methods`, 'method-required');
      for (const methodId of placement.methodIds) {
        if (!methodsById.has(methodId)) addError(errors, `${placementPath}.methods`, 'method-unavailable');
      }
      if (placement.sizes.length === 0) addError(errors, `${placementPath}.sizes`, 'size-required');

      const widthEntered = placement.widthCm.trim().length > 0;
      const heightEntered = placement.heightCm.trim().length > 0;
      if (widthEntered && !positiveDecimal(placement.widthCm))
        addError(errors, `${placementPath}.widthCm`, 'physical-width-invalid');
      if (heightEntered && !positiveDecimal(placement.heightCm))
        addError(errors, `${placementPath}.heightCm`, 'physical-height-invalid');
      if (widthEntered !== heightEntered) {
        if (!widthEntered) addError(errors, `${placementPath}.widthCm`, 'physical-dimensions-required');
        if (!heightEntered) addError(errors, `${placementPath}.heightCm`, 'physical-dimensions-required');
      }

      for (const size of placement.sizes) {
        const sizePath = `${placementPath}.sizes.${size.id}`;
        if (!nonblank(size.name)) addError(errors, `${sizePath}.name`, 'size-name-required');
        const widthPercent = Number(size.widthPercent);
        if (
          !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(size.widthPercent.trim()) ||
          !Number.isFinite(widthPercent) ||
          widthPercent <= 0 ||
          widthPercent > 100
        )
          addError(errors, `${sizePath}.widthPercent`, 'size-factor-invalid');

        for (const methodId of placement.methodIds) {
          const method = methodsById.get(methodId);
          if (method?.pricing !== 'product') continue;
          const price = size.prices[methodId];
          const pricePath = `${sizePath}.prices.${methodId}`;
          if (price === undefined || price.trim() === '') {
            addError(errors, `${pricePath}.unavailable`, 'size-unavailable');
          } else if (parsePrice(price).kind === 'invalid') {
            addError(errors, pricePath, 'price-invalid');
          }
        }
      }
    }
  }

  return errors;
}
