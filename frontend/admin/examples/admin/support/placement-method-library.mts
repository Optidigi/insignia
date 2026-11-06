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

export { availablePlacementMethods, importPlacementMethods } from '../../../src/islands/selected-method-choices.ts';
