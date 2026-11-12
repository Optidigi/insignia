import {
  type Artwork,
  type ColorId,
  type Design,
  isValidQuantity,
  type Position,
  type PositionId,
  type Print,
  type Quantities,
  type VariantMatrixCell,
  type View,
} from './model';
import type { PercentPoint } from './position-geometry';
import { resolvePrintCenter } from './position-geometry';
import type { CartReceipt } from './runtime';

export type DesignerStep = 0 | 1 | 2;

export type DesignerModal =
  | { kind: 'closed' }
  | { kind: 'artwork'; positionId: PositionId }
  | { kind: 'positions'; view: View | null }
  | { kind: 'colors'; mode: 'choose' | 'add' }
  | { kind: 'confirm-close' }
  | { kind: 'confirm-upload-cancel'; positionId: PositionId; destination: 'artwork' | 'customizer' }
  | { kind: 'switch-design'; design: Design };

export type UploadFailureReason = 'file-too-large' | 'unsupported-file-type' | 'read-failed' | 'upload-failed' | 'processing-failed' | 'inspection-rejected' | 'artwork-expired';

export type UploadState =
  | { kind: 'idle' }
  | { kind: 'reading'; token: number; target: PositionId; phase?: 'uploading' | 'processing'; fileName?: string }
  | {
      kind: 'failed';
      token: number;
      target: PositionId;
      reason: UploadFailureReason;
      fileName?: string;
    };

export type RecoveryState =
  | { kind: 'none' }
  | { kind: 'removed-position'; token: number; print: Print }
  | {
      kind: 'removed-color';
      token: number;
      color: ColorId;
      colorName: string;
      colorNameSource?: 'generic-selection';
      index: number;
      quantities: Quantities;
    }
  | {
      kind: 'message';
      token: number;
      reason: 'artwork-restored' | 'items-restored';
    };

export interface DesignerRules {
  positions: readonly Position[];
  colorIds: readonly ColorId[];
  sizeIds: readonly string[];
  availableSizes: Readonly<Record<ColorId, readonly string[] | undefined>>;
  variantMatrix?: readonly VariantMatrixCell[] | undefined;
  productionOptions?: readonly { id: string; valueIds: readonly string[] }[];
  maxQuantity: number;
  deferablePositions: readonly PositionId[];
}

export interface DesignerState {
  rules: DesignerRules;
  step: DesignerStep;
  view: View;
  color: ColorId;
  prints: Print[];
  active: PositionId;
  expanded: PositionId | null;
  artworks: Artwork[];
  positionUndo: Partial<Record<PositionId, Pick<Print, 'size' | 'position'>>>;
  quantities: Quantities;
  productionChoices: Record<string, string>;
  colorRows: ColorId[];
  /** Baseline for dirty detection; the host owns its saved-design collection. */
  baseline: Design | null;
  requiresCartReview: boolean;
  commit:
    | { kind: 'idle' }
    | { kind: 'preparing'; requestId: string; design: Design }
    /** Silent re-proposal of an expired, still-displayed quote; the footer stays usable. */
    | { kind: 'refreshing'; requestId: string; design: Design }
    | { kind: 'pending'; requestId: string; design: Design }
    | { kind: 'failed'; reason: 'cart-commit-failed'; preparation?: boolean }
    /** Shopify definitely refused the update (typically stock); `detail` is its own explanation. */
    | { kind: 'failed'; reason: 'cart-rejected'; detail?: string; preparation?: undefined };
  completion: CartReceipt | null;
  editing: string | null;
  open: boolean;
  modal: DesignerModal;
  attemptedStep: DesignerStep | null;
  upload: UploadState;
  uploadVersion: number;
  recovery: RecoveryState;
  recoveryVersion: number;
}

export interface CreateDesignerStateInput {
  rules: DesignerRules;
  view: View;
  color: ColorId;
  prints: readonly Print[];
  active: PositionId;
  expanded: PositionId | null;
  artworks: readonly Artwork[];
  designerOpen: boolean;
  initialDesign?: Design;
  /** Accepted cart intent when the restored editable draft differs from it. */
  initialBaseline?: Design;
  requiresCartReview?: boolean;
}

