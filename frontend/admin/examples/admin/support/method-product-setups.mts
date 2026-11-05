/** Read product-owned saved snapshots for Methods. Eligibility does not establish usage or readiness. */
import type { MethodProduct } from './method-configuration.mts';
import {
  inspectPlacementPreviewState,
  type PlacementPreviewStorage,
  type PlacementSetupExample,
} from './placement-preview-storage.mts';
import { applyPlacementSetupExample } from './placement-workflow-examples.mts';
import { type PlacementProduct, placementSetupIssue } from './placement-workflow-model.mts';

export function projectMethodProducts(
  products: readonly MethodProduct[],
  configured: readonly PlacementProduct[],
  example: PlacementSetupExample,
  storage: PlacementPreviewStorage | null,
): MethodProduct[] {
  return products.map((product) => {
    const initial = configured.find((item) => item.id.split('/').at(-1) === product.id);
    if (!initial) return { ...product, setup: [] };
    const saved = inspectPlacementPreviewState(example, initial.id, storage);
    if (saved.status === 'malformed' || saved.status === 'unavailable')
      throw new Error('Saved product setup could not be read.');
    const draft = saved.status === 'valid' ? saved.state.draft : applyPlacementSetupExample(initial, example);
    return {
      ...product,
      setup: draft.methods.map((method) => {
        const areas = draft.views.flatMap((view) =>
          view.placements.filter((area) => area.methodIds.includes(method.id)).map((area) => ({ view, area })),
        );
        return {
          methodId: method.id,
          locations: areas.length,
          pricedLocations: areas.filter(
            ({ view, area }) =>
              !!view.imageUrl &&
              !view.needsAlignmentReview &&
              placementSetupIssue({ ...draft, methods: [method] }, { ...area, methodIds: [method.id] }) === null,
          ).length,
        };
      }),
    };
  });
}
