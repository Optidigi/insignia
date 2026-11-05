import type { CustomerArtworkSlot } from '@insignia/application';
import { getVariantPhotoGroups, readSelectedStepIdentity, type SelectedProductSetup } from '@insignia/contracts';
import type { PurchaseRecord } from '@insignia/database';
import { type GeometryV1, validateGeometry } from '@insignia/visualizer/geometry';

type PurchasedGroup = NonNullable<
  PurchaseRecord['bindings'][number]['designPayload']
>['request']['groups'][number]['group'];
function unavailable(): never {
  throw new Error('CUSTOMER_ARTWORK_PREVIEW_UNAVAILABLE');
}
const numeric = (id: string) => /^gid:\/\/shopify\/ProductVariant\/([1-9][0-9]*)$/.exec(id)?.[1] ?? id;
/** Preview authority is the accepted variant geometry and missing-slot instructions, never current catalogue/draft data. */
export function scopeCustomerArtworkPresentation(
  setup: SelectedProductSetup,
  source: GeometryV1,
  group: Pick<PurchasedGroup, 'variants'> & { design: Pick<PurchasedGroup['design'], 'placements'> },
  slots: readonly CustomerArtworkSlot[],
) {
  const { geometry, variantIds } = scopeCustomerArtworkGeometry(source, group, slots);
  const chosen = new Map(slots.map((slot) => [slot.placementId, slot]));
  const methods = new Set(slots.map((slot) => slot.methodId));
  const product = {
    ...setup.product,
    productionChoices: undefined,
    images: setup.product.images.map((image) => ({ ...image, alt: '' })),
    methods: setup.product.methods
      .filter((method) => methods.has(method.id))
      .map((method) => ({ ...method, pricing: 'fixed' as const, amount: '0' })),
    views: setup.product.views.flatMap((view) => {
      const frozen = geometry.views.find((value) => value.id === view.id);
      if (!frozen?.image) return [];
      const image = setup.product.images.find((image) => image.id === frozen.image?.revisionId);
      if (!image) unavailable();
      const { calibration: _calibration, ...base } = view;
      return [
        {
          ...base,
          imageUrl: image.url,
          imageWidth: image.width,
          imageHeight: image.height,
          placements: view.placements.flatMap((placement) => {
            const slot = chosen.get(placement.id);
            if (!slot) return [];
            const accepted = group.design.placements.find((value) => value.placementId === placement.id);
            const size = placement.sizes.find(
              (size) => readSelectedStepIdentity(placement.id, size.id, [slot.stepId]) === slot.stepId,
            );
            const area = frozen.placements.find((value) => value.id === placement.id);
            if (!accepted || !size || !area || accepted.methodId !== slot.methodId || accepted.stepId !== slot.stepId)
              unavailable();
            return [
              {
                ...placement,
                widthCm: '',
                heightCm: '',
                rect: area.rect,
                methodIds: [slot.methodId],
                sizes: [{ ...size, prices: {} }],
                logoLaterAllowed: false,
                customPlacementAllowed: false,
                movementRect: undefined,
              },
            ];
          }),
        },
      ];
    }),
  };
  if (product.variantPhotos) {
    const variants = product.variantPhotos.variants.filter((value) => variantIds.includes(numeric(value.id)));
    if (variants.length !== variantIds.length) unavailable();
    const photos = {
      ...product.variantPhotos,
      variants,
      options: product.variantPhotos.options.map((option) => ({
        ...option,
        values: option.values.filter((value) =>
          variants.some((variant) => variant.optionValues[option.id] === value.id),
        ),
      })),
      assignments: [] as NonNullable<SelectedProductSetup['product']['variantPhotos']>['assignments'],
    };
    product.variantPhotos = photos;
    for (const appearance of getVariantPhotoGroups(product))
      for (const view of geometry.views) {
        const resolved = appearance.variantIds.map((id) => {
          const variantId = numeric(id);
          return {
            image:
              view.variantImages.find((value) => value.variantId === variantId)?.image ?? view.image ?? unavailable(),
            rects: Object.fromEntries(
              view.placements.map((placement) => [
                placement.id,
                placement.variantOverrides?.find((value) => value.variantId === variantId)?.rect ?? placement.rect,
              ]),
            ),
          };
        });
        const base = resolved[0];
        if (!base || resolved.some((value) => JSON.stringify(value) !== JSON.stringify(base))) unavailable();
        photos.assignments.push({
          groupKey: appearance.key,
          viewId: view.id,
          imageId: base.image.revisionId,
          placementRects: base.rects,
        });
      }
  } else if (
    geometry.views.some(
      (view) => view.variantImages.length || view.placements.some((placement) => placement.variantOverrides?.length),
    )
  )
    unavailable();
  return {
    selectedSetup: { version: 'selected-product-setup-v1' as const, methodBindings: {}, product },
    geometry,
    variantIds,
    positions: group.design.placements.flatMap((placement) =>
      chosen.has(placement.placementId) && placement.position
        ? [{ placementId: placement.placementId, position: placement.position }]
        : [],
    ),
  };
}

export function scopeCustomerArtworkGeometry(
  source: GeometryV1,
  group: Pick<PurchasedGroup, 'variants'> & { design: Pick<PurchasedGroup['design'], 'placements'> },
  slots: readonly CustomerArtworkSlot[],
) {
  const variantIds = [...new Set(group.variants.map((variant) => numeric(variant.variantId)))];
  if (!variantIds.length || variantIds.some((id) => !/^[1-9][0-9]{0,19}$/.test(id))) unavailable();
  const first = variantIds[0];
  if (!first) unavailable();
  const chosen = new Map(slots.map((slot) => [slot.placementId, slot]));
  const geometry: GeometryV1 = {
    ...source,
    steps: source.steps.filter((step) => slots.some((slot) => slot.stepId === step.id)),
    views: source.views.flatMap((view) => {
      const placements = view.placements.filter((placement) => chosen.has(placement.id));
      if (!placements.length) return [];
      const image = (variantId: string) =>
        view.variantImages.find((value) => value.variantId === variantId)?.image ?? view.image;
      const base = image(first);
      return [
        {
          ...view,
          image: base,
          variantImages: variantIds.flatMap((variantId) => {
            const current = image(variantId);
            return !current || JSON.stringify(current) === JSON.stringify(base) ? [] : [{ variantId, image: current }];
          }),
          placements: placements.map((placement) => {
            const rect = (variantId: string) =>
              placement.variantOverrides?.find((value) => value.variantId === variantId)?.rect ?? placement.rect;
            const baseRect = rect(first);
            return {
              ...placement,
              rect: baseRect,
              variantOverrides: variantIds.flatMap((variantId) =>
                JSON.stringify(rect(variantId)) === JSON.stringify(baseRect)
                  ? []
                  : [{ variantId, rect: rect(variantId) }],
              ),
            };
          }),
        },
      ];
    }),
  };
  validateGeometry(geometry);
  for (const slot of slots)
    if (
      !geometry.views.some((view) => view.placements.some((placement) => placement.id === slot.placementId)) ||
      !geometry.steps.some((step) => step.id === slot.stepId && step.physicalMm)
    )
      unavailable();
  return {
    geometry,
    variantIds,
    positions: group.design.placements.flatMap((placement) =>
      chosen.has(placement.placementId) && placement.position
        ? [{ placementId: placement.placementId, position: placement.position }]
        : [],
    ),
  };
}
