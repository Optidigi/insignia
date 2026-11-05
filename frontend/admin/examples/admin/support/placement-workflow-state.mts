/** Explicit interaction and dialog transitions for the local placement editor. */
import type { PlacementPublicationIssue } from './placement-publication.mts';
import type { EditorPlacement, PlacementProduct, PlacementRect } from './placement-workflow-model.mts';

export type PlacementWorkspaceError = 'movement-must-contain-artwork' | 'measurement-invalid';

export type PlacementWorkspaceMode =
  | { kind: 'idle' }
  | { kind: 'drawing-placement'; viewId: string; placementId: string | null }
  | {
      kind: 'movement-edit';
      viewId: string;
      placementId: string;
      phase: 'drawing' | 'editing';
      draft: PlacementRect | null;
      error: 'movement-must-contain-artwork' | null;
    }
  | {
      kind: 'measuring';
      viewId: string;
      placementId: string | null;
      imageUrl: string;
      line: { a: { x: number; y: number }; b: { x: number; y: number } } | null;
      distance: string;
      coordinatesOpen: boolean;
      pointInputs: Partial<Record<`${'a' | 'b'}-${'x' | 'y'}`, string>>;
      error: 'measurement-invalid' | null;
    }
  | { kind: 'size-preview'; viewId: string; placementId: string; sizeId: string }
  | { kind: 'group-area-edit'; viewId: string; placementId: string; groupKey: string };

export interface MeasurementLine {
  a: { x: number; y: number };
  b: { x: number; y: number };
}

export interface PlacementWorkspaceState {
  mode: PlacementWorkspaceMode;
}

export const initialPlacementWorkspaceState: PlacementWorkspaceState = { mode: { kind: 'idle' } };

export type PlacementWorkspaceEvent =
  | { type: 'selection-changed'; viewId: string; placementId: string | null }
  | { type: 'placement-drawing-started'; viewId: string; placementId: string | null }
  | { type: 'placement-drawing-canceled' }
  | { type: 'movement-edit-started'; viewId: string; placementId: string; draft: PlacementRect | null }
  | { type: 'movement-redraw-started' }
  | { type: 'movement-drawing-canceled' }
  | { type: 'movement-drawn'; viewId: string; placementId: string; draft: PlacementRect }
  | { type: 'movement-error'; viewId: string; placementId: string; reason: 'movement-must-contain-artwork' }
  | { type: 'movement-edit-committed'; viewId: string; placementId: string }
  | {
      type: 'measurement-started';
      viewId: string;
      placementId: string | null;
      imageUrl: string;
      line: MeasurementLine | null;
      distance: string;
    }
  | { type: 'measurement-distance-changed'; value: string }
  | { type: 'measurement-line-changed'; line: MeasurementLine | null }
  | { type: 'measurement-drawn'; line: MeasurementLine }
  | { type: 'measurement-redraw-requested' }
  | { type: 'measurement-coordinates-toggled'; open: boolean }
  | { type: 'measurement-point-changed'; point: 'a' | 'b'; axis: 'x' | 'y'; value: string }
  | { type: 'measurement-error'; reason: 'measurement-invalid' }
  | { type: 'measurement-committed'; viewId: string; imageUrl: string }
  | { type: 'group-area-edit-started'; viewId: string; placementId: string; groupKey: string }
  | { type: 'size-preview-toggled'; viewId: string; placementId: string; sizeId: string }
  | { type: 'size-preview-selected'; viewId: string; placementId: string; sizeId: string }
  | { type: 'mode-canceled' };

function sameTarget(mode: PlacementWorkspaceMode, viewId: string, placementId: string | null): boolean {
  if (mode.kind === 'idle') return true;
  if (mode.kind === 'drawing-placement' || mode.kind === 'measuring')
    return mode.viewId === viewId && mode.placementId === placementId;
  return mode.viewId === viewId && mode.placementId === placementId;
}

