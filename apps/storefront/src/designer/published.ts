import { CustomerCanonicalProductSchema } from '@insignia/contracts';
import { validateGeometry } from '@insignia/visualizer/geometry';
import { buildPublishedDesigner, type PublishedDesignerSource } from '../../../../frontend/designer/src/live-config';
import type { BuyerConfig } from '../buyer.ts';

function unavailable(): never {
  throw new Error('Published facts cannot be represented safely');
}
/** Compatibility is a factual projection, never a rewrite of retained config/history or a financial fallback. */
export function canonicalDesignerSource(source: BuyerConfig): PublishedDesignerSource {
  if (!source.ready) unavailable();
  if (source.selectedSetup) return source;
  if (!source.title?.trim() || !source.shopCurrency || !source.decorationPrices || !source.variants.length)
    unavailable();
  const geometry = validateGeometry(source.geometry),
    images = new Map<string, { id: string; url: string; width: number; height: number; alt: string }>();
  for (const view of geometry.views) {
    for (const ref of [...(view.image ? [view.image] : []), ...view.variantImages.map((value) => value.image)]) {
      const url = source.imageUrls[ref.revisionId];
      if (!url?.startsWith('https://')) continue;
      const prior = images.get(ref.revisionId);
      if (prior && (prior.width !== ref.width || prior.height !== ref.height)) unavailable();
      images.set(ref.revisionId, { id: ref.revisionId, url, width: ref.width, height: ref.height, alt: '' });
    }
  }
  const cells = new Set<string>();
  for (const price of source.decorationPrices) {
    const key = JSON.stringify([price.placementId, price.methodId, price.stepId]);
    if (cells.has(key)) unavailable();
    cells.add(key);
  }
  const first = source.variants[0]?.selectedOptions;
  if (!first?.length) unavailable();
  const names = first.map((value) => value.name);
  if (
    new Set(names).size !== names.length ||
    source.variants.some(
      (variant) =>
        !variant.selectedOptions ||
        variant.baseUnitMinor === undefined ||
        variant.selectedOptions.length !== names.length ||
        names.some((name) => !variant.selectedOptions?.some((value) => value.name === name)),
    )
  )
    unavailable();
  const stepBindings: { placementId: string; sizeId: string; stepId: string }[] = [];
  const readProduct = CustomerCanonicalProductSchema.parse({
    id: `gid://shopify/Product/${source.productId}`,
    title: source.title,
    images: [...images.values()],
    methods: source.methods.map((method) => ({ id: method.id, name: method.label, pricing: 'product', amount: '' })),
    views: geometry.views.map((view) => ({
      id: view.id,
      name: view.id,
      imageUrl: images.get(view.image?.revisionId ?? '')?.url ?? '',
      ...(view.image ? { imageWidth: view.image.width, imageHeight: view.image.height } : {}),

      placements: view.placements.map((placement) => {
        const policy = source.placements.find((value) => value.id === placement.id);
        if (!policy?.allowedStepIds.length) unavailable();
        const sizes = policy.allowedStepIds.map((id) => {
          const step = geometry.steps.find((value) => value.id === id);
          if (!step?.physicalMm) unavailable();
          stepBindings.push({ placementId: placement.id, sizeId: id, stepId: id });
          return {
            id,
            name: source.steps.find((value) => value.id === id)?.label ?? id,
            widthPercent: String(step.widthFraction * 100),
            heightPercent: String(step.heightFraction * 100),
            prices: {},
          };
        });
        return {
          id: placement.id,
          name: policy.label,
          rect: placement.rect,
          widthCm: '',
          heightCm: '',
          methodIds: policy.allowedMethodIds,
          sizes,
          logoLaterAllowed: policy.logoLaterAllowed,
          customPlacementAllowed: false,
        };
      }),
    })),
    variantPhotos: {
      options: names.map((name) => ({
        id: name,
        name,
        values: [
          ...new Set(
            source.variants.map(
              (variant) => variant.selectedOptions?.find((value) => value.name === name)?.value ?? unavailable(),
            ),
          ),
        ].map((value) => ({ id: value, label: value })),
      })),
      variants: source.variants.map((variant) => ({
        id: `gid://shopify/ProductVariant/${variant.id}`,
        label: variant.label,
        optionValues: Object.fromEntries((variant.selectedOptions ?? []).map((value) => [value.name, value.value])),
      })),
      groupingOptionIds: names,
      assignments: [],
    },
  });
  return { ...source, readProduct, stepBindings, variantRowsById: true };
}
export function buildBuyerDesigner(source: BuyerConfig, options: { locale: string; storeName: string }) {
  return buildPublishedDesigner(canonicalDesignerSource(source), options);
}
