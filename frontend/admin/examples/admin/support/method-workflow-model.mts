import { loadLegacyDemoCatalog } from './legacy-demo-catalog.mts';
import { cellKey, formatPrice, parsePrice } from './method-workflow-prices.mts';

export type { PriceResult } from './method-workflow-prices.mts';
export { cellKey, formatPrice, parsePrice };

export type DemoMethod = { id: string; name: string; explanation: string };
export type DemoSize = { id: string; label: string };
export type DemoLocation = {
  id: string;
  label: string;
  view: string;
  image: string;
  rect: { centerX: number; centerY: number; width: number; height: number };
  sizes: DemoSize[];
};
export type DemoProduct = { id: string; title: string; image: string; locations: DemoLocation[] };
export type ProductMethod = {
  id: string;
  sourceId?: string;
  name: string;
  explanation: string;
  locationIds: string[];
  prices: Record<string, string>;
};

const libraryMethods: DemoMethod[] = [
  { id: 'demo-method-printing', name: 'Printing', explanation: 'Printed in full colour.' },
  { id: 'demo-method-embroidery', name: 'Embroidery', explanation: 'Stitched with thread.' },
];

export function seedMethods(): DemoMethod[] {
  return libraryMethods.map((method) => ({ ...method }));
}

function viewLabel(value: string): string {
  const labels: Record<string, string> = {
    voorkant: 'Front',
    achterkant: 'Back',
    'zijkant links': 'Left side',
    'zijkant rechts': 'Right side',
  };
  return labels[value.toLocaleLowerCase()] ?? value;
}

function locationLabel(value: string): string {
  const labels: Record<string, string> = {
    linkerborst: 'Left chest',
    rechterborst: 'Right chest',
    buik: 'Front body',
    rug: 'Back body',
    'linker schouder': 'Left sleeve',
    'rechter schouder': 'Right sleeve',
  };
  return labels[value.toLocaleLowerCase()] ?? value;
}

function productTitle(handle: string): string {
  if (handle.endsWith('hoodie')) return 'Superfunny hoodie';
  if (handle.endsWith('polo')) return 'Superfunny polo';
  if (handle.endsWith('t-shirt')) return 'Superfunny T-shirt';
  return handle;
}

function imageUrl(images: Record<string, string>, revisionId: string | undefined): string {
  const image = revisionId ? images[revisionId] : undefined;
  if (!image) throw new Error('Missing legacy demo product image');
  return image;
}

export async function loadMethodWorkflowProducts(): Promise<DemoProduct[]> {
  const catalog = await loadLegacyDemoCatalog((path) => `/__preview/demo/${path}`);
  return catalog.map((source) => {
    const front =
      source.geometry.views.find(
        (view) => source.presentation.labels.views[view.id]?.toLocaleLowerCase() === 'voorkant',
      ) ?? source.geometry.views[0];
    if (!front?.image) throw new Error(`Missing front image for ${source.handle}`);
    const locations = source.geometry.views.flatMap((view) => {
      if (!view.image) throw new Error(`Missing image for ${source.handle}`);
      const viewName = viewLabel(source.presentation.labels.views[view.id] ?? view.id);
      const image = imageUrl(source.imageUrls, view.image.revisionId);
      return view.placements.map((area) => {
        const placement = source.placements.find((item) => item.id === area.id);
        if (!placement) throw new Error(`Missing placement ${area.id} for ${source.handle}`);
        return {
          id: area.id,
          label: locationLabel(placement.name),
          view: viewName,
          image,
          rect: { ...area.rect },
          sizes: placement.steps.map(({ id, label }) => ({ id, label })),
        };
      });
    });
    return {
      id: source.id,
      title: productTitle(source.handle),
      image: imageUrl(source.imageUrls, front.image.revisionId),
      locations,
    };
  });
}

function firstByArea(locations: readonly DemoLocation[]): DemoLocation | undefined {
  return [...locations].sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0];
}

export function seedProductMethods(products: readonly DemoProduct[]): Record<string, ProductMethod[]> {
  const methods = seedMethods();
  const printing = methods.find((method) => method.id === 'demo-method-printing');
  const embroidery = methods.find((method) => method.id === 'demo-method-embroidery');
  if (!printing || !embroidery) throw new Error('Missing demo method');
  return Object.fromEntries(
    products.map((product) => {
      const front = product.locations.filter((location) => location.view === 'Front');
      const chests = front.filter((location) => location.label.toLocaleLowerCase().includes('chest'));
      const printLocation = chests[0] ?? firstByArea(front);
      const embroideryLocation =
        chests.find((location) => location.id !== printLocation?.id) ??
        front.find((location) => location.id !== printLocation?.id);
      const bodyLocation = firstByArea(front.filter((location) => location.id !== printLocation?.id));
      const printSizes = printLocation?.sizes ?? [];
      const embroiderySize = embroideryLocation?.sizes[0];
      const printingLocations = [printLocation, ...(product.title === 'Superfunny polo' ? [] : [bodyLocation])].filter(
        (location): location is DemoLocation => !!location,
      );
      const printPrices: Record<string, string> = {};
      if (printLocation && printSizes[0]) printPrices[cellKey(printLocation.id, printSizes[0].id)] = '3.50';
      if (printLocation && printSizes[1]) printPrices[cellKey(printLocation.id, printSizes[1].id)] = '5.00';
      const embroideryPrices: Record<string, string> = {};
      if (embroideryLocation && embroiderySize)
        embroideryPrices[cellKey(embroideryLocation.id, embroiderySize.id)] = '4.75';
      const productMethods: ProductMethod[] = [
        {
          id: `${product.id}:method:printing`,
          sourceId: printing.id,
          name: printing.name,
          explanation: printing.explanation,
          locationIds: printingLocations.map((location) => location.id),
          prices: printPrices,
        },
        {
          id: `${product.id}:method:embroidery`,
          sourceId: embroidery.id,
          name: embroidery.name,
          explanation: embroidery.explanation,
          locationIds: embroideryLocation ? [embroideryLocation.id] : [],
          prices: embroideryPrices,
        },
      ];
      return [product.id, productMethods];
    }),
  );
}