/** Selection changes end only the interaction attached to a different target. */
export function placementWorkspaceReducer(
  state: PlacementWorkspaceState,
  event: PlacementWorkspaceEvent,
): PlacementWorkspaceState {
  const mode = state.mode;
  switch (event.type) {
    case 'selection-changed':
      return sameTarget(mode, event.viewId, event.placementId) ? state : initialPlacementWorkspaceState;
    case 'placement-drawing-started':
      return { mode: { kind: 'drawing-placement', viewId: event.viewId, placementId: event.placementId } };
    case 'placement-drawing-canceled':
      return mode.kind === 'drawing-placement' ? initialPlacementWorkspaceState : state;
    case 'movement-edit-started':
      return {
        mode: {
          kind: 'movement-edit',
          viewId: event.viewId,
          placementId: event.placementId,
          phase: 'drawing',
          draft: event.draft ? { ...event.draft } : null,
          error: null,
        },
      };
    case 'movement-redraw-started':
      return mode.kind === 'movement-edit' ? { mode: { ...mode, phase: 'drawing', error: null } } : state;
    case 'movement-drawing-canceled':
      return mode.kind === 'movement-edit' && mode.phase === 'drawing'
        ? { mode: { ...mode, phase: 'editing', error: null } }
        : state;
    case 'movement-drawn':
      return mode.kind === 'movement-edit' && mode.viewId === event.viewId && mode.placementId === event.placementId
        ? { mode: { ...mode, phase: 'editing', draft: { ...event.draft }, error: null } }
        : state;
    case 'movement-error':
      return mode.kind === 'movement-edit' && mode.viewId === event.viewId && mode.placementId === event.placementId
        ? { mode: { ...mode, error: event.reason } }
        : state;
    case 'movement-edit-committed':
      return mode.kind === 'movement-edit' && mode.viewId === event.viewId && mode.placementId === event.placementId
        ? initialPlacementWorkspaceState
        : state;
    case 'measurement-started':
      return {
        mode: {
          kind: 'measuring',
          viewId: event.viewId,
          placementId: event.placementId,
          imageUrl: event.imageUrl,
          line: event.line ? { a: { ...event.line.a }, b: { ...event.line.b } } : null,
          distance: event.distance,
          coordinatesOpen: false,
          pointInputs: {},
          error: null,
        },
      };
    case 'measurement-distance-changed':
      return mode.kind === 'measuring' ? { mode: { ...mode, distance: event.value, error: null } } : state;
    case 'measurement-line-changed':
      return mode.kind === 'measuring'
        ? {
            mode: {
              ...mode,
              line: event.line ? { a: { ...event.line.a }, b: { ...event.line.b } } : null,
              error: null,
            },
          }
        : state;
    case 'measurement-drawn':
      return mode.kind === 'measuring'
        ? {
            mode: {
              ...mode,
              line: { a: { ...event.line.a }, b: { ...event.line.b } },
              pointInputs: {},
              error: null,
            },
          }
        : state;
    case 'measurement-redraw-requested':
      return mode.kind === 'measuring'
        ? { mode: { ...mode, line: null, coordinatesOpen: false, pointInputs: {}, error: null } }
        : state;
    case 'measurement-coordinates-toggled':
      return mode.kind === 'measuring' ? { mode: { ...mode, coordinatesOpen: event.open } } : state;
    case 'measurement-point-changed':
      if (mode.kind !== 'measuring') return state;
      {
        const key = `${event.point}-${event.axis}` as const;
        const input = Number(event.value);
        const line =
          event.value.trim() && Number.isFinite(input)
            ? {
                ...(mode.line ?? { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } }),
                [event.point]: {
                  ...(mode.line?.[event.point] ?? { x: 0, y: 0 }),
                  [event.axis]: input / 100,
                },
              }
            : mode.line;
        return {
          mode: {
            ...mode,
            pointInputs: { ...mode.pointInputs, [key]: event.value },
            ...(line ? { line } : {}),
            error: null,
          },
        };
      }
    case 'measurement-error':
      return mode.kind === 'measuring' ? { mode: { ...mode, error: event.reason } } : state;
    case 'measurement-committed':
      return mode.kind === 'measuring' && mode.viewId === event.viewId && mode.imageUrl === event.imageUrl
        ? initialPlacementWorkspaceState
        : state;
    case 'group-area-edit-started':
      return {
        mode: {
          kind: 'group-area-edit',
          viewId: event.viewId,
          placementId: event.placementId,
          groupKey: event.groupKey,
        },
      };
    case 'size-preview-toggled':
      return mode.kind === 'size-preview' && mode.placementId === event.placementId && mode.sizeId === event.sizeId
        ? initialPlacementWorkspaceState
        : {
            mode: {
              kind: 'size-preview',
              viewId: event.viewId,
              placementId: event.placementId,
              sizeId: event.sizeId,
            },
          };
    case 'size-preview-selected':
      return {
        mode: {
          kind: 'size-preview',
          viewId: event.viewId,
          placementId: event.placementId,
          sizeId: event.sizeId,
        },
      };
    case 'mode-canceled':
      return mode.kind === 'idle' ? state : initialPlacementWorkspaceState;
  }
}

export interface PlacementDialogTarget {
  viewId: string;
  placementId: string | null;
}