export type DesignerEvent =
  | { type: 'production-option-selected'; optionId: string; valueId: string }
  | { type: 'review-navigation-failed' }
  | { type: 'cart-review-satisfied' }
  | { type: 'step-selected'; step: DesignerStep }
  | { type: 'step-advanced' }
  | { type: 'validation-attempted'; step: DesignerStep }
  | { type: 'validation-cleared' }
  | { type: 'view-selected'; view: View }
  | { type: 'color-selected'; color: ColorId }
  | { type: 'color-added'; color: ColorId }
  | {
      type: 'color-row-removed';
      color: ColorId;
      name: string;
      nameSource?: 'generic-selection';
    }
  | { type: 'color-row-restored' }
  | { type: 'quantity-entered'; color: ColorId; size: string; value: number }
  | { type: 'quantity-focused'; color: ColorId }
  | { type: 'quantity-removed'; key: string }
  | { type: 'position-selected'; positionId: PositionId }
  | { type: 'position-expanded'; positionId: PositionId | null }
  | { type: 'position-added'; print: Print }
  | { type: 'position-removed'; positionId: PositionId }
  | { type: 'position-restored' }
  | { type: 'print-size-selected'; positionId: PositionId; size: number }
  | { type: 'print-method-selected'; positionId: PositionId; method: string }
  | {
      type: 'position-committed';
      positionId: PositionId;
      size: number;
      position: PercentPoint | undefined;
    }
  | { type: 'position-undone'; positionId: PositionId }
  | { type: 'position-undo-cleared'; positionId: PositionId }
  | { type: 'artwork-preview-expired'; id: string; expectedExpiry: string | undefined }
  | { type: 'artwork-preview-refreshed'; artwork: Artwork; expectedExpiry: string | undefined }
  | { type: 'artwork-unavailable'; id: string; expectedExpiry: string | undefined }
  | { type: 'artwork-applied'; positionId: PositionId; artworkId: string }
  | { type: 'cart-commit-requested'; requestId: string; design: Design; preparation?: boolean; refresh?: boolean }
  | { type: 'cart-mutation-started'; requestId: string }
  | { type: 'cart-preparation-started'; requestId: string }
  | { type: 'cart-commit-succeeded'; requestId: string; receipt: CartReceipt }
  | { type: 'cart-commit-failed'; requestId: string; reason: 'cart-commit-failed'; preparation?: boolean }
  | { type: 'cart-commit-failed'; requestId: string; reason: 'cart-rejected'; detail?: string }
  | { type: 'cart-commit-canceled' }
  | { type: 'product-design-edit-requested'; design: Design }
  | { type: 'product-design-switch-confirmed' }
  | { type: 'new-design-requested' }
  | { type: 'product-return-requested' }
  | { type: 'close-requested' }
  | { type: 'upload-close-requested' }
  | { type: 'upload-continue-requested' }
  | { type: 'designer-reopened' }
  | { type: 'location-observed'; designerOpen: boolean }
  | { type: 'modal-opened'; modal: Exclude<DesignerModal, { kind: 'closed' }> }
  | { type: 'modal-closed' }
  | {
      type: 'upload-rejected';
      token: number;
      target: PositionId;
      reason: UploadFailureReason;
      fileName?: string;
    }
  | { type: 'upload-progress'; token: number; target: PositionId; phase: 'uploading' | 'processing' }
  | { type: 'upload-started'; token: number; target: PositionId; fileName?: string }
  | { type: 'upload-canceled' }
  | {
      type: 'upload-succeeded';
      token: number;
      target: PositionId;
      artwork: Artwork;
    }
  | {
      type: 'upload-failed';
      token: number;
      target: PositionId;
      reason: Exclude<UploadFailureReason, 'file-too-large' | 'unsupported-file-type'>;
    }
  | { type: 'recovery-undone' }
  | { type: 'recovery-dismissed' }
  | { type: 'recovery-expired'; token: number };

const closedModal: DesignerModal = { kind: 'closed' };
const noUpload: UploadState = { kind: 'idle' };
const noRecovery: RecoveryState = { kind: 'none' };

export function createDesignerState(input: CreateDesignerStateInput): DesignerState {
  const initial: DesignerState = {
    rules: input.rules,
    step: 0,
    view: input.view,
    color: input.color,
    prints: input.prints.map(copyPrint),
    active: input.active,
    expanded: input.expanded,
    artworks: input.artworks.map((artwork) => ({ ...artwork })),
    positionUndo: {},
    quantities: {},
    productionChoices: defaultProductionChoices(input.rules),
    colorRows: [input.color],
    baseline: null,
    requiresCartReview: input.requiresCartReview ?? false,
    commit: { kind: 'idle' },
    completion: null,
    editing: null,
    open: input.designerOpen,
    modal: closedModal,
    attemptedStep: null,
    upload: noUpload,
    uploadVersion: 0,
    recovery: noRecovery,
    recoveryVersion: 0,
  };
  const loaded = input.initialDesign ? loadCartDesign(initial, input.initialDesign) : initial;
  return input.initialBaseline ? { ...loaded, baseline: copyDesign(input.initialBaseline) } : loaded;
}

