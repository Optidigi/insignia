import { variantPhotoCoverageIssues } from '../../examples/admin/support/placement-variant-photos.mts';
import {
  type PlacementProduct,
  type PlacementValidationError,
  placementSetupIssue,
  validatePlacementProduct,
} from '../../examples/admin/support/placement-workflow-model.mts';

export type PlacementPublicationIssue = {
  key: string;
  reason: PlacementPublicationReason;
  viewId?: string;
  placementId?: string;
  groupKey?: string;
};

export type PlacementPublicationReason =
  | PlacementValidationError
  | 'capacity-exceeded'
  | 'production-dimensions-required'
  | 'method-review-required'
  | 'image-required'
  | 'alignment-review'
  | 'movement-area-required'
  | 'price-required'
  | 'variant-image-required'
  | 'variant-alignment-review'
  | 'image-loading'
  | 'image-unavailable'
  | 'invalid-schema';

const dimensionsAreNotPublicationFields = /\.(?:widthCm|heightCm)$/;

function contextualIssue(
  product: PlacementProduct,
  key: string,
  reason: PlacementPublicationReason,
): PlacementPublicationIssue {
  for (const view of product.views) {
    const viewPrefix = `views.${view.id}`;
    if (key !== viewPrefix && !key.startsWith(`${viewPrefix}.`)) continue;
    for (const placement of view.placements) {
      const placementPrefix = `${viewPrefix}.placements.${placement.id}`;
      if (key === placementPrefix || key.startsWith(`${placementPrefix}.`)) {
        return { key, reason, viewId: view.id, placementId: placement.id };
      }
    }
    return { key, reason, viewId: view.id };
  }
  return { key, reason };
}

/** Return all actionable issues that block the local preview from being published. */
export function placementPublicationIssues(product: PlacementProduct): PlacementPublicationIssue[] {
  const issues: PlacementPublicationIssue[] = [];
  for (const [key, reason] of Object.entries(validatePlacementProduct(product))) {
    if (key.endsWith('.unavailable') || dimensionsAreNotPublicationFields.test(key)) continue;
    issues.push(contextualIssue(product, key, reason as PlacementValidationError));
  }

  for (const view of product.views) {
    if (!view.imageUrl.trim()) {
      issues.push(contextualIssue(product, `views.${view.id}.imageUrl`, 'image-required'));
    }
    if (view.needsAlignmentReview) {
      issues.push(contextualIssue(product, `views.${view.id}.alignment`, 'alignment-review'));
    }
    for (const placement of view.placements) {
      if (placement.customPlacementAllowed && !placement.movementRect) {
        const key = `views.${view.id}.placements.${placement.id}.movementRect`;
        issues.push(contextualIssue(product, key, 'movement-area-required'));
      }
      if (placementSetupIssue(product, placement) === 'price-required') {
        const key = `views.${view.id}.placements.${placement.id}.prices`;
        issues.push(contextualIssue(product, key, 'price-required'));
      }
    }
  }

  for (const issue of variantPhotoCoverageIssues(product))
    issues.push({
      key: `variantPhotos.${issue.viewId}.${issue.groupKey}`,
      reason: issue.kind === 'missing-image' ? 'variant-image-required' : 'variant-alignment-review',
      viewId: issue.viewId,
      groupKey: issue.groupKey,
    });
  return issues;
}
