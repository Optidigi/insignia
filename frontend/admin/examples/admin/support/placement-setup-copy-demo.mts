/** Explicit loopback-only adapter for the selected shared copy dialog. */
import type { PlacementSetupCopyPorts } from './placement-setup-copy-dialog.tsx';
import { applyPlacementSetupExample } from './placement-workflow-examples.mts';
import { placementProductSchema } from './placement-workflow-model.mts';
import { inspectPlacementPreviewState, readPlacementPreviewProduct, readPlacementPreviewState, readPlacementSetupExample, writePlacementPreviewProduct } from './placement-preview-storage.mts';

export function createDemoPlacementSetupCopyPorts(): PlacementSetupCopyPorts {
  const example = readPlacementSetupExample();
  let reportStorage: PlacementSetupCopyPorts['reportStorage'] = null;
  try { reportStorage = sessionStorage; } catch { /* Demo explicitly exposes unavailable custody. */ }
  return {
    scope: () => example,
    reportStorage,
    async loadCatalog(signal) {
      const response = await fetch('/__preview/placement-workflow/catalog', { signal, headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error('Demo catalog unavailable');
      return placementProductSchema.array().parse(await response.json());
    },
    inspect(product) {
      const inspection = inspectPlacementPreviewState(example, product.id);
      if (inspection.status === 'malformed' || inspection.status === 'unavailable') return { product, readiness: 'unavailable' };
      const saved = readPlacementPreviewProduct(example, product.id);
      const value = saved ? { ...saved, title: product.title, images: saved.images.map((image) => ({ ...image })) } : applyPlacementSetupExample(product, example);
      if (new Set(value.methods.map((method) => method.id)).size !== value.methods.length) return { product: value, readiness: 'unavailable' };
      const state = readPlacementPreviewState(example, product.id);
      return { product: value, readiness: value.views.length > 0 || state?.published ? 'configured' : 'ready' };
    },
    async save(product) {
      if (!writePlacementPreviewProduct(example, product)) throw Object.assign(new Error('Demo save unavailable'), { code: 'storage-write-failed' });
    },
  };
}
