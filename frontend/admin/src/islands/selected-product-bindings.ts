import type {
  EditorMethod,
  EditorPlacement,
  MethodDraftBinding,
  PlacementProduct,
  VersionedMethodConfiguration,
} from '@insignia/contracts';
import { methodAssignedToProduct, methodAssignmentReviewKey } from '@insignia/contracts';
import { reconcileMethodBinding } from '@insignia/domain';
import { canonicalPriceText } from '../../examples/admin/support/method-workflow-prices.mts';

export type ProductMethodBindings = Record<string, MethodDraftBinding>;
const cellKey = (placementId: string, sizeId: string) => JSON.stringify([placementId, sizeId]);

/** Display assignment review as soon as current product tags are observed, without changing prices/text or saving. */
export function currentProductMethodReviews(
  bindings: ProductMethodBindings,
  catalog: readonly VersionedMethodConfiguration[],
  product: { id: string; tags?: readonly string[] },
): ProductMethodBindings {
  let next = bindings;
  for (const [id, binding] of Object.entries(bindings)) {
    const current = catalog.find((method) => method.configuration.id === binding.catalogMethodId) ?? null;
    if (current?.configuration.assignment === 'tags' && product.tags === undefined)
      throw new Error('Current product assignment tags unavailable');
    const assigned =
      !!current && methodAssignedToProduct(current.configuration, { id: product.id, tags: product.tags ?? [] });
    const review = reconcileMethodBinding(
      binding,
      current,
      assigned,
      methodAssignmentReviewKey(current?.configuration ?? null, assigned),
      false,
    ).review;
    if (
      binding.review?.reason === review?.reason &&
      binding.review?.catalogVersion === review?.catalogVersion &&
      binding.review?.decision === review?.decision &&
      binding.review?.assignmentKey === review?.assignmentKey
    )
      continue;
    if (next === bindings) next = { ...bindings };
    next[id] = { ...binding, review };
  }
  return next;
}

/** Explicit import/edit actions establish provenance. Matching values or IDs alone never do. */
export function applyMethodImport(input: {
  bindings: ProductMethodBindings;
  product: PlacementProduct;
  placementId: string;
  change: Pick<EditorPlacement, 'methodIds' | 'sizes'>;
  choices: EditorMethod[];
  editedIds: string[];
  editedCells: { sizeId: string; methodId: string }[];
  catalog: readonly VersionedMethodConfiguration[];
  currency: string;
}): ProductMethodBindings {
  const bindings = structuredClone(input.bindings);
  for (const methodId of input.change.methodIds) {
    const record = input.catalog.find((item) => item.configuration.id === methodId);
    if (!bindings[methodId] && !input.product.methods.some((method) => method.id === methodId) && record) {
      if (record.configuration.pricing === 'fixed' && record.currency !== input.currency)
        throw new Error('Review the method price in the current shop currency');
      const configuration = record.configuration;
      bindings[methodId] = {
        catalogMethodId: methodId,
        observedVersion: record.version,
        name: { source: 'catalog', value: configuration.name },
        explanation: { source: 'catalog', value: configuration.explanation },
        translations: Object.fromEntries(
          Object.entries(configuration.translations ?? {}).map(([locale, value]) => [
            locale,
            {
              ...(value.name === undefined ? {} : { name: { source: 'catalog' as const, value: value.name } }),
              ...(value.explanation === undefined
                ? {}
                : { explanation: { source: 'catalog' as const, value: value.explanation } }),
            },
          ]),
        ),
        prices: { default: { source: 'catalog', value: configuration.amount } },
        review: null,
      };
    }
    const binding = bindings[methodId];
    if (!binding) continue; // Pre-existing independent snapshots keep their product-owned meaning.
    const choice = input.choices.find((item) => item.id === methodId);
    for (const size of input.change.sizes) {
      const key = cellKey(input.placementId, size.id);
      if (!binding.prices[key])
        binding.prices[key] = { source: 'catalog', value: choice?.pricing === 'fixed' ? choice.amount : '' };
    }
    if (input.editedIds.includes(methodId) && choice?.pricing === 'fixed') {
      binding.prices.default = { source: 'product', value: choice.amount };
      for (const view of input.product.views)
        for (const placement of view.placements) {
          const selected = placement.id === input.placementId ? input.change : placement;
          if (selected.methodIds.includes(methodId))
            for (const size of selected.sizes)
              binding.prices[cellKey(placement.id, size.id)] = { source: 'product', value: choice.amount };
        }
    }
  }
  for (const edited of input.editedCells) {
    const binding = bindings[edited.methodId];
    if (binding)
      binding.prices[cellKey(input.placementId, edited.sizeId)] = {
        source: 'product',
        value: input.change.sizes.find((size) => size.id === edited.sizeId)?.prices[edited.methodId] ?? '',
      };
  }
  return bindings;
}

