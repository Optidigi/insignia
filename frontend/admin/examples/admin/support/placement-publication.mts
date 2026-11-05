/** Local-preview publication validation; this is not a Shopify publication adapter. */

import {
  inspectPlacementPreviewState,
  type PlacementPreviewState,
  type PlacementPreviewStorage,
  type PlacementSetupExample,
  resolvePlacementPreviewStorage,
  writePlacementPreviewState,
} from './placement-preview-storage.mts';
import { variantPhotoCoverageIssues } from './placement-variant-photos.mts';
import {
  type PlacementProduct,
  type PlacementValidationError,
  placementProductSchema,
  placementSetupIssue,
  validatePlacementProduct,
} from './placement-workflow-model.mts';

export type PlacementPublicationIssue = {
  key: string;
  reason: PlacementPublicationReason;
  viewId?: string;
  placementId?: string;
  groupKey?: string;
};

export type PlacementPublicationReason =
  | PlacementValidationError
  | 'image-required'
  | 'alignment-review'
  | 'movement-area-required'
  | 'price-required'
  | 'variant-image-required'
  | 'variant-alignment-review'
  | 'image-loading'
  | 'image-unavailable'
  | 'invalid-schema';

export type PublishPlacementPreviewResult =
  | { status: 'published'; state: PlacementPreviewState }
  | { status: 'invalid'; issues: PlacementPublicationIssue[] }
  | { status: 'conflict'; currentRevision: number }
  | { status: 'storage-error'; reason: 'unavailable' | 'malformed-state' | 'write-failed' };

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

/**
 * Publish the reviewed current candidate as one tab-local snapshot. A production adapter
 * must persist/version-check the draft before publishing; this helper only simulates that seam.
 */
export function publishPlacementPreviewProduct(
  example: PlacementSetupExample,
  currentCandidate: PlacementProduct,
  storage?: PlacementPreviewStorage,
  expectedRevision?: number,
): PublishPlacementPreviewResult {
  const actualStorage = resolvePlacementPreviewStorage(storage);
  if (!actualStorage) return { status: 'storage-error', reason: 'unavailable' };

  const parsedProduct = placementProductSchema.safeParse(currentCandidate);
  if (!parsedProduct.success) {
    return {
      status: 'invalid',
      issues: parsedProduct.error.issues.map((issue) => ({
        key: issue.path.map(String).join('.') || 'product',
        reason: 'invalid-schema',
      })),
    };
  }
  const candidate = parsedProduct.data;

  const stored = inspectPlacementPreviewState(example, candidate.id, actualStorage);
  if (stored.status === 'malformed') return { status: 'storage-error', reason: 'malformed-state' };
  if (stored.status === 'unavailable') return { status: 'storage-error', reason: 'unavailable' };
  const currentRevision = stored.status === 'valid' ? stored.state.revision : 0;
  if (expectedRevision !== undefined && expectedRevision !== currentRevision)
    return { status: 'conflict', currentRevision };

  const issues = placementPublicationIssues(candidate);
  if (issues.length) return { status: 'invalid', issues };

  const state: PlacementPreviewState = {
    version: 1,
    draft: candidate,
    published: candidate,
    revision: currentRevision + 1,
  };
  if (!writePlacementPreviewState(example, state, actualStorage))
    return { status: 'storage-error', reason: 'write-failed' };
  return { status: 'published', state };
}
