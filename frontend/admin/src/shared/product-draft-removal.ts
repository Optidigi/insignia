import type { MerchantDraft } from '@insignia/contracts';
import { type GeometryV1, validateGeometry } from '@insignia/ui-visualizer/geometry';

export type ProductDraftRemoval =
  | { kind: 'view'; id: string }
  | { kind: 'placement'; id: string; viewId: string }
  | { kind: 'step'; id: string };

/** Removes only editable draft choices; shared placements survive until their last view is removed. */
export function removeProductDraftChoice(draft: MerchantDraft, removal: ProductDraftRemoval): MerchantDraft {
  const geometry = validateGeometry(draft.geometry as GeometryV1);
  const removedPlacements = new Set<string>();
  let views = geometry.views;
  let steps = geometry.steps;
  if (removal.kind === 'view') {
    if (views.length <= 1) throw new Error('Keep at least one product view.');
    const removed = views.find((view) => view.id === removal.id);
    views = views.filter((view) => view.id !== removal.id);
    for (const placement of removed?.placements ?? [])
      if (!views.some((view) => view.placements.some((item) => item.id === placement.id)))
        removedPlacements.add(placement.id);
  } else if (removal.kind === 'placement') {
    views = views.map((view) =>
      view.id === removal.viewId
        ? { ...view, placements: view.placements.filter((placement) => placement.id !== removal.id) }
        : view,
    );
    if (!views.some((view) => view.placements.some((placement) => placement.id === removal.id)))
      removedPlacements.add(removal.id);
  } else {
    steps = steps.filter((step) => step.id !== removal.id);
  }
  const removedPrices = draft.pricingRules.filter(
    (rule) =>
      ('placementId' in rule.scope && removedPlacements.has(rule.scope.placementId)) ||
      (removal.kind === 'step' && rule.scope.kind === 'step' && rule.scope.stepId === removal.id),
  );
  const labels = draft.labels ? structuredClone(draft.labels) : undefined;
  if (labels) {
    if (removal.kind === 'view' && labels.views) delete labels.views[removal.id];
    if (removal.kind === 'step' && labels.steps) delete labels.steps[removal.id];
    for (const id of removedPlacements) if (labels.placements) delete labels.placements[id];
    for (const rule of removedPrices) if (labels.prices) delete labels.prices[rule.id];
  }
  return {
    ...draft,
    labels,
    geometry: validateGeometry({ ...geometry, views, steps }),
    placements: draft.placements
      .filter((placement) => !removedPlacements.has(placement.id))
      .map((placement) =>
        removal.kind === 'step'
          ? { ...placement, allowedStepIds: placement.allowedStepIds.filter((id) => id !== removal.id) }
          : placement,
      ),
    pricingRules: draft.pricingRules.filter((rule) => !removedPrices.includes(rule)),
  };
}
