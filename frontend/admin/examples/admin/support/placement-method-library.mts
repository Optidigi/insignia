/** Explicit catalog-to-product snapshots for the loopback preview only. */
import { methodErrors, methodPreviewSchema, newMethod } from './method-configuration.mts';
import type { EditorMethod } from './placement-workflow-model.mts';

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

/** Demo "Add method": the new method joins the session's method library, like the production POST. */
export async function createPlacementPreviewMethod(input: { id: string; name: string }): Promise<EditorMethod> {
  const large = sessionStorage.getItem('insignia-method-catalog') === 'large';
  const { methods } = await loadPlacementMethodCatalog(AbortSignal.timeout(10_000));
  if (methods.length >= 100) throw new Error('The method library is full.');
  const method = { ...newMethod(), id: input.id, name: input.name, pricing: 'product' as const };
  sessionStorage.setItem(
    methodCatalogStorageKey(large),
    JSON.stringify([...methods.filter((item) => item.id !== input.id), method]),
  );
  return { id: method.id, name: method.name, pricing: 'product', amount: '' };
}

export { availablePlacementMethods, importPlacementMethods } from '../../../src/islands/selected-method-choices.ts';
