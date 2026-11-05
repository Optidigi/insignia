/** Read-only legacy snapshots adapted for local UI work, never a production migration. */
import { readFile } from 'node:fs/promises';
import { type PurchaseGroup, type PurchaseView, PurchaseViewSchema } from '@insignia/contracts';
import { type GeometryV1, validateGeometry } from '@insignia/ui-visualizer/geometry';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid legacy demo record');
  return Object.fromEntries(Object.entries(value));
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Invalid legacy demo collection');
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Invalid legacy demo label');
  return value;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid legacy demo number');
  return value;
}

export async function loadLegacyDemoCatalog(assetUrl: (path: string) => string) {
  const source: unknown = JSON.parse(await readFile(new URL('./legacy-catalog.json', import.meta.url), 'utf8'));
  return array(record(source).products).map((entry) => {
    const product = record(entry);
    const id = text(product.id);
    const methods = array(product.methods).map((entry) => {
      const method = record(entry);
      return { id: text(method.id), name: text(method.name), price: number(method.basePriceCents) };
    });
    const placements = array(product.placements).map((entry) => {
      const placement = record(entry);
      const steps = array(placement.steps).map((entry, index) => {
        const step = record(entry);
        return {
          id: `${text(placement.id)}:${index}`,
          label: text(step.label),
          factor: step.scaleFactor == null ? 1 : number(step.scaleFactor),
          price: number(step.priceAdjustmentCents),
        };
      });
      if (!steps.length) steps.push({ id: `${text(placement.id)}:0`, label: 'Standard', factor: 1, price: 0 });
      const methodPrices = record(placement.pricePerMethod);
      return {
        id: text(placement.id),
        name: text(placement.name),
        steps,
        defaultStep: number(placement.defaultStepIndex),
        price: number(placement.basePriceAdjustmentCents),
        methodPrices: Object.fromEntries(Object.entries(methodPrices).map(([id, value]) => [id, number(value)])),
      };
    });
    const imageFiles: string[] = [];
    const imageUrls: Record<string, string> = {};
    const viewLabels: Record<string, string> = {};
    const geometry = validateGeometry({
      version: 'm5-geometry-v1',
      views: array(product.views).map((entry) => {
        const view = record(entry);
        const image = record(view.image);
        const filename = text(image.previewFilename ?? image.filename);
        if (!/^[a-z0-9-]+\.jpg$/.test(filename)) throw new Error('Invalid legacy demo image filename');
        imageFiles.push(filename);
        const revisionId = filename.replace('.jpg', '');
        imageUrls[revisionId] = assetUrl(`files/${filename}`);
        viewLabels[text(view.id)] = text(view.name);
        return {
          id: text(view.id),
          image: {
            revisionId,
            width: number(image.previewWidth ?? image.width),
            height: number(image.previewHeight ?? image.height),
          },
          variantImages: [],
          placements: array(view.placements).map((entry) => {
            const placement = record(entry);
            return {
              id: text(placement.id),
              rect: {
                centerX: number(placement.centerXPercent) / 100,
                centerY: number(placement.centerYPercent) / 100,
                width: number(placement.maxWidthPercent) / 100,
                height: number(placement.maxHeightPercent ?? placement.maxWidthPercent) / 100,
              },
            };
          }),
        };
      }),
      steps: placements.flatMap((placement) =>
        placement.steps.map((step) => ({ id: step.id, widthFraction: step.factor, heightFraction: step.factor })),
      ),
    } satisfies GeometryV1);
    const variants = array(product.variants).map((entry) => {
      const variant = record(entry);
      return {
        id: text(variant.id),
        title: text(variant.title),
        size: text(variant.sizeLabel),
        price: number(variant.priceCents),
      };
    });
    const presentation = {
      version: 'm5-presentation-v1' as const,
      labels: {
        views: viewLabels,
        methods: Object.fromEntries(methods.map((method) => [method.id, method.name])),
        placements: Object.fromEntries(placements.map((placement) => [placement.id, placement.name])),
        steps: Object.fromEntries(
          placements.flatMap((placement) => placement.steps.map((step) => [step.id, step.label])),
        ),
      },
    };
    return {
      id,
      title: text(product.title),
      handle: text(product.handle),
      geometry,
      imageUrls,
      imageFiles,
      presentation,
      placements,
      methods,
      variants,
    };
  });
}

export type LegacyDemoProduct = Awaited<ReturnType<typeof loadLegacyDemoCatalog>>[number];