export function designerReducer(state: DesignerState, event: DesignerEvent): DesignerState {
  if (
    state.commit.kind === 'pending' &&
    ![
      'cart-mutation-started',
      'cart-preparation-started',
      'cart-commit-succeeded',
      'cart-commit-failed',
      'cart-commit-canceled',
      'product-return-requested',
      'close-requested',
      'location-observed',
      'artwork-preview-expired',
      'artwork-preview-refreshed',
      'artwork-unavailable',
    ].includes(event.type)
  )
    return state;
  if (state.completion?.authority === 'shopify' && !['product-return-requested', 'close-requested', 'designer-reopened', 'location-observed', 'artwork-preview-expired', 'artwork-preview-refreshed', 'artwork-unavailable'].includes(event.type)) return state;
  switch (event.type) {
    case 'artwork-preview-expired':
    case 'artwork-preview-refreshed':
    case 'artwork-unavailable': {
      const id = event.type === 'artwork-preview-refreshed' ? event.artwork.id : event.id;
      const current = state.artworks.find((artwork) => artwork.id === id);
      if (!current || current.previewExpiresAt !== event.expectedExpiry) return state;
      if (event.type === 'artwork-unavailable') return { ...state, artworks: state.artworks.filter((artwork) => artwork.id !== id) };
      if (event.type === 'artwork-preview-expired' && !current.url) return state;
      return { ...state, artworks: state.artworks.map((artwork) => artwork.id !== id ? artwork : event.type === 'artwork-preview-expired' ? { ...artwork, url: '' } : { ...event.artwork }) };
    }
    case 'production-option-selected': {
      const definition = state.rules.productionOptions?.find((option) => option.id === event.optionId);
      if (!definition || (event.valueId !== '' && !definition.valueIds.includes(event.valueId))) return state;
      const next = { ...state.productionChoices };
      if (event.valueId === '') delete next[event.optionId];
      else next[event.optionId] = event.valueId;
      return { ...state, productionChoices: next };
    }

    case 'step-selected':
      return { ...state, step: event.step };
    case 'step-advanced':
      return {
        ...state,
        step: Math.min(2, state.step + 1) as DesignerStep,
        attemptedStep: null,
      };
    case 'validation-attempted':
      return { ...state, attemptedStep: event.step };
    case 'validation-cleared':
      return { ...state, attemptedStep: null };
    case 'view-selected':
      return { ...state, view: event.view };
    case 'color-selected':
      return selectColor(state, event.color);
    case 'color-added':
      if (!state.rules.colorIds.includes(event.color)) return state;
      return {
        ...state,
        color: event.color,
        colorRows: state.colorRows.includes(event.color) ? state.colorRows : [...state.colorRows, event.color],
        recovery: clearMatchingColorRecovery(state.recovery, event.color),
      };
    case 'color-row-removed':
      return removeColorRow(state, event.color, event.name, event.nameSource);
    case 'color-row-restored':
      return restoreColorRow(state);
    case 'quantity-entered': {
      if (!isAvailableSize(state, event.color, event.size)) return state;
      // Invalid drafts remain ineligible. The input boundary sends zero only for a deliberate empty field.
      const value = event.value;
      return {
        ...state,
        color: event.color,
        colorRows: state.colorRows.includes(event.color) ? state.colorRows : [...state.colorRows, event.color],
        recovery: clearMatchingColorRecovery(state.recovery, event.color),
        quantities: {
          ...state.quantities,
          [`${event.color}:${event.size}`]: value,
        },
      };
    }
    case 'quantity-focused':
      return state.rules.colorIds.includes(event.color) ? { ...state, color: event.color } : state;
    case 'quantity-removed':
      return Object.hasOwn(state.quantities, event.key)
        ? {
            ...state,
            quantities: Object.fromEntries(Object.entries(state.quantities).filter(([key]) => key !== event.key)),
          }
        : state;
    case 'position-selected':
      return selectPosition(state, event.positionId);
    case 'position-expanded':
      return { ...state, expanded: event.positionId };
    case 'position-added': {
      if (!state.rules.positions.some((position) => position.id === event.print.id)) return state;
      const prints = state.prints.some((print) => print.id === event.print.id)
        ? state.prints
        : [...state.prints, copyPrint(event.print)];
      const next = { ...state, prints, step: 0 as const };
      const selected = selectPosition(next, event.print.id);
      return {
        ...selected,
        modal: closedModal,
        upload: noUpload,
        recovery: clearMatchingPositionRecovery(state.recovery, event.print.id),
      };
    }
    case 'position-removed':
      return removePosition(state, event.positionId);
    case 'position-restored':
      return restorePosition(state);
    case 'print-size-selected':
      return selectPrintSize(state, event.positionId, event.size);
    case 'print-method-selected':
      return selectPrintMethod(state, event.positionId, event.method);
    case 'position-committed': {
      const current = state.prints.find((print) => print.id === event.positionId);
      if (!current) return state;
      return commitPosition(state, {
        ...current,
        size: event.size,
        position: event.position,
      });
    }
    case 'position-undone':
      return undoPosition(state, event.positionId);
    case 'position-undo-cleared':
      return clearPositionUndo(state, event.positionId);
    case 'artwork-applied':
      return applyArtwork(state, event.positionId, event.artworkId);
    case 'cart-review-satisfied':
      return { ...state, requiresCartReview: false };
    case 'review-navigation-failed':
      return { ...state, commit: { kind: 'failed', reason: 'cart-commit-failed' } };
    case 'cart-commit-requested': {
      const design = buildCommitDesign(event.preparation ? {...state,step:2} : state, event.design.id);
      const kind = !event.preparation ? 'pending' : event.refresh ? 'refreshing' : 'preparing';
      return design ? { ...state, commit: { kind, requestId: event.requestId, design } } : state;
    }
    case 'cart-mutation-started':
      return state.commit.kind === 'preparing' && state.commit.requestId === event.requestId ? { ...state, commit: { ...state.commit, kind: 'pending' } } : state;
    case 'cart-preparation-started':
      return state.commit.kind === 'pending' && state.commit.requestId === event.requestId ? { ...state, commit: { ...state.commit, kind: 'preparing' } } : state;
    case 'cart-commit-succeeded': {
      const pending = state.commit;
      if (
        pending.kind !== 'pending' ||
        pending.requestId !== event.requestId ||
        !state.open ||
        event.receipt.kind !== 'applied' ||
        event.receipt.requestId !== event.requestId ||
        event.receipt.designId !== pending.design.id ||
        event.receipt.operation !== (state.editing ? 'updated' : 'added') ||
        !['local-preview', 'shopify'].includes(event.receipt.authority) ||
        (event.receipt.authority === 'shopify' && !pending.design.variants?.length)
      )
        return state;
      return {
        ...state,
        baseline: copyDesign(pending.design),
        requiresCartReview: false,
        editing: pending.design.id,
        open: event.receipt.authority === 'shopify',
        completion: event.receipt,
        commit: { kind: 'idle' },
        modal: closedModal,
        recovery: noRecovery,
        upload: noUpload,
      };
    }
    case 'cart-commit-failed':
      return (state.commit.kind === 'pending' || state.commit.kind === 'preparing' || state.commit.kind === 'refreshing') && state.commit.requestId === event.requestId
        ? {
            ...state,
            commit:
              event.reason === 'cart-rejected'
                ? { kind: 'failed', reason: event.reason, ...(event.detail ? { detail: event.detail } : {}) }
                : { kind: 'failed', reason: event.reason, ...(event.preparation ? { preparation: true } : {}) },
          }
        : state;
    case 'cart-commit-canceled':
      return state.commit.kind === 'pending' || state.commit.kind === 'preparing' || state.commit.kind === 'refreshing' ? { ...state, commit: { kind: 'idle' } } : state;
    case 'product-design-edit-requested':
      return requestProductDesignEdit(state, event.design);
    case 'product-design-switch-confirmed':
      return confirmProductDesignSwitch(state);
    case 'new-design-requested':
      return startNewDesign(state);
    case 'close-requested':
      if (!state.open) return state;
      // Keep pending-cart cancellation and verified completion closure immediate;
      // another decision would be blocked by their write/edit guards.
      if (state.commit.kind === 'pending' || state.completion)
        return designerReducer(state, { type: 'product-return-requested' });
      if (state.upload.kind === 'reading')
        return { ...state, modal: { kind: 'confirm-upload-cancel', positionId: state.upload.target, destination: 'customizer' } };
      if (hasDraftChanges(state))
        return { ...state, modal: { kind: 'confirm-close' } };
      // An untouched design can return straight to its Shopify host.
      return designerReducer(state, { type: 'product-return-requested' });
    case 'upload-close-requested':
      return state.modal.kind === 'artwork' && state.upload.kind === 'reading'
        ? { ...state, modal: { kind: 'confirm-upload-cancel', positionId: state.modal.positionId, destination: 'artwork' } }
        : state;
    case 'upload-continue-requested':
      return state.modal.kind === 'confirm-upload-cancel'
        ? { ...state, modal: { kind: 'artwork', positionId: state.modal.positionId } }
        : state;
    case 'product-return-requested':
      return {
        ...state,
        open: false,
        commit: { kind: 'idle' },
        completion: null,
        modal: closedModal,
        upload: noUpload,
        recovery: noRecovery,
      };
    case 'designer-reopened':
      return { ...state, open: true, completion: null };
    case 'location-observed':
      return {
        ...state,
        open: event.designerOpen,
        commit: { kind: 'idle' },
        completion: null,
        modal: closedModal,
        upload: noUpload,
      };
    case 'modal-opened':
      return { ...state, modal: event.modal, upload: noUpload };
    case 'modal-closed':
      return { ...state, modal: closedModal, upload: noUpload };
    case 'upload-rejected':
      return beginUploadFailure(state, event.token, event.target, event.reason, event.fileName);
    case 'upload-canceled':
      return state.upload.kind === 'idle' ? state : {
        ...state,
        upload: noUpload,
        modal: state.modal.kind === 'confirm-upload-cancel' ? { kind: 'artwork', positionId: state.modal.positionId } : state.modal,
      };
    case 'upload-progress':
      if (state.upload.kind !== 'reading' || state.upload.token !== event.token || state.upload.target !== event.target || state.upload.phase === event.phase) return state;
      return { ...state, upload: { ...state.upload, phase: event.phase } };
    case 'upload-started':
      if (!isOpenUploadTarget(state, event.target)) return state;
      if (event.token <= state.uploadVersion) return state;
      return {
        ...state,
        uploadVersion: event.token,
        upload: { kind: 'reading', token: event.token, target: event.target, ...(event.fileName ? { fileName: event.fileName } : {}) },
      };
    case 'upload-succeeded': {
      if (
        state.upload.kind !== 'reading' ||
        state.upload.token !== event.token ||
        state.upload.target !== event.target ||
        !isOpenUploadTarget(state, event.target) ||
        !hasPrint(state, event.target)
      )
        return state;
      const artwork = { ...event.artwork };
      const applied = applyArtwork(
        {
          ...state,
          artworks: state.artworks.some((existing) => existing.id === artwork.id)
            ? state.artworks.map((existing) => (existing.id === artwork.id ? artwork : existing))
            : [...state.artworks, artwork],
          upload: noUpload,
        },
        event.target,
        artwork.id,
      );
      // The customer asked to leave the customizer while this upload ran: keep that
      // intent as the ordinary close decision for the now-edited design.
      return state.modal.kind === 'confirm-upload-cancel' && state.modal.destination === 'customizer'
        ? { ...applied, modal: { kind: 'confirm-close' } }
        : applied;
    }
    case 'upload-failed':
      if (
        state.upload.kind !== 'reading' ||
        state.upload.token !== event.token ||
        state.upload.target !== event.target ||
        !isOpenUploadTarget(state, event.target)
      )
        return state;
      return {
        ...state,
        upload: {
          kind: 'failed',
          token: event.token,
          target: event.target,
          reason: event.reason,
          ...(state.upload.fileName ? { fileName: state.upload.fileName } : {}),
        },
        modal: state.modal.kind === 'confirm-upload-cancel' ? { kind: 'artwork', positionId: state.modal.positionId } : state.modal,
      };
    case 'recovery-undone':
      return undoRecovery(state);
    case 'recovery-dismissed':
      return { ...state, recovery: noRecovery };
    case 'recovery-expired':
      return state.recovery.kind !== 'none' && state.recovery.token === event.token
        ? { ...state, recovery: noRecovery }
        : state;
  }
}

