/** Shared appearance grouping and alignment. Stable variant IDs retain garment identity; canonical geometry determines production placement. */
import {
  getVariantPhotoGroups,
  photoRectSchema,
  resolveVariantPhotoView as resolveSharedVariantPhotoView,
  type VariantPhotoAssignment,
  type VariantPhotoGroup,
} from '@insignia/contracts';

export {
  type VariantPhotoAssignment,
  type VariantPhotoSetup,
  validateVariantPhotoReferences,
  variantPhotoSetupSchema,
} from '@insignia/contracts';

import type { PlacementProduct, PlacementRect } from './placement-workflow-model.mts';

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

export { getVariantPhotoGroups, type VariantPhotoGroup } from '@insignia/contracts';
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

export type { ResolvedVariantPhotoView } from '@insignia/contracts';
export function resolveVariantPhotoView(product: PlacementProduct, viewId: string, groupKey?: string) {
  if (!product.views.some((view) => view.id === viewId)) throw new VariantPhotoError('view-required');
  return resolveSharedVariantPhotoView(product, viewId, groupKey);
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
