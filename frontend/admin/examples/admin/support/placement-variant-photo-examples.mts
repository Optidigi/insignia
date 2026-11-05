/** Local scenarios using the buyer prototype's existing garment photography. */
import { getVariantPhotoGroups } from './placement-variant-photos.mts';
import type { PlacementProduct } from './placement-workflow-model.mts';

export const variantPhotoExamples = [
  'variant-photos',
  'variant-missing',
  'variant-fit',
  'variant-review',
  'variant-alignment',
  'variant-unassigned',
  'variant-many',
  'variant-image-error',
  'variant-long',
] as const;
export type VariantPhotoExample = (typeof variantPhotoExamples)[number];
export function isVariantPhotoExample(value: string | null): value is VariantPhotoExample {
  return value !== null && (variantPhotoExamples as readonly string[]).includes(value);
}
export function variantPhotoExample(product: PlacementProduct, example: VariantPhotoExample): PlacementProduct {
  if (product.id !== 'gid://shopify/Product/15464675246464') return product;
  const names = ['Black', 'White', 'Navy'];
  const colors =
    example === 'variant-many'
      ? [...names, ...Array.from({ length: 21 }, (_, index) => `Sample colour ${index + 4}`)]
      : names;
  const images = ['black', 'white', 'navy'].flatMap((color) =>
    ['front', 'back', 'left', 'right'].map((side) => ({
      id: `variant-photo-${color}-${side}`,
      url: `https://insignia-order-demo.invalid/files/shirt-${color}-${side}.jpg`,
      width: 1200,
      height: 1200,
      alt: `${color[0]?.toUpperCase()}${color.slice(1)} T-shirt · ${side}`,
    })),
  );
  if (example === 'variant-image-error')
    images.push({
      id: 'variant-photo-broken-front',
      url: 'https://insignia-order-demo.invalid/files/missing-variant-photo.jpg',
      width: 1200,
      height: 1200,
      alt: 'Unavailable sample image',
    });
  const fit = example === 'variant-fit' || example === 'variant-long';
  const options = [
    { id: 'colour', name: 'Colour', values: colors.map((label, index) => ({ id: `colour-${index}`, label })) },
    { id: 'size', name: 'Size', values: ['S', 'M', 'L', 'XL'].map((label) => ({ id: label, label })) },
    ...(fit
      ? [
          {
            id: 'fit',
            name: 'Fit',
            values: [
              { id: 'regular', label: example === 'variant-long' ? 'Regular unisex fit' : 'Regular' },
              { id: 'relaxed', label: example === 'variant-long' ? 'Relaxed unisex fit' : 'Relaxed' },
            ],
          },
        ]
      : []),
  ];
  const variants = colors.flatMap((_, colorIndex) =>
    ['S', 'M', 'L', 'XL'].flatMap((size) =>
      (fit ? ['regular', 'relaxed'] : ['regular']).map((fitId) => ({
        id: `sample-${colorIndex}-${size}-${fitId}`,
        optionValues: { colour: `colour-${colorIndex}`, size, ...(fit ? { fit: fitId } : {}) },
      })),
    ),
  );
  const views = product.views.map((view, index) => {
    const side = ['front', 'back', 'left', 'right'][index] ?? 'front';
    const image = images.find((item) => item.id === `variant-photo-black-${side}`);
    if (!image) throw new Error('Sample view photo missing.');
    return { ...view, imageUrl: image.url, imageWidth: image.width, imageHeight: image.height };
  });
  const next: PlacementProduct = {
    ...product,
    views,
    images: [...images, ...product.images],
    variantPhotos: { options, variants, groupingOptionIds: fit ? ['colour', 'fit'] : ['colour'], assignments: [] },
  };
  if (!next.variantPhotos || example === 'variant-unassigned') return next;
  const groups = getVariantPhotoGroups(next);
  next.variantPhotos.assignments = groups.flatMap((group, index) =>
    views.flatMap((view, viewIndex) => {
      if (example === 'variant-missing' && index === 0 && viewIndex === 1) return [];
      const color = group.values.find((value) => value.optionId === 'colour')?.label.toLowerCase();
      const side = ['front', 'back', 'left', 'right'][viewIndex] ?? 'front';
      const image = images.find((item) => item.id === `variant-photo-${color}-${side}`);
      if (!image) return [];
      const area = view.placements[0];
      return [
        {
          groupKey: group.key,
          viewId: view.id,
          imageId:
            example === 'variant-image-error' && index === 0 && viewIndex === 0
              ? 'variant-photo-broken-front'
              : image.id,
          ...(example === 'variant-review' && index === 0 && viewIndex === 0 ? { needsAlignmentReview: true } : {}),
          ...(example === 'variant-alignment' && index === 0 && viewIndex === 0 && area
            ? { placementRects: { [area.id]: { ...area.rect, centerX: Math.min(0.75, area.rect.centerX + 0.04) } } }
            : {}),
        },
      ];
    }),
  );
  return next;
}
