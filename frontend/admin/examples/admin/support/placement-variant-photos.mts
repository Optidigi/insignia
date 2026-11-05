/** Preview-only photo assignments. Image grouping never changes commerce or production identity. */
import { z } from 'zod';
import type { EditorView, PlacementProduct, PlacementRect } from './placement-workflow-model.mts';

const variantPhotoDiagnostics = {
  'view-required': 'Choose an existing product view.',
  'group-and-view-required': 'Choose an existing product image group and view.',
  'product-image-required': 'Choose an image from this product.',
  'exclusive-image-source': 'Choose an image or the shared image.',
  'areas-outside-image': 'Choose a product image and keep its artwork areas inside the image.',
  'placement-required': 'Choose a placement in this view.',
  'movement-outside-image': 'Keep the movement area inside the product image.',
  'unique-options-required': 'Choose each product option at most once.',
} as const;
export type VariantPhotoErrorReason = keyof typeof variantPhotoDiagnostics;
export class VariantPhotoError extends Error {
  readonly reason: VariantPhotoErrorReason;
  constructor(reason: VariantPhotoErrorReason) {
    super(variantPhotoDiagnostics[reason]);
    this.name = 'VariantPhotoError';
    this.reason = reason;
  }
}

const idSchema = z.string().min(1).max(1000);
const photoRectSchema = z
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
export type VariantPhotoGroup = {
  key: string;
  label: string;
  values: { optionId: string; optionName: string; valueId: string; label: string; swatch?: string }[];
  variantIds: string[];
};

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

function groupsForSetup(setup: VariantPhotoSetup): VariantPhotoGroup[] {
  if (setup.groupingOptionIds.length === 0) return [];
  const groups = new Map<string, VariantPhotoGroup>();
  for (const variant of setup.variants) {
    const values = setup.groupingOptionIds.flatMap((optionId) => {
      const option = setup.options.find((item) => item.id === optionId);
      const value = option?.values.find((item) => item.id === variant.optionValues[optionId]);
      return option && value
        ? [
            {
              optionId,
              optionName: option.name,
              valueId: value.id,
              label: value.label,
              ...(value.swatch ? { swatch: value.swatch } : {}),
            },
          ]
        : [];
    });
    if (values.length !== setup.groupingOptionIds.length) continue;
    const key = JSON.stringify(values.map((value) => [value.optionId, value.valueId]));
    const group = groups.get(key);
    if (group) group.variantIds.push(variant.id);
    else
      groups.set(key, { key, label: values.map((value) => value.label).join(' / '), values, variantIds: [variant.id] });
  }
  return [...groups.values()];
}

export function getVariantPhotoGroups(product: PlacementProduct): VariantPhotoGroup[] {
  return product.variantPhotos ? groupsForSetup(product.variantPhotos) : [];
}

/** Match one actual variant's values together, including options hidden by photo grouping. */
export function filterVariantPhotoGroups(product: PlacementProduct, query: string, locale = 'en'): VariantPhotoGroup[] {
  const groups = getVariantPhotoGroups(product);
  const words = query.trim().toLocaleLowerCase(locale).split(/\s+/).filter(Boolean);
  const setup = product.variantPhotos;
  if (!words.length || !setup) return groups;
  const matches = (text: string) => words.every((word) => text.toLocaleLowerCase(locale).includes(word));
  const matchingIds = new Set(
    setup.variants
      .filter((variant) =>
        matches(
          [
            variant.id,
            variant.label ?? '',
            ...setup.options.map((option) => {
              const value = option.values.find((item) => item.id === variant.optionValues[option.id]);
              return value ? `${option.name} ${value.label}` : '';
            }),
          ].join(' '),
        ),
      )
      .map((variant) => variant.id),
  );
  return groups.filter((group) => matches(group.label) || group.variantIds.some((id) => matchingIds.has(id)));
}

