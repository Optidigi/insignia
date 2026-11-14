/** Selected product editor presentation. Persistence/host effects are supplied by its composition. */
import AdminSaveBar from '../components/AdminSaveBar.tsx';
import { DecimalField } from '../components/DecimalField.tsx';
import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import AdminResourceName from '../components/AdminResourceName.tsx';
import AdminTruncatedLabel from '../components/AdminTruncatedLabel.tsx';
import { useAdminLocale } from '../shared/admin-i18n.js';
import { isShopifyBusy } from '../shared/admin-request.ts';
import { configRejectionFrom } from '../shared/config-rejection.ts';
import { productEditorReturnPath } from '../shared/products-return-path.ts';
import { storefrontProductTestSetupHref } from '../shared/storefront-product-test.ts';
import Dialog from '../../examples/admin/support/method-dialog.tsx';
import { methodLibraryHref } from '../../examples/admin/support/method-return-context.mts';
import { currencyPrefix, formatPrice, parsePrice } from '../../examples/admin/support/method-workflow-prices.mts';
import { parseDecimalNumber } from '../../examples/admin/support/decimal-input.mts';
import {
  approximatePlacementDimensions,
  calibrationMatchesImage,
  placementCalibrationSchema,
} from '../../examples/admin/support/placement-calibration.mts';
import { placementColor } from '../../examples/admin/support/placement-canvas-tools.mts';
import { type CustomerPreviewFailure } from '../../examples/admin/support/placement-customer-preview.mts';
import {
  commitPlacementDraftChange,
  createPlacementHistory,
  endPlacementHistoryGroup,
  placementDraftEqual,
  redoPlacementHistory,
  resetPlacementHistory,
  undoPlacementHistory,
} from '../../examples/admin/support/placement-history.mts';
import ImagePicker from '../../examples/admin/support/placement-image-picker.tsx';
import { getProductImageUsage } from '../../examples/admin/support/placement-image-usage.mts';
import { importPlacementMethods } from './selected-method-choices.ts';
import PlacementMethodManager from '../../examples/admin/support/placement-method-manager.tsx';
import {
  closedPlacementPhotoPicker,
  confirmPlacementPhotoPicker,
  nextUnassignedPhotoGroup,
  placementPhotoPickerReducer,
} from '../../examples/admin/support/placement-photo-assignment.mts';

import {
  type PlacementPublicationIssue,
  type PlacementPublicationReason,
  placementPublicationIssues,
} from './selected-product-publication.ts';
import PlacementSetupCopyDialog from '../../examples/admin/support/placement-setup-copy-dialog.tsx';
import {
  type PlacementVariantEditorSelection,
  parsePlacementVariantEditorSelection,
  placementVariantEditorSelectionKey,
  resolvePlacementVariantEditorSelection,
  serializePlacementVariantEditorSelection,
} from '../../examples/admin/support/placement-variant-editor-selection.mts';
import VariantPhotoPanel, { VariantPhotoSelector } from '../../examples/admin/support/placement-variant-photo-panel.tsx';
import {
  confirmVariantPhotoAlignment,
  getVariantPhotoGroups,
  pruneVariantPhotoAssignments,
  resetVariantPhotoPlacementRect,
  resolveVariantPhotoView,
  setVariantPhotoImage,
  setVariantPhotoPlacementRect,
} from '../../examples/admin/support/placement-variant-photos.mts';
import PlacementCanvas, { type CanvasDrawFailure } from '../../examples/admin/support/placement-workflow-canvas.tsx';
import {
  addPlacement,
  addViewsFromImages,
  clampPlacementRect,
  cloneProductView,
  copyPlacementToView,
  duplicateProductPlacement,
  type EditorPlacement,
  type EditorView,
  moveEditorItem,
  moveEditorItemTo,
  movementRectContainsPlacementRect,
  nextItemName,
  defaultNewSizeScale,
  canonicalPlacementDecimals,
  type PlacementProduct,
  type PlacementRect,
  type PlacementSetupIssue,
  type PlacementValidationError,
  placementSetupIssue,
  validatePlacementProduct,
} from '../../examples/admin/support/placement-workflow-model.mts';
import {
  initialPlacementDialogState,
  initialPlacementWorkspaceState,
  placementDialogReducer,
  placementDialogTargetMatches,
  placementWorkspaceReducer,
} from '../../examples/admin/support/placement-workflow-state.mts';


import type { PlacementPreviewState } from '../../examples/admin/support/placement-preview-storage.mts';
import type { PublishPlacementPreviewResult } from '../../examples/admin/support/placement-publication.mts';
import type { PlacementMethodCatalog } from './selected-method-choices.ts';
import type { PlacementSetupCopyPorts } from '../../examples/admin/support/placement-setup-copy-dialog.tsx';
import type { EditorProductImage, EditorMethod, MethodDraftBinding } from '@insignia/contracts';
/** Typed decimal text as a number; NaN keeps schema checks failing for text the shared parser rejects. */
const decimalOrNaN = (text: string): number => parseDecimalNumber(text) ?? Number.NaN;
type MethodBindings = Record<string, MethodDraftBinding>;
type EditorSnapshot = { product: PlacementProduct; bindings: MethodBindings };
export type ProductPublicationResult = PublishPlacementPreviewResult | { status: 'pending' } | { status:'rejected' } | { status: 'changed'; product: PlacementProduct };
export interface ProductEditorAdapter {
  kind: 'demo' | 'production'; currency: string; selectionScope: string;
  readOnly?: boolean; hasPublished?: boolean; publicationBlocked?: boolean; publicationFailed?: boolean;
  /** A publish request ended without an answer and is being followed until it settles. */
  publicationProgressing?: boolean;
  /** The publication stopped in a state only operator review can resolve. */
  publicationNeedsReview?: boolean;
  productChanging?(previous: PlacementProduct, next: PlacementProduct): PlacementProduct;
  reviews?: { methodId: string; name: string }[];
  reviewMethod?(product: PlacementProduct, methodId: string, decision: 'keep'|'remove'): PlacementProduct;
  publicationIssues?(product: PlacementProduct): PlacementPublicationIssue[];
  saveIssues?(product: PlacementProduct): PlacementPublicationIssue[];
  publication: PlacementPreviewState | null; settled?: PlacementProduct;
  revision(): number; pending(): boolean;
  getBindings?(): MethodBindings;
  restoreBindings?(bindings: MethodBindings): void;
  save(product: PlacementProduct): Promise<PlacementProduct | void>;
  publish(product: PlacementProduct, expectedRevision: number): Promise<ProductPublicationResult>;
  loadMethods(signal: AbortSignal): Promise<PlacementMethodCatalog>;
  copyPorts: PlacementSetupCopyPorts;
  upload?(image: EditorProductImage): Promise<EditorProductImage>;
  preview: typeof import('../../examples/admin/support/placement-customer-preview.mts').launchCustomerPreview;
  methodsApplied?(placementId: string, change: Pick<EditorPlacement, 'methodIds'|'sizes'>, choices: EditorMethod[], editedIds: string[], editedCells: { sizeId: string; methodId: string }[]): void;
  priceEdited?(placementId: string, sizeId: string, methodId: string, amount: string): void;
}

type OutlineItem = { kind: 'view'; id: string } | { kind: 'placement'; id: string; viewId: string };
type PlacementOutlineItem = Extract<OutlineItem, { kind: 'placement' }>;
type OutlineDropTarget = { item: OutlineItem; edge: 'before' | 'after' };
type PointerSortSession = {
  pointerId: number;
  item: OutlineItem;
  handle: HTMLButtonElement;
  row: HTMLElement;
  scrollContainer: HTMLElement | null;
  scrollsDocument: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  grabOffsetY: number;
  ghost: HTMLElement | null;
  target: OutlineDropTarget | null;
  frame: number | null;
};

type PlacementIssueReason = PlacementPublicationReason | PlacementValidationError | 'geometry-input-required';
type Translate = ReturnType<typeof useAdminLocale>['t'];
type PlacementNotice =
  | {
      kind: 'message';
      reason:
        | 'invalid-method-return'
        | 'image-assigned'
        | 'image-changed'
        | 'areas-outside-image'
        | 'placement-duplicated'
        | 'view-duplicated'
        | 'order-updated'
        | 'movement-edit-before-selection'
        | 'movement-edit-before-save'
        | 'movement-edit-before-publish'
        | 'movement-edit-before-preview'
        | 'shared-image-required'
        | 'copy-validation-failed'
        | 'geometry-input-before-selection'
        | 'geometry-input-required'
        | 'invalid-setup'
        | 'draft-changed'
        | 'storage-save-failed'
        | 'draft-saved'
        | 'publish-succeeded'
        | 'publish-failed'
        | 'changes-discarded'
        | 'position-reverted'
        | 'placement-copied';
    }
  | { kind: 'item-edge'; itemKind: 'view' | 'placement'; edge: 'first' | 'last' }
  | { kind: 'item-moved'; itemKind: 'view' | 'placement'; direction: 'up' | 'down' }
  | { kind: 'item-removed'; itemKind: 'view' | 'placement' }
  | { kind: 'publication-issue'; issue: PlacementPublicationIssue }
  | { kind: 'customer-preview-failed'; reason: CustomerPreviewFailure }
  | null;

function placementIssueProblem(reason: PlacementIssueReason, t: Translate): string {
  switch (reason) {
    case 'capacity-exceeded': return t('editor:placementWorkflowPreview.realCapacityExceeded');
    case 'production-dimensions-required': return t('editor:placementWorkflowPreview.realDimensionsRequired');
    case 'method-review-required': return t('editor:placementWorkflowPreview.realReviewMethods');
    case 'product-name-required':
      return t('editor:placementValidation.errors.productNameRequired');
    case 'method-name-required':
      return t('editor:placementValidation.errors.methodNameRequired');
    case 'method-ids-not-unique':
      return t('editor:placementValidation.errors.methodIdsNotUnique');
    case 'fixed-price-invalid':
      return t('editor:placementValidation.errors.fixedPriceInvalid');
    case 'view-required':
      return t('editor:placementValidation.errors.viewRequired');
    case 'view-name-required':
      return t('editor:placementValidation.errors.viewNameRequired');
    case 'placement-required':
      return t('editor:placementValidation.errors.placementRequired');
    case 'placement-name-required':
      return t('editor:placementValidation.errors.placementNameRequired');
    case 'artwork-area-invalid':
      return t('editor:placementValidation.errors.artworkAreaInvalid');
    case 'movement-area-invalid':
      return t('editor:canvas.drawFeedback.movement-must-contain-artwork');
    case 'method-required':
      return t('editor:placementValidation.errors.methodRequired');
    case 'method-unavailable':
      return t('editor:placementValidation.errors.methodUnavailable');
    case 'size-required':
      return t('editor:placementValidation.errors.sizeRequired');
    case 'physical-width-invalid':
      return t('editor:placementValidation.errors.physicalWidthInvalid');
    case 'physical-height-invalid':
      return t('editor:placementValidation.errors.physicalHeightInvalid');
    case 'physical-dimensions-required':
      return t('editor:placementValidation.errors.physicalDimensionsRequired');
    case 'size-name-required':
      return t('editor:placementValidation.errors.sizeNameRequired');
    case 'size-factor-invalid':
      return t('editor:placementValidation.errors.sizeFactorInvalid');
    case 'size-unavailable':
      return t('editor:placementValidation.errors.sizeUnavailable');
    case 'price-invalid':
      return t('editor:placementValidation.errors.priceInvalid');
    case 'image-required':
      return t('editor:placementValidation.errors.imageRequired');
    case 'alignment-review':
      return t('editor:placementValidation.errors.alignmentReview');
    case 'movement-area-required':
      return t('editor:placementValidation.errors.movementAreaRequired');
    case 'price-required':
      return t('editor:placementValidation.errors.priceRequired');
    case 'invalid-schema':
      return t('editor:placementValidation.errors.invalidSchema');
    case 'geometry-input-required':
      return t('editor:placementValidation.errors.geometryInputRequired');
    case 'variant-image-required':
      return t('editor:placementValidation.errors.variantImageRequiredGeneric');
    case 'variant-alignment-review':
      return t('editor:placementValidation.errors.variantAlignmentReviewGeneric');
    case 'image-loading':
      return t('editor:placementValidation.errors.imageLoadingGeneric');
    case 'image-unavailable':
      return t('editor:placementValidation.errors.imageUnavailableGeneric');
  }
}

function placementSetupIssueText(reason: PlacementSetupIssue, t: Translate): string {
  if (reason === 'name-required') return t('editor:placementValidation.errors.placementNameRequired');
  return placementIssueProblem(reason, t);
}

function publicationIssueText(issue: PlacementPublicationIssue, product: PlacementProduct, t: Translate): string {
  const view = issue.viewId ? product.views.find((candidate) => candidate.id === issue.viewId) : undefined;
  const viewName = view?.name.trim() || t('editor:placementWorkflowPreview.unnamedView');
  if (issue.groupKey && issue.viewId) {
    const groupName =
      getVariantPhotoGroups(product).find((group) => group.key === issue.groupKey)?.label ??
      t('editor:placementWorkflowPreview.variantGroupFallback');
    const key =
      issue.reason === 'variant-image-required'
        ? 'editor:placementValidation.errors.variantImageRequired'
        : issue.reason === 'variant-alignment-review'
          ? 'editor:placementValidation.errors.variantAlignmentReview'
          : issue.reason === 'image-loading'
            ? 'editor:placementValidation.errors.imageLoading'
            : 'editor:placementValidation.errors.imageUnavailable';
    return t(key, { groupName, viewName });
  }
  const problem = placementIssueProblem(issue.reason, t);
  if (issue.viewId && issue.placementId) {
    const placementName =
      view?.placements.find((candidate) => candidate.id === issue.placementId)?.name.trim() ||
      t('editor:placementWorkflowPreview.unnamedPlacement');
    return t('editor:placementValidation.context.placement', { viewName, placementName, problem });
  }
  return issue.viewId ? t('editor:placementValidation.context.view', { viewName, problem }) : problem;
}

function placementNoticeText(notice: PlacementNotice, product: PlacementProduct, t: Translate, production = false): string {
  if (!notice) return '';
  if (notice.kind === 'publication-issue') return publicationIssueText(notice.issue, product, t);
  if (notice.kind === 'customer-preview-failed') {
    switch (notice.reason) {
      case 'appearance-unavailable':
        return t('editor:placementWorkflowPreview.customerPreview.appearanceUnavailable');
      case 'assigned-images-required':
        return t('editor:placementWorkflowPreview.customerPreview.assignedImagesRequired');
      case 'draft-invalid':
        return t('editor:placementWorkflowPreview.customerPreview.draftInvalid');
      case 'product-name-required':
        return t('editor:placementWorkflowPreview.customerPreview.productNameRequired');
      case 'view-required':
        return t('editor:placementWorkflowPreview.customerPreview.viewRequired');
      case 'product-image-required':
        return t('editor:placementWorkflowPreview.customerPreview.productImageRequired');
      case 'images-for-placement-views-required':
        return t('editor:placementWorkflowPreview.customerPreview.imagesForPlacementViewsRequired');
      case 'view-name-required':
        return t('editor:placementWorkflowPreview.customerPreview.viewNameRequired');
      case 'priced-placement-required':
        return t('editor:placementWorkflowPreview.customerPreview.pricedPlacementRequired');
      case 'placement-limit-exceeded':
        return t('editor:placementWorkflowPreview.customerPreview.placementLimitExceeded');
      case 'snapshot-copy-failed':
        return t('editor:placementWorkflowPreview.customerPreview.snapshotCopyFailed');
      case 'draft-load-failed':
        return t('editor:placementWorkflowPreview.customerPreview.draftLoadFailed');
      case 'preview-open-failed':
        return t('editor:placementWorkflowPreview.customerPreview.previewOpenFailed');
      case 'preview-send-failed':
        return t('editor:placementWorkflowPreview.customerPreview.previewSendFailed');
    }
  }
  if (notice.kind === 'item-edge') {
    if (notice.itemKind === 'view' && notice.edge === 'first')
      return t('editor:placementWorkflowPreview.notices.viewAlreadyFirst');
    if (notice.itemKind === 'view') return t('editor:placementWorkflowPreview.notices.viewAlreadyLast');
    if (notice.edge === 'first') return t('editor:placementWorkflowPreview.notices.placementAlreadyFirst');
    return t('editor:placementWorkflowPreview.notices.placementAlreadyLast');
  }
  if (notice.kind === 'item-moved') {
    if (notice.itemKind === 'view' && notice.direction === 'up')
      return t('editor:placementWorkflowPreview.notices.viewMovedUp');
    if (notice.itemKind === 'view') return t('editor:placementWorkflowPreview.notices.viewMovedDown');
    if (notice.direction === 'up') return t('editor:placementWorkflowPreview.notices.placementMovedUp');
    return t('editor:placementWorkflowPreview.notices.placementMovedDown');
  }
  if (notice.kind === 'item-removed')
    return notice.itemKind === 'view'
      ? t('editor:placementWorkflowPreview.notices.viewRemoved')
      : t('editor:placementWorkflowPreview.notices.placementRemoved');
  if (notice.kind !== 'message') return '';
  switch (notice.reason) {
    case 'invalid-method-return':
      return t('editor:placementWorkflowPreview.notices.invalidMethodReturn');
    case 'image-assigned':
      return t('editor:placementWorkflowPreview.notices.imageAssigned');
    case 'image-changed':
      return t('editor:placementWorkflowPreview.notices.imageChanged');
    case 'areas-outside-image':
      return t('editor:placementWorkflowPreview.notices.areasOutsideImage');
    case 'placement-duplicated':
      return t('editor:placementWorkflowPreview.notices.placementDuplicated');
    case 'view-duplicated':
      return t('editor:placementWorkflowPreview.notices.viewDuplicated');
    case 'order-updated':
      return t('editor:placementWorkflowPreview.notices.orderUpdated');
    case 'movement-edit-before-selection':
      return t('editor:placementWorkflowPreview.notices.movementEditBeforeSelection');
    case 'movement-edit-before-save':
      return t('editor:placementWorkflowPreview.notices.movementEditBeforeSave');
    case 'movement-edit-before-publish':
      return t('editor:placementWorkflowPreview.notices.movementEditBeforePublish');
    case 'movement-edit-before-preview':
      return t('editor:placementWorkflowPreview.notices.movementEditBeforePreview');
    case 'shared-image-required':
      return t('editor:placementWorkflowPreview.notices.sharedImageRequired');
    case 'copy-validation-failed':
      return t('editor:placementWorkflowPreview.notices.copyValidationFailed');
    case 'geometry-input-before-selection':
      return t('editor:placementWorkflowPreview.notices.geometryInputBeforeSelection');
    case 'geometry-input-required':
      return t('editor:placementWorkflowPreview.notices.geometryInputRequired');
    case 'invalid-setup':
      return t('editor:placementWorkflowPreview.notices.invalidSetup');
    case 'draft-changed':
      return t('editor:placementWorkflowPreview.realDraftChanged');
    case 'storage-save-failed':
      return t(production ? 'editor:placementWorkflowPreview.realSaveFailed' : 'editor:placementWorkflowPreview.notices.storageSaveFailed');
    case 'draft-saved':
      return t(production ? 'editor:placementWorkflowPreview.realDraftSaved' : 'editor:placementWorkflowPreview.notices.draftSaved');
    case 'publish-failed':
      return t('editor:placementWorkflowPreview.realPublicationFailed');
    case 'publish-succeeded':
      return t(production ? 'editor:placementWorkflowPreview.realPublished' : 'editor:placementWorkflowPreview.notices.publishSucceeded');
    case 'changes-discarded':
      return t('editor:placementWorkflowPreview.notices.changesDiscarded');
    case 'position-reverted':
      return t('editor:placementWorkflowPreview.notices.positionReverted');
    case 'placement-copied':
      return t('editor:placementWorkflowPreview.notices.placementCopied');
  }
}
const uid = () => crypto.randomUUID();

/** Long enough to read a sentence; the host toast and the in-page fallback use the same time. */
const FEEDBACK_MS = 8000;
type HostToast = { show(message: string, options?: { duration?: number }): unknown };
/** Shopify's toast sits above its own bottom bar; the in-page banner is only the fallback without a host. */
const hostToast = (): HostToast | undefined =>
  (window as unknown as { shopify?: { toast?: HostToast } }).shopify?.toast;

// Names update the draft as you type. Enter finishes this field, not the whole configuration.
function finishNameEdit(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.isComposing) return;
  event.preventDefault();
  const input = event.composedPath().find((target) => target instanceof HTMLInputElement);
  if (input instanceof HTMLInputElement) input.blur();
}

