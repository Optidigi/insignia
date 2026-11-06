import {
  type EditorProductImage,
  type EditorView,
  type VariantPhotoSetup,
  variantPhotoSetupSchema,
} from '@insignia/contracts';
import { type GeometryV1, validateGeometry } from '@insignia/visualizer/geometry';
import type { CatalogProduct } from '../shared/admin-view.ts';

export type LegacyVariantPhotoErrorCode =
  | 'catalog-incomplete'
  | 'variant-reference'
  | 'projection-mismatch'
  | 'unrepresentable-geometry'
  | 'capacity-exceeded';
export class LegacyVariantPhotoError extends Error {
  readonly code: LegacyVariantPhotoErrorCode;
  constructor(code: LegacyVariantPhotoErrorCode, message: string) {
    super(message);
    this.name = 'LegacyVariantPhotoError';
    this.code = code;
  }
}
const fail = (code: LegacyVariantPhotoErrorCode, message: string): never => {
  throw new LegacyVariantPhotoError(code, message);
};

/** Keep exact stored photo/rectangle instructions; unproven delivery identity requires merchant review. */
export function legacyVariantPhotos(input: {
  geometry: GeometryV1;
  catalog: CatalogProduct;
  views: readonly EditorView[];
  images: readonly EditorProductImage[];
}): VariantPhotoSetup {
  const { geometry, catalog, views, images } = input;
  try {
    validateGeometry(geometry);
  } catch {
    fail('unrepresentable-geometry', 'Existing geometry must be reviewed before adopting the selected editor.');
  }
  const actualOptions = catalog.options;
  if (
    catalog.variantsTruncated !== false ||
    catalog.imagesTruncated !== false ||
    !actualOptions?.length ||
    !catalog.variants.length
  )
    return fail(
      'catalog-incomplete',
      'Complete current Shopify options, variants and media are required to retain existing appearances.',
    );
  if (
    new Set(actualOptions.map((option) => option.name)).size !== actualOptions.length ||
    actualOptions.some((option) => !/^gid:\/\/shopify\/ProductOption\/[1-9][0-9]{0,19}$/.test(option.id))
  )
    fail('catalog-incomplete', 'Actual unique Shopify option identities are required.');
  if (catalog.images && new Set(catalog.images.map((image) => image.id)).size !== catalog.images.length)
    fail('catalog-incomplete', 'Current Shopify photo identities are ambiguous.');
  if (
    new Set(images.map((image) => image.id)).size !== images.length ||
    views.length !== geometry.views.length ||
    new Set(views.map((view) => view.id)).size !== views.length
  )
    fail('projection-mismatch', 'The projected views and photos must retain the original geometry identities.');
  const options = actualOptions.map((option) => ({
    id: option.id,
    name: option.name,
    values: option.values.map((value) => ({ id: value, label: value })),
  }));
  const variants = catalog.variants.map((variant) => {
    if (
      !/^gid:\/\/shopify\/ProductVariant\/[1-9][0-9]{0,19}$/.test(variant.id) ||
      !Array.isArray(variant.selectedOptions) ||
      variant.selectedOptions.length !== options.length ||
      new Set(variant.selectedOptions.map((choice) => choice.name)).size !== options.length
    )
      return fail('catalog-incomplete', 'Every actual variant must have complete Shopify option values.');
    const optionValues = Object.fromEntries(
      options.map((option) => {
        const value = variant.selectedOptions.find((choice) => choice.name === option.name)?.value;
        if (value === undefined || !option.values.some((candidate) => candidate.id === value))
          return fail('catalog-incomplete', 'Variant option values no longer match the current Shopify axes.');
        return [option.id, value];
      }),
    );
    return { id: variant.id, label: variant.title, optionValues };
  });
  const initial = variantPhotoSetupSchema.safeParse({
    options,
    variants,
    groupingOptionIds: options.map((option) => option.id),
    assignments: [],
  });
  if (!initial.success)
    return fail(
      initial.error.issues.some((issue) => issue.code === 'too_big') ? 'capacity-exceeded' : 'catalog-incomplete',
      'Current Shopify variant facts cannot be represented completely.',
    );
  const setup = initial.data;
  const numbers = new Set(setup.variants.map((variant) => variant.id.slice('gid://shopify/ProductVariant/'.length)));
  function selector(id: string) {
    const number = /^variant_([1-9][0-9]{0,19})$/.exec(id)?.[1] ?? /^([1-9][0-9]{0,19})$/.exec(id)?.[1];
    if (!number || !numbers.has(number))
      return fail(
        'variant-reference',
        'An existing appearance references a variant that is not in the complete current Shopify catalogue.',
      );
    return number;
  }
  function indexed<T extends { variantId: string }>(values: readonly T[]) {
    const result = new Map<string, T>();
    for (const value of values) {
      const number = selector(value.variantId);
      if (result.has(number))
        return fail(
          'variant-reference',
          'Existing appearance aliases resolve to the same variant and require explicit review.',
        );
      result.set(number, value);
    }
    return result;
  }
  const projected = geometry.views.map((view) => {
    const target = views.find((candidate) => candidate.id === view.id);
    if (!target || target.placements.length !== view.placements.length)
      return fail('projection-mismatch', 'Existing view placements must not disappear during conversion.');
    for (const area of view.placements) {
      const placement = target.placements.find((candidate) => candidate.id === area.id);
      if (
        !placement ||
        (['centerX', 'centerY', 'width', 'height'] as const).some((key) => placement.rect[key] !== area.rect[key])
      )
        fail('projection-mismatch', 'The projected placement must retain its original rectangle.');
    }
    const shared = view.image ? images.find((image) => image.id === view.image?.revisionId) : undefined;
    if (target.imageUrl !== (shared?.url ?? ''))
      fail('projection-mismatch', 'The projected shared photo does not match the original photo identity.');
    return {
      source: view,
      target,
      photos: indexed(view.variantImages),
      rects: new Map(view.placements.map((area) => [area.id, indexed(area.variantOverrides ?? [])])),
    };
  });
  const groupKeys = new Set<string>();
  const assignments: VariantPhotoSetup['assignments'] = [];
  for (const variant of setup.variants) {
    const groupKey = JSON.stringify(setup.groupingOptionIds.map((id) => [id, variant.optionValues[id]]));
    if (groupKeys.has(groupKey))
      fail(
        'catalog-incomplete',
        'Actual variants have ambiguous option combinations; one variant per appearance is required.',
      );
    groupKeys.add(groupKey);
    const number = variant.id.slice('gid://shopify/ProductVariant/'.length);
    for (const view of projected) {
      const specific = view.photos.get(number);
      const reference = specific?.image ?? view.source.image;
      const photo = reference ? images.find((image) => image.id === reference.revisionId) : undefined;
      const actual = reference ? catalog.images?.find((image) => image.id === reference.revisionId) : undefined;
      const unchanged =
        !!reference &&
        !!photo &&
        !!actual &&
        /^image_[1-9][0-9]{0,19}$/.test(reference.revisionId) &&
        photo.url === actual.url &&
        reference.width === photo.width &&
        reference.height === photo.height &&
        actual.width === photo.width &&
        actual.height === photo.height &&
        (!specific
          ? view.target.imageWidth === photo.width &&
            view.target.imageHeight === photo.height &&
            !view.target.needsAlignmentReview
          : true);
      const rects = Object.fromEntries(
        [...view.rects].flatMap(([id, values]) => {
          const override = values.get(number);
          return override ? [[id, { ...override.rect }]] : [];
        }),
      );
      assignments.push({
        groupKey,
        viewId: view.source.id,
        ...(photo ? (specific ? { imageId: photo.id } : { useShared: true }) : {}),
        ...(Object.keys(rects).length ? { placementRects: rects } : {}),
        needsAlignmentReview: !unchanged,
      });
    }
  }
  const parsed = variantPhotoSetupSchema.safeParse({ ...setup, assignments });
  if (!parsed.success)
    return fail(
      parsed.error.issues.some((issue) => issue.code === 'too_big') ? 'capacity-exceeded' : 'unrepresentable-geometry',
      'Existing appearances exceed the selected editor representation; no overrides were discarded.',
    );
  return parsed.data;
}
