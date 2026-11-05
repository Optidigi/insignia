import {
  type BuyerDesiredGroup,
  type CustomerCanonicalProduct,
  readSelectedStepIdentity,
  selectedStepIdentity,
  type SelectedProductSetup,
} from '@insignia/contracts';
import { type GeometryV1, validateGeometry } from '@insignia/visualizer/geometry';
import { configSchema, type ProductConfig } from './config';
import type { Design } from './model';
import { buildShopifyVariantMatrix } from './shopify-variant-matrix';

export type PublishedDesignerSource = {
  geometry?: GeometryV1;
  stepBindings?: readonly { placementId: string; sizeId: string; stepId: string }[];
  variantRowsById?: boolean;
  imageUrls?: Record<string, string>;
  productId: string;
  revisionId: string;
  contentHash: string;
  title?: string;
  shopCurrency?: 'USD' | 'EUR';
  selectedSetup?: SelectedProductSetup;
  readProduct?: CustomerCanonicalProduct;
  placements: { id: string; allowedStepIds: string[] }[];
  options: { id: string; label: string; values: { id: string; label: string }[] }[];
  variants: {
    id: string;
    label: string;
    available: boolean;
    selectedOptions?: { name: string; value: string }[];
    baseUnitMinor?: string;
  }[];
  decorationPrices?: { placementId: string; methodId: string; stepId: string; minor: string }[];
};
/** Reversible code-unit encoding gives stable UI-safe aliases without array-index identity. */
export function designerAlias(value: string): string {
  if (!value) throw new Error('Missing stable designer identity');
  const points: string[] = [];
  for (const character of value) {
    const point = character.codePointAt(0);
    if (point === undefined) throw new Error('Missing stable designer identity');
    points.push(point.toString(16).padStart(6, '0'));
  }
  return `id-${points.join('')}`;
}
function displayMinor(value: string | undefined): number {
  if (!value || !/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('Unsupported display amount');
  return Number(value);
}
/** Real published data only: no demo prices, garment guesses, sample artwork or variant fabrication. */
export function buildPublishedDesigner(
  source: PublishedDesignerSource,
  options: { locale: string; storeName: string },
) {
  const product = source.readProduct ?? source.selectedSetup?.product;
  const stepIdentity = (placementId: string, sizeId: string) => {
    const explicit = source.stepBindings?.find(
      (binding) => binding.placementId === placementId && binding.sizeId === sizeId,
    )?.stepId;
    const allowed = source.placements.find((placement) => placement.id === placementId)?.allowedStepIds ?? [];
    const id =
      explicit && allowed.includes(explicit) ? explicit : readSelectedStepIdentity(placementId, sizeId, allowed);
    if (!id || !source.geometry?.steps.some((step) => step.id === id))
      throw new Error('Published decoration size binding unavailable');
    return id;
  };
  if (!product || !source.shopCurrency || !['USD', 'EUR'].includes(source.shopCurrency) || !source.decorationPrices)
    throw new Error('Published designer configuration unavailable');
  const grouping = product.variantPhotos?.groupingOptionIds.map(
    (id) => product.variantPhotos?.options.find((option) => option.id === id)?.name ?? '',
  );
  const matrix = buildShopifyVariantMatrix(
    { variants: source.variants.map((variant) => ({ ...variant, selectedOptions: variant.selectedOptions ?? null })) },
    grouping,
  );
  if (matrix.status !== 'ready') throw new Error(`Unsupported Shopify variant shape: ${matrix.reason}`);
  if (source.variantRowsById) {
    const rows = new Map<string, string>();
    for (const row of matrix.colors) {
      const variants = matrix.variantMatrix.filter((cell) => cell.rowId === row.id);
      if (variants.length !== 1 || !variants[0]) throw new Error('Canonical variant identity is not representable');
      const id = variants[0].variantId;
      rows.set(row.id, designerAlias(`variant:${id}`));
      row.id = rows.get(row.id) ?? row.id;
      row.name = source.variants.find((variant) => variant.id === id)?.label ?? row.name;
    }
    matrix.variantMatrix = matrix.variantMatrix.map((cell) => ({ ...cell, rowId: rows.get(cell.rowId) ?? cell.rowId }));
  }
  const methods = new Map(product.methods.map((method) => [designerAlias(method.id), method.id]));
  const placements = new Map<string, { placementId: string; sizeIds: string[] }>();
  const variantBasePrices = Object.fromEntries(
    source.variants.map((variant) => [variant.id, displayMinor(variant.baseUnitMinor)]),
  );
  const colors = matrix.colors.map((row) => ({
    ...row,
    imageAspects: Object.fromEntries<number>([]),
    images: Object.fromEntries(
      product.views.flatMap((view) => (view.imageUrl ? [[designerAlias(view.id), view.imageUrl]] : [])),
    ),
  }));
  const positions: ProductConfig['positions'] = product.views.flatMap((view) =>
    view.placements.map((placement) => {
      const alias = designerAlias(placement.id);
      placements.set(alias, {
        placementId: placement.id,
        sizeIds: placement.sizes.map((size) => stepIdentity(placement.id, size.id)),
      });
      const widths = placement.sizes.map((size) => Number(size.widthPercent));
      if (!widths.length || widths.some((width) => !Number.isFinite(width) || width <= 0 || width > 100))
        throw new Error('Published decoration sizes unavailable');
      const first = widths[0];
      if (first === undefined) throw new Error('Published decoration sizes unavailable');
      const methodSizePrices = Object.fromEntries(
        placement.methodIds.map((methodId) => [
          designerAlias(methodId),
          placement.sizes.map((size) => {
            const stepId = stepIdentity(placement.id, size.id);
            const price = source.decorationPrices?.find(
              (price) => price.placementId === placement.id && price.methodId === methodId && price.stepId === stepId,
            );
            return price ? displayMinor(price.minor) : null;
          }),
        ]),
      );
      const eligible = placement.methodIds.filter((methodId) =>
        methodSizePrices[designerAlias(methodId)]?.some((amount) => amount !== null),
      );
      if (!eligible.length) throw new Error('Published decoration method prices unavailable');
      return {
        id: alias,
        name: placement.name,
        view: designerAlias(view.id),
        x: placement.rect.centerX * 100,
        y: placement.rect.centerY * 100,
        width: placement.rect.width * first,
        maximumHeight:
          placement.rect.height * Number(placement.sizes[0]?.heightPercent ?? placement.sizes[0]?.widthPercent),
        sizeBounds: placement.sizes.map((size) => {
          const step = source.geometry?.steps.find((step) => step.id === stepIdentity(placement.id, size.id));
          if (!step) throw new Error('Published size geometry unavailable');
          return {
            width: placement.rect.width * step.widthFraction * 100,
            maximumHeight: placement.rect.height * step.heightFraction * 100,
          };
        }),
        dimensions: placement.sizes.map((size) => {
          const physical = source.geometry?.steps.find(
            (step) => step.id === stepIdentity(placement.id, size.id),
          )?.physicalMm;
          if (!physical) throw new Error('Published production dimensions unavailable');
          return physical.width / 10;
        }),
        sizeLabels: placement.sizes.map((size) => size.name),
        price: 0,
        sizePrices: widths.map(() => 0),
        methodSizePrices,
        methodIds: eligible.map(designerAlias),
        artworkLater: placement.logoLaterAllowed,
        ...(placement.customPlacementAllowed && placement.movementRect
          ? {
              movementArea: {
                x: placement.movementRect.centerX * 100,
                y: placement.movementRect.centerY * 100,
                width: placement.movementRect.width * 100,
                height: placement.movementRect.height * 100,
              },
            }
          : {}),
      };
    }),
  );
  const positionOverrides: Record<
    string,
    Record<
      string,
      {
        x: number;
        y: number;
        width: number;
        maximumHeight: number;
        movementArea?: { x: number; y: number; width: number; height: number };
        sizeBounds?: { width: number; maximumHeight: number }[];
      }
    >
  > = {};
  if (source.geometry) {
    const geometry = validateGeometry(source.geometry);
    for (const row of colors) {
      const variants = matrix.variantMatrix.filter((cell) => cell.rowId === row.id);
      const overrides: (typeof positionOverrides)[string] = {};
      for (const view of product.views) {
        const publishedView = geometry.views.find((candidate) => candidate.id === view.id);
        if (!publishedView) throw new Error('Published view unavailable');
        const appearances = variants.map(
          (cell) =>
            publishedView.variantImages.find((image) => image.variantId === cell.variantId)?.image ??
            publishedView.image,
        );
        const imageIds = new Set(appearances.map((image) => image?.revisionId));
        if (imageIds.size !== 1) throw new Error('Variant photo grouping is not representable');
        const imageId = appearances[0]?.revisionId;
        const url = imageId ? source.imageUrls?.[imageId] : undefined;
        if (url) row.images[designerAlias(view.id)] = url;
        else delete row.images[designerAlias(view.id)];
        row.imageAspects ??= {};
        const ref = appearances[0];
        if (ref) row.imageAspects[designerAlias(view.id)] = ref.width / ref.height;
        for (const placement of view.placements) {
          const published = publishedView.placements.find((candidate) => candidate.id === placement.id);
          if (!published) throw new Error('Published placement unavailable');
          const rects = variants.map(
            (cell) =>
              published.variantOverrides?.find((override) => override.variantId === cell.variantId)?.rect ??
              published.rect,
          );
          if (new Set(rects.map((rect) => JSON.stringify(rect))).size !== 1)
            throw new Error('Variant placement grouping is not representable');
          const rect = rects[0];
          const first = Number(placement.sizes[0]?.widthPercent);
          if (!rect || !Number.isFinite(first) || first <= 0) throw new Error('Published placement unavailable');
          const sourceRect = placement.rect;
          const movement =
            placement.customPlacementAllowed && placement.movementRect
              ? {
                  x:
                    (rect.centerX +
                      ((placement.movementRect.centerX - sourceRect.centerX) * rect.width) / sourceRect.width) *
                    100,
                  y:
                    (rect.centerY +
                      ((placement.movementRect.centerY - sourceRect.centerY) * rect.height) / sourceRect.height) *
                    100,
                  width: ((placement.movementRect.width * rect.width) / sourceRect.width) * 100,
                  height: ((placement.movementRect.height * rect.height) / sourceRect.height) * 100,
                }
              : undefined;
          overrides[designerAlias(placement.id)] = {
            x: rect.centerX * 100,
            y: rect.centerY * 100,
            width: rect.width * first,
            maximumHeight: rect.height * Number(placement.sizes[0]?.heightPercent ?? placement.sizes[0]?.widthPercent),
            sizeBounds: placement.sizes.map((size) => {
              const step = geometry.steps.find((step) => step.id === stepIdentity(placement.id, size.id));
              if (!step) throw new Error('Published size geometry unavailable');
              return {
                width: rect.width * step.widthFraction * 100,
                maximumHeight: rect.height * step.heightFraction * 100,
              };
            }),
            ...(movement ? { movementArea: movement } : {}),
          };
        }
      }
      positionOverrides[row.id] = overrides;
    }
  }
  const config = configSchema.parse({
    id: designerAlias(`${source.productId}:${source.revisionId}`),
    name: product.title,
    description: product.title,
    storeName: options.storeName || product.title,
    productName: product.title,
    productDescription: product.title,
    ...(source.geometry ? { positionOverrides } : {}),
    basePrice: Math.min(...Object.values(variantBasePrices)),
    variantBasePrices,
    currency: source.shopCurrency,
    locale: options.locale,
    preview: 'photo',
    maxQuantity: 10000,
    artworkLater: false,
    sizes: matrix.sizes,
    colors,
    ...(colors.some((row) => product.views.some((view) => !row.images[designerAlias(view.id)]))
      ? { previewUnavailable: true }
      : {}),
    variantMatrix: matrix.variantMatrix,
    optionPresentation: matrix.optionPresentation,
    views: product.views.map((view) => ({
      id: designerAlias(view.id),
      label: view.name,
      illustration: 'front' as const,
    })),
    methods: product.methods
      .filter((method) => positions.some((position) => position.methodIds.includes(designerAlias(method.id))))
      .map(designerMethod),
    positions,
    ...(source.options.length
      ? {
          productionOptions: source.options.map((option) => ({
            id: designerAlias(option.id),
            label: option.label,
            values: option.values.map((value) => ({ id: designerAlias(value.id), label: value.label })),
          })),
        }
      : {}),
  });
  function desired(design: Design): BuyerDesiredGroup {
    if (!design.variants?.length) throw new Error('Real variant selections required');
    const chosen = design.options ?? [];
    if (
      chosen.length !== source.options.length ||
      new Set(chosen.map((option) => option.optionId)).size !== chosen.length
    )
      throw new Error('Complete production choices required');
    const selectedOptions = source.options.map((option) => {
      const choice = chosen.find((value) => value.optionId === designerAlias(option.id));
      const selected = option.values.find((value) => designerAlias(value.id) === choice?.valueId);
      if (!choice || !selected) throw new Error('A production choice is unavailable');
      return { optionId: option.id, valueId: selected.id };
    });
    return {
      productId: source.productId,
      configRevisionId: source.revisionId,
      revisionContentHash: source.contentHash,
      design: {
        placements: design.prints.map((print) => {
          const placement = placements.get(print.id),
            methodId = methods.get(print.method);
          const stepId = placement?.sizeIds[print.size];
          if (!placement || !methodId || !stepId || !print.artworkId) throw new Error('Invalid production selection');
          return {
            placementId: placement.placementId,
            methodId,
            stepId,
            artwork:
              print.artworkId === 'later'
                ? {
                    kind: 'deferred' as const,
                    intentId: print.deferredIntentId ?? selectedStepIdentity(design.id, placement.placementId),
                  }
                : { kind: 'revision' as const, revisionId: print.artworkId },
            ...(print.position
              ? {
                  position: {
                    xMicros: Math.round(print.position.x * 10000),
                    yMicros: Math.round(print.position.y * 10000),
                  },
                }
              : {}),
          };
        }),
        options: selectedOptions,
      },
      variants: design.variants.map((variant) => ({ ...variant })),
    };
  }
  function restore(group: BuyerDesiredGroup, designId: string): Design {
    if (
      group.productId !== source.productId ||
      group.design.options.length !== source.options.length ||
      new Set(group.design.options.map((option) => option.optionId)).size !== group.design.options.length
    )
      throw new Error('Unsupported restored production options');
    const restoredOptions = group.design.options.map((choice) => {
      const option = source.options.find((option) => option.id === choice.optionId);
      if (!option || !option.values.some((value) => value.id === choice.valueId))
        throw new Error('A saved production choice is no longer available');
      return { optionId: designerAlias(choice.optionId), valueId: designerAlias(choice.valueId) };
    });
    const prints = group.design.placements.map((selection) => {
      const entry = [...placements.entries()].find(([, placement]) => placement.placementId === selection.placementId);
      const method = [...methods.entries()].find(([, methodId]) => methodId === selection.methodId);
      const size = entry?.[1].sizeIds.indexOf(selection.stepId) ?? -1;
      if (!entry || !method || size < 0) throw new Error('A saved production choice is no longer available');
      return {
        id: entry[0],
        method: method[0],
        size,
        artworkId: selection.artwork.kind === 'deferred' ? 'later' : selection.artwork.revisionId,
        ...(selection.artwork.kind === 'deferred' ? { deferredIntentId: selection.artwork.intentId } : {}),
        ...(selection.position
          ? { position: { x: selection.position.xMicros / 10000, y: selection.position.yMicros / 10000 } }
          : {}),
      };
    });
    const quantities: Record<string, number> = {};
    for (const variant of group.variants) {
      const cell = config.variantMatrix?.find((cell) => cell.variantId === variant.variantId);
      if (!cell) throw new Error('A saved Shopify variant is no longer available');
      quantities[`${cell.rowId}:${cell.columnId}`] = variant.quantity;
    }
    return {
      id: designId,
      prints,
      quantities,
      variants: group.variants.map((variant) => ({ ...variant })),
      ...(restoredOptions.length ? { options: restoredOptions } : {}),
    };
  }
  return { config, desired, restore, placements, methods };
}

export function designerMethod(method: SelectedProductSetup['product']['methods'][number]) {
  return {
    id: designerAlias(method.id),
    label: method.name,
    defaultLabel: method.name,
    ...(method.explanation ? { description: method.explanation, defaultDescription: method.explanation } : {}),
    ...(method.translations
      ? {
          translations: Object.fromEntries(
            Object.entries(method.translations).map(([locale, text]) => [
              locale,
              {
                ...(text.name ? { label: text.name } : {}),
                ...(text.explanation ? { description: text.explanation } : {}),
              },
            ]),
          ),
        }
      : {}),
    surcharge: 0,
  };
}
