import { getVariantPhotoGroups, type VariantPhotoGroup } from './placement-variant-photos.mts';
import type { PlacementProduct } from './placement-workflow-model.mts';

/** Continue through missing groups in visible product order, preserving all existing choices. */
export function nextUnassignedPhotoGroup(
  product: PlacementProduct,
  viewId: string,
  currentKey: string,
): VariantPhotoGroup | undefined {
  if (!product.views.some((view) => view.id === viewId)) return undefined;
  const groups = getVariantPhotoGroups(product);
  const index = groups.findIndex((group) => group.key === currentKey);
  if (index < 0) return undefined;
  return groups
    .slice(index + 1)
    .find(
      (group) =>
        !product.variantPhotos?.assignments.some(
          (assignment) => assignment.viewId === viewId && assignment.groupKey === group.key,
        ),
    );
}

export type PlacementPhotoPickerIntent = 'add-views' | 'replace-view' | 'assign-variant-groups';

export interface PlacementPhotoPickerSession {
  status: 'closed' | 'editing' | 'stale';
  sessionId: string;
  pickerRevision: number;
  intent: PlacementPhotoPickerIntent;
  productId: string;
  viewId: string;
  targetRevision: number;
  groupKeys: string[];
  imageIds: string[];
  selectionReady: boolean;
  processing: boolean;
}

export const closedPlacementPhotoPicker: PlacementPhotoPickerSession = {
  status: 'closed',
  sessionId: '',
  pickerRevision: 0,
  intent: 'add-views',
  productId: '',
  viewId: '',
  targetRevision: 0,
  groupKeys: [],
  imageIds: [],
  selectionReady: false,
  processing: false,
};

export type PlacementPhotoPickerEvent =
  | {
      type: 'opened';
      sessionId: string;
      intent: PlacementPhotoPickerIntent;
      productId: string;
      viewId: string;
      targetRevision: number;
      groupKeys?: string[];
      imageIds?: string[];
    }
  | { type: 'selection-changed'; sessionId: string; pickerRevision: number; imageIds: string[] }
  | { type: 'selection-ready'; sessionId: string; pickerRevision: number; imageIds: string[]; ready: boolean }
  | { type: 'processing-changed'; sessionId: string; pickerRevision: number; processing: boolean }
  | { type: 'context-invalidated'; productId: string; viewId: string; targetRevision: number }
  | { type: 'assignment-advanced'; sessionId: string; nextGroupKey: string; targetRevision: number }
  | { type: 'closed'; sessionId: string };

function currentPicker(state: PlacementPhotoPickerSession, sessionId: string, pickerRevision: number): boolean {
  return state.status === 'editing' && state.sessionId === sessionId && state.pickerRevision === pickerRevision;
}

/** Media decode/retry remains in the picker. This model owns the parent's target and commit intent. */
export function placementPhotoPickerReducer(
  state: PlacementPhotoPickerSession,
  event: PlacementPhotoPickerEvent,
): PlacementPhotoPickerSession {
  switch (event.type) {
    case 'opened':
      return {
        status: 'editing',
        sessionId: event.sessionId,
        pickerRevision: 0,
        intent: event.intent,
        productId: event.productId,
        viewId: event.viewId,
        targetRevision: event.targetRevision,
        groupKeys: [...(event.groupKeys ?? [])],
        imageIds: [...(event.imageIds ?? [])],
        selectionReady: false,
        processing: false,
      };
    case 'selection-changed':
      return currentPicker(state, event.sessionId, event.pickerRevision)
        ? { ...state, imageIds: [...event.imageIds], selectionReady: false }
        : state;
    case 'selection-ready':
      return currentPicker(state, event.sessionId, event.pickerRevision) &&
        event.imageIds.length === state.imageIds.length &&
        event.imageIds.every((imageId, index) => imageId === state.imageIds[index])
        ? { ...state, selectionReady: event.ready }
        : state;
    case 'processing-changed':
      return currentPicker(state, event.sessionId, event.pickerRevision)
        ? { ...state, processing: event.processing }
        : state;
    case 'context-invalidated':
      return state.status === 'editing' &&
        (state.productId !== event.productId ||
          state.viewId !== event.viewId ||
          state.targetRevision !== event.targetRevision)
        ? { ...state, status: 'stale', imageIds: [], selectionReady: false, processing: false }
        : state;
    case 'assignment-advanced':
      return state.status === 'editing' &&
        state.sessionId === event.sessionId &&
        state.intent === 'assign-variant-groups'
        ? {
            ...state,
            pickerRevision: state.pickerRevision + 1,
            targetRevision: event.targetRevision,
            groupKeys: [event.nextGroupKey],
            imageIds: [],
            selectionReady: false,
            processing: false,
          }
        : state;
    case 'closed':
      return state.status !== 'closed' && state.sessionId === event.sessionId ? closedPlacementPhotoPicker : state;
  }
}

export interface PlacementPhotoPickerCommitContext {
  sessionId: string;
  pickerRevision: number;
  productId: string;
  viewId: string;
  targetRevision: number;
}

export type PlacementPhotoPickerConfirmation =
  | { kind: 'ready'; imageIds: string[]; groupKeys: string[]; targetViewId: string }
  | { kind: 'stale' | 'not-ready' | 'empty-selection' };

/** Snapshot the currently confirmed picker choice; reducers never commit to product history. */
export function confirmPlacementPhotoPicker(
  state: PlacementPhotoPickerSession,
  context: PlacementPhotoPickerCommitContext,
): PlacementPhotoPickerConfirmation {
  if (
    state.status !== 'editing' ||
    state.sessionId !== context.sessionId ||
    state.pickerRevision !== context.pickerRevision ||
    state.productId !== context.productId ||
    state.viewId !== context.viewId ||
    state.targetRevision !== context.targetRevision
  )
    return { kind: 'stale' };
  if (state.processing || !state.selectionReady) return { kind: 'not-ready' };
  if (
    state.imageIds.length === 0 ||
    (state.intent === 'assign-variant-groups' && state.groupKeys.length === 0) ||
    (state.intent !== 'add-views' && state.imageIds.length !== 1)
  )
    return { kind: 'empty-selection' };
  return { kind: 'ready', imageIds: [...state.imageIds], groupKeys: [...state.groupKeys], targetViewId: state.viewId };
}
