/** Local-preview publication validation; this is not a Shopify publication adapter. */

import {
  inspectPlacementPreviewState,
  type PlacementPreviewState,
  type PlacementPreviewStorage,
  type PlacementSetupExample,
  resolvePlacementPreviewStorage,
  writePlacementPreviewState,
} from './placement-preview-storage.mts';
import { placementProductSchema, type PlacementProduct } from './placement-workflow-model.mts';
import { placementPublicationIssues, type PlacementPublicationIssue } from '../../../src/islands/selected-product-publication.ts';
export { placementPublicationIssues, type PlacementPublicationIssue, type PlacementPublicationReason } from '../../../src/islands/selected-product-publication.ts';
export type PublishPlacementPreviewResult =
  | { status: 'published'; state: PlacementPreviewState }
  | { status: 'invalid'; issues: PlacementPublicationIssue[] }
  | { status: 'conflict'; currentRevision: number }
  | { status: 'storage-error'; reason: 'unavailable' | 'malformed-state' | 'write-failed' };

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
