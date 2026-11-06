/** Canonical appearance grouping and alignment; shared by authoring and publication. */
import type { EditorView, PlacementProduct, PlacementRect, VariantPhotoSetup } from './selected-product.js';

function rectInImage(rect: PlacementRect): boolean {
  return (
    rect.centerX - rect.width / 2 >= -1e-9 &&
    rect.centerX + rect.width / 2 <= 1 + 1e-9 &&
    rect.centerY - rect.height / 2 >= -1e-9 &&
    rect.centerY + rect.height / 2 <= 1 + 1e-9
  );
}

export type VariantPhotoGroup = {
  key: string;
  label: string;
  values: { optionId: string; optionName: string; valueId: string; label: string; swatch?: string }[];
  variantIds: string[];
};

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
  if (!source) throw new Error('Choose an existing product view.');
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
