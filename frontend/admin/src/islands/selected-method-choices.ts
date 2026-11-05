import { assignedProducts, type MethodConfiguration, type MethodProduct } from '../../examples/admin/support/method-configuration.mts';
import type { EditorMethod, PlacementProduct } from '@insignia/contracts';
export type PlacementMethodCatalog = { methods: MethodConfiguration[]; products: MethodProduct[] };
const productIdentity = (id: string) => id.replace(/^gid:\/\/shopify\/Product\//, '');

/** Existing product snapshots win. Catalog assignment only supplies additional choices. */
export function availablePlacementMethods(product: PlacementProduct, catalog: PlacementMethodCatalog): EditorMethod[] {
  const methods = new Map(product.methods.map((method) => [method.id, structuredClone(method)]));
  for (const method of catalog.methods) {
    if (methods.has(method.id)) continue;
    const assigned = assignedProducts(method, catalog.products).some(
      (candidate) => productIdentity(candidate.id) === productIdentity(product.id),
    );
    if (!assigned) continue;
    methods.set(method.id, { id: method.id, name: method.name, pricing: method.pricing, amount: method.amount, explanation: method.explanation, ...(method.translations ? { translations: method.translations } : {}) });
  }
  return [...methods.values()];
}

/** Import confirmed choices. Only explicitly edited selected product copies may replace existing defaults. */
export function importPlacementMethods(
  product: PlacementProduct,
  selectedIds: readonly string[],
  choices: readonly EditorMethod[],
  editedIds: readonly string[] = [],
): PlacementProduct {
  const methods = new Map(product.methods.map((method) => [method.id, method]));
  for (const id of selectedIds) {
    if (methods.has(id) && !editedIds.includes(id)) continue;
    const method = choices.find((candidate) => candidate.id === id);
    if (!method) throw new Error('Choose methods available for this product.');
    methods.set(id, structuredClone(method));
  }
  return { ...product, methods: [...methods.values()] };
}
