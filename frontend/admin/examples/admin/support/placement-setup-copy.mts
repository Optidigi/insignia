/** Pure cross-product setup snapshots shared by the selected UI hosts. No media or Shopify writes are copied. */
import type { EditorMethod, EditorPlacement, PlacementProduct } from './placement-workflow-model.mts';

export type CopySetupIdKind = 'view' | 'placement' | 'size' | 'option' | 'value';

export interface CopyPlacementSetupOptions {
  selectedViewIds: readonly string[];
  includeMethods?: boolean;
  includePrices?: boolean;
  createId?: (kind: CopySetupIdKind) => string;
}

export type CopyPlacementSetupError =
  | 'same-product'
  | 'target-has-views'
  | 'no-source-views'
  | 'no-views-selected'
  | 'unknown-source-view'
  | 'duplicate-source-method'
  | 'duplicate-target-method'
  | 'missing-source-method'
  | 'id-collision';

export type PlacementSetupCopyProduct = PlacementProduct & {
  views: (PlacementProduct['views'][number] & { needsAlignmentReview: true })[];
};

export interface CopyPlacementSetupSummary {
  views: number;
  placements: number;
  methods: number;
  prices: number;
}

export type CopyPlacementSetupResult =
  | {
      kind: 'copied';
      product: PlacementSetupCopyProduct;
      summary: CopyPlacementSetupSummary;
    }
  | { kind: 'error'; reason: CopyPlacementSetupError };

function defaultId(kind: CopySetupIdKind): string {
  return `${kind}-${globalThis.crypto.randomUUID()}`;
}

function collectIds(product: PlacementProduct, used: Set<string>): void {
  for (const method of product.methods) used.add(method.id);
  for (const option of product.productionChoices?.definitions ?? []) {
    used.add(option.id);
    for (const value of option.allowedValueIds) used.add(value);
  }
  for (const view of product.views) {
    used.add(view.id);
    for (const placement of view.placements) {
      used.add(placement.id);
      for (const size of placement.sizes) used.add(size.id);
    }
  }
}

/**
 * Copy selected source views into an unconfigured target product. The source image is deliberately
 * removed: every destination view needs its own image and a fresh alignment review.
 */