function selectColor(state: DesignerState, color: ColorId): DesignerState {
  if (!state.rules.colorIds.includes(color)) return state;
  const quantity = Object.values(state.quantities).reduce<number>(
    (sum, value) => (isValidQuantity(value ?? 0, state.rules.maxQuantity) ? sum + (value ?? 0) : sum),
    0,
  );
  const hasInvalidQuantity = Object.values(state.quantities).some(
    (value) => !isValidQuantity(value ?? 0, state.rules.maxQuantity),
  );
  const colorRows =
    quantity === 0 && !hasInvalidQuantity
      ? [color]
      : state.colorRows.includes(color)
        ? state.colorRows
        : [...state.colorRows, color];
  return {
    ...state,
    color,
    colorRows,
    recovery: clearMatchingColorRecovery(state.recovery, color),
  };
}

export function hasUnappliedDraft(state: DesignerState): boolean {
  return state.requiresCartReview || hasDraftChanges(state);
}

/** Edited intent is distinct from the requirement to review current purchase terms. */
export function hasDraftChanges(state: DesignerState): boolean {
  const saved = state.baseline;
  return saved
    ? JSON.stringify(state.prints) !== JSON.stringify(saved.prints) ||
        quantitySignature(state.quantities) !== quantitySignature(saved.quantities) ||
        productionSignature(state.productionChoices) !==
          productionSignature(
            Object.fromEntries((saved.options ?? []).map((option) => [option.optionId, option.valueId])),
          )
    : productionSignature(state.productionChoices) !== productionSignature(defaultProductionChoices(state.rules)) ||
        state.prints.length > 0 ||
        Object.values(state.quantities).some((value) => (value ?? 0) !== 0);
}

