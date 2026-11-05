/** Server-side fixture adaptation for the preview-only placement workflow. */

import { loadLegacyDemoCatalog } from './legacy-demo-catalog.mts';
import { demoAssetOrigin } from './order-demo.mts';
import {
  type EditorPlacement,
  type EditorProductImage,
  type EditorView,
  type PlacementProduct,
  type PlacementSize,
  placementProductSchema,
} from './placement-workflow-model.mts';

const methodSeeds = [
  { id: 'demo-method-printing', name: 'Printing', pricing: 'fixed' as const, amount: '5.00' },
  { id: 'demo-method-embroidery', name: 'Embroidery', pricing: 'product' as const, amount: '' },
];

const sourceMethodIds: Record<string, string> = {
  'd8f3958d-f892-470f-8144-20397097fa40': 'demo-method-printing',
  '54f013a5-5382-41de-b36e-d80e6fc1c971': 'demo-method-embroidery',
};

function formatMinor(minor: bigint): string {
  const amount = minor.toString().padStart(3, '0');
  return `${amount.slice(0, -2)}.${amount.slice(-2)}`;
}

function viewName(name: string): string {
  const labels: Record<string, string> = {
    voorkant: 'Front',
    achterkant: 'Back',
    'zijkant links': 'Left side',
    'zijkant rechts': 'Right side',
  };
  return labels[name.toLocaleLowerCase()] ?? name;
}

function placementName(name: string): string {
  const labels: Record<string, string> = {
    linkerborst: 'Left chest',
    rechterborst: 'Right chest',
    buik: 'Front body',
    rug: 'Back body',
    'linker schouder': 'Left sleeve',
    'rechter schouder': 'Right sleeve',
  };
  return labels[name.toLocaleLowerCase()] ?? name;
}

function imageUrl(images: Record<string, string>, revisionId: string): string {
  const url = images[revisionId];
  if (!url) throw new Error(`Missing preview image for ${revisionId}`);
  return url;
}

export async function loadPlacementProducts(): Promise<PlacementProduct[]> {
  const legacyProducts = await loadLegacyDemoCatalog((path) => `${demoAssetOrigin}/${path}`);
  return legacyProducts.map((source) => {
    const images = new Map<string, EditorProductImage>();
    const views = source.geometry.views.map((sourceView): EditorView => {
      const image = sourceView.image;
      if (!image) throw new Error(`Missing preview image for ${source.handle} / ${sourceView.id}`);
      const name = viewName(source.presentation.labels.views[sourceView.id] ?? sourceView.id);
      const url = imageUrl(source.imageUrls, image.revisionId);
      if (!images.has(image.revisionId)) {
        images.set(image.revisionId, {
          id: image.revisionId,
          url,
          width: image.width,
          height: image.height,
          alt: name,
        });
      }
      const placements = sourceView.placements.map((sourceArea): EditorPlacement => {
        const sourcePlacement = source.placements.find((placement) => placement.id === sourceArea.id);
        if (!sourcePlacement) throw new Error(`Missing placement ${sourceArea.id} for ${source.handle}`);

        const methodIds = Object.keys(sourcePlacement.methodPrices)
          .map((sourceMethodId) => sourceMethodIds[sourceMethodId])
          .filter((methodId): methodId is string => methodId !== undefined);
        const sizes = sourcePlacement.steps.map((step): PlacementSize => {
          const prices = Object.fromEntries(
            Object.entries(sourcePlacement.methodPrices)
              .map(([sourceMethodId, placementMethodPrice]) => {
                const methodId = sourceMethodIds[sourceMethodId];
                if (!methodId) return undefined;
                // Printing uses the Methods demo's fixed amount. Only product-priced methods carry size prices.
                if (methodSeeds.find((method) => method.id === methodId)?.pricing === 'fixed') return undefined;
                const sourceMethodPrice = source.methods.find((method) => method.id === sourceMethodId)?.price ?? 0;
                const cents =
                  BigInt(sourceMethodPrice) +
                  BigInt(placementMethodPrice ?? sourcePlacement.price) +
                  BigInt(step.price);
                return [methodId, formatMinor(cents)] as const;
              })
              .filter((entry): entry is readonly [string, string] => entry !== undefined),
          );
          return {
            id: step.id,
            name: step.label,
            widthPercent: String(Number((step.factor * 100).toFixed(6))),
            prices,
          };
        });

        return {
          id: sourceArea.id,
          name: placementName(sourcePlacement.name),
          rect: { ...sourceArea.rect },
          widthCm: '',
          heightCm: '',
          methodIds,
          sizes,
          logoLaterAllowed: false,
          customPlacementAllowed: false,
        };
      });

      return {
        id: sourceView.id,
        name,
        imageUrl: url,
        imageWidth: image.width,
        imageHeight: image.height,
        placements,
      };
    });

    return placementProductSchema.parse({
      id: source.id,
      title: source.title,
      images: [...images.values()],
      views,
      methods: methodSeeds.map((method) => ({ ...method })),
    });
  });
}