export function legacyDemoOrders(
  products: LegacyDemoProduct[],
  base: PurchaseView,
  expiresAt: string,
  artwork: { chest: string; back: string; replacement: string },
) {
  const find = (type: string) => {
    const product = products.find((product) => product.handle.endsWith(type));
    if (!product) throw new Error(`Missing ${type} legacy demo product`);
    return product;
  };
  const hoodie = find('hoodie'),
    polo = find('polo'),
    tee = find('t-shirt');
  const orders: PurchaseView[] = [];
  function order(
    offset: number,
    selections: {
      product: LegacyDemoProduct;
      placements: string[];
      size: string;
      quantity: number;
      replaced?: boolean;
    }[],
    state: PurchaseView['artworkState'],
  ) {
    const groups: PurchaseGroup[] = [];
    const lines: PurchaseView['lines'] = [];
    for (const [index, selection] of selections.entries()) {
      const product = selection.product;
      const variant = product.variants.find((variant) => variant.size === selection.size);
      const method = product.methods[0];
      if (!variant || !method) throw new Error('Missing legacy demo variant or method');
      const placements = selection.placements.map((name) => {
        const placement = product.placements.find((placement) => placement.name === name);
        if (!placement) throw new Error(`Missing legacy placement ${name}`);
        const step = placement.steps[placement.defaultStep] ?? placement.steps[0];
        if (!step) throw new Error('Missing legacy decoration size');
        return { placement, step };
      });
      const price =
        variant.price +
        method.price +
        placements.reduce(
          (sum, { placement, step }) => sum + (placement.methodPrices[method.id] ?? placement.price) + step.price,
          0,
        );
      lines.push({
        orderLineId: `demo-${offset}-${index}`,
        title: product.title,
        variantTitle: variant.title,
        productId: product.id,
        variantId: variant.id,
        quantity: selection.quantity,
        unitPriceMinor: String(price),
      });
      groups.push({
        index,
        productId: product.id,
        configRevisionId: `demo-legacy-${offset}-${index}`,
        variants: [{ variantId: variant.id, quantity: selection.quantity }],
        geometry: product.geometry,
        imageUrls: product.imageUrls,
        presentation: product.presentation,
        payloadExpiresAt: expiresAt,
        placements: placements.map(({ placement, step }, placementIndex) => {
          const original = /rug/i.test(placement.name) ? artwork.back : artwork.chest;
          const deferred = state === 'PENDING_ARTWORK' && placementIndex === placements.length - 1;
          return {
            id: placement.id,
            methodId: method.id,
            stepId: step.id,
            originalArtwork: deferred
              ? { kind: 'deferred' as const, intentId: `demo-later-${offset}` }
              : { kind: 'revision' as const, revisionId: original },
            currentAssetId: deferred
              ? null
              : selection.replaced && placementIndex === 0
                ? artwork.replacement
                : original,
            currentExpiresAt: deferred ? null : expiresAt,
            expired: false,
          };
        }),
      });
    }
    const artworkEvents: PurchaseView['artworkEvents'] = groups.flatMap((group) =>
      group.placements.flatMap((placement) =>
        placement.originalArtwork.kind === 'revision' &&
        placement.currentAssetId !== placement.originalArtwork.revisionId
          ? [
              {
                eventId: `demo-replacement-${offset}-${group.index}`,
                version: 1,
                kind: 'ATTACH' as const,
                groupIndex: group.index,
                placementId: placement.id,
                assetId: placement.currentAssetId,
                expiresAt,
                erasedAt: null,
              },
            ]
          : [],
      ),
    );
    if (state === 'ARTWORK_LOCKED')
      artworkEvents.push({
        eventId: 'demo-initial-lock',
        version: artworkEvents.length + 1,
        kind: 'LOCK',
        groupIndex: null,
        placementId: null,
        assetId: null,
        expiresAt: null,
        erasedAt: null,
      });
    orders.push(
      PurchaseViewSchema.parse({
        ...base,
        purchaseId: `10000000-0000-4000-8000-${String(101 + offset).padStart(12, '0')}`,
        orderId: `gid://shopify/Order/${1042 + offset}`,
        orderName: `#${1042 + offset}`,
        orderCreatedAt: new Date(Date.parse(base.orderCreatedAt) + offset * 3600000).toISOString(),
        firstPaidAt: base.firstPaidAt
          ? new Date(Date.parse(base.orderCreatedAt) + offset * 3600000 + 60000).toISOString()
          : null,
        originalTotalMinor: lines
          .reduce((sum, line) => sum + BigInt(line.unitPriceMinor) * BigInt(line.quantity), 0n)
          .toString(),
        artworkState: state,
        artworkVersion: artworkEvents.length,
        lines,
        groups,
        artworkEvents,
      }),
    );
  }
  order(1, [{ product: hoodie, placements: ['Linkerborst', 'Rug'], size: 'M', quantity: 4 }], 'PENDING_ARTWORK');
  order(2, [{ product: polo, placements: ['Linkerborst'], size: 'L', quantity: 6 }], 'READY');
  order(
    3,
    [
      { product: tee, placements: ['Linkerborst', 'Rug'], size: 'M', quantity: 2 },
      { product: hoodie, placements: ['Linkerborst', 'Rug', 'Linker Schouder'], size: 'XL', quantity: 1 },
      { product: polo, placements: ['Linkerborst'], size: 'L', quantity: 3 },
    ],
    'READY',
  );
  order(
    4,
    [
      { product: hoodie, placements: ['Linkerborst', 'Rug'], size: 'M', quantity: 2 },
      { product: hoodie, placements: ['Linkerborst', 'Rug'], size: 'M', quantity: 3, replaced: true },
    ],
    'READY',
  );
  order(5, [{ product: polo, placements: ['Linkerborst', 'Rug'], size: 'XXL', quantity: 8 }], 'ARTWORK_LOCKED');
  order(
    6,
    [
      {
        product: tee,
        placements: ['Linkerborst', 'Rechterborst', 'Buik', 'Rug', 'Linker Schouder', 'Rechter Schouder'],
        size: '7XL',
        quantity: 1,
      },
    ],
    'READY',
  );
  order(
    7,
    ['S', 'M', 'L', 'XL'].map((size, index) => ({
      product: hoodie,
      placements: ['Linkerborst', 'Rug'],
      size,
      quantity: index + 1,
    })),
    'PENDING_ARTWORK',
  );
  const varied = orders.pop();
  const design = varied?.groups[0];
  if (!varied || !design) throw new Error('Missing multi-size demo order');
  // These four size selections share one design and the same placement artwork.
  orders.push(
    PurchaseViewSchema.parse({
      ...varied,
      groups: [{ ...design, variants: varied.groups.flatMap((group) => group.variants) }],
    }),
  );
  return orders;
}