export function copyPlacementSetup(
  source: PlacementProduct,
  target: PlacementProduct,
  options: CopyPlacementSetupOptions,
): CopyPlacementSetupResult {
  if (source.id === target.id) return { kind: 'error', reason: 'same-product' };
  if (target.views.length) return { kind: 'error', reason: 'target-has-views' };
  if (!source.views.length) return { kind: 'error', reason: 'no-source-views' };
  if (!options.selectedViewIds.length) return { kind: 'error', reason: 'no-views-selected' };

  const selected = new Set(options.selectedViewIds);
  if (selected.size !== options.selectedViewIds.length) return { kind: 'error', reason: 'unknown-source-view' };
  const sourceViews = source.views.filter((view) => selected.has(view.id));
  if (sourceViews.length !== selected.size) return { kind: 'error', reason: 'unknown-source-view' };

  const includeMethods = options.includeMethods ?? true;
  const includePrices = includeMethods && (options.includePrices ?? false);
  const sourceMethods = new Map<string, EditorMethod>();
  for (const method of source.methods) {
    if (sourceMethods.has(method.id)) return { kind: 'error', reason: 'duplicate-source-method' };
    sourceMethods.set(method.id, method);
  }
  const targetMethods = new Map<string, EditorMethod>();
  for (const method of target.methods) {
    if (targetMethods.has(method.id)) return { kind: 'error', reason: 'duplicate-target-method' };
    targetMethods.set(method.id, structuredClone(method));
  }

  const neededMethodIds = new Set<string>();
  if (includeMethods) {
    for (const view of sourceViews)
      for (const placement of view.placements)
        for (const id of placement.methodIds) {
          if (!sourceMethods.has(id)) return { kind: 'error', reason: 'missing-source-method' };
          neededMethodIds.add(id);
        }
  }

  const importedMethods = source.methods
    .filter((method) => neededMethodIds.has(method.id) && !targetMethods.has(method.id))
    .map((method) => structuredClone(method));
  const effectiveMethods = new Map(targetMethods);
  for (const method of importedMethods) effectiveMethods.set(method.id, method);

  const usedIds = new Set<string>();
  collectIds(source, usedIds);
  collectIds(target, usedIds);
  const createId = options.createId ?? defaultId;
  const fresh = (kind: CopySetupIdKind): string | null => {
    const id = createId(kind);
    if (!id.trim() || usedIds.has(id)) return null;
    usedIds.add(id);
    return id;
  };

  let productionChoices: PlacementProduct['productionChoices'];
  if (source.productionChoices) {
    const definitions: NonNullable<PlacementProduct['productionChoices']>['definitions'] = [];
    const labels: NonNullable<PlacementProduct['productionChoices']>['labels'] = { options: {}, values: {} };
    for (const option of source.productionChoices.definitions) {
      const id = fresh('option');
      if (!id) return { kind: 'error', reason: 'id-collision' };
      const values: string[] = [];
      const valueLabels: Record<string, string> = {};
      for (const value of option.allowedValueIds) {
        const valueId = fresh('value');
        if (!valueId) return { kind: 'error', reason: 'id-collision' };
        values.push(valueId);
        const label = source.productionChoices.labels.values?.[option.id]?.[value];
        if (label !== undefined) valueLabels[valueId] = label;
      }
      definitions.push({ id, allowedValueIds: values });
      const label = source.productionChoices.labels.options?.[option.id];
      if (label !== undefined) labels.options![id] = label;
      labels.values![id] = valueLabels;
    }
    productionChoices = { definitions, labels };
  }

  let placementCount = 0;
  let priceCount = 0;
  const copiedViews: PlacementSetupCopyProduct['views'] = [];
  for (const sourceView of sourceViews) {
    const viewId = fresh('view');
    if (!viewId) return { kind: 'error', reason: 'id-collision' };
    const placements: EditorPlacement[] = [];
    for (const sourcePlacement of sourceView.placements) {
      const placementId = fresh('placement');
      if (!placementId) return { kind: 'error', reason: 'id-collision' };
      const methodIds = includeMethods ? [...new Set(sourcePlacement.methodIds)] : [];
      const sizes = includeMethods
        ? sourcePlacement.sizes.map((sourceSize) => {
            const sizeId = fresh('size');
            if (!sizeId) return null;
            const prices = includePrices
              ? Object.fromEntries(
                  Object.entries(sourceSize.prices).filter(
                    ([methodId, amount]) =>
                      amount.trim() &&
                      methodIds.includes(methodId) &&
                      sourceMethods.get(methodId)?.pricing === 'product' &&
                      effectiveMethods.get(methodId)?.pricing === 'product',
                  ),
                )
              : {};
            priceCount += Object.keys(prices).length;
            return { ...sourceSize, id: sizeId, prices };
          })
        : [];
      if (sizes.some((size) => size === null)) return { kind: 'error', reason: 'id-collision' };
      placements.push({
        ...sourcePlacement,
        id: placementId,
        rect: { ...sourcePlacement.rect },
        ...(sourcePlacement.movementRect ? { movementRect: { ...sourcePlacement.movementRect } } : {}),
        widthCm: '',
        heightCm: '',
        methodIds,
        sizes: includeMethods
          ? (sizes as NonNullable<(typeof sizes)[number]>[])
          : [{ id: fresh('size') ?? '', name: 'Standard', widthPercent: '100', prices: {} }],
        logoLaterAllowed: includeMethods && sourcePlacement.logoLaterAllowed,
      });
      if (!placements.at(-1)?.sizes.at(-1)?.id) return { kind: 'error', reason: 'id-collision' };
      placementCount += 1;
    }
    copiedViews.push({
      id: viewId,
      name: sourceView.name,
      imageUrl: '',
      imageWidth: sourceView.imageWidth,
      imageHeight: sourceView.imageHeight,
      needsAlignmentReview: true,
      placements,
    });
  }

  // Same-ID methods already present on the target keep the target's saved definition and amount.
  const methods = [...target.methods.map((method) => ({ ...method })), ...importedMethods];
  return {
    kind: 'copied',
    product: {
      ...target,
      ...(productionChoices ? { productionChoices } : {}),
      images: target.images.map((image) => ({ ...image })),
      methods,
      views: copiedViews,
    },
    summary: {
      views: copiedViews.length,
      placements: placementCount,
      methods: neededMethodIds.size,
      prices: priceCount,
    },
  };
}
