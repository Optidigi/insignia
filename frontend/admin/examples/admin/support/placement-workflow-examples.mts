/** Preview-only scale fixture. Reuses real garment photos; view names and extra methods are sample data. */

import type { PlacementSetupExample } from './placement-preview-storage.mts';
import { isVariantPhotoExample, variantPhotoExample } from './placement-variant-photo-examples.mts';
import type { PlacementProduct } from './placement-workflow-model.mts';

export function applyPlacementSetupExample(
  product: PlacementProduct,
  example: PlacementSetupExample,
): PlacementProduct {
  if (isVariantPhotoExample(example)) return variantPhotoExample(product, example);
  if (example === 'copy-ready' && product.id !== 'gid://shopify/Product/15468416336256')
    return { ...product, views: [] };
  if (example === 'large') return largePlacementExample(product);
  if (example === 'many-methods') return manyMethodsPlacementExample(product);
  if (example === 'partial') return { ...product, views: product.views.slice(0, 1) };
  if (example === 'blank' || example === 'no-images' || example === 'first-product')
    return {
      ...product,
      views: [],
      images: example === 'no-images' ? [] : product.images,
      methods: example === 'first-product' ? [] : product.methods,
    };
  return product;
}

/** Isolated method-scale example; no extra views or production catalog changes. */
export function manyMethodsPlacementExample(product: PlacementProduct): PlacementProduct {
  const names = [
    'Heat transfer',
    'Direct to garment',
    'Cut vinyl',
    'Sublimation',
    'Woven patch',
    'Embroidered patch',
    'Reflective print',
    'Silicone transfer',
    'Flock transfer',
    'Puff print',
    'Metallic foil',
    'Water-based screen printing',
    'Discharge printing',
    'Appliqué',
    'Premium full-colour transfer for technical outerwear',
    'Specialist embroidery with individually matched thread colours',
  ];
  const additional = names.map((name, index) => ({
    id: `sample-decoration-${index}`,
    name,
    pricing: index % 2 === 0 || index === 15 ? ('product' as const) : ('fixed' as const),
    amount: index % 2 === 0 || index === 15 ? '' : '7.50',
  }));
  const enabled = additional.filter((_, index) => [0, 1, 4, 15].includes(index));
  return {
    ...product,
    methods: [...product.methods, ...additional],
    views: product.views.map((view) => ({
      ...view,
      placements: view.placements.map((placement) => ({
        ...placement,
        methodIds: [...new Set([...placement.methodIds, ...enabled.map((method) => method.id)])],
        sizes: placement.sizes.map((size, index) => ({
          ...size,
          prices: {
            ...size.prices,
            ...Object.fromEntries(
              enabled
                .filter((method) => method.pricing === 'product')
                .map((method) => [method.id, index ? '15.00' : '10.00']),
            ),
          },
        })),
      })),
    })),
  };
}

export function largePlacementExample(product: PlacementProduct): PlacementProduct {
  const source = product.views[0]?.placements[0];
  if (!source || !product.images.length) return product;
  const viewNames = [
    'Front',
    'Back',
    'Left sleeve',
    'Right sleeve',
    'Inside neckline',
    'Lower front',
    'Lower back',
    'Left shoulder',
    'Right shoulder',
    'Additional view with a longer customer-facing name',
  ];
  const areaNames = ['Upper area', 'Small emblem', 'Main artwork', 'Lower area'];
  return {
    ...product,
    methods: [
      ...product.methods.map((method) => (method.pricing === 'fixed' ? { ...method, amount: '5,00' } : method)),
      { id: 'sample-transfer', name: 'Heat transfer', pricing: 'fixed', amount: '7.50' },
      { id: 'sample-dtg', name: 'Direct to garment', pricing: 'fixed', amount: '9.00' },
      { id: 'sample-vinyl', name: 'Cut vinyl', pricing: 'product', amount: '' },
      { id: 'sample-patch', name: 'Woven patch', pricing: 'product', amount: '' },
      {
        id: 'sample-special',
        name: 'Specialist decoration with a longer merchant-defined name',
        pricing: 'product',
        amount: '',
      },
    ],
    views: Array.from({ length: 10 }, (_, index) => {
      const image = product.images[index % product.images.length];
      if (!image) throw new Error('Sample image missing');
      const id = `sample-view-${index}`;
      return {
        id,
        name: viewNames[index] ?? `View ${index + 1}`,
        imageUrl: image.url,
        imageWidth: image.width,
        imageHeight: image.height,
        placements: Array.from({ length: 4 }, (_, areaIndex) => ({
          ...source,
          id: `${id}:area:${areaIndex}`,
          name: areaNames[areaIndex] ?? 'Artwork area',
          rect: {
            centerX: areaIndex === 0 ? 0.35 : areaIndex === 1 ? 0.65 : 0.5,
            centerY: areaIndex < 2 ? 0.3 : areaIndex === 2 ? 0.48 : 0.7,
            width: 0.2,
            height: 0.16,
          },
          methodIds: areaIndex === 3 && index % 3 === 0 ? [] : [...source.methodIds],
          sizes: source.sizes.map((size, sizeIndex) => ({
            ...size,
            id: `${id}:area:${areaIndex}:size:${sizeIndex}`,
            prices: { ...size.prices },
          })),
        })),
      };
    }),
  };
}