export function PlacementEditor({ initial, adapter }: { initial: PlacementProduct; adapter: ProductEditorAdapter }) {
  const { t: translateUi, formatLocale } = useAdminLocale();
  const [writeBusy, setWriteBusy] = useState(false);
  const writeBusyRef = useRef(false);
  useEffect(() => {
    if (!adapter.settled) return;
    const confirmedBindings = adapter.getBindings?.() ?? {};
    if (!writeBusyRef.current && !adapter.pending()) {
      commitPlacementDraftChange(history.current, { product: currentProduct.current, bindings: currentBindings.current }, { product: adapter.settled, bindings: confirmedBindings });
      currentBindings.current = confirmedBindings;
      currentProduct.current = adapter.settled;
      renderProduct(adapter.settled);
    }
    setSaved(adapter.settled); savedBindings.current = confirmedBindings;
  }, [adapter.settled]);
  useEffect(() => { setPublication(adapter.publication); }, [adapter.publication]);
  const [saved, setSaved] = useState(initial);
  const currentBindings = useRef<MethodBindings>(adapter.getBindings?.() ?? {});
  const savedBindings = useRef(currentBindings.current);
  const [publication, setPublication] = useState(adapter.publication);
  const [product, renderProduct] = useState(initial);
  const [historyNotice, setHistoryNotice] = useState<'change-undone' | 'change-redone' | null>(null);
  const currentProduct = useRef(initial);
  const interactionTargetRevision = useRef(0);
  const selectedViewId = useRef(initial.views[0]?.id ?? '');
  const photoSessionGuard = useRef({ sessionId: '', pickerRevision: -1 });
  const claimedPhotoSubmissions = useRef(new Set<string>());
  const claimedMethodCommits = useRef(new Set<string>());
  const [photoPicker, dispatchPhotoPicker] = useReducer(placementPhotoPickerReducer, closedPlacementPhotoPicker);
  const history = useRef(createPlacementHistory<EditorSnapshot>());
  const historyGroup = useRef<string | undefined>(undefined);
  const groupSequence = useRef(0);
  function invalidatePhotoPickerContext(productId: string, viewId: string, targetRevision: number) {
    const staleSessionId = photoSessionGuard.current.sessionId;
    photoSessionGuard.current = { sessionId: '', pickerRevision: -1 };
    dispatchPhotoPicker({ type: 'context-invalidated', productId, viewId, targetRevision });
    if (staleSessionId) dispatchPhotoPicker({ type: 'closed', sessionId: staleSessionId });
  }
  function setProduct(
    change: PlacementProduct | ((current: PlacementProduct) => PlacementProduct),
    origin: 'editor' | 'photo-picker' = 'editor',
  ): boolean {
    const current = currentProduct.current;
    if (adapter.readOnly || writeBusyRef.current || adapter.pending()) return false;
    let next = pruneVariantPhotoAssignments(typeof change === 'function' ? change(current) : change);
    next = adapter.productChanging?.(current,next) ?? next;
    const nextBindings = adapter.getBindings?.() ?? currentBindings.current;
    if (!commitPlacementDraftChange(history.current, { product: current, bindings: currentBindings.current }, { product: next, bindings: nextBindings }, historyGroup.current)) return false;
    currentBindings.current = nextBindings;
    currentProduct.current = next;
    renderProduct(next);
    interactionTargetRevision.current += 1;
    if (origin === 'editor')
      invalidatePhotoPickerContext(next.id, selectedViewId.current, interactionTargetRevision.current);
    return true;
  }
  function endHistoryGroup() {
    historyGroup.current = undefined;
    endPlacementHistoryGroup(history.current);
  }
  const requestedSelection = new URLSearchParams(location.search);
  const requestedView = initial.views.find((item) => item.id === requestedSelection.get('view'));
  const requestedPlacement = requestedView?.placements.find((item) => item.id === requestedSelection.get('placement'));
  const invalidMethodReturn = requestedSelection.get('chooseMethods') === '1' && !requestedPlacement;
  const initialPhotoGroups = getVariantPhotoGroups(initial);
  const selectionExample = adapter.selectionScope;
  const selectionStorageKey = placementVariantEditorSelectionKey(selectionExample, initial.id);
  let savedEditorSelection = null;
  if (initialPhotoGroups.length > 0) {
    try {
      savedEditorSelection = parsePlacementVariantEditorSelection(window.sessionStorage.getItem(selectionStorageKey));
    } catch {
      savedEditorSelection = null;
    }
  }
  const initialEditorSelection = resolvePlacementVariantEditorSelection({
    views: initial.views.map((item) => ({
      id: item.id,
      placementIds: item.placements.map((placement) => placement.id),
    })),
    appearanceKeys: initialPhotoGroups.map((group) => group.key),
    saved: savedEditorSelection,
    requestedViewId: requestedSelection.get('view'),
    requestedPlacementId: requestedSelection.get('placement'),
    hasExplicitViewOrPlacement:
      requestedSelection.has('view') ||
      requestedSelection.has('placement') ||
      requestedSelection.has('variantImages') ||
      requestedSelection.get('chooseMethods') === '1',
    clearPlacement: invalidMethodReturn || requestedSelection.has('variantImages'),
  });
  const initialView = initial.views.find((item) => item.id === initialEditorSelection.viewId);
  const initialPlacement = initialView?.placements.find((item) => item.id === initialEditorSelection.placementId);
  const [viewId, setViewIdState] = useState(initialEditorSelection.viewId);
  const [selectedId, setSelectedIdState] = useState<string | null>(initialEditorSelection.placementId);
  selectedViewId.current = viewId;
  const editorSelectionRef = useRef<PlacementVariantEditorSelection>(initialEditorSelection);
  const selections = useRef(
    new WeakMap<PlacementProduct, { viewId: string; selectedId: string | null; appearanceKey: string | null }>(),
  );
  const [dialog, dispatchDialog] = useReducer(placementDialogReducer, initialPlacementDialogState);
  const methodDialog = dialog.kind === 'method-manager' ? dialog : null;
  const publishReview = dialog.kind === 'publish' ? dialog : null;
  const production = adapter.kind === 'production';
  useEffect(() => { if (dialog.kind === 'publish' && dialog.error === 'pending' && !adapter.pending() && (adapter.publicationFailed || adapter.publication?.published)) { dispatchDialog({ type: 'dialog-closed', id: dialog.id }); setNotice({ kind: 'message', reason: adapter.publicationFailed ? 'publish-failed' : 'publish-succeeded' }); } else if (dialog.kind === 'publish' && dialog.error === 'pending' && adapter.publicationNeedsReview) dispatchDialog({ type: 'dialog-closed', id: dialog.id }); }, [adapter.publication, adapter.publicationNeedsReview]);
  const publishError = publishReview?.error
    ? translateUi(
        publishReview.error === 'pending'
          ? adapter.publicationProgressing
            ? 'editor:placementWorkflowPreview.realPublicationProgress'
            : 'editor:placementWorkflowPreview.realPublicationPending'
          : publishReview.error === 'conflict'
          ? 'editor:placementWorkflowPreview.publishErrors.conflict'
          : publishReview.error === 'busy'
          ? 'editor:placementWorkflowPreview.publishErrors.shopifyBusy'
          : 'editor:placementWorkflowPreview.publishErrors.storageError',
      )
    : '';
  const removing = dialog.kind === 'remove' ? dialog.target : null;
  const removingOrigin = dialog.kind === 'remove' ? dialog.origin : 'outline';
  const leaving = dialog.kind === 'leave' ? dialog.href : null;
  const discarding = dialog.kind === 'discard';
  const copyingSetup = dialog.kind === 'copy-setup' ? dialog.source : null;
  const copySource = dialog.kind === 'copy-placement' ? dialog.source : null;
  const copyTarget = dialog.kind === 'copy-placement' ? dialog.targetViewId : '';
  const methodDraft = methodDialog?.draft ?? null;
  const [workspace, dispatchWorkspace] = useReducer(placementWorkspaceReducer, initialPlacementWorkspaceState);
  const workspaceMode = workspace.mode;
  const preview = workspaceMode.kind === 'size-preview';
  const previewSizeId = workspaceMode.kind === 'size-preview' ? workspaceMode.sizeId : '';
  const drawing =
    workspaceMode.kind === 'drawing-placement' ||
    (workspaceMode.kind === 'movement-edit' && workspaceMode.phase === 'drawing');
  const drawingTarget = workspaceMode.kind === 'movement-edit' ? 'movement' : 'placement';
  const movementEditing = workspaceMode.kind === 'movement-edit';
  const movementDraft = workspaceMode.kind === 'movement-edit' ? workspaceMode.draft : null;
  const movementError = workspaceMode.kind === 'movement-edit' ? workspaceMode.error : null;
  const movementErrorText = movementError
    ? translateUi('editor:canvas.drawFeedback.movement-must-contain-artwork')
    : '';
  const calibrationEditing = workspaceMode.kind === 'measuring';
  const measurementLine = workspaceMode.kind === 'measuring' ? workspaceMode.line : null;
  const measurementDistance = workspaceMode.kind === 'measuring' ? workspaceMode.distance : '';
  const measurementCoordinates = workspaceMode.kind === 'measuring' && workspaceMode.coordinatesOpen;
  const measurementPointInputs = workspaceMode.kind === 'measuring' ? workspaceMode.pointInputs : {};
  const measurementError =
    workspaceMode.kind === 'measuring' && workspaceMode.error
      ? translateUi('editor:placementWorkflowPreview.measurementInvalid')
      : '';
  const groupAreaEditing = workspaceMode.kind === 'group-area-edit';
  const [expandedCanvas, setExpandedCanvas] = useState(false);
  const [outlineHidden, setOutlineHidden] = useState(false);
  const [wideEditor, setWideEditor] = useState(() => matchMedia('(min-width: 1181px)').matches);
  const [geometryInput, setGeometryInput] = useState<{
    viewId: string;
    placementId: string;
    key: 'centerX' | 'centerY' | 'width' | 'height';
    value: string;
  } | null>(null);
  const [panel, setPanel] = useState<'placements' | 'settings'>(
    requestedSelection.get('chooseMethods') === '1' || requestedSelection.has('variantImages')
      ? 'settings'
      : 'placements',
  );
  const [expandedViews, setExpandedViews] = useState<string[]>(initialView ? [initialView.id] : []);
  const [outlineQuery, setOutlineQuery] = useState('');
  useEffect(() => {
    if (requestedSelection.get('chooseMethods') !== '1' || !initialPlacement || !initialView) return;
    dispatchDialog({
      type: 'method-manager-opened',
      id: uid(),
      productId: initial.id,
      target: { viewId: initialView.id, placementId: initialPlacement.id },
      targetRevision: interactionTargetRevision.current,
      draft: structuredClone({ methodIds: initialPlacement.methodIds, sizes: initialPlacement.sizes }),
    });
    const url = new URL(location.href);
    url.searchParams.delete('chooseMethods');
    window.history.replaceState(window.history.state, '', url);
  }, []);
  const [methodErrors, setMethodErrors] = useState<Record<string, string>>({});
  const [methodQuery, setMethodQuery] = useState('');
  const [methodFilter, setMethodFilter] = useState('all');
  const [expandedMethodIds, setExpandedMethodIds] = useState<string[]>([]);
  const [draggingItem, setDraggingItem] = useState<OutlineItem | null>(null);
  const [dropTarget, setDropTarget] = useState<OutlineDropTarget | null>(null);
  const [notice, setNotice] = useState<PlacementNotice>(
    invalidMethodReturn ? { kind: 'message', reason: 'invalid-method-return' } : null,
  );
  const feedback =
    notice?.kind === 'message' && (notice.reason === 'draft-saved' || notice.reason === 'changes-discarded');
  const noticeText = placementNoticeText(notice, product, translateUi, adapter.kind === 'production');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const addingView = photoPicker.status === 'editing';
  const replacingImage = addingView && photoPicker.intent === 'replace-view';
  const choosingSingleImage = addingView && photoPicker.intent !== 'add-views';
  const variantImageTargets =
    addingView && photoPicker.intent === 'assign-variant-groups' ? photoPicker.groupKeys : null;
  const imageSelectionReady = addingView && photoPicker.selectionReady;
  const imageProcessing = addingView && photoPicker.processing;
  const [activePhotoGroup, setActivePhotoGroupState] = useState<string | null>(initialEditorSelection.appearanceKey);
  selections.current.set(product, { viewId, selectedId, appearanceKey: activePhotoGroup });
  const [alignmentFocusRequested, setAlignmentFocusRequested] = useState(false);
  const [failedPhotoUrls, setFailedPhotoUrls] = useState<string[]>([]);
  const [readyPhotoUrls, setReadyPhotoUrls] = useState<string[]>([]);
  const [photoRetryRevisions, setPhotoRetryRevisions] = useState<Record<string, number>>({});
  const [pendingPhotoUrls, setPendingPhotoUrls] = useState<string[]>([]);
  function retryPhoto(url: string) {
    setPendingPhotoUrls((current) => (current.includes(url) ? current : [...current, url]));
    setReadyPhotoUrls((current) => current.filter((item) => item !== url));
    setPhotoRetryRevisions((current) => ({ ...current, [url]: (current[url] ?? 0) + 1 }));
  }
  function photoLoadStatus(url: string, failed: boolean, source: 'thumbnail' | 'canvas' = 'thumbnail') {
    if (!failed && source === 'thumbnail' && url === canvasView?.imageUrl) return;
    setPendingPhotoUrls((current) => (current.includes(url) ? current.filter((item) => item !== url) : current));
    setFailedPhotoUrls((current) =>
      failed
        ? current.includes(url)
          ? current
          : [...current, url]
        : current.includes(url)
          ? current.filter((item) => item !== url)
          : current,
    );
    setReadyPhotoUrls((current) =>
      failed
        ? current.includes(url)
          ? current.filter((value) => value !== url)
          : current
        : current.includes(url)
          ? current
          : [...current, url],
    );
  }
  function imageLoadIssues(candidate: PlacementProduct): PlacementPublicationIssue[] {
    return getVariantPhotoGroups(candidate).flatMap((group) =>
      candidate.views.flatMap((item) => {
        const resolved = resolveVariantPhotoView(candidate, item.id, group.key);
        return failedPhotoUrls.includes(resolved.view.imageUrl) || pendingPhotoUrls.includes(resolved.view.imageUrl)
          ? [
              {
                key: `variantPhotos.${item.id}.${group.key}.load`,
                reason: pendingPhotoUrls.includes(resolved.view.imageUrl) ? 'image-loading' : 'image-unavailable',
                viewId: item.id,
                groupKey: group.key,
              },
            ]
          : [];
      }),
    );
  }
  const [pickerImages, setPickerImages] = useState(initial.images);
  const [interactionRevision, setInteractionRevision] = useState(0);
  const viewImages = addingView && photoPicker.intent === 'add-views' ? photoPicker.imageIds : [];
  const viewImage = addingView && photoPicker.intent !== 'add-views' ? (photoPicker.imageIds[0] ?? '') : '';
  const main = useRef<HTMLDivElement>(null);
  const pointerSort = useRef<PointerSortSession | null>(null);
  const view = product.views.find((item) => item.id === viewId) ?? product.views[0];
  const placement = view?.placements.find((item) => item.id === selectedId);
  const photoGroups = getVariantPhotoGroups(product);
  const photoTargetGroups = photoGroups.filter((group) => variantImageTargets?.includes(group.key));
  const photoTargetVariantCount = photoTargetGroups.reduce((sum, group) => sum + group.variantIds.length, 0);
  const nextPhotoTarget =
    variantImageTargets?.length === 1 && view
      ? nextUnassignedPhotoGroup(product, view.id, variantImageTargets[0] ?? '')
      : undefined;
  const photoGroupSignature = photoGroups.map((group) => group.key).join('|');
  const activePhoto = photoGroups.find((group) => group.key === activePhotoGroup);
  const photoView = view ? resolveVariantPhotoView(product, view.id, activePhoto?.key) : null;
  const canvasView = photoView?.view ?? view;
  const photoAssignment = product.variantPhotos?.assignments.find(
    (item) => item.viewId === view?.id && item.groupKey === activePhoto?.key,
  );
  const hasGroupArea = !!(placement && photoAssignment?.placementRects?.[placement.id]);
  const groupAreaScope = !!activePhoto && (groupAreaEditing || hasGroupArea);
  const displayedRect =
    (groupAreaScope ? canvasView?.placements.find((item) => item.id === selectedId)?.rect : placement?.rect) ??
    placement?.rect;
  function writeEditorSelection(selection = editorSelectionRef.current) {
    if (photoGroups.length === 0 || !selection.viewId) return;
    try {
      window.sessionStorage.setItem(selectionStorageKey, serializePlacementVariantEditorSelection(selection));
    } catch {
      // Editor selection is best-effort session state. Product edits remain independent.
    }
  }
  function updateEditorSelection(change: Partial<PlacementVariantEditorSelection>) {
    const next = { ...editorSelectionRef.current, ...change };
    editorSelectionRef.current = next;
    writeEditorSelection(next);
    return next;
  }
  function setViewId(nextViewId: string) {
    if (selectedViewId.current !== nextViewId) {
      selectedViewId.current = nextViewId;
      interactionTargetRevision.current += 1;
      invalidatePhotoPickerContext(currentProduct.current.id, nextViewId, interactionTargetRevision.current);
    }
    updateEditorSelection({ viewId: nextViewId });
    setViewIdState(nextViewId);
    dispatchWorkspace({
      type: 'selection-changed',
      viewId: nextViewId,
      placementId: editorSelectionRef.current.placementId,
    });
  }
  function setSelectedId(nextPlacementId: string | null) {
    updateEditorSelection({ placementId: nextPlacementId });
    setSelectedIdState(nextPlacementId);
    dispatchWorkspace({ type: 'selection-changed', viewId: selectedViewId.current, placementId: nextPlacementId });
  }
  function setActivePhotoGroup(nextAppearanceKey: string | null) {
    updateEditorSelection({ appearanceKey: nextAppearanceKey });
    setActivePhotoGroupState(nextAppearanceKey);
    dispatchWorkspace({ type: 'mode-canceled' });
  }
  function cancelDrawingTask() {
    if (workspaceMode.kind === 'movement-edit') dispatchWorkspace({ type: 'movement-drawing-canceled' });
    else dispatchWorkspace({ type: 'placement-drawing-canceled' });
  }
  function exitSizePreview() {
    if (workspaceMode.kind === 'size-preview') dispatchWorkspace({ type: 'mode-canceled' });
  }
  function closePhotoPicker() {
    const sessionId = photoPicker.sessionId;
    if (!sessionId) return;
    photoSessionGuard.current = { sessionId: '', pickerRevision: -1 };
    for (const claim of claimedPhotoSubmissions.current)
      if (claim.startsWith(`${sessionId}:`)) claimedPhotoSubmissions.current.delete(claim);
    dispatchPhotoPicker({ type: 'closed', sessionId });
  }
  function recordPickerSelection(sessionId: string, pickerRevision: number, imageIds: string[]) {
    dispatchPhotoPicker({ type: 'selection-changed', sessionId, pickerRevision, imageIds });
  }
  function recordPickerReadiness(sessionId: string, pickerRevision: number, ready: boolean, imageIds: string[]) {
    dispatchPhotoPicker({ type: 'selection-ready', sessionId, pickerRevision, imageIds, ready });
  }
  function recordPickerProcessing(sessionId: string, pickerRevision: number, processing: boolean) {
    dispatchPhotoPicker({ type: 'processing-changed', sessionId, pickerRevision, processing });
  }
  function recordPickerUpload(sessionId: string, pickerRevision: number, image: PlacementProduct['images'][number]) {
    if (
      photoSessionGuard.current.sessionId !== sessionId ||
      photoSessionGuard.current.pickerRevision !== pickerRevision
    )
      return;
    setPickerImages((current) => (current.some((item) => item.id === image.id) ? current : [...current, image]));
  }
  function startPhotoPicker(
    intent: 'add-views' | 'replace-view' | 'assign-variant-groups',
    groupKeys: string[] = [],
    imageIds: string[] = [],
  ) {
    if ((intent !== 'add-views' && !view) || !prepareSelectionChange()) return false;
    cancelCalibration();
    const sessionId = uid();
    photoSessionGuard.current = { sessionId, pickerRevision: 0 };
    dispatchPhotoPicker({
      type: 'opened',
      sessionId,
      intent,
      productId: product.id,
      viewId: view?.id ?? '',
      targetRevision: interactionTargetRevision.current,
      ...(groupKeys.length ? { groupKeys } : {}),
      ...(imageIds.length ? { imageIds } : {}),
    });
    setPickerImages(product.images);
    return true;
  }
  useEffect(() => {
    if (activePhotoGroup && !photoGroups.some((group) => group.key === activePhotoGroup)) setActivePhotoGroup(null);
  }, [photoGroupSignature]);
  useEffect(() => {
    writeEditorSelection();
  }, [photoGroupSignature, selectionStorageKey]);
  useEffect(() => {
    if (!alignmentFocusRequested || !canvasView || !readyPhotoUrls.includes(canvasView.imageUrl)) return;
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-confirm-variant-alignment]')?.focus({ preventScroll: true });
      setAlignmentFocusRequested(false);
    });
  }, [alignmentFocusRequested, canvasView?.imageUrl, readyPhotoUrls]);
  function choosePhotoGroup(key: string | null) {
    if (!prepareSelectionChange()) return;
    setAlignmentFocusRequested(false);
    setActivePhotoGroup(key);
    cancelCalibration();
    cancelDrawingTask();
    exitSizePreview();
    setInteractionRevision((value) => value + 1);
  }
  function openVariantImagePicker(keys: string[]) {
    if (!keys.length || !startPhotoPicker('assign-variant-groups', keys)) return;
    const resolved = keys.length === 1 && view ? resolveVariantPhotoView(product, view.id, keys[0] ?? '') : null;
    if (resolved?.status === 'ready') {
      const imageId = product.images.find((image) => image.url === resolved.view.imageUrl)?.id ?? '';
      dispatchPhotoPicker({
        type: 'selection-changed',
        sessionId: photoSessionGuard.current.sessionId,
        pickerRevision: photoSessionGuard.current.pickerRevision,
        imageIds: imageId ? [imageId] : [],
      });
    }
  }
  function assignVariantImage(continueAdding = false) {
    if (photoPicker.intent !== 'assign-variant-groups' || !addingView || !view) return;
    const sessionId = photoPicker.sessionId;
    const pickerRevision = photoPicker.pickerRevision;
    const sessionKey = `${sessionId}:${pickerRevision}`;
    if (
      photoSessionGuard.current.sessionId !== sessionId ||
      photoSessionGuard.current.pickerRevision !== pickerRevision
    )
      return;
    const confirmation = confirmPlacementPhotoPicker(photoPicker, {
      sessionId,
      pickerRevision,
      productId: product.id,
      viewId: view.id,
      targetRevision: interactionTargetRevision.current,
    });
    if (confirmation.kind !== 'ready' || claimedPhotoSubmissions.current.has(sessionKey)) return;
    const imageId = confirmation.imageIds[0];
    const source = pickerImages.find((image) => image.id === imageId);
    if (!source) return;
    claimedPhotoSubmissions.current.add(sessionKey);
    const assignedKey = confirmation.groupKeys[0] ?? null;
    setProduct(
      (current) =>
        setVariantPhotoImage(
          { ...current, images: pickerImages },
          confirmation.targetViewId,
          confirmation.groupKeys,
          source.id,
        ),
      'photo-picker',
    );
    setActivePhotoGroup(assignedKey);
    exitSizePreview();
    cancelDrawingTask();
    if (continueAdding && nextPhotoTarget) {
      const nextRevision = photoPicker.pickerRevision + 1;
      photoSessionGuard.current = { sessionId, pickerRevision: nextRevision };
      dispatchPhotoPicker({
        type: 'assignment-advanced',
        sessionId,
        nextGroupKey: nextPhotoTarget.key,
        targetRevision: interactionTargetRevision.current,
      });
      setNotice(null);
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-photo-target]')?.focus());
      return;
    }
    closePhotoPicker();
    setNotice({ kind: 'message', reason: 'image-assigned' });
    requestAnimationFrame(() => {
      const row = Array.from(document.querySelectorAll<HTMLElement>('[data-photo-group-key]')).find(
        (item) => item.dataset.photoGroupKey === assignedKey,
      );
      (
        row?.querySelector<HTMLElement>('s-clickable') ??
        document.querySelector<HTMLElement>('[data-variant-photo-panel]')
      )?.focus({ preventScroll: true });
    });
  }
  function confirmViewImagePicker() {
    if (!addingView || photoPicker.intent === 'assign-variant-groups') return;
    const { sessionId, pickerRevision } = photoPicker;
    const claim = `${sessionId}:${pickerRevision}`;
    if (
      photoSessionGuard.current.sessionId !== sessionId ||
      photoSessionGuard.current.pickerRevision !== pickerRevision ||
      claimedPhotoSubmissions.current.has(claim)
    )
      return;
    const confirmation = confirmPlacementPhotoPicker(photoPicker, {
      sessionId,
      pickerRevision,
      productId: product.id,
      viewId: view?.id ?? '',
      targetRevision: interactionTargetRevision.current,
    });
    if (confirmation.kind !== 'ready') return;
    claimedPhotoSubmissions.current.add(claim);
    if (photoPicker.intent === 'replace-view') {
      const image = pickerImages.find((item) => item.id === confirmation.imageIds[0]);
      const targetView = product.views.find((item) => item.id === confirmation.targetViewId);
      if (!image || !targetView) return;
      setProduct(
        (current) => ({
          ...current,
          images: pickerImages,
          views: current.views.map((item) =>
            item.id === targetView.id
              ? {
                  ...item,
                  imageUrl: image.url,
                  imageWidth: image.width,
                  imageHeight: image.height,
                  calibration: undefined,
                  needsAlignmentReview: true,
                }
              : item,
          ),
        }),
        'photo-picker',
      );
      setNotice({ kind: 'message', reason: 'image-changed' });
    } else {
      const additions = confirmation.imageIds.map((imageId) => ({ imageId, id: uid() }));
      const added = addViewsFromImages({ ...product, images: pickerImages }, additions);
      setProduct(added, 'photo-picker');
      const first = additions[0];
      if (first) setViewId(first.id);
      setExpandedViews((current) => [...current, ...additions.map((item) => item.id)]);
      setNotice(null);
      focusName();
    }
    setSelectedId(null);
    setPanel('settings');
    closePhotoPicker();
    exitSizePreview();
    cancelDrawingTask();
  }
  function changeArtworkRect(id: string, rect: PlacementRect, targetViewId = view?.id) {
    if (!targetViewId) return;
    setProduct((current) => artworkRectCandidate(current, targetViewId, id, rect));
  }
  function artworkRectCandidate(
    current: PlacementProduct,
    targetViewId: string,
    id: string,
    rect: PlacementRect,
  ): PlacementProduct {
    if (groupAreaScope && activePhoto) {
      try {
        return setVariantPhotoPlacementRect(current, targetViewId, activePhoto.key, id, clampPlacementRect(rect));
      } catch {
        setNotice({ kind: 'message', reason: 'areas-outside-image' });
        return current;
      }
    }
    return {
      ...current,
      views: current.views.map((item) =>
        item.id === targetViewId
          ? {
              ...item,
              placements: item.placements.map((area) =>
                area.id === id ? { ...area, rect: clampPlacementRect(rect) } : area,
              ),
            }
          : item,
      ),
    };
  }

  const calibration =
    canvasView?.calibration && calibrationMatchesImage(canvasView.calibration, canvasView)
      ? canvasView.calibration
      : null;
  const estimatedSize = calibration && placement ? approximatePlacementDimensions(calibration, placement.rect) : null;
  function cancelCalibration() {
    if (workspaceMode.kind === 'measuring') dispatchWorkspace({ type: 'mode-canceled' });
  }
  const removal = removing ? locateOutlineItem(product, removing) : null;
  const copySourceData = copySource ? locateOutlineItem(product, copySource) : null;
  const dirty = !placementDraftEqual(currentBindings.current, savedBindings.current) || !placementDraftEqual(product, saved) || geometryInput !== null || movementEditing;
  const publishedCurrent =
    !!publication?.published && !adapter.pending() && placementDraftEqual(product, publication.published) && !geometryInput;
  const setupStatus = translateUi(
    publication?.published || adapter.hasPublished
      ? publishedCurrent
        ? adapter.kind === 'demo' ? 'editor:placementWorkflowPreview.status.previewPublished' : 'editor:placementWorkflowPreview.realPublished'
        : 'editor:placementWorkflowPreview.status.draftChanges'
      : 'editor:placementWorkflowPreview.status.draft',
  );
  const missingViewIssue =
    publishReview?.issues.length === 1 && publishReview.issues[0]?.key === 'views' ? publishReview.issues[0] : null;
  const publishViewCount = publishReview?.product.views.length ?? 0;
  const publishPlacementCount =
    publishReview?.product.views.reduce((sum, item) => sum + item.placements.length, 0) ?? 0;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const outlineSearch = outlineQuery.trim().toLocaleLowerCase(formatLocale);
  const returnTo = productEditorReturnPath(new URLSearchParams(location.search).get('returnTo'));
  const methodPlacement = methodDraft ?? placement;
  const enabledMethods = product.methods.filter((method) => placement?.methodIds.includes(method.id));
  const movementNeedsReview = !!(
    placement?.movementRect && !movementRectContainsPlacementRect(placement.movementRect, placement.rect)
  );
  const visibleMethods = product.methods.filter(
    (method) =>
      (methodFilter !== 'enabled' || methodPlacement?.methodIds.includes(method.id)) &&
      method.name.toLocaleLowerCase(formatLocale).includes(methodQuery.trim().toLocaleLowerCase(formatLocale)),
  );
  const count = product.views.reduce((sum, item) => sum + item.placements.length, 0);
  const outlineItems = product.views.flatMap((item) => {
    const matchesView = item.name.toLocaleLowerCase(formatLocale).includes(outlineSearch);
    const areas = matchesView
      ? item.placements
      : item.placements.filter((area) => area.name.toLocaleLowerCase(formatLocale).includes(outlineSearch));
    return !outlineSearch || matchesView || areas.length ? [{ view: item, areas }] : [];
  });
  const nameFocusRevision = useRef(0);
  function focusName(editField = true) {
    const revision = ++nameFocusRevision.current;
    // Menu dismissal restores its trigger on a later frame. Move focus after that restoration.
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (revision !== nameFocusRevision.current) return;
          const field = main.current?.querySelector<HTMLElement>(
            editField ? '#placement-properties [data-editor-name-field]' : '.placement-object-name',
          );
          if (editField) field?.scrollIntoView({ block: 'nearest' });
          field?.focus({ preventScroll: !editField });
        }),
      ),
    );
  }
  function rename(nextView: EditorView, id: string | null) {
    if (select(nextView, id, true)) focusName();
  }
  function locateOutlineItem(base: PlacementProduct, item: OutlineItem) {
    const targetViewId = item.kind === 'view' ? item.id : item.viewId;
    const targetView = base.views.find((candidate) => candidate.id === targetViewId);
    if (!targetView) return null;
    if (item.kind === 'view') return { view: targetView, placement: null };
    const targetPlacement = targetView.placements.find((candidate) => candidate.id === item.id);
    return targetPlacement ? { view: targetView, placement: targetPlacement } : null;
  }
  function duplicatePlacementItem(item: PlacementOutlineItem) {
    const base = prepareSelectionChange();
    const source = base && locateOutlineItem(base, item);
    if (!base || !source?.placement) return;
    const id = uid();
    const next = duplicateProductPlacement(base, source.view.id, item.id, id);
    const updated = next.views.find((candidate) => candidate.id === source.view.id);
    if (!updated) return;
    setProduct(next);
    setOutlineQuery('');
    select(updated, id, true, false);
    exitSizePreview();
    setNotice({ kind: 'message', reason: 'placement-duplicated' });
    focusName();
  }
  function duplicateViewItem(item: Extract<OutlineItem, { kind: 'view' }>) {
    const base = prepareSelectionChange();
    if (!base || !locateOutlineItem(base, item)) return;
    const id = uid();
    const next = cloneProductView(base, item.id, id);
    const created = next.views.find((candidate) => candidate.id === id);
    if (!created) return;
    setProduct(next);
    setOutlineQuery('');
    select(created, null, true, false);
    setNotice({ kind: 'message', reason: 'view-duplicated' });
    focusName();
  }
  function renameOutlineItem(item: OutlineItem) {
    const base = prepareSelectionChange();
    const source = base && locateOutlineItem(base, item);
    if (!source) return;
    select(source.view, source.placement?.id ?? null, true, false);
    focusName();
  }
  function openCopy(item: PlacementOutlineItem) {
    const base = prepareSelectionChange();
    const source = base && locateOutlineItem(base, item);
    if (!base || !source?.placement) return;
    dispatchDialog({
      type: 'copy-placement-opened',
      id: uid(),
      source: { kind: 'placement', id: item.id, viewId: item.viewId },
      targetViewId: base.views.find((candidate) => candidate.id !== source.view.id)?.id ?? '',
    });
  }
  function requestRemove(item: OutlineItem, origin: 'outline' | 'inspector' | 'inspector-footer' = 'outline') {
    const base = prepareSelectionChange();
    if (!base || !locateOutlineItem(base, item)) return;
    dispatchDialog({ type: 'remove-requested', id: uid(), target: item, origin });
  }
  function clearDragStateForViews(viewIds: readonly string[]) {
    const collapsed = new Set(viewIds);
    const belongsToView = (candidate: OutlineItem) =>
      candidate.kind === 'view' ? collapsed.has(candidate.id) : collapsed.has(candidate.viewId);
    const session = pointerSort.current;
    if (session && belongsToView(session.item)) cancelPointerSort();
    setDraggingItem((current) => (current && belongsToView(current) ? null : current));
    setDropTarget((current) => (current && belongsToView(current.item) ? null : current));
  }
  function collapseOtherViews() {
    const expanded = view ? [view.id] : [];
    setExpandedViews(expanded);
    clearDragStateForViews(expandedViews.filter((id) => !expanded.includes(id)));
  }
  function toggleViewExpansion(item: EditorView) {
    const collapsing = expandedViews.includes(item.id);
    setExpandedViews((current) =>
      collapsing ? current.filter((id) => id !== item.id) : current.includes(item.id) ? current : [...current, item.id],
    );
    if (collapsing) clearDragStateForViews([item.id]);
  }
  function moveOutlineItem(item: OutlineItem, direction: -1 | 1) {
    const base = prepareSelectionChange();
    const source = base && locateOutlineItem(base, item);
    if (!base || !source) return;
    const items = item.kind === 'view' ? base.views : source.view.placements;
    const index = items.findIndex((candidate) => candidate.id === item.id);
    const destination = index + direction;
    if (index < 0) return;
    if (destination < 0 || destination >= items.length) {
      setNotice({ kind: 'item-edge', itemKind: item.kind, edge: direction < 0 ? 'first' : 'last' });
      return;
    }
    if (item.kind === 'view') setProduct({ ...base, views: moveEditorItem(base.views, item.id, direction) });
    else
      setProduct({
        ...base,
        views: base.views.map((candidate) =>
          candidate.id === source.view.id
            ? { ...candidate, placements: moveEditorItem(source.view.placements, item.id, direction) }
            : candidate,
        ),
      });
    setNotice({ kind: 'item-moved', itemKind: item.kind, direction: direction < 0 ? 'up' : 'down' });
  }
  function focusOutlineControl(item: OutlineItem, action: 'remove' | 'select') {
    const role = item.kind === 'view' ? 'view' : 'placement';
    const attribute = `data-outline-${action}-${role}-id`;
    const candidates = main.current?.querySelectorAll<HTMLElement>(`[${attribute}]`);
    const target =
      candidates && Array.from(candidates).find((candidate) => candidate.getAttribute(attribute) === item.id);
    if (!target) {
      if (action === 'select' && !product.views.length)
        main.current?.querySelector<HTMLElement>('[data-outline-add-view]')?.focus({ preventScroll: true });
      return;
    }
    target.scrollIntoView({ block: 'nearest' });
    target.focus({ preventScroll: true });
  }
  function closeRemove() {
    const target = removing;
    if (dialog.kind === 'remove') dispatchDialog({ type: 'dialog-closed', id: dialog.id });
    if (target)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (removingOrigin !== 'outline')
            main.current
              ?.querySelector<HTMLElement>(
                removingOrigin === 'inspector-footer'
                  ? '.placement-remove-action s-button'
                  : '[data-inspector-actions]',
              )
              ?.focus({ preventScroll: true });
          else focusOutlineControl(target, 'remove');
        }),
      );
  }
  function confirmRemove() {
    if (!removing) return;
    const target = removing;
    const base = prepareSelectionChange();
    const source = base && locateOutlineItem(base, target);
    if (!base || !source) {
      if (dialog.kind === 'remove') dispatchDialog({ type: 'dialog-closed', id: dialog.id });
      return;
    }
    let focusTarget: OutlineItem | null = null;
    let emptyAfterRemoval = false;
    if (target.kind === 'view') {
      const index = base.views.findIndex((candidate) => candidate.id === target.id);
      const views = base.views.filter((candidate) => candidate.id !== target.id);
      const neighbor = views[Math.min(index, views.length - 1)];
      emptyAfterRemoval = views.length === 0;
      setProduct({ ...base, views });
      setViewId(neighbor?.id ?? '');
      setSelectedId(null);
      setExpandedViews(neighbor ? [neighbor.id] : []);
      if (neighbor) focusTarget = { kind: 'view', id: neighbor.id };
    } else {
      const index = source.view.placements.findIndex((candidate) => candidate.id === target.id);
      const placements = source.view.placements.filter((candidate) => candidate.id !== target.id);
      const neighbor = placements[Math.min(index, placements.length - 1)];
      setProduct({
        ...base,
        views: base.views.map((candidate) =>
          candidate.id === source.view.id ? { ...candidate, placements } : candidate,
        ),
      });
      setViewId(source.view.id);
      setSelectedId(neighbor?.id ?? null);
      setExpandedViews((current) => (current.includes(source.view.id) ? current : [...current, source.view.id]));
      focusTarget = neighbor
        ? { kind: 'placement', id: neighbor.id, viewId: source.view.id }
        : { kind: 'view', id: source.view.id };
    }
    setPanel('placements');
    setGeometryInput(null);
    exitSizePreview();
    cancelDrawingTask();
    setOutlineQuery('');
    setNotice({ kind: 'item-removed', itemKind: target.kind });
    if (dialog.kind === 'remove') dispatchDialog({ type: 'dialog-closed', id: dialog.id });
    if (focusTarget)
      requestAnimationFrame(() => requestAnimationFrame(() => focusOutlineControl(focusTarget, 'select')));
    else if (emptyAfterRemoval)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => main.current?.querySelector<HTMLElement>('[data-outline-add-view]')?.focus()),
      );
  }
  function sameOutlineItem(first: OutlineItem, second: OutlineItem) {
    return first.kind === second.kind && first.id === second.id;
  }
  function canDrop(source: OutlineItem, target: OutlineItem) {
    return (
      !outlineSearch &&
      !sameOutlineItem(source, target) &&
      source.kind === target.kind &&
      (source.kind !== 'placement' || (target.kind === 'placement' && source.viewId === target.viewId))
    );
  }
  function reorderOutline(source: OutlineItem, target: OutlineItem, edge: 'before' | 'after') {
    if (!canDrop(source, target)) return;
    const base = prepareSelectionChange();
    const located = base && locateOutlineItem(base, source);
    if (!base || !located || !locateOutlineItem(base, target)) return;
    if (source.kind === 'view' && target.kind === 'view') {
      const views = moveEditorItemTo(base.views, source.id, target.id, edge);
      if (views === base.views) return;
      setProduct({ ...base, views });
    } else if (source.kind === 'placement' && target.kind === 'placement' && source.viewId === target.viewId) {
      const view = base.views.find((item) => item.id === source.viewId);
      if (!view) return;
      const placements = moveEditorItemTo(view.placements, source.id, target.id, edge);
      if (placements === view.placements) return;
      setProduct({
        ...base,
        views: base.views.map((item) => (item.id === source.viewId ? { ...item, placements } : item)),
      });
    } else return;
    setNotice({ kind: 'message', reason: 'order-updated' });
  }
  function itemMenuItems(item: OutlineItem, origin: 'outline' | 'inspector' = 'outline') {
    const source = locateOutlineItem(product, item);
    const siblings = item.kind === 'view' ? product.views : (source?.view.placements ?? []);
    const index = siblings.findIndex((candidate) => candidate.id === item.id);
    return (
      <>
        <s-button onClick={() => renameOutlineItem(item)}>
          {translateUi('editor:placementWorkflowPreview.rename')}
        </s-button>
        {item.kind === 'view' ? (
          <s-button onClick={() => duplicateViewItem(item)}>
            {translateUi('editor:placementWorkflowPreview.duplicateView')}
          </s-button>
        ) : (
          <>
            <s-button onClick={() => duplicatePlacementItem(item)}>
              {translateUi('editor:placementWorkflowPreview.duplicatePlacement')}
            </s-button>
            <s-button disabled={product.views.length < 2} onClick={() => openCopy(item)}>
              {translateUi('editor:placementWorkflowPreview.copyToAnotherView')}
            </s-button>
          </>
        )}
        <s-button disabled={index <= 0} onClick={() => moveOutlineItem(item, -1)}>
          {translateUi('editor:placementWorkflowPreview.moveUp')}
        </s-button>
        <s-button disabled={index < 0 || index >= siblings.length - 1} onClick={() => moveOutlineItem(item, 1)}>
          {translateUi('editor:placementWorkflowPreview.moveDown')}
        </s-button>
        <s-button tone="critical" onClick={() => requestRemove(item, origin)}>
          {translateUi(
            item.kind === 'view'
              ? 'editor:placementWorkflowPreview.removeView'
              : 'editor:placementWorkflowPreview.removePlacement',
          )}
        </s-button>
      </>
    );
  }
  function outlineActions(item: OutlineItem, label: string) {
    const menuId = `placement-outline-actions-${item.kind}-${encodeURIComponent(item.id)}`;
    return (
      <div class="placement-outline-actions">
        <button
          type="button"
          data-placement-row-action="remove"
          data-outline-remove-view-id={item.kind === 'view' ? item.id : undefined}
          data-outline-remove-placement-id={item.kind === 'placement' ? item.id : undefined}
          aria-label={translateUi('editor:placementWorkflowPreview.removeNamedItem', { itemName: label })}
          onClick={() => requestRemove(item)}
        >
          <span class="placement-row-action-icon placement-row-remove" aria-hidden="true">
            <s-icon type="delete" />
          </span>
        </button>
        <button
          type="button"
          data-placement-row-action="more"
          data-placement-row-more
          aria-label={translateUi('editor:placementWorkflowPreview.moreActionsFor', { itemName: label })}
          aria-haspopup="menu"
          aria-controls={menuId}
          commandfor={menuId}
          command="--show"
        >
          <span class="placement-row-action-icon placement-row-more-icon" aria-hidden="true">
            <s-icon type="menu-horizontal" />
          </span>
        </button>
        <s-menu
          id={menuId}
          accessibilityLabel={translateUi('editor:placementWorkflowPreview.actionsForItem', { itemName: label })}
        >
          {itemMenuItems(item)}
        </s-menu>
      </div>
    );
  }
  function createSortGhost(session: PointerSortSession) {
    const clone = session.row.cloneNode(true) as HTMLElement;
    clone.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after');
    clone.removeAttribute('id');
    const identityAttributes = [
      'data-outline-select-view-id',
      'data-outline-select-placement-id',
      'data-outline-remove-view-id',
      'data-outline-remove-placement-id',
      'data-outline-sort-kind',
      'data-outline-sort-id',
      'data-outline-sort-view-id',
      'data-placement-row-more',
    ];
    identityAttributes.forEach((attribute) => {
      clone.removeAttribute(attribute);
    });
    const sourceIdentitySelector =
      '[data-outline-select-view-id], [data-outline-select-placement-id], [data-outline-remove-view-id], [data-outline-remove-placement-id], [data-outline-sort-kind], [data-outline-sort-id], [data-outline-sort-view-id], [data-placement-row-more]';
    clone.querySelectorAll(sourceIdentitySelector).forEach((element) => {
      identityAttributes.forEach((attribute) => {
        element.removeAttribute(attribute);
      });
    });
    clone.querySelectorAll('[id]').forEach((element) => {
      element.removeAttribute('id');
    });
    clone.querySelector('.placement-drag-handle')?.remove();
    clone.querySelector('s-menu')?.remove();
    const actions = clone.querySelector<HTMLElement>('.placement-outline-actions');
    if (actions) actions.style.opacity = '1';
    const wrapper = document.createElement('div');
    wrapper.className = 'placement-workflow placement-sort-ghost';
    wrapper.setAttribute('aria-hidden', 'true');
    wrapper.inert = true;
    wrapper.style.width = `${session.row.getBoundingClientRect().width}px`;
    wrapper.style.height = `${session.row.getBoundingClientRect().height}px`;
    wrapper.style.left = `${session.row.getBoundingClientRect().left}px`;
    wrapper.style.top = `${session.lastY - session.grabOffsetY}px`;
    clone.style.width = '100%';
    clone.style.margin = '0';
    wrapper.append(clone);
    document.body.append(wrapper);
    return wrapper;
  }
  function updatePointerDropTarget(session: PointerSortSession) {
    const element = document.elementFromPoint(session.lastX, session.lastY);
    const row = element?.closest<HTMLElement>('[data-outline-sort-kind]');
    const kind = row?.dataset.outlineSortKind;
    const id = row?.dataset.outlineSortId;
    const viewId = row?.dataset.outlineSortViewId;
    if (!row || !id || (kind !== 'view' && kind !== 'placement')) {
      session.target = null;
      setDropTarget(null);
      return;
    }
    const target: OutlineItem = kind === 'view' ? { kind, id } : { kind, id, viewId: viewId ?? '' };
    if (!canDrop(session.item, target)) {
      session.target = null;
      setDropTarget(null);
      return;
    }
    const bounds = row.getBoundingClientRect();
    const next = { item: target, edge: session.lastY > bounds.top + bounds.height / 2 ? 'after' : 'before' } as const;
    if (session.target && sameOutlineItem(session.target.item, next.item) && session.target.edge === next.edge) return;
    session.target = next;
    setDropTarget(next);
  }
  function autoScrollPointerSort() {
    const session = pointerSort.current;
    const container = session?.scrollContainer;
    if (!session?.ghost || !container) return;
    const bounds = session.scrollsDocument
      ? { top: 0, bottom: window.innerHeight, height: window.innerHeight }
      : container.getBoundingClientRect();
    const edge = Math.min(48, bounds.height / 3);
    const distanceFromTop = session.lastY - bounds.top;
    const distanceFromBottom = bounds.bottom - session.lastY;
    const proximity = distanceFromTop < edge ? distanceFromTop : distanceFromBottom < edge ? distanceFromBottom : edge;
    const direction = distanceFromTop < edge ? -1 : distanceFromBottom < edge ? 1 : 0;
    if (!direction || proximity < 0) {
      session.frame = null;
      return;
    }
    const amount = Math.max(1, Math.ceil(14 * (1 - proximity / edge)));
    const previous = container.scrollTop;
    container.scrollTop += direction * amount;
    if (container.scrollTop === previous) {
      session.frame = null;
      return;
    }
    updatePointerDropTarget(session);
    session.frame = requestAnimationFrame(autoScrollPointerSort);
  }
  function requestPointerAutoScroll(session: PointerSortSession) {
    if (session.frame === null) session.frame = requestAnimationFrame(autoScrollPointerSort);
  }
  function clearPointerSort() {
    const session = pointerSort.current;
    pointerSort.current = null;
    if (!session) return;
    if (session.frame !== null) cancelAnimationFrame(session.frame);
    session.ghost?.remove();
    if (session.handle.hasPointerCapture(session.pointerId)) {
      try {
        session.handle.releasePointerCapture(session.pointerId);
      } catch {
        // The browser may already have released capture during cancellation.
      }
    }
    setDraggingItem(null);
    setDropTarget(null);
  }
  function cancelPointerSort() {
    clearPointerSort();
  }
  function finishPointerSort(commit: boolean) {
    const session = pointerSort.current;
    if (!session) return;
    const source = session.item;
    const target = session.target;
    const shouldReorder = commit && !!session.ghost && !!target;
    clearPointerSort();
    if (shouldReorder && target) reorderOutline(source, target.item, target.edge);
  }
  function pointerSortStart(event: PointerEvent, item: OutlineItem) {
    if (outlineSearch || event.button !== 0 || pointerSort.current) return;
    const handle = event.currentTarget;
    if (!(handle instanceof HTMLButtonElement)) return;
    const row = handle.closest<HTMLElement>('[data-outline-sort-kind]');
    if (!row) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = row.getBoundingClientRect();
    const outlineBody = main.current?.querySelector<HTMLElement>('.placement-outline-body') ?? null;
    const scrollsDocument = !outlineBody || getComputedStyle(outlineBody).overflowY === 'visible';
    const session: PointerSortSession = {
      pointerId: event.pointerId,
      item,
      handle,
      row,
      scrollContainer: scrollsDocument ? (document.scrollingElement as HTMLElement | null) : outlineBody,
      scrollsDocument,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      grabOffsetY: event.clientY - bounds.top,
      ghost: null,
      target: null,
      frame: null,
    };
    pointerSort.current = session;
    handle.focus({ preventScroll: true });
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      pointerSort.current = null;
    }
  }
  function pointerSortMove(event: PointerEvent) {
    const session = pointerSort.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    session.lastX = event.clientX;
    session.lastY = event.clientY;
    if (!session.ghost && Math.hypot(event.clientX - session.startX, event.clientY - session.startY) >= 5) {
      session.ghost = createSortGhost(session);
      setDraggingItem(session.item);
    }
    if (!session.ghost) return;
    session.ghost.style.top = `${session.lastY - session.grabOffsetY}px`;
    updatePointerDropTarget(session);
    requestPointerAutoScroll(session);
  }
  function pointerSortEnd(event: PointerEvent) {
    const session = pointerSort.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    finishPointerSort(true);
  }
  function dragHandle(item: OutlineItem, label: string) {
    return (
      <button
        type="button"
        class="placement-drag-handle"
        disabled={!!outlineSearch}
        aria-label={translateUi('editor:placementWorkflowPreview.reorderNamedItem', { itemName: label })}
        title={translateUi('editor:placementWorkflowPreview.dragToReorderUseArrowKeysToMoveUpOrDown')}
        onPointerDown={(event) => pointerSortStart(event, item)}
        onPointerMove={pointerSortMove}
        onPointerUp={pointerSortEnd}
        onPointerCancel={() => finishPointerSort(false)}
        onLostPointerCapture={() => finishPointerSort(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && pointerSort.current) {
            event.preventDefault();
            event.stopPropagation();
            cancelPointerSort();
            return;
          }
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          const direction = event.key === 'ArrowUp' ? -1 : 1;
          const items =
            item.kind === 'view'
              ? product.views
              : (product.views.find((view) => view.id === item.viewId)?.placements ?? []);
          const index = items.findIndex((candidate) => candidate.id === item.id);
          if (index < 0 || index + direction < 0 || index + direction >= items.length) {
            setNotice({ kind: 'item-edge', itemKind: item.kind, edge: direction === -1 ? 'first' : 'last' });
            return;
          }
          if (item.kind === 'view')
            setProduct((current) => ({ ...current, views: moveEditorItem(current.views, item.id, direction) }));
          else
            setProduct((current) => ({
              ...current,
              views: current.views.map((view) =>
                view.id === item.viewId
                  ? { ...view, placements: moveEditorItem(view.placements, item.id, direction) }
                  : view,
              ),
            }));
          setNotice({ kind: 'item-moved', itemKind: item.kind, direction: direction === -1 ? 'up' : 'down' });
        }}
      >
        <s-icon type="drag-handle" size="small" />
      </button>
    );
  }
  function dropClass(item: OutlineItem) {
    return dropTarget && sameOutlineItem(dropTarget.item, item) ? ` is-drop-${dropTarget.edge}` : '';
  }
  function draggingClass(item: OutlineItem) {
    return draggingItem && sameOutlineItem(draggingItem, item) ? ' is-dragging' : '';
  }
  function openViewDialog(replace = false) {
    const imageId = replace ? product.images.find((image) => image.url === view?.imageUrl)?.id : undefined;
    if (!startPhotoPicker(replace ? 'replace-view' : 'add-views', [], imageId ? [imageId] : [])) return;
  }

  useEffect(() => {
    const query = matchMedia('(min-width: 1181px)');
    const update = () => setWideEditor(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !pointerSort.current) return;
      event.preventDefault();
      event.stopPropagation();
      cancelPointerSort();
    };
    const onBlur = () => cancelPointerSort();
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', onBlur);
      cancelPointerSort();
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.adminContentReady = 'true';
    document.dispatchEvent(new Event('insignia:admin-ready'));
    const unload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) event.preventDefault();
    };
    const navigate = (event: MouseEvent) => {
      if (
        !dirtyRef.current ||
        event.defaultPrevented ||
        event.button ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = event
        .composedPath()
        .find(
          (node): node is Element => node instanceof Element && node.matches('a[href],s-link[href],s-button[href]'),
        );
      if (!link || link.getAttribute('target') === '_blank' || link.hasAttribute('download')) return;
      const target = new URL(link.getAttribute('href') ?? '', location.href);
      if (target.origin !== location.origin || target.pathname === location.pathname) return;
      event.preventDefault();
      dispatchDialog({ type: 'leave-requested', id: uid(), href: target.href });
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', navigate, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', navigate, true);
    };
  }, []);

  function patchView(change: Partial<EditorView>) {
    setProduct((current) => ({
      ...current,
      views: current.views.map((item) => (item.id === view?.id ? { ...item, ...change } : item)),
    }));
    setErrors({});
    setNotice(null);
  }
  function patchPlacement(change: Partial<EditorPlacement>) {
    if (!placement || !view) return;
    if (change.rect && groupAreaScope) {
      changeArtworkRect(placement.id, change.rect);
      return;
    }
    patchView({
      placements: view.placements.map((item) => (item.id === placement.id ? { ...item, ...change } : item)),
    });
  }
  function cancelMovementAreaEdit() {
    if (workspaceMode.kind === 'movement-edit') dispatchWorkspace({ type: 'mode-canceled' });
    setNotice((current) =>
      current?.kind === 'message' && current.reason.startsWith('movement-edit-before-') ? null : current,
    );
  }
  function startMovementAreaEdit() {
    if (activePhoto) {
      setNotice({ kind: 'message', reason: 'shared-image-required' });
      return;
    }
    if (!placement || !view?.imageUrl) return;
    const candidate = prepareSelectionChange();
    const selectedView = candidate?.views.find((item) => item.id === view.id);
    const selectedPlacement = selectedView?.placements.find((item) => item.id === placement.id);
    if (!candidate || !selectedPlacement) return;
    cancelCalibration();
    exitSizePreview();
    dispatchWorkspace({
      type: 'movement-edit-started',
      viewId: view.id,
      placementId: placement.id,
      draft: selectedPlacement.movementRect ? { ...selectedPlacement.movementRect } : null,
    });
    if (matchMedia('(max-width: 800px)').matches) {
      setExpandedCanvas(true);
      window.scrollTo({ top: 0 });
    }
  }
  function redrawMovementArea() {
    if (!movementEditing) return;
    dispatchWorkspace({ type: 'movement-redraw-started' });
    exitSizePreview();
    if (matchMedia('(max-width: 800px)').matches) {
      setExpandedCanvas(true);
      window.scrollTo({ top: 0 });
    }
  }
  function completeMovementAreaEdit() {
    if (!placement || !movementDraft || drawing) return;
    if (!movementRectContainsPlacementRect(movementDraft, placement.rect)) {
      dispatchWorkspace({
        type: 'movement-error',
        viewId: view?.id ?? '',
        placementId: placement.id,
        reason: 'movement-must-contain-artwork',
      });
      return;
    }
    endHistoryGroup();
    patchPlacement({ movementRect: { ...movementDraft } });
    endHistoryGroup();
    if (view) dispatchWorkspace({ type: 'movement-edit-committed', viewId: view.id, placementId: placement.id });
    setNotice((current) =>
      current?.kind === 'message' && current.reason.startsWith('movement-edit-before-') ? null : current,
    );
  }
  function openSetupCopy() {
    const candidate = prepareSelectionChange();
    if (!candidate) return;
    const problems: Record<string, PlacementValidationError> = validatePlacementProduct(candidate);
    const blocking = Object.fromEntries(
      Object.entries(problems).filter(
        ([key]) =>
          !key.endsWith('.widthCm') &&
          !key.endsWith('.heightCm') &&
          key !== 'views' &&
          !key.endsWith('.placements') &&
          !key.endsWith('.methods') &&
          !key.endsWith('.sizes') &&
          !key.endsWith('.unavailable'),
      ),
    );
    if (Object.keys(blocking).length) {
      setErrors(blocking);
      setNotice({ kind: 'message', reason: 'copy-validation-failed' });
      return;
    }
    cancelCalibration();
    cancelDrawingTask();
    dispatchDialog({ type: 'copy-setup-opened', id: uid(), source: structuredClone(canonicalPlacementDecimals(candidate)) });
  }
  /**
   * Start measuring an explicit view. A caller that selects a view in the same event cannot rely on
   * `view`, which is still the previous render's value, so it passes the target and its placement.
   */
  function startMeasurementFor(target: EditorView | undefined, placementId: string | null): boolean {
    if (!target?.imageUrl || !prepareSelectionChange()) return false;
    const current =
      target.calibration && calibrationMatchesImage(target.calibration, target) ? target.calibration : null;
    dispatchWorkspace({
      type: 'measurement-started',
      viewId: target.id,
      placementId,
      imageUrl: target.imageUrl,
      line: current ? { a: current.a, b: current.b } : null,
      distance: current ? String(current.distanceCm) : '',
    });
    if (matchMedia('(max-width: 800px)').matches) {
      setExpandedCanvas(true);
    }
    return true;
  }
  function startMeasurement() {
    startMeasurementFor(view, selectedId);
  }
  function applyMeasurement() {
    if (!view || workspaceMode.kind !== 'measuring') return;
    if (workspaceMode.viewId !== view.id || workspaceMode.imageUrl !== view.imageUrl) {
      // The line was drawn on another view or image: never apply it here and never fail silently.
      // Restart measuring on the visible image with the existing message, or leave measuring cleanly.
      if (startMeasurementFor(view, selectedId)) dispatchWorkspace({ type: 'measurement-error', reason: 'measurement-invalid' });
      else cancelCalibration();
      return;
    }
    const parsed = placementCalibrationSchema.safeParse({
      imageUrl: view.imageUrl,
      imageWidth: view.imageWidth,
      imageHeight: view.imageHeight,
      ...measurementLine,
      distanceCm: decimalOrNaN(measurementDistance),
    });
    if (
      !parsed.success ||
      Object.values(measurementPointInputs).some(
        (value) => typeof value !== 'string' || parseDecimalNumber(value) === null,
      )
    ) {
      dispatchWorkspace({
        type: 'measurement-error',
        reason: 'measurement-invalid',
      });
      return;
    }
    endHistoryGroup();
    patchView({ calibration: parsed.data });
    endHistoryGroup();
    dispatchWorkspace({ type: 'measurement-committed', viewId: view.id, imageUrl: view.imageUrl });
  }
  function renderMeasurementControls() {
    if (!calibrationEditing || (!measurementLine && !measurementCoordinates)) return null;
    return (
      <section
        class="placement-calibration-form placement-measure-controls"
        aria-label={translateUi('editor:placementWorkflowPreview.imageMeasurement')}
      >
        <div class="placement-measure-heading">
          <div>
            <s-text type="strong">{translateUi('editor:placementWorkflowPreview.measureImage')}</s-text>
          </div>
          <div class="placement-measure-actions">
            <s-button
              variant="tertiary"
              icon="x"
              accessibilityLabel={translateUi('editor:placementWorkflowPreview.cancel')}
              onClick={cancelCalibration}
            />
          </div>
        </div>
        <form
          class="placement-measure-field-row"
          onSubmit={(event) => {
            event.preventDefault();
            applyMeasurement();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.isComposing) {
              event.preventDefault();
              applyMeasurement();
            }
          }}
        >
          <div>
            <DecimalField
              label={translateUi('editor:placementWorkflowPreview.knownLength')}
              name="reference-length"
              suffix="cm"
              value={measurementDistance}
              error={measurementError}
              onValue={(value) => dispatchWorkspace({ type: 'measurement-distance-changed', value })}
            />
          </div>
          <div>
            <s-button variant="primary" disabled={!measurementLine} onClick={applyMeasurement}>
              {translateUi('editor:placementWorkflowPreview.apply')}
            </s-button>
          </div>
        </form>
        <details
          class="placement-details"
          open={measurementCoordinates}
          onToggle={(event) =>
            dispatchWorkspace({ type: 'measurement-coordinates-toggled', open: event.currentTarget.open })
          }
        >
          <summary>{translateUi('editor:placementWorkflowPreview.enterPointCoordinates')}</summary>
          <div class="placement-fields-grid">
            {(['a', 'b'] as const).flatMap((point) =>
              (['x', 'y'] as const).map((axis) => (
                <DecimalField
                  key={`${point}-${axis}`}
                  name={`measurement-${point}-${axis}`}
                  label={translateUi('editor:placementWorkflowPreview.pointCoordinate', {
                    point: point.toUpperCase(),
                    axis: axis.toUpperCase(),
                  })}
                  suffix="%"
                  value={
                    measurementPointInputs[`${point}-${axis}`] ??
                    (measurementLine ? String(Math.round(measurementLine[point][axis] * 1000) / 10) : '')
                  }
                  onValue={(value) =>
                    dispatchWorkspace({
                      type: 'measurement-point-changed',
                      point,
                      axis,
                      value,
                    })
                  }
                />
              )),
            )}
          </div>
        </details>

        <div class="placement-measure-footer">
          {calibration && (
            <s-button
              variant="tertiary"
              onClick={() => {
                endHistoryGroup();
                patchView({ calibration: undefined });
                endHistoryGroup();
                cancelCalibration();
              }}
            >
              {translateUi('editor:placementWorkflowPreview.clearMeasurement')}
            </s-button>
          )}
          {measurementLine && (
            <s-button variant="tertiary" onClick={() => dispatchWorkspace({ type: 'measurement-redraw-requested' })}>
              {translateUi('editor:placementWorkflowPreview.redrawLine')}
            </s-button>
          )}
        </div>
      </section>
    );
  }
  function renderImageScale() {
    if (!calibration || !view) return null;
    return (
      <div class="placement-image-scale">
        <div class="placement-estimate-row">
          <s-text>
            {estimatedSize
              ? translateUi('editor:placementWorkflowPreview.estimatedSize', {
                  width: new Intl.NumberFormat(formatLocale, {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  }).format(estimatedSize.widthCm),
                  height: new Intl.NumberFormat(formatLocale, {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  }).format(estimatedSize.heightCm),
                })
              : translateUi('editor:placementWorkflowPreview.imageMeasured')}
          </s-text>
          <s-button
            variant="tertiary"
            icon="info"
            accessibilityLabel={translateUi('editor:placementWorkflowPreview.aboutEstimatedDimensions')}
            commandFor="placement-estimate-info"
          />
        </div>
        <div class="placement-control-overlays">
          <s-popover id="placement-estimate-info" inlineSize="280px">
            <s-box padding="base">
              <s-stack gap="small">
                <s-text type="strong">
                  {translateUi('editor:placementWorkflowPreview.basedOnYourImageMeasurement')}
                </s-text>
                <s-paragraph>
                  {translateUi('editor:placementWorkflowPreview.measurementExplanation', {
                    imageName: view.name || translateUi('editor:placementWorkflowPreview.selectedImage'),
                    distance: new Intl.NumberFormat(formatLocale, { maximumFractionDigits: 2 }).format(
                      calibration.distanceCm,
                    ),
                  })}{' '}
                  {estimatedSize && translateUi('editor:placementWorkflowPreview.estimatedAreaExplanation')}
                </s-paragraph>
                <s-paragraph>
                  {translateUi(
                    'editor:placementWorkflowPreview.photoPerspectiveAndFabricCanAffectTheEstimateCheckDimensionsBeforeProduction',
                  )}
                </s-paragraph>
              </s-stack>
            </s-box>
          </s-popover>
        </div>
      </div>
    );
  }
  function patchMethodSettings(change: Partial<Pick<EditorPlacement, 'methodIds' | 'sizes'>>) {
    if (methodDraft) return;
    patchPlacement(change);
  }
  function openMethodEditor(methodId?: string) {
    if (!placement || !prepareSelectionChange()) return;
    endHistoryGroup();
    setMethodQuery('');
    setMethodFilter('all');
    setExpandedMethodIds([]);
    setMethodErrors({});
    dispatchDialog({
      type: 'method-manager-opened',
      id: uid(),
      productId: product.id,
      target: { viewId: view?.id ?? '', placementId: placement.id },
      targetRevision: interactionTargetRevision.current,
      ...(methodId ? { initialMethodId: methodId } : {}),
      draft: structuredClone({ methodIds: placement.methodIds, sizes: placement.sizes }),
    });
  }
  function renderMethodSettings() {
    if (!methodPlacement) return null;
    return (
      <>
        {product.methods.length > 6 && (
          <div class="placement-method-editor-controls">
            <s-search-field
              label={translateUi('editor:placementWorkflowPreview.searchDecorationMethods')}
              labelAccessibilityVisibility="exclusive"
              placeholder={translateUi('editor:placementWorkflowPreview.searchMethods')}
              value={methodQuery}
              onInput={(event) => setMethodQuery(event.currentTarget.value)}
            />
            <s-select
              label={translateUi('editor:placementWorkflowPreview.showMethods')}
              labelAccessibilityVisibility="exclusive"
              name="placement-method-filter"
              value={methodFilter}
              onChange={(event) => setMethodFilter(event.currentTarget.value)}
            >
              <s-option value="all">
                {translateUi('editor:placementWorkflowPreview.allMethodsCount', {
                  formattedCount: new Intl.NumberFormat(formatLocale).format(product.methods.length),
                })}
              </s-option>
              <s-option value="enabled">
                {translateUi('editor:placementWorkflowPreview.enabledMethodsCount', {
                  formattedCount: new Intl.NumberFormat(formatLocale).format(methodPlacement.methodIds.length),
                })}
              </s-option>
            </s-select>
          </div>
        )}
        {product.methods.length > 6 && (
          <div class="placement-method-table-heading" aria-hidden="true">
            <span>{translateUi('editor:placementWorkflowPreview.method')}</span>
            <span>{translateUi('editor:placementWorkflowPreview.perItem')}</span>
          </div>
        )}
        <div class="placement-method-editor-results">
          <div
            class={`placement-method-list ${product.methods.length > 6 ? 'is-large' : ''} ${methodPlacement.sizes.length > 6 ? 'has-many-sizes' : ''}`}
          >
            {visibleMethods.map((method) => (
              <fieldset
                class={`placement-method ${method.pricing === 'product' ? 'is-product-method' : ''}`}
                aria-label={method.name}
                key={method.id}
              >
                <s-checkbox
                  label={method.name}
                  checked={methodPlacement.methodIds.includes(method.id)}
                  onChange={(event) =>
                    patchMethodSettings({
                      methodIds: event.currentTarget.checked
                        ? [...methodPlacement.methodIds, method.id]
                        : methodPlacement.methodIds.filter((id) => id !== method.id),
                    })
                  }
                />
                {method.pricing === 'fixed' ? (
                  <div class="placement-method-price">
                    <s-text color="subdued">{translateUi('editor:placementWorkflowPreview.perLocationPerItem')}</s-text>
                    <s-button
                      variant="tertiary"
                      icon="edit"
                      accessibilityLabel={translateUi('editor:placementWorkflowPreview.editMethodPrice', {
                        methodName: method.name,
                      })}
                      disabled={!methodPlacement.methodIds.includes(method.id)}
                      onClick={() => openMethodEditor(method.id)}
                    >
                      {(() => {
                        const price = parsePrice(method.amount);
                        return price.kind === 'valid'
                          ? formatPrice(price.minor, formatLocale, adapter.currency)
                          : translateUi('editor:placementWorkflowPreview.priceUnavailable');
                      })()}
                    </s-button>
                  </div>
                ) : methodPlacement.methodIds.includes(method.id) ? (
                  <details
                    class="placement-method-size-prices"
                    open={
                      (product.methods.length <= 6 && methodPlacement.sizes.length <= 6) ||
                      expandedMethodIds.includes(method.id)
                    }
                    onToggle={(event) => {
                      const open = event.currentTarget.open;
                      setExpandedMethodIds((current) =>
                        open
                          ? current.includes(method.id)
                            ? current
                            : [...current, method.id]
                          : current.filter((id) => id !== method.id),
                      );
                    }}
                  >
                    <summary>{translateUi('editor:placementWorkflowPreview.sizePrices')}</summary>
                    <div class="placement-method-prices">
                      {methodPlacement.sizes.map((size) => (
                        <div class="placement-price-row" key={size.id}>
                          <span>{size.name || translateUi('editor:placementWorkflowPreview.unnamedSize')}</span>
                          {/* Polaris money and number fields are number inputs, which discard a typed comma. */}
                          <DecimalField
                            kind="price"
                            label={translateUi('editor:placementWorkflowPreview.priceForSize', {
                              sizeName: size.name || translateUi('editor:placementWorkflowPreview.unnamedSize'),
                            })}
                            labelAccessibilityVisibility="exclusive"
                            prefix={currencyPrefix(adapter.currency)}
                            value={size.prices[method.id] ?? ''}
                            placeholder={translateUi('editor:placementWorkflowPreview.notOffered')}
                            error={
                              methodErrors[`${size.id}:${method.id}`] ??
                              fieldError(`sizes.${size.id}.prices.${method.id}`)
                            }
                            data-field-invalid={!!fieldError(`sizes.${size.id}.prices.${method.id}`)}
                            data-method-invalid={!!methodErrors[`${size.id}:${method.id}`]}
                            onValue={(text) => {
                              if (!placement) return;
                              adapter.priceEdited?.(placement.id, size.id, method.id, text);
                              patchMethodSettings({
                                sizes: methodPlacement.sizes.map((entry) =>
                                  entry.id === size.id
                                    ? {
                                        ...entry,
                                        prices: { ...entry.prices, [method.id]: text },
                                      }
                                    : entry,
                                ),
                              });
                            }}
                          />
                        </div>
                      ))}
                      <s-text color="subdued">
                        {translateUi(
                          'editor:placementWorkflowPreview.perItemAtThisPlacementLeaveBlankToExcludeASizeEnter0ForFree',
                        )}
                      </s-text>
                    </div>
                  </details>
                ) : (
                  <span class="placement-method-type">
                    <s-text color="subdued">
                      {translateUi(
                        product.methods.length <= 6
                          ? 'editor:placementWorkflowPreview.setPricesForEachSize'
                          : 'editor:placementWorkflowPreview.perSize',
                      )}
                    </s-text>
                  </span>
                )}
              </fieldset>
            ))}
          </div>
          {product.methods.length > 6 && !visibleMethods.length && (
            <s-paragraph>
              {translateUi('editor:placementWorkflowPreview.noMethodsMatchFilters')}{' '}
              <s-button
                variant="tertiary"
                onClick={() => {
                  setMethodQuery('');
                  setMethodFilter('all');
                }}
              >
                {translateUi('editor:placementWorkflowPreview.showAllMethods')}
              </s-button>
            </s-paragraph>
          )}
        </div>
      </>
    );
  }
  function prepareSelectionChange(): PlacementProduct | null {
    if (movementEditing) {
      setNotice({ kind: 'message', reason: 'movement-edit-before-selection' });
      return null;
    }
    if (!geometryInput) return product;
    const typedGeometry = parseDecimalNumber(geometryInput.value);
    if (typedGeometry === null) {
      setErrors({
        [`views.${geometryInput.viewId}.placements.${geometryInput.placementId}.rect.${geometryInput.key}`]:
          'geometry-input-required',
      });
      setNotice({ kind: 'message', reason: 'geometry-input-before-selection' });
      setViewId(geometryInput.viewId);
      setSelectedId(geometryInput.placementId);
      setPanel('settings');
      requestAnimationFrame(() =>
        main.current?.querySelector<HTMLElement>(`s-text-field[name="area-${geometryInput.key}"]`)?.focus(),
      );
      return null;
    }
    const currentArea = product.views
      .find((item) => item.id === geometryInput.viewId)
      ?.placements.find((item) => item.id === geometryInput.placementId);
    if (!currentArea) return null;
    const currentRect = groupAreaScope && displayedRect ? displayedRect : currentArea.rect;
    const candidate = artworkRectCandidate(product, geometryInput.viewId, geometryInput.placementId, {
      ...currentRect,
      [geometryInput.key]: typedGeometry / 100,
    });
    setProduct(candidate);
    setGeometryInput(null);
    return candidate;
  }
  function select(nextView: EditorView, id: string | null, openSettings = false, commitPending = true) {
    if (movementEditing) {
      setNotice({ kind: 'message', reason: 'movement-edit-before-selection' });
      return false;
    }
    if (commitPending && !prepareSelectionChange()) return false;
    cancelCalibration();
    const origin = document.activeElement;
    const hiddenOutlineOrigin =
      openSettings && !wideEditor && origin instanceof HTMLElement && !!origin.closest('#placement-outline');
    const keyboardSelection = origin?.matches(':focus-visible') ?? false;
    setExpandedViews((current) => (current.includes(nextView.id) ? current : [...current, nextView.id]));
    setViewId(nextView.id);
    setSelectedId(id);
    setNotice((current) =>
      current?.kind === 'message' && current.reason === 'invalid-method-return' ? null : current,
    );
    if (id === null) exitSizePreview();
    setMethodQuery('');
    cancelDrawingTask();
    if (openSettings) {
      setPanel('settings');
    }
    requestAnimationFrame(() => {
      document.querySelector('.placement-properties-body')?.scrollTo({ top: 0 });
      if (matchMedia('(max-width: 800px)').matches) window.scrollTo({ top: 0 });
    });
    // The compact outline disappears after selection. Keep focus in the visible panel,
    // without opening the phone keyboard after a pointer selection.
    if (hiddenOutlineOrigin) focusName(keyboardSelection);
    return true;
  }
  function add(targetView?: EditorView) {
    const base = prepareSelectionChange();
    const currentView = base?.views.find((item) => item.id === (targetView ?? view)?.id);
    if (!base || !currentView) return;
    const id = uid();
    const updated = addPlacement(
      currentView,
      nextItemName(
        translateUi('editor:placementWorkflowPreview.defaultNames.placement'),
        currentView.placements.map((area) => area.name),
      ),
      id,
    );
    setProduct({ ...base, views: base.views.map((item) => (item.id === currentView.id ? updated : item)) });
    setExpandedViews((current) => (current.includes(currentView.id) ? current : [...current, currentView.id]));
    setViewId(currentView.id);
    setErrors({});
    setNotice(null);
    setSelectedId(id);
    setPanel('settings');
    exitSizePreview();
    cancelDrawingTask();
    requestAnimationFrame(() => {
      document.querySelector('.placement-properties-body')?.scrollTo({ top: 0 });
    });
    focusName();
  }
  function geometry(
    key: 'centerX' | 'centerY' | 'width' | 'height',
    value: string,
    targetViewId: string,
    targetAreaId: string,
  ) {
    if (movementEditing) return;
    const number = parseDecimalNumber(value);
    if (number === null) return;
    const currentRect = displayedRect ?? placement?.rect;
    if (currentRect) changeArtworkRect(targetAreaId, { ...currentRect, [key]: number / 100 }, targetViewId);
    setGeometryInput((current) =>
      current?.viewId === targetViewId && current.placementId === targetAreaId && current.key === key ? null : current,
    );
  }
  async function saveDraft(allowMethodDialog = false): Promise<boolean> {
    if (writeBusyRef.current || adapter.pending() || adapter.readOnly) return false;
    if (movementEditing) {
      setNotice({ kind: 'message', reason: 'movement-edit-before-save' });
      return false;
    }
    if (
      addingView ||
      (dialog.kind !== 'closed' && !(allowMethodDialog && dialog.kind === 'method-manager')) ||
      calibrationEditing
    )
      return false;
    let candidate = product;
    if (geometryInput) {
      const { key, value, viewId: targetView, placementId } = geometryInput;
      const typedValue = parseDecimalNumber(value);
      if (typedValue === null) {
        setErrors({ [`views.${targetView}.placements.${placementId}.rect.${key}`]: 'geometry-input-required' });
        setNotice({ kind: 'message', reason: 'invalid-setup' });
        return false;
      }
      candidate = {
        ...product,
        views: product.views.map((item) =>
          item.id === targetView
            ? {
                ...item,
                placements: item.placements.map((area) =>
                  area.id === placementId
                    ? { ...area, rect: clampPlacementRect({ ...area.rect, [key]: typedValue / 100 }) }
                    : area,
                ),
              }
            : item,
        ),
      };
    }
    const problems: Record<string, PlacementValidationError> = validatePlacementProduct(candidate);
    // Incomplete setup is a valid draft. Input errors such as invalid dimensions still block saving.
    const blocking = Object.fromEntries(
      Object.entries(problems).filter(
        ([key]) =>
          !key.endsWith('.widthCm') &&
          !key.endsWith('.heightCm') &&
          key !== 'views' &&
          !key.endsWith('.placements') &&
          !key.endsWith('.methods') &&
          !key.endsWith('.sizes') &&
          !key.endsWith('.unavailable'),
      ),
    );
    if (Object.keys(blocking).length) {
      setErrors(blocking);
      setNotice({ kind: 'message', reason: 'invalid-setup' });
      const firstView = candidate.views.find((item) =>
        Object.keys(blocking).some((key) => key.startsWith(`views.${item.id}.`)),
      );
      setOutlineQuery('');
      if (firstView) {
        const firstArea = firstView.placements.find((area) =>
          Object.keys(blocking).some((key) => key.startsWith(`views.${firstView.id}.placements.${area.id}.`)),
        );
        select(firstView, firstArea?.id ?? null, true, false);
      }
      requestAnimationFrame(() => {
        const target = document.querySelector<HTMLElement>('[data-field-invalid="true"]');
        const disclosure = target?.closest('details');
        if (disclosure) disclosure.open = true;
        target?.scrollIntoView({ block: 'center', behavior: 'instant' });
        target?.focus();
      });
      return false;
    }
    const transportIssues = adapter.saveIssues?.(candidate) ?? [];
    if (transportIssues.length) { setNotice({ kind: 'publication-issue', issue: transportIssues[0]! }); return false; }
    setErrors({});
    candidate = canonicalPlacementDecimals(candidate);
    writeBusyRef.current = true;
    setWriteBusy(true);
    try { const confirmed = await adapter.save(candidate); if (confirmed) candidate = confirmed; } catch (error) {
      // A server rejection is explained by the host's own banner; it is not an unconfirmed write.
      setNotice(configRejectionFrom(error) ? null : { kind: 'message', reason: 'storage-save-failed' });
      return false;
    } finally { writeBusyRef.current = false; setWriteBusy(false); }
    setProduct(candidate);
    setSaved(candidate);
    savedBindings.current = currentBindings.current;
    setGeometryInput(null);
    cancelDrawingTask();
    setNotice({ kind: 'message', reason: 'draft-saved' });
    return true;
  }
  function save() {
    saveDraft();
  }
  function openPublishReview() {
    if (adapter.readOnly || adapter.publicationBlocked || writeBusyRef.current || adapter.pending()) return;
    if (movementEditing) {
      setNotice({ kind: 'message', reason: 'movement-edit-before-publish' });
      return;
    }
    if (calibrationEditing || methodDraft || copyingSetup || imageProcessing) return;
    const candidate = prepareSelectionChange();
    if (!candidate) return;
    endHistoryGroup();
    dispatchDialog({
      type: 'publish-opened',
      id: uid(),
      product: structuredClone(canonicalPlacementDecimals(candidate)),
      revision: adapter.revision(),
      issues: [...placementPublicationIssues(candidate), ...imageLoadIssues(candidate), ...(adapter.publicationIssues?.(candidate) ?? [])],
    });
  }
  async function confirmPublish() {
    if (adapter.readOnly || adapter.publicationBlocked || writeBusyRef.current || adapter.pending()) return;
    if (!publishReview || dialog.kind !== 'publish' || dialog.id !== publishReview.id) return;
    const imageIssues = imageLoadIssues(publishReview.product);
    if (imageIssues.length) {
      dispatchDialog({ type: 'publish-issues-updated', id: publishReview.id, issues: imageIssues });
      return;
    }
    writeBusyRef.current = true;
    setWriteBusy(true);
    let result: ProductPublicationResult;
    let shopifyBusy = false;
    try { result = await adapter.publish(publishReview.product, publishReview.revision); }
    catch (error) {
      if (configRejectionFrom(error)) {
        if (adapter.pending()) result = { status: 'pending' }; // The write may have committed: keep the pending flow.
        else {
          // Refused, not lost: close the review so the merchant can fix the edit the host's banner names.
          dispatchDialog({ type: 'dialog-closed', id: publishReview.id });
          setNotice(null);
          return;
        }
      } else {
        shopifyBusy = isShopifyBusy(error);
        result = { status: 'storage-error', reason: 'write-failed' };
      }
    }
    finally { writeBusyRef.current = false; setWriteBusy(false); }
    if (result.status === 'changed') {
      setProduct(result.product); setSaved(result.product); savedBindings.current = adapter.getBindings?.() ?? currentBindings.current;
      dispatchDialog({ type: 'dialog-closed', id: publishReview.id });
      setNotice({ kind: 'message', reason: 'draft-changed' });
      return;
    }
    if (result.status === 'rejected') {dispatchDialog({type:'dialog-closed',id:publishReview.id});setNotice({kind:'message',reason:'publish-failed'});return;}
    if (result.status === 'pending') {
      dispatchDialog({ type: 'publish-failed', id: publishReview.id, reason: 'pending' });
      return;
    }
    if (result.status === 'invalid') {
      dispatchDialog({ type: 'publish-issues-updated', id: publishReview.id, issues: result.issues });
      return;
    }
    if (result.status !== 'published') {
      dispatchDialog({
        type: 'publish-failed',
        id: publishReview.id,
        reason: result.status === 'conflict' ? 'conflict' : shopifyBusy ? 'busy' : 'storage-error',
      });
      return;
    }
    setProduct(result.state.draft);
    setSaved(result.state.draft);
    savedBindings.current = currentBindings.current;
    setPublication(result.state);
    setErrors({});
    dispatchDialog({ type: 'dialog-closed', id: publishReview.id });
    setNotice({ kind: 'message', reason: 'publish-succeeded' });
  }
  function publicationIssueAction(issue: PlacementPublicationIssue): string {
    const { key } = issue;
    if (key.endsWith('.calibration')) return translateUi('editor:placementWorkflowPreview.realCalibrateImage');
    if (key.endsWith('.review')) return translateUi('editor:placementWorkflowPreview.realReviewMethods');
    if (key === 'views') return translateUi('editor:placementWorkflowPreview.publicationActions.addView');
    if (key.endsWith('.placements'))
      return translateUi('editor:placementWorkflowPreview.publicationActions.addPlacement');
    if (key.endsWith('.imageUrl')) return translateUi('editor:placementWorkflowPreview.publicationActions.chooseImage');
    if (key.endsWith('.alignment'))
      return translateUi('editor:placementWorkflowPreview.publicationActions.reviewAlignment');
    if (key.endsWith('.movementRect'))
      return translateUi('editor:placementWorkflowPreview.publicationActions.setMovementArea');
    if (key.endsWith('.prices')) return translateUi('editor:placementWorkflowPreview.publicationActions.addPrice');
    if (key.includes('.prices.')) return translateUi('editor:placementWorkflowPreview.publicationActions.reviewPrices');
    if (key.endsWith('.methods'))
      return translateUi(
        product.methods.length
          ? 'editor:placementWorkflowPreview.publicationActions.manageMethods'
          : 'editor:placementWorkflowPreview.publicationActions.chooseMethods',
      );
    if (key.endsWith('.sizes')) return translateUi('editor:placementWorkflowPreview.publicationActions.addSize');
    if (key.includes('.sizes.'))
      return translateUi(
        key.endsWith('.name')
          ? 'editor:placementWorkflowPreview.publicationActions.editSizeName'
          : (key.endsWith('.widthPercent')||key.endsWith('.heightPercent'))
            ? 'editor:placementWorkflowPreview.publicationActions.editSizeFactor'
            : 'editor:placementWorkflowPreview.publicationActions.reviewSize',
      );
    if (key.startsWith('methods.'))
      return translateUi('editor:placementWorkflowPreview.publicationActions.reviewMethod');
    if (key.endsWith('.rect'))
      return translateUi('editor:placementWorkflowPreview.publicationActions.reviewArtworkArea');
    if (key.endsWith('.name'))
      return translateUi(
        issue.placementId
          ? 'editor:placementWorkflowPreview.publicationActions.editPlacementName'
          : 'editor:placementWorkflowPreview.publicationActions.editViewName',
      );
    if (key === 'title') return translateUi('editor:placementWorkflowPreview.publicationActions.reviewProductName');
    return translateUi(
      issue.placementId
        ? 'editor:placementWorkflowPreview.publicationActions.reviewPlacement'
        : issue.viewId
          ? 'editor:placementWorkflowPreview.publicationActions.reviewView'
          : 'editor:placementWorkflowPreview.publicationActions.reviewSetup',
    );
  }
  function reviewPublishIssue(issue: PlacementPublicationIssue) {
    if (dialog.kind === 'publish') dispatchDialog({ type: 'dialog-closed', id: dialog.id });
    if (issue.groupKey) {
      setActivePhotoGroup(issue.groupKey);
    }
    if (issue.key === 'views' && product.views.length === 0) {
      setErrors({});
      setNotice(null);
      openViewDialog();
      return;
    }
    const target = product.views.find((item) => item.id === issue.viewId) ?? product.views[0];
    if (target) select(target, issue.placementId ?? null, true, false);
    if (issue.key.endsWith('.calibration')) { startMeasurementFor(target, issue.placementId ?? null); return; }
    if (issue.groupKey)
      requestAnimationFrame(() => {
        const panel = document.querySelector<HTMLElement>('[data-variant-photo-panel]');
        panel?.scrollIntoView({ block: 'start' });
        panel?.focus();
      });
    setErrors({ [issue.key]: issue.reason });
    setNotice({ kind: 'publication-issue', issue });
    requestAnimationFrame(() => {
      const field = main.current?.querySelector<HTMLElement>('[data-field-invalid="true"]');
      // Polaris hosts can use display: contents. Scroll their measurable wrapper,
      // while leaving focus on the component's public focus target.
      let scrollTarget = field;
      while (scrollTarget && scrollTarget.getBoundingClientRect().height === 0)
        scrollTarget = scrollTarget.parentElement;
      scrollTarget?.scrollIntoView({ block: 'center' });
      field?.focus({ preventScroll: true });
      if (!field && issue.key.endsWith('.placements')) {
        const addPlacement = main.current?.querySelector<HTMLElement>('[data-add-placement]');
        addPlacement?.scrollIntoView({ block: 'center' });
        addPlacement?.focus({ preventScroll: true });
      }
      if (!field && issue.key.endsWith('.sizes')) {
        const addSize = main.current?.querySelector<HTMLElement>('[data-add-size]');
        addSize?.scrollIntoView({ block: 'center' });
        addSize?.focus({ preventScroll: true });
      }
      if (!field && issue.key.endsWith('.methods')) {
        const methods = main.current?.querySelector<HTMLElement>('[data-placement-methods]');
        methods?.scrollIntoView({ block: 'center' });
        methods?.querySelector<HTMLElement>('s-button')?.focus({ preventScroll: true });
      }
      if (!field && issue.key.endsWith('.prices')) {
        const methods = main.current?.querySelector<HTMLElement>('[data-placement-methods]');
        methods?.scrollIntoView({ block: 'start' });
        methods?.querySelector<HTMLElement>('s-text-field,s-button')?.focus({ preventScroll: true });
      }
    });
  }
  function discard() {
    if (writeBusyRef.current || adapter.pending()) return;
    cancelCalibration();
    cancelMovementAreaEdit();
    currentBindings.current = savedBindings.current;
    adapter.restoreBindings?.(savedBindings.current);
    currentProduct.current = saved;
    renderProduct(saved);
    interactionTargetRevision.current += 1;
    invalidatePhotoPickerContext(saved.id, selectedViewId.current, interactionTargetRevision.current);
    resetPlacementHistory(history.current);
    endHistoryGroup();
    dispatchWorkspace({ type: 'mode-canceled' });
    setGeometryInput(null);
    setErrors({});
    if (dialog.kind === 'discard') dispatchDialog({ type: 'dialog-closed', id: dialog.id });
    const restoredView = saved.views.find((item) => item.id === viewId) ?? saved.views[0];
    setViewId(restoredView?.id ?? '');
    setSelectedId(
      restoredView?.placements.some((area) => area.id === selectedId)
        ? selectedId
        : (restoredView?.placements[0]?.id ?? null),
    );
    setNotice({ kind: 'message', reason: 'changes-discarded' });
  }
  const fieldError = (path: string) => {
    const reason = errors[`views.${view?.id}.placements.${placement?.id}.${path}`] as PlacementIssueReason | undefined;
    return reason ? placementIssueProblem(reason, translateUi) : undefined;
  };
  const errorText = (key: string) => {
    const reason = errors[key] as PlacementIssueReason | undefined;
    return reason ? placementIssueProblem(reason, translateUi) : undefined;
  };
  const previewSize = placement?.sizes.find((size) => size.id === previewSizeId) ?? placement?.sizes[0];
  function restoreHistory(direction: 'undo' | 'redo') {
    if (adapter.readOnly || movementEditing || calibrationEditing || writeBusyRef.current || adapter.pending()) return;
    endHistoryGroup();
    if (geometryInput) {
      if (direction === 'redo') return;
      setGeometryInput(null);
      setErrors({});
      setNotice({ kind: 'message', reason: 'position-reverted' });
      return;
    }
    const result =
      direction === 'undo'
        ? undoPlacementHistory(history.current, { product: currentProduct.current, bindings: currentBindings.current })
        : redoPlacementHistory(history.current, { product: currentProduct.current, bindings: currentBindings.current });
    if (!result.changed) return;
    currentBindings.current = result.state.bindings;
    adapter.restoreBindings?.(result.state.bindings);
    currentProduct.current = result.state.product;
    renderProduct(result.state.product);
    interactionTargetRevision.current += 1;
    invalidatePhotoPickerContext(result.state.product.id, selectedViewId.current, interactionTargetRevision.current);
    const selection = selections.current.get(result.state.product) ?? { viewId, selectedId, appearanceKey: activePhotoGroup };
    const restoredGroups = getVariantPhotoGroups(result.state.product);
    setActivePhotoGroup(
      selection.appearanceKey === null
        ? null
        : restoredGroups.some((group) => group.key === selection.appearanceKey)
          ? selection.appearanceKey
          : (restoredGroups[0]?.key ?? null),
    );
    const nextView = result.state.product.views.find((item) => item.id === selection.viewId) ?? result.state.product.views[0];
    setViewId(nextView?.id ?? '');
    setSelectedId(
      selection.selectedId === null || nextView?.placements.some((item) => item.id === selection.selectedId)
        ? selection.selectedId
        : (nextView?.placements[0]?.id ?? null),
    );
    if (nextView) setExpandedViews((current) => (current.includes(nextView.id) ? current : [...current, nextView.id]));
    dispatchWorkspace({ type: 'mode-canceled' });
    setErrors({});
    setInteractionRevision((current) => current + 1);
    setNotice(null);
    setHistoryNotice(direction === 'undo' ? 'change-undone' : 'change-redone');
  }
  const shortcutHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  shortcutHandler.current = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    if (calibrationEditing && event.key === 'Escape') {
      event.preventDefault();
      cancelCalibration();
      return;
    }
    const dialogOpen = addingView || dialog.kind !== 'closed' || calibrationEditing;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (!dialogOpen && dirty) save();
      return;
    }
    if (dialogOpen) return;
    if (event.composedPath().some((node) => node instanceof Element && node.hasAttribute('data-editor-name-field'))) {
      // A completed name edit must not be refocused by a pending add/rename callback.
      if (event.key === 'Enter' && !event.isComposing) nameFocusRevision.current++;
      finishNameEdit(event);
    }
    const editing = event
      .composedPath()
      .some((node) => node instanceof HTMLElement && (node.matches('input,textarea,select') || node.isContentEditable));
    if (event.key === 'Escape' && preview && !editing) {
      event.preventDefault();
      exitSizePreview();
    }
    if (!(event.ctrlKey || event.metaKey) || event.altKey || editing) return;
    const key = event.key.toLowerCase();
    if (key === 'z' || key === 'y') {
      event.preventDefault();
      restoreHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo');
    }
  };
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => shortcutHandler.current(event);
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, []);
  useEffect(() => {
    if (!feedback) return;
    // The host toast is not ours to retire; this only ends the in-page notice and its live-region text.
    const timer = window.setTimeout(() => setNotice(null), FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [notice, feedback]);
  useEffect(() => {
    if (!feedback || !noticeText || !hostToast()) return;
    try {
      hostToast()?.show(noticeText, { duration: FEEDBACK_MS });
    } catch {
      // The live region still announces it.
    }
  }, [notice]);
  function showSize(id: string) {
    if (movementEditing) {
      setNotice({ kind: 'message', reason: 'movement-edit-before-preview' });
      return;
    }
    cancelCalibration();
    cancelDrawingTask();
    if (!view || !placement) return;
    dispatchWorkspace({ type: 'size-preview-toggled', viewId: view.id, placementId: placement.id, sizeId: id });
    if (matchMedia('(max-width: 800px)').matches) {
      setExpandedCanvas(true);
      window.scrollTo({ top: 0 });
    }
  }
  return (
    <div
      class="placement-workflow"
      ref={main}
      inert={writeBusy || adapter.pending() || adapter.readOnly}
      onFocusIn={(event) => {
        if (event.composedPath().some((node) => node instanceof HTMLElement && node.matches('input,textarea'))) {
          endHistoryGroup();
          historyGroup.current = `field:${++groupSequence.current}`;
        }
      }}
      onFocusOut={endHistoryGroup}
      onPointerDownCapture={(event) => {
        if (event.target instanceof Element && event.target.closest('.placement-canvas')) {
          endHistoryGroup();
          historyGroup.current = `gesture:${++groupSequence.current}`;
        }
      }}
      onPointerUpCapture={() => queueMicrotask(endHistoryGroup)}
      onPointerCancelCapture={() => queueMicrotask(endHistoryGroup)}
    >
      <span
        class={`placement-announcement ${panel === 'settings' ? 'is-inactive' : ''}`}
        role="status"
        aria-live="polite"
      >
        {noticeText}
      </span>
      <span class="placement-announcement" role="status" aria-live="polite">
        {historyNotice === 'change-undone'
          ? translateUi('editor:placementWorkflowPreview.history.changeUndone')
          : historyNotice === 'change-redone'
            ? translateUi('editor:placementWorkflowPreview.history.changeRedone')
            : ''}
      </span>
      {adapter.kind === 'production' && <AdminSaveBar dirty={dirty} saving={dirty && writeBusy && dialog.kind !== 'publish'} canSave={dirty && !writeBusy && !adapter.pending() && !adapter.readOnly} canDiscard={!writeBusy && !adapter.pending()} onSave={save} onDiscard={discard} manageNavigation={false}/>}
      <s-page heading={product.title} inlineSize="large">
        <s-link slot="breadcrumb-actions" href={returnTo}>
          {translateUi(
            returnTo === '/admin/settings/storefront'
              ? 'editor:placementWorkflowPreview.storefrontSetup'
              : 'editor:placementWorkflowPreview.products',
          )}
        </s-link>
        <s-button slot="primary-action" variant="primary" disabled={publishedCurrent || !product.views.length || !!adapter.readOnly || !!adapter.publicationBlocked || writeBusy || adapter.pending()} onClick={openPublishReview}>
          {translateUi('editor:placementWorkflowPreview.publish')}
        </s-button>
        <s-button
          slot="secondary-actions"
          variant="secondary"
          icon="external"
          accessibilityLabel={translateUi('editor:placementWorkflowPreview.previewCustomization')}
          disabled={movementEditing || drawing || calibrationEditing}
          onClick={() =>
            adapter.preview(
              canonicalPlacementDecimals(product),
              (reason) => {
                setNotice({ kind: 'customer-preview-failed', reason });
                setPanel('settings');
              },
              activePhoto ? { appearanceGroupKey: activePhoto.key } : {},
            )
          }
        >
          {translateUi('editor:placementWorkflowPreview.previewCustomization')}
        </s-button>
        <s-button
          slot="secondary-actions"
          icon="menu-horizontal"
          accessibilityLabel={translateUi('editor:placementWorkflowPreview.moreActions')}
          commandFor="placement-page-actions"
        >{adapter.kind === 'production' ? translateUi('editor:placementWorkflowPreview.moreActions') : null}</s-button>
        <s-menu
          id="placement-page-actions"
          accessibilityLabel={translateUi('editor:placementWorkflowPreview.editorActions')}
        >
          <s-button href={storefrontProductTestSetupHref(product.id) ?? '/admin/settings/storefront#test-product'}>
            {translateUi('editor:placementWorkflowPreview.testOnYourStore')}
          </s-button>
          <s-button disabled={!product.views.length || calibrationEditing} onClick={openSetupCopy}>
            {translateUi('editor:placementWorkflowPreview.copySetupToProducts')}
          </s-button>
          <s-button
            tone="critical"
            disabled={!dirty || !!adapter.readOnly || writeBusy || adapter.pending()}
            onClick={() => dispatchDialog({ type: 'discard-requested', id: uid() })}
          >
            {translateUi('editor:placementWorkflowPreview.discardChanges')}
          </s-button>
        </s-menu>
        {adapter.kind !== 'production' && (
          <s-button
            slot="secondary-actions"
            data-preview-keep-visible
            data-editor-save-draft
            variant="secondary"
            disabled={!dirty || !!adapter.readOnly || writeBusy || adapter.pending()}
            onClick={save}
          >
            {translateUi('editor:placementWorkflowPreview.saveDraft')}
          </s-button>
        )}
      </s-page>
      {!!adapter.reviews?.length && <div class="placement-method-review" role="region" aria-label={translateUi('editor:placementWorkflowPreview.realReviewMethods')}>
        <s-banner tone="warning">{translateUi('editor:placementWorkflowPreview.realReviewMethods')}
          {adapter.reviews.map((review) => <s-stack direction="inline" gap="small" key={review.methodId}>
            <s-text>{review.name}</s-text>
            <s-button disabled={!!adapter.readOnly||writeBusy||adapter.pending()} onClick={() => { if(adapter.readOnly||writeBusyRef.current||adapter.pending())return;const next=adapter.reviewMethod?.(currentProduct.current,review.methodId,'keep'); if(next)setProduct(next); }}>{translateUi('editor:placementWorkflowPreview.realKeepMethod')}</s-button>
            <s-button disabled={!!adapter.readOnly||writeBusy||adapter.pending()} onClick={() => { if(adapter.readOnly||writeBusyRef.current||adapter.pending())return;const next=adapter.reviewMethod?.(currentProduct.current,review.methodId,'remove'); if(next)setProduct(next); }}>{translateUi('editor:placementWorkflowPreview.realRemoveMethod')}</s-button>
          </s-stack>)}
        </s-banner>
      </div>}
      {/* Local host bridge. Production host integration is deliberately separate. */}
      <div data-preview-editor-chrome hidden>
        <s-button
          data-editor-control="panels"
          icon="layout-sidebar-left"
          accessibilityLabel={translateUi(
            outlineHidden
              ? 'editor:placementWorkflowPreview.showViewsAndPlacements'
              : 'editor:placementWorkflowPreview.hideViewsAndPlacements',
          )}
          disabled={!view}
          onClick={() => setOutlineHidden((hidden) => !hidden)}
        />
        <s-button
          data-editor-control="undo"
          icon="undo"
          accessibilityLabel={translateUi('editor:placementWorkflowPreview.undo')}
          disabled={movementEditing || calibrationEditing || (!geometryInput && !history.current.past.length)}
          onClick={() => restoreHistory('undo')}
        />
        <s-button
          data-editor-control="redo"
          icon="redo"
          accessibilityLabel={translateUi('editor:placementWorkflowPreview.redo')}
          disabled={movementEditing || calibrationEditing || !!geometryInput || !history.current.future.length}
          onClick={() => restoreHistory('redo')}
        />
      </div>
      <div
        class={`placement-editor ${!view ? 'is-empty' : ''} ${view && outlineHidden ? 'is-outline-hidden' : ''}`}
        data-placement-editor
      >
        <div
          class="placement-mobile-tabs"
          role="tablist"
          aria-label={translateUi('editor:placementWorkflowPreview.editorPanels')}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next =
              event.key === 'Home'
                ? 'placements'
                : event.key === 'End'
                  ? 'settings'
                  : panel === 'placements'
                    ? 'settings'
                    : 'placements';
            setPanel(next);
            event.currentTarget.querySelector<HTMLButtonElement>(`[data-panel="${next}"]`)?.focus();
          }}
        >
          <button
            type="button"
            role="tab"
            id="placement-outline-tab"
            data-panel="placements"
            tabIndex={panel === 'placements' ? 0 : -1}
            aria-selected={panel === 'placements'}
            aria-controls="placement-outline"
            onClick={() => {
              setPanel('placements');
              if (view) setExpandedViews((current) => (current.includes(view.id) ? current : [...current, view.id]));
            }}
          >
            {translateUi('editor:placementWorkflowPreview.viewsPlacements')}
          </button>
          <button
            type="button"
            role="tab"
            id="placement-settings-tab"
            data-panel="settings"
            disabled={!view}
            tabIndex={panel === 'settings' ? 0 : -1}
            aria-selected={panel === 'settings'}
            aria-controls="placement-properties"
            onClick={() => setPanel('settings')}
          >
            {translateUi('editor:placementWorkflowPreview.settings')}
          </button>
        </div>
        <div
          id="placement-outline"
          inert={wideEditor && !!view && outlineHidden}
          class={`placement-outline ${panel === 'placements' ? 'is-mobile-active' : ''}`}
          role="tabpanel"
          aria-labelledby="placement-outline-tab"
          aria-label={translateUi('editor:placementWorkflowPreview.viewsAndPlacements')}
        >
          <div class="placement-panel-heading">
            <s-heading>{translateUi('editor:placementWorkflowPreview.viewsPlacements')}</s-heading>
            <s-text color="subdued">{setupStatus}</s-text>
          </div>
          <div class="placement-outline-summary">
            <span>
              {translateUi('editor:placementWorkflowPreview.outlineSummary', {
                views: translateUi('editor:placementWorkflowPreview.viewCount', {
                  count: product.views.length,
                  formattedCount: new Intl.NumberFormat(formatLocale).format(product.views.length),
                }),
                placements: translateUi('editor:placementWorkflowPreview.placementCount', {
                  count,
                  formattedCount: new Intl.NumberFormat(formatLocale).format(count),
                }),
              })}
            </span>
            <s-button
              variant="tertiary"
              icon="menu-horizontal"
              accessibilityLabel={translateUi('editor:placementWorkflowPreview.outlineActions')}
              commandFor="placement-outline-menu"
              command="--show"
            />
            <s-menu
              id="placement-outline-menu"
              accessibilityLabel={translateUi('editor:placementWorkflowPreview.outlineActions')}
            >
              <s-button
                disabled={!!outlineSearch}
                onClick={() => setExpandedViews(product.views.map((item) => item.id))}
              >
                {translateUi('editor:placementWorkflowPreview.expandAllViews')}
              </s-button>
              <s-button disabled={!!outlineSearch} onClick={collapseOtherViews}>
                {translateUi('editor:placementWorkflowPreview.collapseOtherViews')}
              </s-button>
            </s-menu>
          </div>
          {(count > 8 || product.views.length > 6 || outlineQuery) && (
            <div class="placement-outline-search">
              <s-search-field
                label={translateUi('editor:placementWorkflowPreview.searchViewsAndPlacements')}
                labelAccessibilityVisibility="exclusive"
                placeholder={translateUi('editor:placementWorkflowPreview.searchViewsAndPlacements')}
                value={outlineQuery}
                onInput={(event) => setOutlineQuery(event.currentTarget.value)}
              />
            </div>
          )}
          <div class="placement-outline-body">
            {outlineItems.map(({ view: item, areas }) => (
              <div class="placement-view-group" key={item.id}>
                <fieldset
                  aria-label={translateUi('editor:placementWorkflowPreview.viewAccessibilityName', {
                    viewName: item.name || translateUi('editor:placementWorkflowPreview.unnamedView'),
                  })}
                  data-outline-sort-kind="view"
                  data-outline-sort-id={item.id}
                  class={`placement-view-heading ${view?.id === item.id && !placement ? 'is-selected' : ''}${dropClass({ kind: 'view', id: item.id })}${draggingClass({ kind: 'view', id: item.id })}`}
                >
                  <button
                    type="button"
                    class="placement-disclosure"
                    aria-label={translateUi(
                      outlineSearch || expandedViews.includes(item.id)
                        ? 'editor:placementWorkflowPreview.collapseView'
                        : 'editor:placementWorkflowPreview.expandView',
                      { viewName: item.name },
                    )}
                    aria-expanded={!!outlineSearch || expandedViews.includes(item.id)}
                    aria-controls={`view-placements-${item.id}`}
                    disabled={!!outlineSearch}
                    onClick={() => toggleViewExpansion(item)}
                  >
                    <s-icon
                      type={outlineSearch || expandedViews.includes(item.id) ? 'chevron-down' : 'chevron-right'}
                    />
                  </button>
                  <button
                    class="placement-view"
                    type="button"
                    data-outline-select-view-id={item.id}
                    aria-current={view?.id === item.id && !placement ? 'true' : undefined}
                    onClick={() => select(item, null, true)}
                    onDblClick={() => rename(item, null)}
                    onKeyDown={(event) => {
                      if (event.key === 'F2') {
                        event.preventDefault();
                        rename(item, null);
                      }
                    }}
                  >
                    {resolveVariantPhotoView(product, item.id, activePhoto?.key).view.imageUrl ? (
                      <img
                        src={resolveVariantPhotoView(product, item.id, activePhoto?.key).view.imageUrl}
                        width="20"
                        height="20"
                        alt=""
                      />
                    ) : (
                      <s-icon type="image" />
                    )}
                    <AdminTruncatedLabel
                      text={item.name || translateUi('editor:placementWorkflowPreview.unnamedView')}
                    />
                    <span class="placement-count">
                      {translateUi('editor:placementWorkflowPreview.placementCount', {
                        count: item.placements.length,
                        formattedCount: new Intl.NumberFormat(formatLocale).format(item.placements.length),
                      })}
                    </span>
                    {(!item.imageUrl || item.needsAlignmentReview) && (
                      <span
                        class="placement-setup-warning"
                        role="img"
                        aria-label={translateUi(
                          !item.imageUrl
                            ? 'editor:placementWorkflowPreview.publicationActions.chooseImage'
                            : 'editor:placementWorkflowPreview.publicationActions.reviewAlignment',
                        )}
                      >
                        <s-icon type="alert-circle" tone="warning" />
                      </span>
                    )}
                  </button>
                  {outlineActions(
                    { kind: 'view', id: item.id },
                    item.name || translateUi('editor:placementWorkflowPreview.unnamedView'),
                  )}
                  {dragHandle(
                    { kind: 'view', id: item.id },
                    item.name || translateUi('editor:placementWorkflowPreview.unnamedView'),
                  )}
                </fieldset>
                <div
                  class="placement-children"
                  id={`view-placements-${item.id}`}
                  hidden={!outlineSearch && !expandedViews.includes(item.id)}
                >
                  {areas.map((area) => {
                    const issue = placementSetupIssue(product, area);
                    const rowSize =
                      item.calibration && calibrationMatchesImage(item.calibration, item)
                        ? approximatePlacementDimensions(item.calibration, area.rect)
                        : null;
                    const sizeLabel = rowSize
                      ? translateUi('editor:placementWorkflowPreview.approximateDimensions', {
                          width: new Intl.NumberFormat(formatLocale, {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 1,
                          }).format(rowSize.widthCm),
                          height: new Intl.NumberFormat(formatLocale, {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 1,
                          }).format(rowSize.heightCm),
                        })
                      : '';
                    return (
                      <fieldset
                        aria-label={translateUi('editor:placementWorkflowPreview.placementAccessibilityName', {
                          placementName: area.name || translateUi('editor:placementWorkflowPreview.unnamedPlacement'),
                        })}
                        data-outline-sort-kind="placement"
                        data-outline-sort-id={area.id}
                        data-outline-sort-view-id={item.id}
                        class={`placement-row-shell${view?.id === item.id && selectedId === area.id ? ' is-selected' : ''}${dropClass({ kind: 'placement', id: area.id, viewId: item.id })}${draggingClass({ kind: 'placement', id: area.id, viewId: item.id })}`}
                        key={area.id}
                      >
                        <button
                          type="button"
                          class={`placement-row ${rowSize ? 'has-estimate' : ''} ${view?.id === item.id && selectedId === area.id ? 'is-selected' : ''}`}
                          aria-description={
                            sizeLabel
                              ? translateUi('editor:placementWorkflowPreview.estimatedFullArtworkArea', {
                                  dimensions: sizeLabel,
                                })
                              : undefined
                          }
                          data-outline-select-placement-id={area.id}
                          aria-pressed={view?.id === item.id && selectedId === area.id}
                          onClick={() => select(item, area.id, true)}
                          onDblClick={() => rename(item, area.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'F2') {
                              event.preventDefault();
                              rename(item, area.id);
                            }
                          }}
                          key={area.id}
                        >
                          <span
                            class="placement-color-dot"
                            style={{ backgroundColor: placementColor(area.id).stroke }}
                            aria-hidden="true"
                          />
                          <AdminTruncatedLabel
                            className="placement-row-label"
                            text={area.name || translateUi('editor:placementWorkflowPreview.unnamedPlacement')}
                          />
                          {sizeLabel && (
                            <span
                              class="placement-row-dimensions"
                              aria-hidden="true"
                              title={translateUi('editor:placementWorkflowPreview.estimatedFullArtworkArea', {
                                dimensions: sizeLabel,
                              })}
                            >
                              {sizeLabel}
                            </span>
                          )}
                          {issue && (
                            <span
                              class="placement-setup-warning"
                              role="img"
                              aria-label={placementSetupIssueText(issue, translateUi)}
                            >
                              <s-icon type="alert-circle" tone="warning" />
                            </span>
                          )}
                        </button>
                        {outlineActions(
                          { kind: 'placement', id: area.id, viewId: item.id },
                          area.name || translateUi('editor:placementWorkflowPreview.unnamedPlacement'),
                        )}
                        {dragHandle(
                          { kind: 'placement', id: area.id, viewId: item.id },
                          area.name || translateUi('editor:placementWorkflowPreview.unnamedPlacement'),
                        )}
                      </fieldset>
                    );
                  })}
                  {!outlineSearch && (
                    <button class="placement-add" type="button" onClick={() => add(item)}>
                      <s-icon type="plus-circle" tone="info" />
                      <span>{translateUi('editor:placementWorkflowPreview.addPlacement')}</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
            {outlineSearch && !outlineItems.length && (
              <div class="placement-outline-empty">
                <s-text>{translateUi('editor:placementWorkflowPreview.noViewsOrPlacementsFound')}</s-text>
                <s-button variant="tertiary" onClick={() => setOutlineQuery('')}>
                  {translateUi('editor:placementWorkflowPreview.clearSearch')}
                </s-button>
              </div>
            )}
            {outlineSearch &&
              view &&
              !outlineItems.some(
                (item) =>
                  item.view.id === view.id && (!placement || item.areas.some((area) => area.id === placement.id)),
              ) && (
                <div class="placement-outline-empty">
                  <s-text color="subdued">
                    {translateUi('editor:placementWorkflowPreview.currentSelectionIsHiddenBySearch')}
                  </s-text>
                  <s-button variant="tertiary" onClick={() => setOutlineQuery('')}>
                    {translateUi('editor:placementWorkflowPreview.showSelection')}
                  </s-button>
                </div>
              )}
          </div>
          <div class="placement-outline-footer">
            <s-button data-outline-add-view variant="tertiary" icon="plus" onClick={() => openViewDialog()}>
              {translateUi('editor:placementWorkflowPreview.addView')}
            </s-button>
          </div>
        </div>
        <section
          class={`placement-workspace ${expandedCanvas ? 'is-expanded' : ''}`}
          aria-label={translateUi('editor:placementWorkflowPreview.garmentPreview')}
          data-preview-mode={preview}
        >
          <div
            class={`placement-canvas-toolbar ${photoGroups.length ? 'has-variant-photos' : ''} ${preview && placement && placement.sizes.length > 1 ? 'is-size-preview' : ''} ${movementEditing || drawing || calibrationEditing ? 'is-editing-task' : ''}`}
          >
            <div>
              {adapter.kind === 'production' && (
                <>
                  {wideEditor && (
                    <s-button
                      variant="tertiary"
                      icon="layout-sidebar-left"
                      interestFor="placement-panel-toggle-help"
                      accessibilityLabel={translateUi(outlineHidden ? 'editor:placementWorkflowPreview.showViewsAndPlacements' : 'editor:placementWorkflowPreview.hideViewsAndPlacements')}
                      disabled={!view || writeBusy || adapter.pending()}
                      onClick={() => setOutlineHidden((hidden) => !hidden)}
                    />
                  )}
                  <s-button
                    variant="tertiary"
                    icon="undo"
                    interestFor="placement-undo-help"
                    accessibilityLabel={translateUi('editor:placementWorkflowPreview.undo')}
                    disabled={movementEditing || calibrationEditing || writeBusy || adapter.pending() || (!geometryInput && !history.current.past.length)}
                    onClick={() => restoreHistory('undo')}
                  />
                  <s-button
                    variant="tertiary"
                    icon="redo"
                    interestFor="placement-redo-help"
                    accessibilityLabel={translateUi('editor:placementWorkflowPreview.redo')}
                    disabled={movementEditing || calibrationEditing || writeBusy || adapter.pending() || !!geometryInput || !history.current.future.length}
                    onClick={() => restoreHistory('redo')}
                  />
                  {wideEditor && (
                    <s-tooltip id="placement-panel-toggle-help">
                      {translateUi(outlineHidden ? 'editor:placementWorkflowPreview.showViewsAndPlacements' : 'editor:placementWorkflowPreview.hideViewsAndPlacements')}
                    </s-tooltip>
                  )}
                  <s-tooltip id="placement-undo-help">{translateUi('editor:placementWorkflowPreview.undo')}</s-tooltip>
                  <s-tooltip id="placement-redo-help">{translateUi('editor:placementWorkflowPreview.redo')}</s-tooltip>
                </>
              )}
              {view && placement && !movementEditing && !drawing && !calibrationEditing ? (
                <AdminResourceName text={view.name}>
                  {({ textRef, interestFor, tooltip }) => (
                    <>
                      <s-button
                        data-placement-view-overview
                        variant="tertiary"
                        icon="chevron-left"
                        interestFor={interestFor}
                        accessibilityLabel={translateUi('editor:placementWorkflowPreview.showAllPlacementsInView', {
                          viewName: view.name,
                        })}
                        onClick={() => select(view, null, true)}
                      >
                        <div class="placement-view-overview-label" ref={textRef}>
                          {view.name}
                        </div>
                      </s-button>
                      {tooltip}
                    </>
                  )}
                </AdminResourceName>
              ) : (
                <span class="placement-canvas-title">
                  {view && placement && (movementEditing || drawing || calibrationEditing)
                    ? `${view.name} · ${placement.name}`
                    : (view?.name ?? translateUi('editor:placementWorkflowPreview.productSetup'))}
                </span>
              )}
              {view && (
                <span class="placement-toolbar-caption">
                  {preview
                    ? translateUi('editor:placementWorkflowPreview.sampleArtwork')
                    : calibrationEditing
                      ? translateUi('editor:placementWorkflowPreview.imageScale')
                      : movementEditing
                        ? translateUi('editor:placementWorkflowPreview.movementArea')
                        : drawing
                          ? translateUi('editor:placementWorkflowPreview.artworkArea')
                          : (placement?.name ??
                            translateUi(
                              view.placements.length
                                ? 'editor:placementWorkflowPreview.allPlacements'
                                : 'editor:placementWorkflowPreview.viewSettings',
                            ))}
                </span>
              )}
            </div>
            <div class="placement-canvas-actions">
              {view && photoGroups.length > 0 && (
                <>
                  <VariantPhotoSelector
                    product={product}
                    value={activePhoto?.key ?? null}
                    onChange={choosePhotoGroup}
                    disabled={movementEditing || drawing || calibrationEditing}
                  />
                  {!preview && !movementEditing && !drawing && !calibrationEditing && (
                    <s-button
                      variant="tertiary"
                      icon="image"
                      accessibilityLabel={translateUi('editor:placementWorkflowPreview.variantImages')}
                      data-variant-images-action
                      onClick={() => {
                        if (select(view, null, true)) {
                          nameFocusRevision.current++;
                          requestAnimationFrame(() => {
                            const target = document.querySelector<HTMLElement>('[data-variant-photo-panel]');
                            target?.scrollIntoView({ block: 'start' });
                            target?.focus({ preventScroll: true });
                          });
                        }
                      }}
                    >
                      <span class="placement-toolbar-action-label">
                        {translateUi('editor:placementWorkflowPreview.images')}
                      </span>
                    </s-button>
                  )}
                </>
              )}
              {view && !view.placements.length && (
                <s-button icon="plus" variant="secondary" onClick={() => add(view)}>
                  {translateUi('editor:placementWorkflowPreview.addPlacement')}
                </s-button>
              )}
              {view && (placement || preview) && !movementEditing && !drawing && !calibrationEditing && (
                <s-button
                  variant="secondary"
                  icon={preview ? 'edit' : 'view'}
                  accessibilityLabel={translateUi(
                    preview ? 'editor:placementWorkflowPreview.exitPreview' : 'editor:placementWorkflowPreview.preview',
                  )}
                  disabled={movementEditing || (!placement && !preview)}
                  onClick={() => {
                    cancelCalibration();
                    cancelDrawingTask();
                    if (preview) exitSizePreview();
                    else if (view && placement) {
                      const sizeId = previewSize?.id ?? placement.sizes[0]?.id;
                      if (sizeId)
                        dispatchWorkspace({
                          type: 'size-preview-selected',
                          viewId: view.id,
                          placementId: placement.id,
                          sizeId,
                        });
                    }
                  }}
                >
                  <span class="placement-toolbar-action-label">
                    {translateUi(
                      preview
                        ? 'editor:placementWorkflowPreview.exitPreview'
                        : 'editor:placementWorkflowPreview.preview',
                    )}
                  </span>
                </s-button>
              )}
              {preview && placement && placement.sizes.length > 1 && (
                <div class="placement-size-selector">
                  <span aria-hidden="true">{translateUi('editor:placementWorkflowPreview.size')}</span>
                  <div class="placement-size-field">
                    <s-select
                      label={translateUi('editor:placementWorkflowPreview.previewSize')}
                      labelAccessibilityVisibility="exclusive"
                      value={previewSize?.id ?? ''}
                      onChange={(event) => {
                        if (view && placement)
                          dispatchWorkspace({
                            type: 'size-preview-selected',
                            viewId: view.id,
                            placementId: placement.id,
                            sizeId: event.currentTarget.value,
                          });
                      }}
                    >
                      {placement.sizes.map((size) => (
                        <s-option key={size.id} value={size.id}>
                          {size.name}
                        </s-option>
                      ))}
                    </s-select>
                  </div>
                </div>
              )}
              {movementEditing ? (
                <>
                  <s-button
                    variant="secondary"
                    disabled={
                      !movementDraft ||
                      drawing ||
                      !placement ||
                      !movementRectContainsPlacementRect(movementDraft, placement.rect)
                    }
                    onClick={completeMovementAreaEdit}
                  >
                    {translateUi('editor:placementWorkflowPreview.done')}
                  </s-button>
                  <s-button variant="tertiary" onClick={cancelMovementAreaEdit}>
                    {translateUi('editor:placementWorkflowPreview.cancel')}
                  </s-button>
                </>
              ) : drawing ? (
                <s-button variant="tertiary" onClick={cancelDrawingTask}>
                  {translateUi('editor:placementWorkflowPreview.cancelDrawing')}
                </s-button>
              ) : null}
              <span class="placement-expand">
                <s-button
                  data-add-size
                  variant="tertiary"
                  icon={expandedCanvas ? 'minimize' : 'maximize'}
                  accessibilityLabel={translateUi(
                    expandedCanvas
                      ? 'editor:placementWorkflowPreview.reduceCanvas'
                      : 'editor:placementWorkflowPreview.expandCanvas',
                  )}
                  onClick={() => setExpandedCanvas((current) => !current)}
                />
              </span>
            </div>
          </div>
          {view && activePhoto && photoView?.needsAlignmentReview && photoView.status === 'ready' && (
            <div class="placement-variant-review">
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-text>
                  {translateUi('editor:placementWorkflowPreview.checkAppearanceOnView', {
                    appearanceName: activePhoto.label,
                    viewName: view.name,
                  })}
                </s-text>
                <s-button
                  data-confirm-variant-alignment
                  disabled={!canvasView || !readyPhotoUrls.includes(canvasView.imageUrl)}
                  onClick={() => {
                    setProduct((current) => confirmVariantPhotoAlignment(current, view.id, activePhoto.key));
                    requestAnimationFrame(() =>
                      document.querySelector<HTMLElement>('[data-variant-images-action]')?.focus(),
                    );
                  }}
                >
                  {translateUi('editor:placementWorkflowPreview.confirmAlignment')}
                </s-button>
              </s-stack>
            </div>
          )}
          {view && canvasView?.imageUrl ? (
            <PlacementCanvas
              key={`${canvasView.imageUrl}:${photoRetryRevisions[canvasView.imageUrl] ?? 0}`}
              view={canvasView}
              onImageStatus={(status) => {
                if (status === 'ready' || status === 'image-error')
                  photoLoadStatus(canvasView.imageUrl, status === 'image-error', 'canvas');
              }}
              selectedId={selectedId}
              preview={preview}
              editingLocked={movementEditing}
              interactionRevision={interactionRevision}
              sizePercent={decimalOrNaN(previewSize?.widthPercent ?? '100')}
              sizeHeightPercent={decimalOrNaN(previewSize?.heightPercent ?? previewSize?.widthPercent ?? '100')}
              movementRect={movementEditing ? movementDraft : null}
              drawing={drawing}
              drawTarget={drawingTarget === 'movement' ? 'movement' : 'artwork'}
              measuring={calibrationEditing}
              measurementLine={calibrationEditing ? measurementLine : null}
              measurementControls={renderMeasurementControls()}
              measurementCoordinates={measurementCoordinates}
              onEnterMeasureCoordinates={() => {
                dispatchWorkspace({ type: 'measurement-coordinates-toggled', open: true });
                nameFocusRevision.current++;
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => {
                    main.current
                      ?.querySelector<HTMLElement>('.placement-calibration-form s-text-field[name="measurement-a-x"]')
                      ?.focus();
                  }),
                );
              }}
              onMeasure={(line, pointerType) => {
                dispatchWorkspace({ type: 'measurement-drawn', line });
                if (pointerType === 'mouse' && matchMedia('(min-width: 801px)').matches)
                  requestAnimationFrame(() => {
                    main.current
                      ?.querySelector<HTMLElement>('.placement-calibration-form s-text-field')
                      ?.focus({ preventScroll: true });
                  });
              }}
              onStartMeasure={activePhoto ? undefined : () => startMeasurement()}
              onCancelMeasure={cancelCalibration}
              onCancelDraw={cancelDrawingTask}
              onDraw={(rect): CanvasDrawFailure | undefined => {
                if (drawingTarget === 'movement') {
                  if (!placement) return 'placement-required';
                  if (!movementRectContainsPlacementRect(rect, placement.rect)) {
                    dispatchWorkspace({
                      type: 'movement-error',
                      viewId: view.id,
                      placementId: placement.id,
                      reason: 'movement-must-contain-artwork',
                    });
                    return 'movement-must-contain-artwork';
                  }
                  dispatchWorkspace({
                    type: 'movement-drawn',
                    viewId: view.id,
                    placementId: placement.id,
                    draft: rect,
                  });
                  const movementKey = `views.${view.id}.placements.${placement.id}.movementRect`;
                  setErrors((current) => {
                    const remaining = { ...current };
                    delete remaining[movementKey];
                    return remaining;
                  });
                  if (
                    (notice?.kind === 'publication-issue' && notice.issue.key === movementKey) ||
                    (errors[movementKey] &&
                      Object.keys(errors).length === 1 &&
                      notice?.kind === 'message' &&
                      notice.reason === 'invalid-setup')
                  )
                    setNotice(null);
                  return undefined;
                }
                patchPlacement({ rect });
                dispatchWorkspace({ type: 'placement-drawing-canceled' });
                return undefined;
              }}
              onSelect={(id) => select(view, id, true)}
              onRect={(id, rect) => changeArtworkRect(id, rect)}
            />
          ) : view ? (
            <div class="placement-start">
              <s-empty-state heading={translateUi('editor:placementWorkflowPreview.chooseAnImageForThisView')}>
                <s-icon slot="graphic" type="image-add" />
                <s-text slot="subheading">
                  {activePhoto
                    ? translateUi('editor:placementWorkflowPreview.addImageForAppearance', {
                        viewName: view.name,
                        appearanceName: activePhoto.label,
                      })
                    : translateUi('editor:placementWorkflowPreview.copiedViewImageGuidance', {
                        viewName: view.name,
                      })}
                </s-text>
                <s-button
                  slot="primary-action"
                  variant="primary"
                  onClick={() => (activePhoto ? openVariantImagePicker([activePhoto.key]) : openViewDialog(true))}
                >
                  {translateUi('editor:placementWorkflowPreview.chooseImage')}
                </s-button>
              </s-empty-state>
            </div>
          ) : (
            <div class="placement-start">
              <div class="placement-start-guide">
                <div class={`placement-start-image${product.images.length ? '' : ' is-illustration'}`}>
                  <s-image
                    src={product.images[0]?.url ?? '/illustrations/shopify/empty-records.png'}
                    alt=""
                    aspectRatio="1/1"
                    objectFit="contain"
                  />
                </div>
                <div class="placement-start-copy">
                  <s-heading fontSize="large">
                    {translateUi('editor:placementWorkflowPreview.addYourFirstProductView')}
                  </s-heading>
                  <p class="placement-start-description">
                    {translateUi(
                      'editor:placementWorkflowPreview.aViewIsAProductPhotoSuchAsTheFrontOrBackNextMarkWhereCustomersCanAddArtwork',
                    )}
                  </p>
                  <s-text color="subdued">{translateUi('editor:placementWorkflowPreview.publishNeedsView')}</s-text>
                  <s-button variant="primary" onClick={() => openViewDialog()}>
                    {translateUi('editor:placementWorkflowPreview.addView')}
                  </s-button>
                </div>
              </div>
            </div>
          )}
        </section>
        <div
          id="placement-properties"
          class={`placement-properties ${panel === 'settings' ? 'is-mobile-active' : ''}`}
          role="tabpanel"
          aria-labelledby="placement-settings-tab"
          aria-label={translateUi('editor:placementWorkflowPreview.placementSettings')}
        >
          <div class="placement-panel-heading">
            {view && (
              <>
                <button
                  type="button"
                  class="placement-object-name"
                  aria-label={translateUi('editor:placementWorkflowPreview.renameItem', {
                    itemName: placement
                      ? placement.name || translateUi('editor:placementWorkflowPreview.unnamedPlacement')
                      : view.name || translateUi('editor:placementWorkflowPreview.unnamedView'),
                  })}
                  title={translateUi('editor:placementWorkflowPreview.rename')}
                  onClick={() => focusName()}
                >
                  <s-icon type={placement ? 'location' : 'image'} />
                  <AdminTruncatedLabel
                    text={
                      placement
                        ? placement.name || translateUi('editor:placementWorkflowPreview.unnamedPlacement')
                        : view.name || translateUi('editor:placementWorkflowPreview.unnamedView')
                    }
                  />
                </button>
                <s-button
                  data-inspector-actions
                  icon="menu-horizontal"
                  variant="tertiary"
                  accessibilityLabel={translateUi(
                    placement
                      ? 'editor:placementWorkflowPreview.moreActionsForSelectedPlacement'
                      : 'editor:placementWorkflowPreview.moreActionsForSelectedView',
                  )}
                  commandFor="placement-inspector-actions"
                  interestFor="placement-inspector-actions-help"
                />
              </>
            )}
          </div>
          {view && (
            <div class="placement-control-overlays">
              <s-tooltip id="placement-inspector-actions-help">
                {translateUi('editor:placementWorkflowPreview.moreActions')}
              </s-tooltip>
              <s-menu
                id="placement-inspector-actions"
                accessibilityLabel={translateUi('editor:placementWorkflowPreview.selectedItemActions')}
              >
                {itemMenuItems(
                  placement ? { kind: 'placement', id: placement.id, viewId: view.id } : { kind: 'view', id: view.id },
                  'inspector',
                )}
              </s-menu>
            </div>
          )}
          {view?.needsAlignmentReview && (
            <div class="placement-alignment-review">
              <s-text>
                {view.imageUrl
                  ? view.placements.some((area) => area.customPlacementAllowed)
                    ? translateUi('editor:placementWorkflowPreview.checkArtworkAndMovementAreas')
                    : translateUi('editor:placementWorkflowPreview.checkArtworkAreas')
                  : translateUi('editor:placementWorkflowPreview.chooseImageForCopiedView')}
              </s-text>
              <s-button
                variant="tertiary"
                data-field-invalid={!!errors[`views.${view.id}.alignment`]}
                onClick={() => (view.imageUrl ? patchView({ needsAlignmentReview: false }) : openViewDialog(true))}
              >
                {translateUi(
                  view.imageUrl
                    ? 'editor:placementWorkflowPreview.markAlignmentReviewed'
                    : 'editor:placementWorkflowPreview.chooseImage',
                )}
              </s-button>
            </div>
          )}
          {notice && !(feedback && hostToast()) && (
            <div class={`placement-notice${feedback ? ' is-feedback' : ''}`}>
              <s-banner tone={Object.keys(errors).length ? 'critical' : feedback ? 'success' : 'info'}>
                {noticeText}
              </s-banner>
            </div>
          )}
          {placement && view ? (
            <div class="placement-properties-body" key={placement.id}>
              <section class="placement-property-section">
                <s-text-field
                  label={translateUi('editor:placementWorkflowPreview.placementName')}
                  data-editor-name-field
                  name="placement-name"
                  value={placement.name}
                  maxLength={80}
                  required
                  error={fieldError('name')}
                  data-field-invalid={!!fieldError('name')}
                  onInput={(event) => patchPlacement({ name: event.currentTarget.value })}
                />
                <s-text color="subdued">
                  {translateUi('editor:placementWorkflowPreview.shownToCustomersWhenChoosingAPlacement')}
                </s-text>
              </section>
              <section class="placement-property-section">
                <div class="placement-section-label placement-section-label-artwork">
                  <s-heading>{translateUi('editor:placementWorkflowPreview.artworkArea')}</s-heading>
                  <s-button
                    variant="tertiary"
                    disabled={movementEditing}
                    onClick={() => {
                      cancelCalibration();
                      exitSizePreview();
                      if (drawing) cancelDrawingTask();
                      else
                        dispatchWorkspace({
                          type: 'placement-drawing-started',
                          viewId: view.id,
                          placementId: placement.id,
                        });
                      if (!drawing && matchMedia('(max-width: 800px)').matches) {
                        setExpandedCanvas(true);
                        window.scrollTo({ top: 0 });
                      }
                    }}
                  >
                    {translateUi(
                      movementEditing
                        ? 'editor:placementWorkflowPreview.drawArtworkArea'
                        : drawing
                          ? 'editor:placementWorkflowPreview.cancelDrawing'
                          : 'editor:placementWorkflowPreview.drawArea',
                    )}
                  </s-button>
                </div>
                {photoGroups.length > 0 ? (
                  <div class="placement-variant-area-scope">
                    <s-text color="subdued">
                      {groupAreaScope && activePhoto
                        ? translateUi('editor:placementWorkflowPreview.alignmentForAppearance', {
                            appearanceName: activePhoto.label,
                          })
                        : translateUi('editor:placementWorkflowPreview.sharedArtworkArea')}
                    </s-text>
                    {activePhoto && (
                      <s-button
                        variant="tertiary"
                        disabled={photoView?.status !== 'ready'}
                        onClick={() => {
                          if (!prepareSelectionChange()) return;
                          if (groupAreaScope) {
                            setProduct((current) =>
                              resetVariantPhotoPlacementRect(current, view.id, activePhoto.key, placement.id),
                            );
                            dispatchWorkspace({ type: 'mode-canceled' });
                          } else
                            dispatchWorkspace({
                              type: 'group-area-edit-started',
                              viewId: view.id,
                              placementId: placement.id,
                              groupKey: activePhoto.key,
                            });
                        }}
                      >
                        {groupAreaScope
                          ? translateUi('editor:placementWorkflowPreview.useSharedArea')
                          : translateUi('editor:placementWorkflowPreview.adjustForAppearance', {
                              appearanceName: activePhoto.label,
                            })}
                      </s-button>
                    )}
                  </div>
                ) : (
                  <s-text color="subdued">
                    {translateUi('editor:placementWorkflowPreview.setsTheMaximumArtworkSizeAndStartingPosition')}
                  </s-text>
                )}

                <div class="placement-fields-grid">
                  {(
                    [
                      ['width', translateUi('editor:placementWorkflowPreview.geometryLabels.width')],
                      ['height', translateUi('editor:placementWorkflowPreview.geometryLabels.height')],
                      ['centerX', translateUi('editor:placementWorkflowPreview.geometryLabels.centerX')],
                      ['centerY', translateUi('editor:placementWorkflowPreview.geometryLabels.centerY')],
                    ] as const
                  ).map(([key, label]) => (
                    <DecimalField
                      key={key}
                      label={label}
                      name={`area-${key}`}
                      disabled={movementEditing}
                      suffix="%"
                      value={
                        geometryInput?.placementId === placement.id && geometryInput.key === key
                          ? geometryInput.value
                          : String(Math.round((displayedRect ?? placement.rect)[key] * 1000) / 10)
                      }
                      error={fieldError(`rect.${key}`)}
                      data-field-invalid={!!fieldError(`rect.${key}`)}
                      onValue={(value) =>
                        setGeometryInput({
                          viewId: view.id,
                          placementId: placement.id,
                          key,
                          value,
                        })
                      }
                      onCommit={(value) => geometry(key, value, view.id, placement.id)}
                    />
                  ))}
                </div>
                {renderImageScale()}
                <s-divider />
                <div data-placement-positioning>
                  <s-stack gap="base">
                    <s-switch
                      label={translateUi('editor:placementWorkflowPreview.allowCustomersToMoveArtwork')}
                      details={translateUi('editor:placementWorkflowPreview.customerMovementDetails')}
                      checked={placement.customPlacementAllowed}
                      disabled={movementEditing}
                      onChange={(event) => patchPlacement({ customPlacementAllowed: event.currentTarget.checked })}
                    />
                    {placement.customPlacementAllowed && (
                      <div class="placement-movement-settings">
                        {movementEditing ? (
                          <>
                            {!drawing && (
                              <s-button variant="tertiary" onClick={redrawMovementArea}>
                                {translateUi(
                                  movementDraft
                                    ? 'editor:placementWorkflowPreview.redrawMovementArea'
                                    : 'editor:placementWorkflowPreview.drawMovementArea',
                                )}
                              </s-button>
                            )}
                            {(movementErrorText || fieldError('movementRect')) && (
                              <s-text tone="critical">{movementErrorText || fieldError('movementRect')}</s-text>
                            )}
                          </>
                        ) : (
                          <>
                            <s-stack direction="inline" gap="small" justifyContent="space-between" alignItems="center">
                              <s-stack direction="inline" gap="small" alignItems="center">
                                <s-text>{translateUi('editor:placementWorkflowPreview.movementArea')}</s-text>
                                <s-badge
                                  tone={
                                    !view.imageUrl || !placement.movementRect || movementNeedsReview
                                      ? 'warning'
                                      : 'auto'
                                  }
                                >
                                  {!view.imageUrl
                                    ? translateUi('editor:placementWorkflowPreview.movementStatus.noImage')
                                    : !placement.movementRect
                                      ? translateUi('editor:placementWorkflowPreview.movementStatus.areaNeeded')
                                      : movementNeedsReview
                                        ? translateUi('editor:placementWorkflowPreview.movementStatus.reviewArea')
                                        : translateUi('editor:placementWorkflowPreview.movementStatus.areaSet')}
                                </s-badge>
                              </s-stack>
                              {!view.imageUrl ? (
                                <s-button
                                  variant="secondary"
                                  accessibilityLabel={translateUi(
                                    'editor:placementWorkflowPreview.chooseImageForThisView',
                                  )}
                                  data-field-invalid={!!fieldError('movementRect')}
                                  onClick={() => openViewDialog(true)}
                                >
                                  {translateUi('editor:placementWorkflowPreview.chooseImage')}
                                </s-button>
                              ) : (
                                <s-button
                                  variant={!placement.movementRect || movementNeedsReview ? 'secondary' : 'tertiary'}
                                  accessibilityLabel={translateUi(
                                    placement.movementRect
                                      ? 'editor:placementWorkflowPreview.editMovementArea'
                                      : 'editor:placementWorkflowPreview.setMovementArea',
                                  )}
                                  data-field-invalid={!!fieldError('movementRect')}
                                  onClick={startMovementAreaEdit}
                                >
                                  {translateUi(
                                    placement.movementRect
                                      ? 'editor:placementWorkflowPreview.edit'
                                      : 'editor:placementWorkflowPreview.set',
                                  )}
                                </s-button>
                              )}
                            </s-stack>
                            {!view.imageUrl ? (
                              <s-text color="subdued">
                                {translateUi(
                                  'editor:placementWorkflowPreview.chooseAnImageForThisViewBeforeSettingAMovementArea',
                                )}
                              </s-text>
                            ) : (
                              (!placement.movementRect || movementNeedsReview) && (
                                <s-text color="subdued">
                                  {translateUi(
                                    movementNeedsReview
                                      ? 'editor:placementWorkflowPreview.updateMovementAreaBeforePublish'
                                      : 'editor:placementWorkflowPreview.setMovementBoundaryBeforePublish',
                                  )}
                                </s-text>
                              )
                            )}
                            {fieldError('movementRect') && (
                              <s-text tone="critical">{fieldError('movementRect')}</s-text>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </s-stack>
                </div>
              </section>
              <section class="placement-property-section">
                <div class="placement-section-label">
                  <s-heading>{translateUi('editor:placementWorkflowPreview.decorationSizes')}</s-heading>
                </div>
                <s-text color="subdued">{translateUi('editor:placementWorkflowPreview.maxArtworkSizeGuidance')}</s-text>
                <div class="placement-size-headings" aria-hidden="true">
                  <span>{translateUi('editor:placementWorkflowPreview.sizeName')}</span>
                  <span>{translateUi('editor:placementWorkflowPreview.scale')}</span>
                </div>
                {placement.sizes.map((size) => (
                  <div class="placement-size-row" key={size.id}>
                    <s-text-field
                      label={translateUi('editor:placementWorkflowPreview.sizeName')}
                      data-editor-name-field
                      labelAccessibilityVisibility="exclusive"
                      value={size.name}
                      error={fieldError(`sizes.${size.id}.name`)}
                      data-field-invalid={!!fieldError(`sizes.${size.id}.name`)}
                      onInput={(event) =>
                        patchPlacement({
                          sizes: placement.sizes.map((entry) =>
                            entry.id === size.id ? { ...entry, name: event.currentTarget.value } : entry,
                          ),
                        })
                      }
                    />
                    <DecimalField
                      label={translateUi(size.heightPercent!==undefined?'editor:placementWorkflowPreview.legacyWidthScale':'editor:placementWorkflowPreview.areaScale')}
                      labelAccessibilityVisibility="exclusive"
                      value={size.widthPercent}
                      error={fieldError(`sizes.${size.id}.widthPercent`)}
                      data-field-invalid={!!fieldError(`sizes.${size.id}.widthPercent`)}
                      onValue={(value) =>
                        patchPlacement({
                          sizes: placement.sizes.map((entry) =>
                            entry.id === size.id ? { ...entry, widthPercent: value } : entry,
                          ),
                        })
                      }
                    />
                    {size.heightPercent!==undefined&&<DecimalField label={translateUi('editor:placementWorkflowPreview.legacyHeightScale')} value={size.heightPercent} error={fieldError(`sizes.${size.id}.heightPercent`)} data-field-invalid={!!fieldError(`sizes.${size.id}.heightPercent`)} onValue={value=>patchPlacement({sizes:placement.sizes.map(entry=>entry.id===size.id?{...entry,heightPercent:value}:entry)})}/>}
                    <s-button
                      icon="view"
                      variant={preview && previewSize?.id === size.id ? 'secondary' : 'tertiary'}
                      accessibilityLabel={translateUi(
                        preview && previewSize?.id === size.id
                          ? 'editor:placementWorkflowPreview.exitPreviewForSize'
                          : 'editor:placementWorkflowPreview.previewSizeNamed',
                        {
                          sizeName: size.name || translateUi('editor:placementWorkflowPreview.unnamedSize'),
                        },
                      )}
                      disabled={movementEditing || drawing || calibrationEditing}
                      onClick={() => showSize(size.id)}
                    />
                    <s-button
                      icon="delete"
                      variant="tertiary"
                      accessibilityLabel={translateUi('editor:placementWorkflowPreview.removeSizeNamed', {
                        sizeName: size.name || translateUi('editor:placementWorkflowPreview.unnamedSize'),
                      })}
                      disabled={placement.sizes.length === 1}
                      onClick={() => patchPlacement({ sizes: placement.sizes.filter((entry) => entry.id !== size.id) })}
                    />
                  </div>
                ))}
                <s-button
                  variant="tertiary"
                  icon="plus"
                  onClick={() =>
                    patchPlacement({
                      sizes: [
                        ...placement.sizes,
                        {
                          id: uid(),
                          name: nextItemName(
                            translateUi('editor:placementWorkflowPreview.defaultNames.size'),
                            placement.sizes.map((size) => size.name),
                          ),
                          widthPercent: defaultNewSizeScale(placement.sizes),
                          prices: {},
                        },
                      ],
                    })
                  }
                >
                  {translateUi('editor:placementWorkflowPreview.addSize')}
                </s-button>
              </section>
              <section class="placement-property-section" data-placement-methods>
                <div class="placement-section-label">
                  <s-heading>{translateUi('editor:placementWorkflowPreview.decorationMethods')}</s-heading>
                  <s-button
                    variant="tertiary"
                    accessibilityLabel={translateUi(
                      product.methods.length
                        ? 'editor:placementWorkflowPreview.manageMethods'
                        : 'editor:placementWorkflowPreview.chooseMethods',
                    )}
                    onClick={() => openMethodEditor()}
                  >
                    {translateUi(
                      product.methods.length
                        ? 'editor:placementWorkflowPreview.manage'
                        : 'editor:placementWorkflowPreview.chooseMethods',
                    )}
                  </s-button>
                </div>
                <s-text color="subdued">
                  {translateUi(
                    product.methods.length > 6
                      ? 'editor:placementWorkflowPreview.pricesPerItemAtPlacement'
                      : 'editor:placementWorkflowPreview.chooseCustomerOptionsForPlacement',
                  )}
                </s-text>
                {!product.methods.length && (
                  <s-paragraph>
                    {translateUi(
                      'editor:placementWorkflowPreview.noDecorationMethodsSelectedChooseAMethodFromYourLibraryToOfferThisPlacement',
                    )}
                  </s-paragraph>
                )}
                {product.methods.length > 6 ? (
                  <div class="placement-method-summary">
                    <s-stack direction="inline">
                      <s-badge>
                        {translateUi('editor:placementWorkflowPreview.enabledMethodCount', {
                          count: enabledMethods.length,
                          formattedCount: new Intl.NumberFormat(formatLocale).format(enabledMethods.length),
                        })}
                      </s-badge>
                    </s-stack>
                    {!!enabledMethods.length && (
                      <ul>
                        {enabledMethods.slice(0, 3).map((method) => (
                          <li key={method.id}>
                            <span class="placement-method-summary-name">{method.name}</span>
                            {method.pricing === 'fixed' ? (
                              <s-button
                                variant="tertiary"
                                icon="edit"
                                accessibilityLabel={translateUi('editor:placementWorkflowPreview.editMethodPrice', {
                                  methodName: method.name,
                                })}
                                onClick={() => openMethodEditor(method.id)}
                              >
                                {(() => {
                                  const price = parsePrice(method.amount);
                                  return price.kind === 'valid'
                                    ? formatPrice(price.minor, formatLocale, adapter.currency)
                                    : translateUi('editor:placementWorkflowPreview.priceUnavailable');
                                })()}
                              </s-button>
                            ) : (
                              <s-button
                                variant="tertiary"
                                accessibilityLabel={translateUi('editor:placementWorkflowPreview.editMethodPrices', {
                                  methodName: method.name,
                                })}
                                onClick={() => openMethodEditor(method.id)}
                              >
                                {(() => {
                                  const priced = placement.sizes.filter(
                                    (size) => parsePrice(size.prices[method.id] ?? '').kind === 'valid',
                                  ).length;
                                  return translateUi('editor:placementWorkflowPreview.pricedSizeCount', {
                                    count: placement.sizes.length,
                                    formattedPricedCount: new Intl.NumberFormat(formatLocale).format(priced),
                                    formattedTotalCount: new Intl.NumberFormat(formatLocale).format(
                                      placement.sizes.length,
                                    ),
                                  });
                                })()}
                              </s-button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {enabledMethods.length > 3 && (
                      <s-text color="subdued">
                        {translateUi('editor:placementWorkflowPreview.moreEnabledMethods', {
                          count: enabledMethods.length - 3,
                          formattedCount: new Intl.NumberFormat(formatLocale).format(enabledMethods.length - 3),
                        })}
                      </s-text>
                    )}
                  </div>
                ) : (
                  renderMethodSettings()
                )}
                {!!product.methods.length && !placement.methodIds.length && (
                  <s-text tone="warning">
                    {translateUi('editor:placementWorkflowPreview.chooseAMethodBeforeOfferingThisPlacement')}
                  </s-text>
                )}
              </section>
              <section class="placement-property-section">
                <s-heading>{translateUi('editor:placementWorkflowPreview.customerOptions')}</s-heading>
                <s-switch
                  label={translateUi('editor:placementWorkflowPreview.allowOrdersWithoutArtwork')}
                  details={translateUi('editor:placementWorkflowPreview.allowOrdersWithoutArtworkDetails')}
                  checked={placement.logoLaterAllowed}
                  onChange={(event) => patchPlacement({ logoLaterAllowed: event.currentTarget.checked })}
                />
              </section>
              <div class="placement-property-section placement-remove-action">
                <s-button
                  tone="critical"
                  variant="tertiary"
                  icon="delete"
                  inlineSize="fill"
                  onClick={() =>
                    requestRemove({ kind: 'placement', id: placement.id, viewId: view.id }, 'inspector-footer')
                  }
                >
                  {translateUi('editor:placementWorkflowPreview.removePlacement')}
                </s-button>
              </div>
            </div>
          ) : view ? (
            <div class="placement-properties-body">
              <section class="placement-property-section">
                <s-text-field
                  label={translateUi('editor:placementWorkflowPreview.viewName')}
                  data-editor-name-field
                  name="view-name"
                  value={view?.name ?? ''}
                  maxLength={60}
                  required
                  error={errorText(`views.${view?.id}.name`)}
                  data-field-invalid={!!errors[`views.${view?.id}.name`]}
                  onInput={(event) => patchView({ name: event.currentTarget.value })}
                />
                <s-text color="subdued">
                  {translateUi('editor:placementWorkflowPreview.shownToCustomersForExampleFrontOrBack')}
                </s-text>
                <div class="placement-view-image">
                  {view.imageUrl && <img src={view.imageUrl} alt="" width="56" height="64" />}
                  <s-button
                    data-field-invalid={!!errors[`views.${view.id}.imageUrl`]}
                    onClick={() => openViewDialog(true)}
                  >
                    {translateUi(
                      view.imageUrl
                        ? photoGroups.length
                          ? 'editor:placementWorkflowPreview.changeSharedImage'
                          : 'editor:placementWorkflowPreview.changeImage'
                        : 'editor:placementWorkflowPreview.chooseImage',
                    )}
                  </s-button>
                </div>
                <s-paragraph>
                  {translateUi(
                    view.placements.length
                      ? 'editor:placementWorkflowPreview.selectPlacementToEditDetails'
                      : 'editor:placementWorkflowPreview.addPlacementToBeginDetails',
                  )}
                </s-paragraph>
                <s-button data-add-placement icon="plus" onClick={() => add()}>
                  {translateUi('editor:placementWorkflowPreview.addPlacement')}
                </s-button>
              </section>
              {product.variantPhotos && (
                <section class="placement-property-section">
                  <VariantPhotoPanel
                    product={product}
                    viewId={view.id}
                    activeGroupKey={activePhoto?.key ?? null}
                    onSelectGroup={choosePhotoGroup}
                    onChange={setProduct}
                    onChooseImage={openVariantImagePicker}
                    onImageStatus={photoLoadStatus}
                    failedImageUrls={failedPhotoUrls}
                    pendingImageUrls={pendingPhotoUrls}
                    imageRetryRevisions={photoRetryRevisions}
                    onRetryImage={retryPhoto}
                    onReviewAlignment={(key) => {
                      choosePhotoGroup(key);
                      if (matchMedia('(max-width: 800px)').matches) {
                        setExpandedCanvas(true);
                        window.scrollTo({ top: 0 });
                      }
                      setAlignmentFocusRequested(true);
                    }}
                  />
                </section>
              )}
              {calibration && <section class="placement-property-section">{renderImageScale()}</section>}
              <div class="placement-property-section placement-remove-action">
                <s-button
                  variant="tertiary"
                  tone="critical"
                  icon="delete"
                  inlineSize="fill"
                  onClick={() => requestRemove({ kind: 'view', id: view.id }, 'inspector-footer')}
                >
                  {translateUi('editor:placementWorkflowPreview.removeView')}
                </s-button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {publishReview && (
        <Dialog
          heading={
            missingViewIssue
              ? translateUi('editor:placementWorkflowPreview.publishHeadings.addProductView')
              : publishReview.issues.length
                ? translateUi('editor:placementWorkflowPreview.publishHeadings.finishSetup')
                : translateUi('editor:placementWorkflowPreview.publishHeadings.publishSetup')
          }
          size={missingViewIssue || !publishReview.issues.length ? 'small-100' : 'base'}
          onClose={() => dispatchDialog({ type: 'dialog-closed', id: publishReview.id })}
          actions={
            missingViewIssue ? (
              <s-button slot="primary-action" variant="primary" onClick={() => reviewPublishIssue(missingViewIssue)}>
                {translateUi('editor:placementWorkflowPreview.addView')}
              </s-button>
            ) : publishReview.issues.length ? null : (
              <s-button slot="primary-action" variant="primary" onClick={confirmPublish}>
                {translateUi(production ? 'editor:placementWorkflowPreview.realPublish' : 'editor:placementWorkflowPreview.publishPreview')}
              </s-button>
            )
          }
        >
          <s-stack gap="base">
            {publishReview.issues.length ? (
              missingViewIssue ? (
                <s-paragraph>
                  {translateUi(
                    'editor:placementWorkflowPreview.chooseAProductImageToStartNextMarkTheArtworkAreaCustomersCanCustomize',
                  )}
                </s-paragraph>
              ) : (
                <div class="placement-publication-issues">
                  {publishReview.issues.map((issue) => (
                    <div class="placement-publication-issue" key={issue.key}>
                      <s-text>{publicationIssueText(issue, publishReview.product, translateUi)}</s-text>
                      <s-button variant="secondary" onClick={() => reviewPublishIssue(issue)}>
                        {publicationIssueAction(issue)}
                      </s-button>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <>
                <div class="placement-publish-summary">
                  {publishReview.product.views[0]?.imageUrl && (
                    <s-thumbnail src={publishReview.product.views[0].imageUrl} size="small" alt="" />
                  )}
                  <div class="placement-publish-summary-copy">
                    <s-text type="strong">{publishReview.product.title}</s-text>
                    <s-text color="subdued">
                      {translateUi('editor:placementWorkflowPreview.publishSummary', {
                        views: new Intl.NumberFormat(formatLocale).format(publishViewCount),
                        placements: new Intl.NumberFormat(formatLocale).format(publishPlacementCount),
                      })}
                    </s-text>
                  </div>
                </div>
                <s-paragraph>
                  {translateUi(
                    publication?.published
                      ? production
                        ? 'editor:placementWorkflowPreview.realReplacePublishedQuestion'
                        : 'editor:placementWorkflowPreview.publishQuestions.replacePublishedPreview'
                      : production
                        ? 'editor:placementWorkflowPreview.realPublishQuestion'
                        : 'editor:placementWorkflowPreview.publishQuestions.publishPreview',
                  )}
                </s-paragraph>
              </>
            )}
            {writeBusy && !publishReview.error && adapter.kind === 'production' && <s-banner tone="info">{translateUi('editor:placementWorkflowPreview.realPublicationProgress')}</s-banner>}
            {publishError && <s-banner tone={publishReview.error === 'pending' ? 'info' : 'critical'}>{publishError}</s-banner>}
            {!publishReview.issues.length && (
              <s-text color="subdued">
                {translateUi(adapter.kind === 'demo' ? 'editor:placementWorkflowPreview.localPreviewOnlyShopifyIsnTUpdated' : 'editor:placementWorkflowPreview.realPublicationNotice')}
              </s-text>
            )}
          </s-stack>
        </Dialog>
      )}
      {removing && removal && (
        <Dialog
          heading={translateUi(
            removing.kind === 'view'
              ? 'editor:placementWorkflowPreview.removeDialog.viewHeading'
              : 'editor:placementWorkflowPreview.removeDialog.placementHeading',
          )}
          onClose={closeRemove}
          actions={
            <s-button slot="primary-action" tone="critical" variant="primary" onClick={confirmRemove}>
              {translateUi(
                removing.kind === 'view'
                  ? 'editor:placementWorkflowPreview.removeView'
                  : 'editor:placementWorkflowPreview.removePlacement',
              )}
            </s-button>
          }
        >
          {removing.kind === 'placement' && removal.placement ? (
            <s-paragraph>
              {translateUi('editor:placementWorkflowPreview.removeDialog.placementBody', {
                placementName: removal.placement.name,
              })}
            </s-paragraph>
          ) : (
            <s-paragraph>
              {removal.view.placements.length
                ? translateUi('editor:placementWorkflowPreview.removeDialog.viewBody', {
                    viewName: removal.view.name,
                    count: removal.view.placements.length,
                    formattedCount: new Intl.NumberFormat(formatLocale).format(removal.view.placements.length),
                  })
                : translateUi('editor:placementWorkflowPreview.removeDialog.viewBody_noPlacements', {
                    viewName: removal.view.name,
                  })}
            </s-paragraph>
          )}
        </Dialog>
      )}
      {discarding && (
        <Dialog
          heading={translateUi('editor:placementWorkflowPreview.discardChanges2')}
          onClose={() => {
            if (dialog.kind === 'discard') dispatchDialog({ type: 'dialog-closed', id: dialog.id });
          }}
          actions={
            <s-button slot="primary-action" variant="primary" tone="critical" onClick={discard}>
              {translateUi('editor:placementWorkflowPreview.discardChanges')}
            </s-button>
          }
        >
          <s-paragraph>
            {translateUi('editor:placementWorkflowPreview.yourChangesSinceTheLastSaveWillBeLost')}
          </s-paragraph>
        </Dialog>
      )}
      {leaving && (
        <Dialog
          heading={translateUi('editor:placementWorkflowPreview.leaveWithoutSaving')}
          onClose={() => {
            if (dialog.kind === 'leave') dispatchDialog({ type: 'dialog-closed', id: dialog.id });
          }}
          actions={
            <s-button
              slot="primary-action"
              variant="primary"
              tone="critical"
              onClick={() => {
                dirtyRef.current = false;
                location.assign(leaving);
              }}
            >
              {translateUi('editor:placementWorkflowPreview.leavePage')}
            </s-button>
          }
        >
          <s-paragraph>{translateUi('editor:placementWorkflowPreview.yourUnsavedChangesWillBeLost')}</s-paragraph>
        </Dialog>
      )}
      {methodDialog && placement && (
        <PlacementMethodManager
          key={methodDialog.id}
          methods={product.methods}
          loadCatalog={adapter.loadMethods}
          currency={adapter.currency}
          product={product}
          onOpenLibrary={async () => {
            if (!(await saveDraft(true)) || !view) return;
            dirtyRef.current = false;
            location.assign(methodLibraryHref(product.id, view.id, placement.id));
          }}
          placement={placement}
          initialMethodId={methodDialog.initialMethodId}
          sessionId={methodDialog.id}
          targetRevision={methodDialog.targetRevision}
          onClose={() => dispatchDialog({ type: 'dialog-closed', id: methodDialog.id })}
          onApply={(change, choices, editedIds, editedCells) => {
            if (
              writeBusyRef.current || adapter.pending() || dialog.kind !== 'method-manager' ||
              dialog.id !== methodDialog.id ||
              !placementDialogTargetMatches(
                dialog,
                currentProduct.current,
                { viewId: selectedViewId.current, placementId: editorSelectionRef.current.placementId },
                interactionTargetRevision.current,
              ) ||
              claimedMethodCommits.current.has(methodDialog.id)
            )
              return;
            claimedMethodCommits.current.add(methodDialog.id);
            endHistoryGroup();
            adapter.methodsApplied?.(placement.id, change, choices, editedIds, editedCells);
            setProduct((current) => {
              const imported = importPlacementMethods(current, change.methodIds, choices, editedIds);
              return {
                ...imported,
                views: imported.views.map((item) =>
                  item.id === viewId
                    ? {
                        ...item,
                        placements: item.placements.map((area) =>
                          area.id === placement.id ? { ...area, ...change } : area,
                        ),
                      }
                    : item,
                ),
              };
            });
            setErrors({});
            setNotice(null);
            endHistoryGroup();
            dispatchDialog({ type: 'dialog-closed', id: methodDialog.id });
          }}
        />
      )}
      {copyingSetup && dialog.kind === 'copy-setup' && (
        <PlacementSetupCopyDialog
          source={copyingSetup}
          ports={adapter.copyPorts}
          onClose={() => dispatchDialog({ type: 'dialog-closed', id: dialog.id })}
        />
      )}
      {copySource && copySourceData?.placement && (
        <Dialog
          heading={translateUi('editor:placementWorkflowPreview.copyPlacementToAnotherView')}
          onClose={() => {
            if (dialog.kind === 'copy-placement') dispatchDialog({ type: 'dialog-closed', id: dialog.id });
          }}
          actions={
            <s-button
              slot="primary-action"
              variant="primary"
              disabled={
                !copyTarget ||
                !product.views.some((item) => item.id === copyTarget && item.id !== copySourceData.view.id)
              }
              onClick={() => {
                const base = prepareSelectionChange();
                const source = base && locateOutlineItem(base, copySource);
                const destination = base?.views.find((item) => item.id === copyTarget);
                if (!base || !source?.placement || !destination || destination.id === source.view.id) return;
                const id = uid();
                const next = copyPlacementToView(base, source.view.id, copySource.id, copyTarget, id);
                const target = next.views.find((item) => item.id === copyTarget);
                if (!target) return;
                setProduct(next);
                if (dialog.kind === 'copy-placement') dispatchDialog({ type: 'dialog-closed', id: dialog.id });
                setGeometryInput(null);
                setOutlineQuery('');
                select(target, id, true, false);
                exitSizePreview();
                setNotice({ kind: 'message', reason: 'placement-copied' });
                focusName();
              }}
            >
              {translateUi('editor:placementWorkflowPreview.copyPlacement')}
            </s-button>
          }
        >
          <s-stack gap="base">
            <s-select
              label={translateUi('editor:placementWorkflowPreview.destinationView')}
              value={copyTarget}
              onChange={(event) => {
                if (dialog.kind === 'copy-placement')
                  dispatchDialog({
                    type: 'copy-placement-target-changed',
                    id: dialog.id,
                    targetViewId: event.currentTarget.value,
                  });
              }}
            >
              {product.views
                .filter((item) => item.id !== copySourceData.view.id)
                .map((item) => (
                  <s-option key={item.id} value={item.id}>
                    {item.name}
                  </s-option>
                ))}
            </s-select>
            <s-paragraph>
              {translateUi(
                'editor:placementWorkflowPreview.copiesTheArtworkAreaSizesMethodsAndPricesAdjustTheAreaToFitTheDestinationImage',
              )}
            </s-paragraph>
          </s-stack>
        </Dialog>
      )}
      {addingView && (
        <Dialog
          heading={
            variantImageTargets
              ? translateUi('editor:placementWorkflowPreview.chooseImageForView', {
                  viewName: view?.name || translateUi('editor:placementWorkflowPreview.viewNameFallback'),
                })
              : replacingImage
                ? translateUi('editor:placementWorkflowPreview.changeViewImage')
                : translateUi('editor:placementWorkflowPreview.addViews')
          }
          padding={pickerImages.length ? 'none' : 'base'}
          size={pickerImages.length ? 'large' : 'base'}
          onClose={closePhotoPicker}
          actions={
            <>
              {nextPhotoTarget && (
                <s-button
                  slot="secondary-actions"
                  variant="secondary"
                  disabled={imageProcessing || !imageSelectionReady}
                  accessibilityLabel={translateUi('editor:placementWorkflowPreview.useImageAndChooseAppearanceImage', {
                    viewName: view?.name || translateUi('editor:placementWorkflowPreview.viewNameFallback'),
                    appearanceName: nextPhotoTarget.label,
                  })}
                  onClick={() => assignVariantImage(true)}
                >
                  {translateUi('editor:placementWorkflowPreview.useAndNext')}
                </s-button>
              )}
              <s-button
                slot="primary-action"
                variant="primary"
                loading={imageProcessing}
                disabled={
                  imageProcessing ||
                  !imageSelectionReady ||
                  (choosingSingleImage
                    ? !pickerImages.some(
                        (image) =>
                          image.id === viewImage && (variantImageTargets !== null || image.url !== view?.imageUrl),
                      )
                    : !viewImages.length)
                }
                onClick={() => {
                  if (variantImageTargets) {
                    assignVariantImage();
                    return;
                  }
                  confirmViewImagePicker();
                }}
              >
                {variantImageTargets
                  ? variantImageTargets.length === 1
                    ? translateUi('editor:placementWorkflowPreview.useImage')
                    : translateUi('editor:placementWorkflowPreview.useForGroups', {
                        count: variantImageTargets.length,
                        formattedCount: new Intl.NumberFormat(formatLocale).format(variantImageTargets.length),
                      })
                  : replacingImage
                    ? translateUi('editor:placementWorkflowPreview.useImage')
                    : viewImages.length > 1
                      ? translateUi('editor:placementWorkflowPreview.addViewsCount', {
                          formattedCount: new Intl.NumberFormat(formatLocale).format(viewImages.length),
                          count: viewImages.length,
                        })
                      : translateUi('editor:placementWorkflowPreview.addView')}
              </s-button>
            </>
          }
        >
          <div class={pickerImages.length ? 'placement-image-dialog' : ''}>
            {variantImageTargets && (
              <div class="variant-image-target-summary" data-photo-target tabIndex={-1}>
                {variantImageTargets.length <= 3 ? (
                  <s-paragraph>
                    {translateUi(
                      variantImageTargets.length > 1
                        ? 'editor:placementWorkflowPreview.sameImageForGroupList'
                        : 'editor:placementWorkflowPreview.imageForGroupList',
                      {
                        count: photoTargetVariantCount,
                        groupNames: new Intl.ListFormat(formatLocale, { style: 'long', type: 'conjunction' }).format(
                          photoTargetGroups.map((group) => group.label),
                        ),
                        formattedVariantCount: new Intl.NumberFormat(formatLocale).format(photoTargetVariantCount),
                      },
                    )}
                  </s-paragraph>
                ) : (
                  <details>
                    <summary>
                      {translateUi('editor:placementWorkflowPreview.sameImageForGroupCount', {
                        count: variantImageTargets.length,
                        formattedCount: new Intl.NumberFormat(formatLocale).format(variantImageTargets.length),
                      })}
                    </summary>
                    <s-paragraph>
                      {new Intl.ListFormat(formatLocale, { style: 'long', type: 'conjunction' }).format(
                        photoGroups
                          .filter((group) => variantImageTargets.includes(group.key))
                          .map((group) => group.label),
                      )}
                    </s-paragraph>
                  </details>
                )}
              </div>
            )}
            <ImagePicker
              key={`${photoPicker.sessionId}:${photoPicker.pickerRevision}`}
              images={pickerImages}
              onBusyChange={(busy) => recordPickerProcessing(photoPicker.sessionId, photoPicker.pickerRevision, busy)}
              onSelectionReadyChange={(ready, imageIds) =>
                recordPickerReadiness(photoPicker.sessionId, photoPicker.pickerRevision, ready, imageIds)
              }
              selection={
                choosingSingleImage
                  ? {
                      kind: 'single',
                      value: viewImage,
                      onChange: (id) =>
                        recordPickerSelection(photoPicker.sessionId, photoPicker.pickerRevision, id ? [id] : []),
                    }
                  : {
                      kind: 'multiple',
                      values: viewImages,
                      onChange: (ids) => recordPickerSelection(photoPicker.sessionId, photoPicker.pickerRevision, ids),
                    }
              }
              usedBy={getProductImageUsage(product)}
              upload={adapter.upload}
              onUpload={(image) => recordPickerUpload(photoPicker.sessionId, photoPicker.pickerRevision, image)}
            />
          </div>
        </Dialog>
      )}
    </div>
  );
}

