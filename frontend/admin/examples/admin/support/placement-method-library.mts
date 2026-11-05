/** Explicit catalog-to-product snapshots for the loopback preview only. */
import { assignedProducts, methodErrors, methodPreviewSchema } from './method-configuration.mts';
import type { EditorMethod, PlacementProduct } from './placement-workflow-model.mts';

type MethodCatalog = ReturnType<typeof methodPreviewSchema.parse>;

export function methodCatalogStorageKey(large: boolean): string {
  return large ? 'insignia-methods-preview-large-v1' : 'insignia-methods-preview-v1';
}

export async function loadPlacementMethodCatalog(signal: AbortSignal): Promise<MethodCatalog> {
  const large = sessionStorage.getItem('insignia-method-catalog') === 'large';
  const response = await fetch(`/__preview/method-workflow/data${large ? '?catalog=large' : ''}`, { signal });
  if (!response.ok) throw new Error('The method library could not be loaded.');
  const data = methodPreviewSchema.parse(await response.json());
  const stored = sessionStorage.getItem(methodCatalogStorageKey(large));
  const methods = stored === null ? data.methods : methodPreviewSchema.shape.methods.parse(JSON.parse(stored));
  const ids = new Set<string>();
  for (const method of methods) {
    if (!method.id.trim() || ids.has(method.id) || Object.keys(methodErrors(method)).length)
      throw new Error('The saved method library needs review.');
    ids.add(method.id);
  }
  return { ...data, methods };
}

const productIdentity = (id: string) => id.replace(/^gid:\/\/shopify\/Product\//, '');

/** Existing product snapshots win. Catalog assignment only supplies additional choices. */
export function availablePlacementMethods(product: PlacementProduct, catalog: MethodCatalog): EditorMethod[] {
  const methods = new Map(product.methods.map((method) => [method.id, structuredClone(method)]));
  for (const method of catalog.methods) {
    if (methods.has(method.id)) continue;
    const assigned = assignedProducts(method, catalog.products).some(
      (candidate) => productIdentity(candidate.id) === productIdentity(product.id),
    );
    if (!assigned) continue;
    methods.set(method.id, { id: method.id, name: method.name, pricing: method.pricing, amount: method.amount });
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