function defaultProductionChoices(rules: DesignerRules) {
  return Object.fromEntries(
    (rules.productionOptions ?? []).flatMap((option) => {
      const value = option.valueIds[0];
      return value ? [[option.id, value]] : [];
    }),
  );
}
function productionSignature(values: Record<string, string>) {
  return JSON.stringify(Object.entries(values).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function quantitySignature(quantities: Quantities): string {
  return JSON.stringify(
    Object.entries(quantities)
      .filter(([, value]) => value !== undefined && value !== 0)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

export function productDesignEditRequiresConfirmation(state: DesignerState, designId: string): boolean {
  return hasDraftChanges(state) && designId !== state.editing;
}

function selectPosition(state: DesignerState, positionId: PositionId): DesignerState {
  const position = state.rules.positions.find((entry) => entry.id === positionId);
  if (!position) return state;
  return {
    ...state,
    active: positionId,
    expanded: positionId,
    view: position.view,
  };
}

function removePosition(state: DesignerState, positionId: PositionId): DesignerState {
  const removed = state.prints.find((print) => print.id === positionId);
  if (!removed) return state;
  const prints = state.prints.filter((print) => print.id !== positionId);
  const token = state.recoveryVersion + 1;
  const next = clearPositionUndo(
    {
      ...state,
      prints,
      recovery: {
        kind: 'removed-position',
        token,
        print: copyPrint(removed),
      },
      recoveryVersion: token,
    },
    positionId,
  );
  const first = prints[0];
  return first ? selectPosition(next, first.id) : { ...next, expanded: null };
}

function restorePosition(state: DesignerState): DesignerState {
  if (state.recovery.kind !== 'removed-position') return state;
  const print = state.recovery.print;
  if (state.prints.some((entry) => entry.id === print.id)) return { ...state, recovery: noRecovery };
  const selected = selectPosition({ ...state, prints: [...state.prints, copyPrint(print)] }, print.id);
  return setRecoveryMessage(selected, 'artwork-restored');
}

function removeColorRow(
  state: DesignerState,
  color: ColorId,
  name: string,
  nameSource?: 'generic-selection',
): DesignerState {
  if (!state.colorRows.includes(color) || state.colorRows.length < 2) return state;
  const index = state.colorRows.indexOf(color);
  const quantities = Object.fromEntries(
    Object.entries(state.quantities).filter(([key]) => key.startsWith(`${color}:`)),
  );
  const nextColor =
    state.color === color
      ? (state.colorRows.find((id) => id !== color) ?? state.rules.colorIds[0] ?? state.color)
      : state.color;
  const token = state.recoveryVersion + 1;
  return {
    ...state,
    color: nextColor,
    colorRows: state.colorRows.filter((id) => id !== color),
    quantities: Object.fromEntries(Object.entries(state.quantities).filter(([key]) => !key.startsWith(`${color}:`))),
    recovery: {
      kind: 'removed-color',
      token,
      color,
      colorName: name,
      ...(nameSource ? { colorNameSource: nameSource } : {}),
      index,
      quantities,
    },
    recoveryVersion: token,
  };
}

function restoreColorRow(state: DesignerState): DesignerState {
  if (state.recovery.kind !== 'removed-color') return state;
  const { color, index, quantities } = state.recovery;
  if (state.colorRows.includes(color)) return { ...state, recovery: noRecovery };
  const rows = [...state.colorRows];
  rows.splice(Math.max(0, Math.min(index, rows.length)), 0, color);
  const restored = {
    ...state,
    color,
    colorRows: rows,
    quantities: { ...state.quantities, ...quantities },
  };
  return setRecoveryMessage(restored, 'items-restored');
}

function undoRecovery(state: DesignerState): DesignerState {
  if (state.recovery.kind === 'removed-position') return restorePosition(state);
  if (state.recovery.kind === 'removed-color') return restoreColorRow(state);
  return state;
}

function commitPosition(state: DesignerState, nextPrint: Print): DesignerState {
  const current = state.prints.find((entry) => entry.id === nextPrint.id);
  const position = state.rules.positions.find((entry) => entry.id === nextPrint.id);
  if (
    !current ||
    !position ||
    current.method !== nextPrint.method ||
    current.artworkId !== nextPrint.artworkId ||
    !isAllowedPrint(state, nextPrint)
  )
    return state;
  const before = resolvePrintCenter(position, current);
  const after = resolvePrintCenter(position, nextPrint);
  if (
    current.size === nextPrint.size &&
    Math.abs(before.x - after.x) < 0.000001 &&
    Math.abs(before.y - after.y) < 0.000001
  )
    return state;
  const prior: Pick<Print, 'size' | 'position'> = {
    size: current.size,
    position: current.position,
  };
  return {
    ...state,
    prints: state.prints.map((entry) => (entry.id === nextPrint.id ? copyPrint(nextPrint) : entry)),
    positionUndo: { ...state.positionUndo, [nextPrint.id]: prior },
  };
}

function undoPosition(state: DesignerState, positionId: PositionId): DesignerState {
  const previous = state.positionUndo[positionId];
  if (!previous || !hasPrint(state, positionId)) return state;
  return {
    ...state,
    prints: state.prints.map((print) => (print.id === positionId ? { ...print, ...previous } : print)),
    positionUndo: withoutPositionUndo(state.positionUndo, positionId),
  };
}

function clearPositionUndo(state: DesignerState, positionId: PositionId): DesignerState {
  if (state.positionUndo[positionId] === undefined) return state;
  return {
    ...state,
    positionUndo: withoutPositionUndo(state.positionUndo, positionId),
  };
}

function applyArtwork(state: DesignerState, positionId: PositionId, artworkId: string): DesignerState {
  if (!hasPrint(state, positionId)) return state;
  if (artworkId !== 'later' && !state.artworks.some((artwork) => artwork.id === artworkId)) return state;
  if (artworkId === 'later' && !state.rules.deferablePositions.includes(positionId)) return state;
  return {
    ...clearPositionUndo(
      {
        ...state,
        prints: state.prints.map((print) => {
          if (print.id !== positionId) return print;
          const updated: Print = { ...print, artworkId };
          if (artworkId === 'later') delete updated.position;
          return updated;
        }),
        recovery: noRecovery,
        modal: closedModal,
        upload: noUpload,
      },
      positionId,
    ),
  };
}

export function canCommitDesign(state: DesignerState): boolean {
  return (
    state.open &&
    !state.completion &&
    state.step === 2 &&
    state.modal.kind === 'closed' &&
    state.commit.kind !== 'pending' &&
    !(state.editing && !hasUnappliedDraft(state)) &&
    state.prints.length > 0 &&
    isCartQuantityValid(state) &&
    isProductionChoicesValid(state) &&
    state.prints.every(
      (print) =>
        isAllowedPrint(state, print) &&
        ((print.artworkId === 'later' && state.rules.deferablePositions.includes(print.id)) ||
          state.artworks.some((artwork) => artwork.id === print.artworkId)),
    )
  );
}
function copyDesign(design: Design): Design {
  return {
    id: design.id,
    prints: design.prints.map(copyPrint),
    ...(design.options ? { options: design.options.map((option) => ({ ...option })) } : {}),
    quantities: { ...design.quantities },
    ...(design.variants ? { variants: design.variants.map((variant) => ({ ...variant })) } : {}),
  };
}

function loadCartDesign(state: DesignerState, design: Design): DesignerState {
  const colorRows = state.rules.colorIds.filter((color) =>
    state.rules.sizeIds.some((size) => (design.quantities[`${color}:${size}`] ?? 0) > 0),
  );
  const firstColor = colorRows[0];
  const initial: DesignerState = {
    ...state,
    step: 0,
    prints: design.prints.map(copyPrint),
    quantities: { ...design.quantities },
    productionChoices: Object.fromEntries((design.options ?? []).map((option) => [option.optionId, option.valueId])),
    colorRows: colorRows.length ? colorRows : [state.color],
    editing: design.id,
    baseline: copyDesign(design),
    commit: { kind: 'idle' },
    completion: null,
    positionUndo: {},
    attemptedStep: null,
    recovery: noRecovery,
    modal: closedModal,
    upload: noUpload,
  };
  const selectedColor = firstColor ? { ...initial, color: firstColor } : initial;
  const firstPrint = design.prints[0];
  return firstPrint ? selectPosition(selectedColor, firstPrint.id) : selectedColor;
}

function requestProductDesignEdit(state: DesignerState, design: Design): DesignerState {
  const designId = design.id;
  if (state.open) return state;
  if (productDesignEditRequiresConfirmation(state, designId)) {
    return { ...state, modal: { kind: 'switch-design', design: copyDesign(design) } };
  }
  if (hasUnappliedDraft(state) && designId === state.editing) {
    return {
      ...state,
      open: true,
      completion: null,
      modal: closedModal,
    };
  }
  return loadCartDesign({ ...state, open: true, modal: closedModal }, design);
}

function confirmProductDesignSwitch(state: DesignerState): DesignerState {
  if (state.modal.kind !== 'switch-design') return state;
  return loadCartDesign({ ...state, open: true, modal: closedModal }, state.modal.design);
}

function startNewDesign(state: DesignerState): DesignerState {
  return {
    ...state,
    step: 0,
    prints: [],
    quantities: {},
    productionChoices: defaultProductionChoices(state.rules),
    colorRows: [state.color],
    editing: null,
    baseline: null,
    requiresCartReview: false,
    commit: { kind: 'idle' },
    completion: null,
    expanded: null,
    positionUndo: {},
    attemptedStep: null,
    recovery: noRecovery,
    modal: closedModal,
    upload: noUpload,
  };
}

function beginUploadFailure(
  state: DesignerState,
  token: number,
  target: PositionId,
  reason: UploadFailureReason,
  fileName?: string,
): DesignerState {
  if (!isOpenUploadTarget(state, target) || token <= state.uploadVersion) return state;
  return {
    ...state,
    uploadVersion: token,
    upload: { kind: 'failed', token, target, reason, ...(fileName ? { fileName } : {}) },
  };
}

function isOpenUploadTarget(state: DesignerState, target: PositionId): boolean {
  return (state.modal.kind === 'artwork' || state.modal.kind === 'confirm-upload-cancel') && state.modal.positionId === target;
}

function setRecoveryMessage(state: DesignerState, reason: 'artwork-restored' | 'items-restored'): DesignerState {
  const token = state.recoveryVersion + 1;
  return {
    ...state,
    recovery: { kind: 'message', token, reason },
    recoveryVersion: token,
  };
}

function clearMatchingColorRecovery(recovery: RecoveryState, color: ColorId): RecoveryState {
  return recovery.kind === 'removed-color' && recovery.color === color ? noRecovery : recovery;
}

function clearMatchingPositionRecovery(recovery: RecoveryState, positionId: PositionId): RecoveryState {
  return recovery.kind === 'removed-position' && recovery.print.id === positionId ? noRecovery : recovery;
}

function isAvailableSize(state: DesignerState, color: ColorId, size: string): boolean {
  if (!state.rules.colorIds.includes(color) || !state.rules.sizeIds.includes(size)) return false;
  if (state.rules.variantMatrix !== undefined) {
    const cells = state.rules.variantMatrix.filter((cell) => cell.rowId === color && cell.columnId === size);
    return cells.length === 1 && cells[0]?.available === true;
  }
  return state.rules.availableSizes[color]?.includes(size) ?? false;
}

function isAllowedPrint(state: DesignerState, print: Print): boolean {
  const position = state.rules.positions.find((entry) => entry.id === print.id);
  if (
    !position ||
    !Number.isInteger(print.size) ||
    position.dimensions[print.size] === undefined ||
    !position.methodIds.includes(print.method)
  )
    return false;
  const prices = position.methodSizePrices?.[print.method];
  return prices === undefined || (prices[print.size] !== null && prices[print.size] !== undefined);
}

function selectPrintSize(state: DesignerState, positionId: PositionId, size: number): DesignerState {
  const current = state.prints.find((print) => print.id === positionId);
  if (!current || !isAllowedPrint(state, { ...current, size })) return state;
  return replacePrint(state, positionId, { ...current, size });
}

function selectPrintMethod(state: DesignerState, positionId: PositionId, method: string): DesignerState {
  const current = state.prints.find((print) => print.id === positionId);
  const position = state.rules.positions.find((entry) => entry.id === positionId);
  if (!current || !position || !position.methodIds.includes(method)) return state;
  const currentSize = { ...current, method };
  if (isAllowedPrint(state, currentSize)) return replacePrint(state, positionId, currentSize);
  const nextSize = position.dimensions.findIndex((_, index) =>
    isAllowedPrint(state, { ...current, size: index, method }),
  );
  return nextSize < 0 ? state : replacePrint(state, positionId, { ...current, method, size: nextSize });
}

function replacePrint(state: DesignerState, positionId: PositionId, nextPrint: Print): DesignerState {
  return {
    ...state,
    prints: state.prints.map((print) => (print.id === positionId ? copyPrint(nextPrint) : print)),
  };
}

export function isProductionChoicesValid(state: DesignerState): boolean {
  const definitions = state.rules.productionOptions ?? [];
  return (
    Object.keys(state.productionChoices).length === definitions.length &&
    definitions.every((option) => option.valueIds.includes(state.productionChoices[option.id] ?? ''))
  );
}
function isCartQuantityValid(state: DesignerState): boolean {
  const availableKeys = new Set(
    state.colorRows.flatMap((color) =>
      state.rules.sizeIds.filter((size) => isAvailableSize(state, color, size)).map((size) => `${color}:${size}`),
    ),
  );
  let hasQuantity = false;
  for (const [key, value] of Object.entries(state.quantities)) {
    const quantity = value ?? 0;
    if (!isValidQuantity(quantity, state.rules.maxQuantity)) return false;
    if (quantity === 0) continue;
    if (!availableKeys.has(key)) return false;
    hasQuantity = true;
  }
  if (state.rules.variantMatrix !== undefined) {
    const variantIds = new Set<string>();
    for (const cell of state.rules.variantMatrix) {
      if (!cell.variantId || variantIds.has(cell.variantId)) return false;
      variantIds.add(cell.variantId);
    }
  }
  return hasQuantity;
}

/** A commit snapshot always takes quantities and exact identities from the current rules. */
export function buildCommitDesign(state: DesignerState, id: string): Design | null {
  if (!id || !canCommitDesign(state)) return null;
  const variants = state.rules.variantMatrix?.flatMap((cell) => {
    const quantity = state.quantities[`${cell.rowId}:${cell.columnId}`] ?? 0;
    return cell.available && quantity > 0 ? [{ variantId: cell.variantId, quantity }] : [];
  });
  return {
    id,
    prints: state.prints.map(copyPrint),
    quantities: { ...state.quantities },
    ...(variants === undefined ? {} : { variants }),
    ...(Object.keys(state.productionChoices).length
      ? {
          options: (state.rules.productionOptions ?? []).map((option) => ({
            optionId: option.id,
            valueId: state.productionChoices[option.id]!,
          })),
        }
      : {}),
  };
}

function hasPrint(state: DesignerState, positionId: PositionId): boolean {
  return state.prints.some((print) => print.id === positionId);
}

function withoutPositionUndo(
  positionUndo: DesignerState['positionUndo'],
  positionId: PositionId,
): DesignerState['positionUndo'] {
  const next = { ...positionUndo };
  delete next[positionId];
  return next;
}

function copyPrint(print: Print): Print {
  return { ...print, position: copyPoint(print.position) };
}

function copyPoint(point: PercentPoint | undefined): PercentPoint | undefined {
  return point ? { x: point.x, y: point.y } : undefined;
}