export type PlacementDialogState =
  | { kind: 'closed' }
  | {
      kind: 'remove';
      id: string;
      target: { kind: 'view'; id: string } | { kind: 'placement'; id: string; viewId: string };
      origin: 'outline' | 'inspector' | 'inspector-footer';
    }
  | { kind: 'discard'; id: string }
  | { kind: 'leave'; id: string; href: string }
  | {
      kind: 'copy-placement';
      id: string;
      source: { kind: 'placement'; id: string; viewId: string };
      targetViewId: string;
    }
  | { kind: 'copy-setup'; id: string; source: PlacementProduct }
  | {
      kind: 'method-manager';
      id: string;
      productId: string;
      target: PlacementDialogTarget;
      targetRevision: number;
      initialMethodId?: string;
      draft: Pick<EditorPlacement, 'methodIds' | 'sizes'>;
    }
  | {
      kind: 'publish';
      id: string;
      product: PlacementProduct;
      revision: number;
      issues: PlacementPublicationIssue[];
      error: 'conflict' | 'storage-error' | null;
    };

export const initialPlacementDialogState: PlacementDialogState = { kind: 'closed' };

export type PlacementDialogEvent =
  | {
      type: 'remove-requested';
      id: string;
      target: Extract<PlacementDialogState, { kind: 'remove' }>['target'];
      origin: Extract<PlacementDialogState, { kind: 'remove' }>['origin'];
    }
  | { type: 'discard-requested'; id: string }
  | { type: 'leave-requested'; id: string; href: string }
  | {
      type: 'copy-placement-opened';
      id: string;
      source: { kind: 'placement'; id: string; viewId: string };
      targetViewId: string;
    }
  | { type: 'copy-placement-target-changed'; id: string; targetViewId: string }
  | { type: 'copy-setup-opened'; id: string; source: PlacementProduct }
  | {
      type: 'method-manager-opened';
      id: string;
      productId: string;
      target: PlacementDialogTarget;
      targetRevision: number;
      initialMethodId?: string;
      draft: Pick<EditorPlacement, 'methodIds' | 'sizes'>;
    }
  | {
      type: 'publish-opened';
      id: string;
      product: PlacementProduct;
      revision: number;
      issues: PlacementPublicationIssue[];
    }
  | { type: 'publish-issues-updated'; id: string; issues: PlacementPublicationIssue[] }
  | { type: 'publish-failed'; id: string; reason: 'conflict' | 'storage-error' }
  | { type: 'dialog-closed'; id: string };

/** A single overlay owner prevents unrelated confirmation and staging sessions from overlapping. */
export function placementDialogReducer(state: PlacementDialogState, event: PlacementDialogEvent): PlacementDialogState {
  if (event.type === 'dialog-closed')
    return state.kind !== 'closed' && state.id === event.id ? initialPlacementDialogState : state;
  if (event.type === 'copy-placement-target-changed')
    return state.kind === 'copy-placement' && state.id === event.id
      ? { ...state, targetViewId: event.targetViewId }
      : state;
  if (event.type === 'publish-issues-updated')
    return state.kind === 'publish' && state.id === event.id ? { ...state, issues: event.issues, error: null } : state;
  if (event.type === 'publish-failed')
    return state.kind === 'publish' && state.id === event.id ? { ...state, error: event.reason } : state;
  if (state.kind !== 'closed') return state;

  switch (event.type) {
    case 'remove-requested':
      return { kind: 'remove', id: event.id, target: event.target, origin: event.origin };
    case 'discard-requested':
      return { kind: 'discard', id: event.id };
    case 'leave-requested':
      return { kind: 'leave', id: event.id, href: event.href };
    case 'copy-placement-opened':
      return { kind: 'copy-placement', id: event.id, source: { ...event.source }, targetViewId: event.targetViewId };
    case 'copy-setup-opened':
      return { kind: 'copy-setup', id: event.id, source: structuredClone(event.source) };
    case 'method-manager-opened':
      return {
        kind: 'method-manager',
        id: event.id,
        productId: event.productId,
        target: { ...event.target },
        targetRevision: event.targetRevision,
        ...(event.initialMethodId ? { initialMethodId: event.initialMethodId } : {}),
        draft: structuredClone(event.draft),
      };
    case 'publish-opened':
      return {
        kind: 'publish',
        id: event.id,
        product: structuredClone(event.product),
        revision: event.revision,
        issues: [...event.issues],
        error: null,
      };
  }
}

/** Prevent a staged child commit after its target document or selection has moved. */
export function placementDialogTargetMatches(
  dialog: Extract<PlacementDialogState, { kind: 'method-manager' }>,
  product: PlacementProduct,
  target: PlacementDialogTarget,
  targetRevision: number,
): boolean {
  return (
    dialog.productId === product.id &&
    dialog.targetRevision === targetRevision &&
    dialog.target.viewId === target.viewId &&
    dialog.target.placementId === target.placementId &&
    target.placementId !== null &&
    product.views.some(
      (view) => view.id === target.viewId && view.placements.some((placement) => placement.id === target.placementId),
    )
  );
}