/** Typed prices ("7,5") leave the editor as the exact dot-decimal text the server and reconciliation read. */
export function canonicalBindingPrices(bindings: ProductMethodBindings): ProductMethodBindings {
  return Object.fromEntries(
    Object.entries(bindings).map(([methodId, binding]) => [
      methodId,
      {
        ...binding,
        prices: Object.fromEntries(
          Object.entries(binding.prices).map(([key, price]) => [
            key,
            { ...price, value: canonicalPriceText(price.value) },
          ]),
        ),
      },
    ]),
  );
}

export function overrideProductPrice(
  bindings: ProductMethodBindings,
  placementId: string,
  sizeId: string,
  methodId: string,
  value: string,
): ProductMethodBindings {
  if (!bindings[methodId]) return bindings;
  const next = structuredClone(bindings);
  next[methodId]!.prices[cellKey(placementId, sizeId)] = { source: 'product', value };
  return next;
}

export function reviewProductMethod(
  product: PlacementProduct,
  bindings: ProductMethodBindings,
  methodId: string,
  decision: 'keep' | 'remove',
) {
  const binding = bindings[methodId];
  if (binding?.review?.decision !== 'pending') throw new Error('This method review is no longer current');
  const nextBindings = structuredClone(bindings);
  if (decision === 'keep') {
    nextBindings[methodId]!.review = { ...binding.review, decision: 'keep' };
    return { product, bindings: nextBindings };
  }
  delete nextBindings[methodId];
  return {
    bindings: nextBindings,
    product: {
      ...product,
      methods: product.methods.filter((method) => method.id !== methodId),
      views: product.views.map((view) => ({
        ...view,
        placements: view.placements.map((placement) => ({
          ...placement,
          methodIds: placement.methodIds.filter((id) => id !== methodId),
          sizes: placement.sizes.map((size) => ({
            ...size,
            prices: Object.fromEntries(Object.entries(size.prices).filter(([id]) => id !== methodId)),
          })),
        })),
      })),
    },
  };
}

/** New copied price entries are explicit snapshots; new empty cells may inherit a known method default. */
export function bindNewProductCells(product: PlacementProduct, bindings: ProductMethodBindings) {
  let nextProduct = product;
  let nextBindings = bindings;
  for (const view of product.views)
    for (const placement of view.placements)
      for (const methodId of placement.methodIds) {
        const original = bindings[methodId];
        if (!original) continue;
        const method = product.methods.find((entry) => entry.id === methodId);
        if (!method) continue;
        for (const size of placement.sizes) {
          const key = cellKey(placement.id, size.id);
          if (original.prices[key]) continue;
          if (nextBindings === bindings) nextBindings = structuredClone(bindings);
          const owns = Object.hasOwn(size.prices, methodId);
          const fallback = original.prices.default;
          const value =
            method.pricing === 'fixed' ? method.amount : owns ? size.prices[methodId]! : (fallback?.value ?? '');
          const source = method.pricing === 'fixed' ? (fallback?.source ?? 'product') : owns ? 'product' : 'catalog';
          nextBindings[methodId]!.prices[key] = { source, value };
          if (method.pricing === 'product' && !owns && value !== '') {
            if (nextProduct === product) nextProduct = structuredClone(product);
            const target = nextProduct.views
              .find((entry) => entry.id === view.id)!
              .placements.find((entry) => entry.id === placement.id)!
              .sizes.find((entry) => entry.id === size.id)!;
            target.prices[methodId] = value;
          }
        }
      }
  return { product: nextProduct, bindings: nextBindings };
}