/** Keep the selected appearance when grouping changes, falling back to its first variant. */
export function getRegroupedVariantPhotoGroupKey(
  activeGroupKey: string | null,
  currentGroups: readonly VariantPhotoGroup[],
  nextGroups: readonly VariantPhotoGroup[],
): string | null {
  if (!nextGroups.length || activeGroupKey === null) return null;
  if (nextGroups.some((group) => group.key === activeGroupKey)) return activeGroupKey;

  const firstVariantId = currentGroups.find((group) => group.key === activeGroupKey)?.variantIds[0];
  return (
    nextGroups.find((group) => firstVariantId && group.variantIds.includes(firstVariantId))?.key ??
    nextGroups[0]?.key ??
    null
  );
}

export function validateVariantPhotoReferences(
  product: Pick<PlacementProduct, 'views' | 'images' | 'variantPhotos'>,
): { path: (string | number)[]; message: string }[] {
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

export type ResolvedVariantPhotoView = {
  status: 'ready' | 'missing';
  view: EditorView;
  imageSource: 'shared' | 'assigned' | 'missing';
  group?: VariantPhotoGroup;
  needsAlignmentReview: boolean;
  alignmentValid: boolean;
};

function transformedRect(rect: PlacementRect, from: PlacementRect, to: PlacementRect): PlacementRect {
  return {
    centerX: to.centerX + ((rect.centerX - from.centerX) * to.width) / from.width,
    centerY: to.centerY + ((rect.centerY - from.centerY) * to.height) / from.height,
    width: (rect.width * to.width) / from.width,
    height: (rect.height * to.height) / from.height,
  };
}

export function resolveVariantPhotoView(
  product: PlacementProduct,
  viewId: string,
  groupKey?: string,
): ResolvedVariantPhotoView {
  const source = product.views.find((view) => view.id === viewId);
  if (!source) throw new VariantPhotoError('view-required');
  if (!groupKey || !product.variantPhotos || product.variantPhotos.groupingOptionIds.length === 0) {
    return {
      status: source.imageUrl ? 'ready' : 'missing',
      view: source,
      imageSource: source.imageUrl ? 'shared' : 'missing',
      needsAlignmentReview: !!source.needsAlignmentReview,
      alignmentValid: true,
    };
  }
  const group = getVariantPhotoGroups(product).find((item) => item.key === groupKey);
  const assignment = product.variantPhotos.assignments.find(
    (item) => item.groupKey === groupKey && item.viewId === viewId,
  );
  const image = assignment?.imageId ? product.images.find((item) => item.id === assignment.imageId) : undefined;
  const shared = !!group && assignment?.useShared === true;
  const imageUrl = image?.url ?? (shared ? source.imageUrl : '');
  let alignmentValid = true;
  const view: EditorView = {
    ...source,
    imageUrl,
    imageWidth: image?.width ?? source.imageWidth,
    imageHeight: image?.height ?? source.imageHeight,
    placements: source.placements.map((placement) => {
      const rect = assignment?.placementRects?.[placement.id];
      if (!rect) return placement;
      const movementRect = placement.movementRect
        ? transformedRect(placement.movementRect, placement.rect, rect)
        : undefined;
      if (movementRect && !rectInImage(movementRect)) alignmentValid = false;
      return { ...placement, rect, ...(movementRect ? { movementRect } : {}) };
    }),
  };
  if (imageUrl !== source.imageUrl) delete view.calibration;
  return {
    status: group && imageUrl ? 'ready' : 'missing',
    view,
    imageSource: image ? 'assigned' : shared && imageUrl ? 'shared' : 'missing',
    ...(group ? { group } : {}),
    needsAlignmentReview:
      !!assignment?.needsAlignmentReview || (shared && !!source.needsAlignmentReview) || !alignmentValid,
    alignmentValid,
  };
}

function updateAssignment(
  product: PlacementProduct,
  viewId: string,
  groupKey: string,
  change: (current: VariantPhotoAssignment) => VariantPhotoAssignment,
): PlacementProduct {
  const setup = product.variantPhotos;
  if (
    !setup ||
    !product.views.some((view) => view.id === viewId) ||
    !getVariantPhotoGroups(product).some((group) => group.key === groupKey)
  )
    throw new VariantPhotoError('group-and-view-required');
  const current = setup.assignments.find((item) => item.groupKey === groupKey && item.viewId === viewId) ?? {
    groupKey,
    viewId,
  };
  const assignment = change(current);
  return {
    ...product,
    variantPhotos: {
      ...setup,
      assignments: [
        ...setup.assignments.filter((item) => item.groupKey !== groupKey || item.viewId !== viewId),
        assignment,
      ],
    },
  };
}

export function setVariantPhotoImage(
  product: PlacementProduct,
  viewId: string,
  groupKeys: readonly string[],
  imageId: string | null,
  options: { useShared?: boolean } = {},
): PlacementProduct {
  if (imageId && !product.images.some((image) => image.id === imageId))
    throw new VariantPhotoError('product-image-required');
  if (imageId && options.useShared) throw new VariantPhotoError('exclusive-image-source');
  return [...new Set(groupKeys)].reduce(
    (current, groupKey) =>
      updateAssignment(current, viewId, groupKey, (assignment) => {
        const { imageId: previousImage, useShared: previousShared, ...rest } = assignment;
        const unchanged = previousImage === (imageId ?? undefined) && !!previousShared === !!options.useShared;
        return {
          ...rest,
          ...(imageId ? { imageId } : {}),
          ...(options.useShared ? { useShared: true } : {}),
          needsAlignmentReview: unchanged ? !!assignment.needsAlignmentReview : !!imageId,
        };
      }),
    product,
  );
}

export function confirmVariantPhotoAlignment(
  product: PlacementProduct,
  viewId: string,
  groupKey: string,
): PlacementProduct {
  const resolved = resolveVariantPhotoView(product, viewId, groupKey);
  if (resolved.status !== 'ready' || !resolved.alignmentValid) throw new VariantPhotoError('areas-outside-image');
  return updateAssignment(product, viewId, groupKey, (assignment) => ({ ...assignment, needsAlignmentReview: false }));
}

export function setVariantPhotoPlacementRect(
  product: PlacementProduct,
  viewId: string,
  groupKey: string,
  placementId: string,
  rect: PlacementRect,
): PlacementProduct {
  const view = product.views.find((item) => item.id === viewId);
  if (!view?.placements.some((placement) => placement.id === placementId))
    throw new VariantPhotoError('placement-required');
  const parsed = photoRectSchema.parse(rect);
  const next = updateAssignment(product, viewId, groupKey, (assignment) => ({
    ...assignment,
    placementRects: { ...assignment.placementRects, [placementId]: parsed },
  }));
  if (!resolveVariantPhotoView(next, viewId, groupKey).alignmentValid)
    throw new VariantPhotoError('movement-outside-image');
  return next;
}

export function resetVariantPhotoPlacementRect(
  product: PlacementProduct,
  viewId: string,
  groupKey: string,
  placementId: string,
): PlacementProduct {
  return updateAssignment(product, viewId, groupKey, (assignment) => {
    const placementRects = { ...assignment.placementRects };
    delete placementRects[placementId];
    return { ...assignment, placementRects };
  });
}

export function setVariantPhotoGrouping(product: PlacementProduct, optionIds: readonly string[]): PlacementProduct {
  const setup = product.variantPhotos;
  if (!setup) return product;
  if (
    new Set(optionIds).size !== optionIds.length ||
    optionIds.some((id) => !setup.options.some((option) => option.id === id))
  )
    throw new VariantPhotoError('unique-options-required');
  if (JSON.stringify(optionIds) === JSON.stringify(setup.groupingOptionIds)) return product;
  const oldGroups = getVariantPhotoGroups(product);
  const changed: PlacementProduct = {
    ...product,
    variantPhotos: { ...setup, groupingOptionIds: [...optionIds], assignments: [] },
  };
  const newGroups = getVariantPhotoGroups(changed);
  const newKeys = new Set(newGroups.map((group) => group.key));
  const assignments: VariantPhotoAssignment[] = setup.assignments.filter(
    (assignment) => !newKeys.has(assignment.groupKey),
  );
  for (const group of newGroups) {
    const sources = oldGroups.filter((old) => old.variantIds.some((id) => group.variantIds.includes(id)));
    for (const view of product.views) {
      if (!oldGroups.length) {
        const cached = setup.assignments.find((item) => item.groupKey === group.key && item.viewId === view.id);
        if (cached) assignments.push(cached);
        continue;
      }
      const matches = sources.map((source) =>
        setup.assignments.find((item) => item.groupKey === source.key && item.viewId === view.id),
      );
      const first = matches[0];
      if (
        !first ||
        matches.some(
          (match) =>
            !match ||
            JSON.stringify({
              imageId: match.imageId,
              useShared: match.useShared,
              placementRects: match.placementRects,
            }) !==
              JSON.stringify({
                imageId: first.imageId,
                useShared: first.useShared,
                placementRects: first.placementRects,
              }),
        )
      )
        continue;
      assignments.push({ ...first, groupKey: group.key, needsAlignmentReview: true });
    }
  }
  return { ...changed, variantPhotos: { ...setup, groupingOptionIds: [...optionIds], assignments } };
}

export type VariantPhotoCoverageIssue = {
  kind: 'missing-image' | 'alignment-review';
  viewId: string;
  groupKey: string;
  groupLabel: string;
  message: string;
};

export function variantPhotoCoverageIssues(product: PlacementProduct): VariantPhotoCoverageIssue[] {
  return getVariantPhotoGroups(product).flatMap((group) =>
    product.views.flatMap<VariantPhotoCoverageIssue>((view) => {
      const resolved = resolveVariantPhotoView(product, view.id, group.key);
      return resolved.status === 'missing'
        ? [
            {
              kind: 'missing-image' as const,
              viewId: view.id,
              groupKey: group.key,
              groupLabel: group.label,
              message: `Add an image for ${group.label} · ${view.name}.`,
            },
          ]
        : resolved.needsAlignmentReview
          ? [
              {
                kind: 'alignment-review' as const,
                viewId: view.id,
                groupKey: group.key,
                groupLabel: group.label,
                message: `Check artwork alignment for ${group.label} · ${view.name}.`,
              },
            ]
          : [];
    }),
  );
}

export type VariantPhotoGroupingImpact = {
  missingImageAssignments: number;
  alignmentReviewAssignments: number;
};

/** Count existing photo assignments affected by changing the product-wide appearance grouping. */
export function getVariantPhotoGroupingImpact(
  product: PlacementProduct,
  optionIds: readonly string[],
): VariantPhotoGroupingImpact {
  const unchanged = { missingImageAssignments: 0, alignmentReviewAssignments: 0 };
  const regrouped = setVariantPhotoGrouping(product, optionIds);
  if (regrouped === product) return unchanged;

  const currentGroups = getVariantPhotoGroups(product);
  const nextGroups = getVariantPhotoGroups(regrouped);
  let missingImageAssignments = 0;
  let alignmentReviewAssignments = 0;

  for (const nextGroup of nextGroups) {
    const sourceGroups = currentGroups.filter((group) =>
      group.variantIds.some((variantId) => nextGroup.variantIds.includes(variantId)),
    );
    for (const view of product.views) {
      const resolved = resolveVariantPhotoView(regrouped, view.id, nextGroup.key);
      if (resolved.status === 'ready' && resolved.needsAlignmentReview) {
        alignmentReviewAssignments += 1;
      } else if (
        resolved.status === 'missing' &&
        sourceGroups.some((group) => resolveVariantPhotoView(product, view.id, group.key).status === 'ready')
      ) {
        missingImageAssignments += 1;
      }
    }
  }

  return { missingImageAssignments, alignmentReviewAssignments };
}

/** Call at the editor mutation boundary after removing views, placements or media. */
export function pruneVariantPhotoAssignments(product: PlacementProduct): PlacementProduct {
  if (!product.variantPhotos) return product;
  const assignments = product.variantPhotos.assignments.flatMap((assignment) => {
    const view = product.views.find((item) => item.id === assignment.viewId);
    if (!view) return [];
    const placementRects = Object.fromEntries(
      Object.entries(assignment.placementRects ?? {}).filter(([id]) => view.placements.some((item) => item.id === id)),
    );
    const imageStillExists = !assignment.imageId || product.images.some((image) => image.id === assignment.imageId);
    if (imageStillExists) return [{ ...assignment, ...(assignment.placementRects ? { placementRects } : {}) }];
    const { imageId: removedImage, ...rest } = assignment;
    return [{ ...rest, placementRects, needsAlignmentReview: true }];
  });
  return { ...product, variantPhotos: { ...product.variantPhotos, assignments } };
}
