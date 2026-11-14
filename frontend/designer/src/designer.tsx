import { ARTWORK_UPLOAD_ACCEPT } from '@insignia/contracts';
import type { SupportedLanguage } from '@insignia/ui-localization/core';
import { selectedLanguagePreference } from '@insignia/ui-localization/core';
import type { CustomerWordingOverlay } from '@insignia/ui-localization/customer';
import type { ComponentChildren, TargetedDragEvent, TargetedEvent } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { ColorPicker } from './color-picker';
import { commitFailureView } from './commit-failure';
import { FloatingSelect } from './compact-fields';
import type { ProductConfig } from './config';
import { LocaleProvider, useLocale } from './customer-locale';
import {
  type CreateDesignerStateInput,
  createDesignerState,
  type DesignerEvent,
  type DesignerState,
  designerReducer,
  canCommitDesign,
  hasDraftChanges,
  hasUnappliedDraft,
  isProductionChoicesValid,
  productDesignEditRequiresConfirmation,
  type UploadFailureReason,
} from './designer-state';
import { ArtworkFile, FileName, useArtworkName } from './file-name';
import { GarmentIllustration, swatchInk } from './garment-preview';
import { InlineArtwork, InlinePositionControls } from './inline-positioning';
import { CustomerLanguagePicker } from './language-picker';
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCloudUpload,
  IconFrame,
  IconShoppingCart,
  IconX,
} from './legacy-icons';
import type { Artwork, ColorId, Design, Position, PositionId, Print, Quantities, View } from './model';
import { createProductModel, isValidQuantity } from './model';
import { resolveOptionPresentation } from './option-presentation';
import {
  isArtworkCenterAllowed,
  printSizeLabel,
  printWidthPercent,
  printWidthPercentForArtwork,
  resolvePrintCenter,
} from './position-geometry';
import { PositionPicker } from './position-picker';
import { QuantityEntry } from './quantity-entry';
import { quantityLayout } from './quantity-layout';
import { type DesignerQuoteReview, quoteReviewMoney } from './quote-review';
import { ReviewPanel } from './review-panel';
import { type CartReceipt, createDesignerRuntime, designerIntentKey, type DesignerPorts } from './runtime';
import { ThemeControl } from './theme';
import { useCustomerLanguage } from './use-customer-language';
import { type ValidationIssue, ValidationSummary } from './validation-summary';

export interface ClosedDesignerProps {
  completion: CartReceipt | null;
  hasDraft: boolean;
  editing: string | null;
  switchingDesign: string | null;
  onResume: () => void;
  onStartNew: () => void;
  onEdit: (design: Design) => void;
  onCancelSwitch: () => void;
  onConfirmSwitch: () => void;
}
export interface DesignerProps {
  /** Refresh an expired preview without changing production choices or reviewed prices. */
  onPreviewFailure?: (url: string) => void;
  quoteReview?: DesignerQuoteReview;
  onCartCompletion?: (receipt: CartReceipt, automatic: boolean) => void;
  suspended?: boolean;
  /** Host Escape/close intent. The reducer decides whether to confirm or close. */
  requestCloseSignal?: number;
  /**
   * The host shows the Designer to the buyer; each new object applies once. Focus enters the Designer unless a
   * dialog already owns it: the visible skip link when opened by keyboard, the Designer itself when by pointer.
   */
  entryFocusSignal?: { keyboard: boolean };
  hostErrorSignal?: number;
  cartReviewedSignal?: number;
  /** The host observed this design's cart line change outside the Designer; each new object applies once. */
  observedCartLine?: { design: Design };
  requiresCartReview?: boolean;
  onSelectQuoteGroup?: (id: string) => void;
  config: ProductConfig;
  ports: DesignerPorts;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  initialPrints?: readonly Print[];
  initialDesign?: Design;
  initialBaseline?: Design;
  initialArtworks?: readonly Artwork[];
  /** An unfinished design from an earlier page load; it opens behind "Continue your design?" (#347). */
  resumeDraft?: Design;
  /** The buyer chose Start new over the offered design. */
  onDraftDiscarded?: () => void;
  /** An earlier unfinished design could not be restored and was discarded; the clean Designer says so. */
  draftUnavailable?: boolean;
  previewOnly?: boolean;
  /** Active Shopify page language; missing context falls back to browser language, then English. */
  locale?: string | undefined;
  /** Sparse merchant-authored customer wording for one exact locale. */
  wordingOverlay?: CustomerWordingOverlay | null;
  /** Called after a manual language choice is active; null follows the host locale. */
  onLanguagePreferenceChange?: (language: SupportedLanguage | null) => void;
  /** App-owned context supplied only by the separate editor artwork preview. */
  previewContextLabel?: string;
  /** App-owned notice supplied by the separate editor artwork preview. */
  previewNotice?: string;
  /** Localized app fallback for the selected editor preview's generic image. */
  previewProductImageLabel?: string;
  allowUnload?: boolean;
  renderClosed?: (props: ClosedDesignerProps) => ComponentChildren;
  /** Keep the selected view behind an external host confirmation, inert and paused. */
  retainViewForConfirmation?: boolean;
  /** The Designer is its document's only content (the storefront srcdoc frame): mirror its language there. */
  ownsDocumentLanguage?: boolean;
}
/** The controls Tab visits inside `root`, in order. */
function tabStops(root: HTMLElement) {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex]',
    ),
  ].filter(
    (target) =>
      target.tabIndex >= 0 &&
      !(target instanceof HTMLInputElement && target.type === 'radio' && !target.checked) &&
      target.getClientRects().length > 0 &&
      !target.closest('[hidden],[inert]'),
  );
}
/** Tab from the last control (Shift+Tab from the first) wraps inside `root` instead of leaving it. */
function wrapTab(event: KeyboardEvent, root: HTMLElement) {
  const targets = tabStops(root);
  const first = targets[0];
  const last = targets.at(-1);
  if (
    first &&
    last &&
    (event.shiftKey
      ? document.activeElement === first || !root.contains(document.activeElement)
      : document.activeElement === last || !root.contains(document.activeElement))
  ) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

export function Designer(props: DesignerProps) {
  const language = useCustomerLanguage({
    hostLocale: props.locale,
    wordingOverlay: props.wordingOverlay,
    onPreferenceChange: props.onLanguagePreferenceChange,
  });
  return (
    <LocaleProvider controller={language.controller}>
      <DesignerSession
        {...props}
        languagePreference={selectedLanguagePreference(language.state)}
        languageChangeFailed={language.state.status === 'failed'}
        onLanguagePreferenceSelect={language.selectPreference}
      />
    </LocaleProvider>
  );
}

interface DesignerSessionProps extends DesignerProps {
  languagePreference: SupportedLanguage | null;
  languageChangeFailed: boolean;
  onLanguagePreferenceSelect: (preference: SupportedLanguage | null) => void;
}

function DesignerSession({
  config: sourceConfig,
  ports,
  isOpen,
  onOpenChange,
  onCartCompletion,
  quoteReview: incomingQuoteReview,
  requiresCartReview,
  suspended = false,
  onSelectQuoteGroup,
  onPreviewFailure,
  hostErrorSignal,
  requestCloseSignal,
  entryFocusSignal,
  cartReviewedSignal,
  observedCartLine,
  initialPrints = [],
  initialArtworks = [],
  initialDesign,
  initialBaseline,
  resumeDraft,
  onDraftDiscarded,
  draftUnavailable = false,
  previewOnly = false,
  allowUnload = false,
  renderClosed,
  retainViewForConfirmation = false,
  ownsDocumentLanguage = false,
  previewContextLabel,
  previewNotice,
  previewProductImageLabel,
  languagePreference,
  languageChangeFailed,
  onLanguagePreferenceSelect,
}: DesignerSessionProps) {
  const { t, message, formatLocale, lang, dir } = useLocale();
  const artworkName = useArtworkName();
  useLayoutEffect(() => {
    if (!ownsDocumentLanguage) return;
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [ownsDocumentLanguage, lang, dir]);
  const config = useMemo(
    () =>
      sourceConfig.methods.some((method) => method.translations)
        ? {
            ...sourceConfig,
            methods: sourceConfig.methods.map((method) => {
              const text =
                method.translations?.[formatLocale] ?? method.translations?.[formatLocale.split('-')[0] ?? ''];
              return {
                ...method,
                label: text?.label ?? method.defaultLabel ?? method.label,
                description: text?.description ?? method.defaultDescription ?? method.description,
              };
            }),
          }
        : sourceConfig,
    [sourceConfig, formatLocale],
  );
  const accordionExample = initialPrints.length > 0;
  const { colors, sizes, positions, views } = config;
  const optionPresentation = resolveOptionPresentation(config.optionPresentation);
  const { rowOption } = optionPresentation;
  const rowOptionLabel =
    rowOption.labelSource === 'generic-selection'
      ? t('customer:options.selectionFallback')
      : (config.optionPresentation?.rowOption.label ?? t('customer:options.genericLabel'));
  const columnOptionLabel = config.optionPresentation?.columnOption.label ?? t('customer:options.genericLabel');
  const isNamedChoice = rowOption.display === 'named-choice' || colors.some((choice) => !choice.hex);
  const artworkOnly = previewOnly || config.artworkOnly === true;
  const quantityStepHeading = t('customer:steps.quantities');
  const quantitiesLayout = useMemo(() => quantityLayout(config), [config]);
  const firstPosition = positions[0];
  const firstColor = colors[0];
  const firstView = views[0];
  if (!firstPosition || !firstColor || !firstView) throw new Error('product-options-empty');
  const [workflow, dispatch] = useReducer<DesignerState, DesignerEvent, CreateDesignerStateInput>(
    designerReducer,
    {
      rules: {
        positions,
        ...(config.productionOptions
          ? {
              productionOptions: config.productionOptions.map((option) => ({
                id: option.id,
                valueIds: option.values.map((value) => value.id),
              })),
            }
          : {}),
        colorIds: colors.map((entry) => entry.id),
        sizeIds: sizes.map((entry) => entry.id),
        availableSizes: Object.fromEntries(colors.map((entry) => [entry.id, entry.availableSizeIds])),
        ...(config.variantMatrix ? { variantMatrix: config.variantMatrix } : {}),
        maxQuantity: config.maxQuantity,
        deferablePositions: positions
          .filter((entry) => entry.artworkLater ?? config.artworkLater)
          .map((entry) => entry.id),
      },
      view: accordionExample ? firstPosition.view : firstView.id,
      color: firstColor.id,
      prints: initialPrints,
      active: firstPosition.id,
      expanded: accordionExample ? firstPosition.id : null,
      artworks: initialArtworks,
      designerOpen: isOpen,
      ...(requiresCartReview ? { requiresCartReview: true } : {}),
      ...(initialDesign ? { initialDesign } : {}),
      ...(initialBaseline ? { initialBaseline } : {}),
      ...(resumeDraft ? { resumeDraft } : {}),
      ...(draftUnavailable ? { draftUnavailable } : {}),
    },
    createDesignerState,
  );
  const {
    step,
    view,
    color,
    prints,
    active,
    expanded,
    artworks,
    positionUndo,
    quantities,
    colorRows,
    editing,
    attemptedStep,
    modal,
    recovery,
  } = workflow;
  const model = useMemo(() => createProductModel(config, formatLocale, color), [config, formatLocale, color]);
  const {
    positionFor,
    methodFor,
    printPrice,
    unitPrice,
    totalPrice,
    money,
    imageFor,
    initialPrint,
    isSizeAvailable,
    isCombinationAvailable,
    canDeferArtwork,
  } = model;
  const quantityRowIds =
    quantitiesLayout.kind === 'compact' || quantitiesLayout.kind === 'single' ? colors.map((row) => row.id) : colorRows;
  const designerOpen = workflow.open;
  const modalKind = modal.kind === 'closed' ? null : modal.kind;
  const placementView = modal.kind === 'positions' ? modal.view : null;
  const colorMode = modal.kind === 'colors' ? modal.mode : 'choose';
  const uploading = workflow.upload.kind === 'reading';
  const uploadFileName = workflow.upload.kind === 'idle' ? undefined : workflow.upload.fileName;
  const retryFile = useRef<File | null>(null);
  const error = workflow.upload.kind === 'failed' ? uploadFailureMessage(workflow.upload.reason, workflow.upload.retryAfterSeconds) : '';
  useEffect(() => {
    if (workflow.upload.kind !== 'failed' || modal.kind !== 'artwork') return;
    // Recovery autofocus must yield to a newer keyboard or pointer focus choice.
    let focusMoved = false;
    const onFocus = () => {
      focusMoved = true;
    };
    document.addEventListener('focusin', onFocus);
    const frame = window.requestAnimationFrame(() => {
      document.removeEventListener('focusin', onFocus);
      if (!focusMoved) document.querySelector<HTMLButtonElement>('.upload-failure-actions button')?.focus();
    });
    return () => {
      document.removeEventListener('focusin', onFocus);
      window.cancelAnimationFrame(frame);
    };
  }, [workflow.upload.kind, modal.kind]);
  const notice =
    recovery.kind === 'none'
      ? ''
      : recovery.kind === 'removed-position'
        ? t('customer:recovery.artworkRemoved')
        : recovery.kind === 'removed-color'
          ? t('customer:recovery.colorItemsRemoved', {
              colorName:
                recovery.colorNameSource === 'generic-selection'
                  ? t('customer:options.selectionFallback')
                  : recovery.colorName,
            })
          : recovery.reason === 'draft-unavailable'
            ? t('customer:recovery.draftUnavailable')
            : t(`customer:recovery.${recovery.reason === 'artwork-restored' ? 'artworkRestored' : 'itemsRestored'}`);
  const removed = recovery.kind === 'removed-position' ? recovery.print : null;
  const removedColor =
    recovery.kind === 'removed-color'
      ? {
          id: recovery.color,
          index: recovery.index,
          quantities: recovery.quantities,
        }
      : null;
  const [focusPrint, setFocusPrint] = useState(
    () => !accordionExample && window.matchMedia('(max-width:780px)').matches,
  );
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [failedArtworks, setFailedArtworks] = useState<ReadonlySet<string>>(new Set());
  const [imageDimensions, setImageDimensions] = useState<Record<string, { width: number; height: number } | null>>({});
  const summaryRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const skipLinkRef = useRef<HTMLAnchorElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const previousStep = useRef(step);
  const workflowRef = useRef(workflow);
  workflowRef.current = workflow;
  const runtime = useMemo(
    () =>
      createDesignerRuntime(
        ports,
        () => workflowRef.current,
        dispatch,
        resumeDraft ? { resumeDraftId: resumeDraft.id } : undefined,
      ),
    [ports],
  );
  useLayoutEffect(() => {
    if (cartReviewedSignal) dispatch({ type: 'cart-review-satisfied' });
  }, [cartReviewedSignal]);
  // The host saves the unfinished design shortly after it changes, not only at Review (#366).
  useEffect(() => {
    runtime.reportDraft();
  }, [workflow, runtime]);
  useLayoutEffect(() => {
    if (hostErrorSignal) dispatch({ type: 'review-navigation-failed' });
  }, [hostErrorSignal]);
  useLayoutEffect(() => {
    if (observedCartLine) dispatch({ type: 'cart-line-observed', design: observedCartLine.design });
  }, [observedCartLine]);
  const quoteReview = incomingQuoteReview?.intentId === runtime.reviewIntentId ? incomingQuoteReview : undefined;
  const [, expirePresentation] = useState(0);
  // An expired displayed proposal keeps its total and Add: the cart port re-proposes on Add and
  // continues in the same click only for an unchanged material hash (owner decision, 10 Nov 2026).
  const quoteExpired = !!quoteReview && runtime.expired;
  useEffect(() => {
    if (!quoteReview?.expiresAt || quoteExpired) return;
    const timer = window.setTimeout(() => expirePresentation((n) => n + 1), Math.max(0, Date.parse(quoteReview.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [quoteReview?.expiresAt, quoteExpired]);
  // Returning to the tab re-proposes an expired quote once. No periodic timer: an idle Designer must
  // not spend the per-session proposal budget (128) while nobody is looking.
  useEffect(() => {
    if (!ports.review || !designerOpen || suspended) return;
    const visible = () => {
      if (document.visibilityState === 'visible') runtime.refreshExpired();
    };
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [designerOpen, suspended, runtime, ports]);
  useLayoutEffect(() => {
    if (!requestCloseSignal) return;
    // A host close request (outer Escape, system back) follows the Escape rule:
    // an open nested dialog closes first.
    if (workflowRef.current.open && workflowRef.current.modal.kind !== 'closed') requestCloseModal();
    else requestReturnToProduct();
  }, [requestCloseSignal]);
  useEffect(() => {
    // Opening moves focus from the host's iframe element to a visible control inside the Designer. A dialog
    // that opened with it (resume prompt, close decision) has already chosen its own control.
    if (!entryFocusSignal || suspended || !workflowRef.current.open || workflowRef.current.modal.kind !== 'closed')
      return;
    // A pointer open must not pop the skip link over the header; Tab from the Designer still reaches it first.
    (entryFocusSignal.keyboard ? skipLinkRef.current : appRef.current)?.focus({ preventScroll: true });
  }, [entryFocusSignal]);
  const reviewIntent = designerIntentKey(workflow);
  const beforeQuantities = step === 0;
  const eagerReviewStarted = useRef(false);
  useLayoutEffect(() => {
    if (beforeQuantities || !designerOpen) eagerReviewStarted.current = false;
    if (!ports.review || !designerOpen || suspended || beforeQuantities || eagerReviewStarted.current)
      return () => runtime.cancelPreparation();
    // Use the existing real review port while quantities settle. Entering Review
    // reuses this request; editing/closing cancels only preparation, never a cart write.
    const timer = window.setTimeout(() => {
      if (eagerReviewStarted.current) return;
      const state = {...workflowRef.current, step:2 as const};
      if (!canCommitDesign(state)) return;
      // A multi-size matrix can involve many edits. Speculate once per visit,
      // rather than consuming a draft/proposal slot on every typing pause.
      eagerReviewStarted.current = true;
      void runtime.commit(true);
    }, 350);
    return () => { clearTimeout(timer); runtime.cancelPreparation(); };
  }, [reviewIntent, beforeQuantities, designerOpen, suspended, runtime]);
  // Retire the old intent before starting an explicit review. A passive cleanup
  // here could otherwise abort the newer request after the layout phase.
  useLayoutEffect(() => {
    if (step === 2 && ports.review && designerOpen && !suspended) {
      eagerReviewStarted.current = true;
      void runtime.commit(true);
    }
  }, [step, reviewIntent, designerOpen, suspended, runtime]);

  const previewRenewals = useRef(new Set<string>());
  const artworkUrls = useRef(new Map<string, string>());
  useEffect(() => {
    const changed = artworks.filter((artwork) => artwork.url && artworkUrls.current.has(artwork.id) && artworkUrls.current.get(artwork.id) !== artwork.url);
    artworkUrls.current = new Map(artworks.map((artwork) => [artwork.id, artwork.url]));
    if (changed.length) setFailedArtworks((current) => new Set([...current].filter((id) => !changed.some((artwork) => artwork.id === id))));
  }, [artworks]);
  useEffect(() => {
    if (!designerOpen || suspended) { previewRenewals.current.clear(); runtime.cancel(); return; }
    if (!ports.artwork.renew) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const artwork of artworks) {
      if (!artwork.previewExpiresAt || !Number.isFinite(Date.parse(artwork.previewExpiresAt))) continue;
      const visible = modal.kind === 'artwork' || prints.some((print) => print.artworkId === artwork.id && positions.find((position) => position.id === print.id)?.view === view);
      const key = `${artwork.id}:${artwork.previewExpiresAt}`;
      if (!visible || previewRenewals.current.has(key)) continue;
      timers.push(setTimeout(() => {
        previewRenewals.current.add(key);
        void runtime.renew(artwork).then((renewed) => {
          if (renewed) setFailedArtworks((current) => new Set([...current].filter((id) => id !== artwork.id)));
        });
      }, Math.max(0, Math.min(2147483647, Date.parse(artwork.previewExpiresAt) - Date.now()))));
    }
    return () => timers.forEach(clearTimeout);
  }, [artworks, designerOpen, suspended, modal.kind, prints, view, runtime, ports]);

  function uploadFailureMessage(reason: UploadFailureReason, retryAfterSeconds?: number): string {
    switch (reason) {
      case 'file-too-large':
        return t('customer:artwork.uploadTooLarge', { maxSizeMb: 5 });
      case 'unsupported-file-type':
        return t('customer:artwork.uploadUnsupportedType');
      case 'upload-failed': return t('customer:artwork.uploadFailed');
      case 'processing-failed': return t('customer:artwork.processingFailed');
      case 'processing-timeout': return t('customer:artwork.processingTimeout');
      case 'inspection-rejected': return t('customer:artwork.inspectionRejected');
      case 'dimensions-too-large': return t('customer:artwork.dimensionsTooLarge', { maxEdgePx: 12000, maxMegapixels: 40 });
      case 'artwork-expired': return t('customer:artwork.artworkExpired');
      // Whole minutes, rounded up; without Retry-After the one-hour window is the longest wait.
      case 'session-limited': return t('customer:artwork.sessionLimited', { count: Math.ceil((retryAfterSeconds ?? 3600) / 60) });
      // The owner's upload quota: name its wait when the server sent one (#337).
      case 'rate-limited':
        return retryAfterSeconds
          ? t('customer:artwork.uploadRateLimitedWait', { count: Math.ceil(retryAfterSeconds / 60) })
          : t('customer:artwork.uploadRateLimited');
      case 'read-failed':
        return t('customer:artwork.uploadReadFailed');
    }
  }

  function positionConstraintMessage(
    reason: 'preview-unavailable' | 'loading-previews' | undefined,
  ): string | undefined {
    if (reason === 'preview-unavailable') return t('customer:artwork.selectedPreviewFailed');
    if (reason === 'loading-previews') return t('customer:artwork.loadingPreviews');
    return undefined;
  }

  function colorName(entry: ProductConfig['colors'][number] | undefined): string {
    if (!entry) return t('customer:options.genericLabel');
    if (entry.nameSource === 'admin-preview-product-image') return previewProductImageLabel ?? entry.name;
    return entry.nameSource === 'generic-selection' ? t('customer:options.selectionFallback') : entry.name;
  }
  useEffect(() => () => runtime.cancel(), [runtime]);
  useLayoutEffect(() => {
    if (workflowRef.current.open === isOpen) return;
    runtime.cancel();
    dispatch({ type: 'location-observed', designerOpen: isOpen });
  }, [isOpen, runtime]);
  const availableQuantityKeys = useMemo(
    () =>
      new Set(quantitiesLayout.cells.filter((cell) => cell.available).map((cell) => `${cell.rowId}:${cell.sizeId}`)),
    [quantitiesLayout],
  );
  const hasUnavailableQuantities = Object.entries(quantities).some(
    ([key, value]) => (value ?? 0) !== 0 && !availableQuantityKeys.has(key),
  );
  const hasQuantityErrors =
    hasUnavailableQuantities ||
    Object.values(quantities).some((value) => !isValidQuantity(value ?? 0, config.maxQuantity));
  const qty = Object.values(quantities).reduce<number>(
    (sum, value) => sum + (isValidQuantity(value ?? 0, config.maxQuantity) ? (value ?? 0) : 0),
    0,
  );
  function colorQuantity(id: ColorId): number {
    return sizes.reduce((sum, size) => {
      const value = quantities[`${id}:${size.id}`] ?? 0;
      return sum + (isValidQuantity(value, config.maxQuantity) ? value : 0);
    }, 0);
  }
  const unit = unitPrice(prints);
  const policy = positionFor(active);
  function positioningColorIds(): ColorId[] {
    const ordered = colorRows.filter((id) => colorQuantity(id) > 0);
    return [...new Set(step === 0 || !ordered.length ? [color, ...ordered] : ordered)];
  }
  function imageAspectFor(position: Position, colorId = color): number | null {
    if (config.preview !== 'photo') return 1;
    const src = imageFor(colorId, position.view);
    const dimensions = src ? imageDimensions[src] : undefined;
    return dimensions
      ? dimensions.width / dimensions.height
      : (config.colors.find((row) => row.id === colorId)?.imageAspects?.[position.view] ?? null);
  }
  const movementImageSources = useMemo(
    () => [
      ...new Set(
        [...new Set([color, ...colorRows])].flatMap((colorId) =>
          positions
            .filter((entry) => entry.movementArea)
            .flatMap((entry) => {
              const src = model.imageFor(colorId, entry.view);
              return src ? [src] : [];
            }),
        ),
      ),
    ],
    [model, positions, color, colorRows],
  );
  useEffect(() => {
    let live = true;
    const images: HTMLImageElement[] = [];
    void Promise.all(
      movementImageSources.map(
        (src) =>
          new Promise<{
            src: string;
            dimensions: { width: number; height: number } | null;
          }>((resolve) => {
            const image = new Image();
            images.push(image);
            image.onload = () =>
              resolve({
                src,
                dimensions:
                  image.naturalWidth > 0 && image.naturalHeight > 0
                    ? { width: image.naturalWidth, height: image.naturalHeight }
                    : null,
              });
            image.onerror = () => {
              onPreviewFailure?.(src);
              resolve({ src, dimensions: null });
            };
            image.src = src;
          }),
      ),
    ).then((results) => {
      if (!live) return;
      setImageDimensions((current) => {
        const next = { ...current };
        for (const result of results) next[result.src] = result.dimensions;
        return next;
      });
    });
    return () => {
      live = false;
      for (const image of images) {
        image.onload = null;
        image.onerror = null;
      }
    };
  }, [movementImageSources]);
  function positionImageConstraints(position: Position) {
    const colorIds = positioningColorIds();
    const aspects = colorIds.map((id) => imageAspectFor(position, id));
    const unavailable =
      config.preview === 'photo' &&
      colorIds.some((id) => {
        const src = imageFor(id, position.view);
        return !src || imageDimensions[src] === null;
      });
    const complete = aspects.every((aspect): aspect is number => aspect !== null);
    return {
      aspects: complete ? aspects : [],
      messageReason: unavailable ? 'preview-unavailable' : !complete ? 'loading-previews' : undefined,
    } satisfies {
      aspects: number[];
      messageReason: 'preview-unavailable' | 'loading-previews' | undefined;
    };
  }
  function positionIsValid(print: Print): boolean {
    const position = positionFor(print.id);
    const movementArea = position.movementArea;
    const art = artworks.find((entry) => entry.id === print.artworkId);
    if (!art) return true;
    if (failedArtworks.has(art.id)) return false;
    if (!movementArea) return true;
    return positioningColorIds().every((colorId) => {
      const rowPosition = model.positionFor(print.id, colorId);
      const movementArea = rowPosition.movementArea;
      if (!movementArea) return !print.position;
      const aspect = imageAspectFor(rowPosition, colorId);
      return (
        aspect !== null &&
        isArtworkCenterAllowed(
          resolvePrintCenter(rowPosition, print),
          movementArea,
          printWidthPercentForArtwork(rowPosition, print.size, art.width / art.height, aspect),
          art.width / art.height,
          aspect,
        )
      );
    });
  }
  const productionReady = isProductionChoicesValid(workflow);
  const ready =
    prints.length > 0 &&
    prints.every(
      (p) =>
        (artworks.some((a) => a.id === p.artworkId) || (canDeferArtwork(p.id) && p.artworkId === 'later')) &&
        positionIsValid(p),
    );
  const artworkIssues: ValidationIssue[] = prints
    .filter(
      (p) =>
        (!artworks.some((a) => a.id === p.artworkId) && !(canDeferArtwork(p.id) && p.artworkId === 'later')) ||
        !positionIsValid(p),
    )
    .map((p) => ({
      target: positionIsValid(p) ? `artwork-${p.id}` : `adjust-position-${p.id}`,
      position: p.id,
      message: positionIsValid(p)
        ? t('customer:validation.chooseArtworkForPosition', {
            positionName: positionFor(p.id).name,
          })
        : (positionConstraintMessage(positionImageConstraints(positionFor(p.id)).messageReason) ??
          t('customer:validation.adjustArtworkForPosition', {
            positionName: positionFor(p.id).name,
          })),
    }));
  const validationIssues: ValidationIssue[] =
    attemptedStep !== step
      ? []
      : [
          ...artworkIssues,
          ...(step === 1
            ? quantityRowIds.flatMap((c) =>
                sizes
                  .filter((size) => !isValidQuantity(quantities[`${c}:${size.id}`] ?? 0, config.maxQuantity))
                  .map((size) => ({
                    target: `quantity-${c}-${size.id}`,
                    message: t('customer:validation.quantityForSelection', {
                      rowName: colorName(colors.find((color) => color.id === c)),
                      sizeLabel: size.label,
                      maxQuantity: config.maxQuantity,
                    }),
                  })),
              )
            : []),
        ];
  if (attemptedStep === 1 && step === 1 && !qty && !hasQuantityErrors) {
    const first = quantityRowIds.flatMap((c) =>
      sizes.filter((size) => isSizeAvailable(c, size.id)).map((size) => ({ c, size })),
    )[0];
    if (first)
      validationIssues.push({
        target: `quantity-${first.c}-${first.size.id}`,
        message: t('customer:validation.enterQuantity'),
      });
  }
  if (attemptedStep === 1 && step === 1 && hasUnavailableQuantities) {
    validationIssues.push({
      target: 'quantity-unavailable-selections',
      message: t('customer:validation.removeUnavailableSelections'),
    });
  }
  if (attemptedStep === 1 && step === 1)
    for (const option of config.productionOptions ?? [])
      if (!option.values.some((value) => value.id === workflow.productionChoices[option.id]))
        validationIssues.push({
          target: `production-${option.id}`,
          message: t('customer:artwork.chooseOption') + ': ' + option.label,
        });
  function showValidation() {
    dispatch({ type: 'validation-attempted', step });
    window.requestAnimationFrame(() => {
      summaryRef.current?.focus({ preventScroll: true });
      summaryRef.current?.scrollIntoView({ block: 'start' });
    });
  }
  function navigateIssue(issue: ValidationIssue) {
    if (issue.position) {
      selectPosition(issue.position);
      dispatch({ type: 'step-selected', step: 0 });
    }
    window.requestAnimationFrame(() => {
      const target = document.getElementById(issue.target);
      (target?.closest('label') ?? target)?.scrollIntoView({ block: 'center' });
      target?.focus({ preventScroll: true });
    });
  }
  function openModal(value: Exclude<DesignerState['modal'], { kind: 'closed' }>) {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dispatch({ type: 'modal-opened', modal: value });
  }
  function keepUploading() {
    dispatch({ type: 'upload-continue-requested' });
    window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.upload-cancel')?.focus());
  }
  function requestCloseModal() {
    const state = workflowRef.current;
    if (state.modal.kind === 'confirm-upload-cancel') {
      keepUploading();
      return;
    }
    if (state.modal.kind === 'artwork' && state.upload.kind === 'reading') {
      dispatch({ type: 'upload-close-requested' });
      return;
    }
    closeModal();
  }
  function confirmUploadCancellation() {
    const state = workflowRef.current;
    if (state.modal.kind !== 'confirm-upload-cancel') return;
    runtime.cancelUpload();
    if (state.modal.destination === 'customizer') returnToProduct();
    else closeModal();
  }
  function closeModal() {
    runtime.cancelUpload();
    dispatch({ type: 'modal-closed' });
    restoreFocus();
  }
  function restoreFocus() {
    window.requestAnimationFrame(() => {
      if (opener.current?.isConnected) opener.current.focus();
      else {
        const target =
          document.querySelector<HTMLElement>('.print-card.active .print-card-heading') ?? panelRef.current;
        target?.focus();
      }
    });
  }
  useEffect(() => {
    // A design the buyer lost stays explained until dismissed; undo and restore confirmations expire.
    if (recovery.kind === 'none' || (recovery.kind === 'message' && recovery.reason === 'draft-unavailable')) return;
    const token = recovery.token;
    const timer = window.setTimeout(() => {
      dispatch({ type: 'recovery-expired', token });
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [recovery]);
  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 });
    if (previousStep.current !== step && window.matchMedia('(max-width:780px)').matches)
      panelRef.current?.scrollIntoView({ block: 'start' });
    previousStep.current = step;
  }, [step]);
  useEffect(() => {
    const viewport = window.matchMedia('(max-width:780px)');
    const onChange = (event: MediaQueryListEvent) => setFocusPrint(event.matches);
    viewport.addEventListener('change', onChange);
    return () => viewport.removeEventListener('change', onChange);
  }, []);
  useEffect(() => {
    if (modal.kind === 'closed' || !designerOpen) return;
    const dialog = document.querySelector<HTMLDialogElement>('dialog');
    dialog?.showModal();
    if (modal.kind === 'confirm-close' || modal.kind === 'confirm-upload-cancel' || modal.kind === 'resume-draft') dialog?.querySelector<HTMLButtonElement>('[data-keep-editing]')?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestCloseModal();
      }
      if (event.key === 'Tab' && dialog) wrapTab(event, dialog);
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [modal, designerOpen]);
  useEffect(() => {
    // The host dialog cannot see keys pressed in this frame: Tab past the last control would leave
    // the dialog for the page behind it, so the Designer wraps focus itself.
    const root = appRef.current;
    if (!root || modal.kind !== 'closed' || !designerOpen || suspended || artworkOnly) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && !event.defaultPrevented) wrapTab(event, root);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modal, designerOpen, suspended, artworkOnly]);
  useEffect(() => {
    if (modal.kind !== 'closed' || !designerOpen || artworkOnly) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && workflowRef.current.open && workflowRef.current.modal.kind === 'closed') {
        event.preventDefault();
        requestReturnToProduct();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modal, designerOpen, artworkOnly]);
  function selectPosition(id: PositionId) {
    dispatch({ type: 'position-selected', positionId: id });
    setFocusPrint(window.matchMedia('(max-width:780px)').matches);
  }
  function printSizeDisplayLabel(position: Position, sizeIndex: number): string {
    return printSizeLabel(position, sizeIndex, (dimension) =>
      t('customer:positioning.centimeters', { dimension: String(dimension) }),
    );
  }
  function sizePriceLabel(position: Position, print: Print, sizeIndex: number): string {
    if (artworkOnly) return '';
    if (position.methodSizePrices) {
      if (!isCombinationAvailable(position.id, sizeIndex, print.method)) return t('customer:chrome.unavailable');
      const exact = printPrice({ ...print, size: sizeIndex });
      return exact === 0 ? t('customer:chrome.included') : `+${money(exact)}`;
    }
    const price = position.sizePrices[sizeIndex] ?? 0;
    return price > 0 ? `+${money(price)}` : '';
  }
  function methodPriceLabel(position: Position, methodId: string): string {
    if (artworkOnly) return '';
    if (position.methodSizePrices) {
      const prices = position.dimensions.flatMap((_, sizeIndex) =>
        isCombinationAvailable(position.id, sizeIndex, methodId)
          ? [
              printPrice({
                ...initialPrint(position.id),
                size: sizeIndex,
                method: methodId,
              }),
            ]
          : [],
      );
      return prices.length
        ? t('customer:chrome.fromPrice', { price: money(Math.min(...prices)) })
        : t('customer:chrome.unavailable');
    }
    const surcharge = methodFor(methodId).surcharge;
    return surcharge > 0 ? `+${money(surcharge)}` : '';
  }
  function artworkFitsSize(position: Position, print: Print, sizeIndex: number, art: Artwork | undefined): boolean {
    if (!art) return true;
    if (failedArtworks.has(art.id)) return false;
    return positioningColorIds().every((colorId) => {
      const rowPosition = model.positionFor(print.id, colorId);
      const movementArea = rowPosition.movementArea;
      if (!movementArea) return !print.position;
      const aspect = imageAspectFor(rowPosition, colorId);
      if (aspect === null) return false;
      const width = printWidthPercentForArtwork(position, sizeIndex, art.width / art.height, aspect);
      return (
        width > 0 &&
        (!position.movementArea ||
          isArtworkCenterAllowed(
            resolvePrintCenter(position, print),
            position.movementArea,
            width,
            art.width / art.height,
            aspect,
          ))
      );
    });
  }
  function commitPosition(next: Print) {
    dispatch({
      type: 'position-committed',
      positionId: next.id,
      size: next.size,
      position: next.position,
    });
  }
  function undoPosition(id: PositionId) {
    dispatch({ type: 'position-undone', positionId: id });
  }
  function clearPositionUndo(id: PositionId) {
    dispatch({ type: 'position-undo-cleared', positionId: id });
  }
  function inlineConstraints(position: Position, art: Artwork) {
    const constraints = positionImageConstraints(position);
    return {
      aspects: failedArtworks.has(art.id) ? [] : constraints.aspects,
      message: failedArtworks.has(art.id)
        ? t('customer:artwork.unavailable')
        : positionConstraintMessage(constraints.messageReason),
    };
  }
  function addPosition(id: PositionId) {
    dispatch({ type: 'position-added', print: initialPrint(id) });
    selectPosition(id);
    closeModal();
  }
  function requestPosition(viewId?: View) {
    const available = positions.filter(
      (position) => !prints.some((p) => p.id === position.id) && (!viewId || position.view === viewId),
    );
    if (available.length === 1 && available[0]) addPosition(available[0].id);
    else if (available.length) {
      openModal({ kind: 'positions', view: viewId ?? null });
    }
  }
  function removePrint(id: PositionId) {
    dispatch({ type: 'position-removed', positionId: id });
    window.requestAnimationFrame(() => {
      const next =
        panelRef.current?.querySelector<HTMLElement>('.print-card.active .print-card-heading, .empty-state button') ??
        panelRef.current;
      next?.focus();
    });
  }
  function applyArtwork(id: string, positionId: PositionId = active) {
    if (id === 'later' && !canDeferArtwork(positionId)) return;
    if (ports.artwork.apply && id !== 'later') {
      void runtime.apply(id, positionId).then(() => {
        if (workflowRef.current.open && workflowRef.current.modal.kind === 'closed') restoreFocus();
      });
      return;
    }
    dispatch({ type: 'artwork-applied', positionId, artworkId: id });
    closeModal();
  }
  function cancelArtworkUpload() {
    runtime.cancelUpload();
    window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.upload-zone button')?.focus());
  }
  async function upload(file: File | undefined) {
    if (!file) return;
    const target = modal.kind === 'artwork' ? modal.positionId : active;
    retryFile.current = file;
    if (fileRef.current) fileRef.current.value = '';
    await runtime.upload(file, target);
    if (workflowRef.current.open && workflowRef.current.modal.kind === 'closed') restoreFocus();
  }
  function onDrop(event: TargetedDragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (!uploading) void upload(event.dataTransfer?.files[0]);
  }
  function changeQuantity(c: ColorId, size: string, value: number) {
    if (!isSizeAvailable(c, size)) return;
    dispatch({ type: 'quantity-entered', color: c, size, value });
  }
  function goNext() {
    if (!ready || (step === 1 && (hasQuantityErrors || !qty || !productionReady))) {
      showValidation();
      return;
    }
    dispatch({ type: 'step-advanced' });
  }
  function addToCart() {
    if (artworkOnly) return;
    if (!ready || !qty || hasQuantityErrors || !productionReady) {
      showValidation();
      return;
    }
    if (workflow.modal.kind !== 'closed') return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void runtime.commit();
  }
  const sentCompletion = useRef<string>();
  const cartCompletion = workflow.completion?.authority === 'shopify' ? workflow.completion : null;
  // Only the reducer's matching applied receipt can close the host session.
  useLayoutEffect(() => {
    if (!workflow.completion) return;
    runtime.cancelUpload();
    if (workflow.completion.authority === 'shopify') {
      if (sentCompletion.current !== workflow.completion.requestId) {
        sentCompletion.current = workflow.completion.requestId;
        onCartCompletion?.(workflow.completion, true);
      }
    } else onOpenChange(false);
  }, [workflow.completion]);
  function newDesign() {
    runtime.startNewDesign();
    dispatch({ type: 'new-design-requested' });
    closeModal();
  }
  function requestReturnToProduct() {
    const event: DesignerEvent = { type: 'close-requested' };
    const next = designerReducer(workflowRef.current, event);
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dispatch(event);
    if (!next.open) {
      runtime.cancel();
      onOpenChange(false);
    }
  }
  /**
   * ARTWORK_EXPIRED does not say which artwork expired. With a single uploaded artwork, or a single one whose file
   * is past its known expiry, open that placement's artwork dialog; otherwise return to the Design step.
   */
  function replaceExpiredArtwork() {
    const state = workflowRef.current;
    const uploaded = state.prints.filter((print) => print.artworkId !== null && print.artworkId !== 'later');
    const expired = uploaded.filter((print) => {
      const expiresAt = state.artworks.find((artwork) => artwork.id === print.artworkId)?.assetExpiresAt;
      return !!expiresAt && Date.parse(expiresAt) <= Date.now();
    });
    const target = expired.length === 1 ? expired[0] : uploaded.length === 1 ? uploaded[0] : undefined;
    dispatch({ type: 'step-selected', step: 0 });
    if (target) openModal({ kind: 'artwork', positionId: target.id });
  }
  function returnToProduct() {
    dispatch({ type: 'product-return-requested' });
    runtime.cancel();
    onOpenChange(false);
    window.requestAnimationFrame(() => document.getElementById('host-personalise')?.focus());
  }
  function openDesigner() {
    dispatch({ type: 'designer-reopened' });
    onOpenChange(true);
    window.requestAnimationFrame(() => panelRef.current?.focus());
  }
  function chooseColor(id: ColorId) {
    dispatch({ type: 'color-selected', color: id });
  }
  function requestProductDesignEdit(design: Design) {
    const needsConfirmation = productDesignEditRequiresConfirmation(workflow, design.id);
    dispatch({ type: 'product-design-edit-requested', design });
    if (!needsConfirmation) {
      onOpenChange(true);
      window.requestAnimationFrame(() => panelRef.current?.focus());
    }
  }
  function cancelProductDesignSwitch() {
    dispatch({ type: 'modal-closed' });
  }
  function confirmProductAction() {
    if (workflow.modal.kind !== 'switch-design') return;
    dispatch({ type: 'product-design-switch-confirmed' });
    onOpenChange(true);
    window.requestAnimationFrame(() => panelRef.current?.focus());
  }
  const unappliedDraft = hasUnappliedDraft(workflow);
  const quoteStatus = ports.review && (!editing || unappliedDraft) &&
    (!runtime.prepared || quoteReview?.totalMinor === undefined)
    ? workflow.commit.kind === 'failed'
      ? 'unavailable'
      : quoteExpired
        ? quoteReview?.totalMinor === undefined ? 'unavailable' : undefined
        : 'loading'
    : undefined;
  const footerBusy = workflow.commit.kind === 'pending' || (step === 2 && workflow.commit.kind === 'preparing');
  // A failed review or Add to cart: its copy and the one action that helps come from its cause (#335, #337).
  const failureView = workflow.commit.kind === 'failed' ? commitFailureView(workflow.commit, formatLocale) : undefined;
  // The add/update action Review offers; after a failed add, Retry repeats it.
  const addLabel = editing ? (unappliedDraft ? t('customer:steps.updateCart') : t('customer:steps.done')) : t('customer:steps.addToCart');
  const failureActions = {
    'retry-review': { label: t('common:actions.retry'), run: () => void runtime.commit(true), cart: true },
    'retry-add': { label: addLabel, run: editing && !unappliedDraft ? returnToProduct : addToCart, cart: true },
    'edit-quantities': { label: t('customer:review.editQuantities'), run: () => dispatch({ type: 'step-selected', step: 1 }), cart: false },
    'replace-artwork': { label: t('customer:recovery.replaceArtwork'), run: replaceExpiredArtwork, cart: false },
    'edit-design': { label: t('customer:recovery.editDesign'), run: () => dispatch({ type: 'step-selected', step: 0 }), cart: false },
    close: { label: t('common:actions.close'), run: requestReturnToProduct, cart: false },
  } as const;
  // On Review, a failure's primary action comes only from its view (#337).
  const failureAction = step === 2 && failureView ? failureActions[failureView.action] : undefined;
  const dirtyDraft = hasDraftChanges(workflow);
  useEffect(() => {
    if ((!dirtyDraft && !uploading) || allowUnload || previewOnly) return;
    const handle = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handle);
    return () => window.removeEventListener('beforeunload', handle);
  }, [dirtyDraft, uploading, allowUnload, previewOnly]);
  const focused =
    step === 0 && expanded
      ? prints.find(
          (p) =>
            p.id === expanded && p.artworkId !== null && p.artworkId !== 'later' && positionFor(p.id).view === view,
        )
      : undefined;
  const focusPolicy = focused ? positionFor(focused.id) : undefined;
  const focusStyle =
    focusPrint && focusPolicy && !focusPolicy.movementArea
      ? {
          transform: 'scale(1.4)',
          transformOrigin: `${focusPolicy.x}% ${focusPolicy.y}%`,
        }
      : undefined;
  const visibleColors = [...colors.slice(0, 5)];
  const selectedColor = colors.find((c) => c.id === color);
  if (selectedColor && !visibleColors.some((c) => c.id === color))
    visibleColors.splice(visibleColors.length - 1, 1, selectedColor);
  const pickerColors = colorMode === 'add' ? colors.filter((c) => !colorRows.includes(c.id)) : colors;
  const artworkTarget = modal.kind === 'artwork' ? modal.positionId : active;
  const dialogClassName = [
    'dialog',
    modalKind === 'positions' && 'position-dialog',
    modalKind === 'artwork' && 'artwork-dialog',
    (modalKind === 'confirm-close' || modalKind === 'confirm-upload-cancel' || modalKind === 'resume-draft') && 'close-dialog',
    modalKind === 'colors' && 'color-dialog',
    modalKind === 'colors' && pickerColors.length > 12 && 'many-colors',
  ]
    .filter(Boolean)
    .join(' ');
  let closedView: ComponentChildren = null;
  if (!designerOpen) {
    const hostModal = workflow.modal;
    const target = hostModal.kind === 'switch-design' ? hostModal.design : undefined;
    closedView = (
      renderClosed?.({
        completion: workflow.completion,
        hasDraft: dirtyDraft,
        editing,
        switchingDesign: target?.id ?? null,
        onResume: openDesigner,
        onStartNew: () => {
          newDesign();
          openDesigner();
        },
        onEdit: requestProductDesignEdit,
        onCancelSwitch: cancelProductDesignSwitch,
        onConfirmSwitch: confirmProductAction,
      }) ?? null
    );
    if (!retainViewForConfirmation) return closedView;
  }

  const visiblePrints = prints.filter((print) => positionFor(print.id).view === view);
  return (
    <>
    <div
      ref={appRef}
      tabIndex={-1}
      inert={!designerOpen}
      className={`app ${artworkOnly ? 'admin-preview' : ''} ${previewExpanded && focusPolicy?.movementArea ? 'preview-expanded' : ''}`}
      style={suspended ? { display: 'none' } : undefined}
      data-step={step}
      lang={lang}
      dir={dir}
    >
      <a
        ref={skipLinkRef}
        className="skip-link"
        href="#design-controls"
        onClick={(event) => {
          // A srcdoc frame resolves fragments against the host page URL, so a
          // default fragment navigation would replace this document.
          event.preventDefault();
          panelRef.current?.focus();
        }}
      >
        {t('customer:chrome.skipToDesignControls')}
      </a>
      <header className="app-header">
        <div className="header-product">
          {artworkOnly && previewContextLabel && <p className="admin-preview-context">{previewContextLabel}</p>}
          <h1 title={config.productName}>{config.productName}</h1>
          {artworkOnly && previewNotice && (
            <p className="admin-preview-omitted" role="status">
              {previewNotice}
            </p>
          )}
        </div>
        {!artworkOnly && (
          <nav className="steps" aria-label={t('customer:steps.designSteps')}>
            {[
              { key: 'artwork', label: t('customer:steps.artwork') },
              { key: 'quantities', label: quantityStepHeading },
              { key: 'review', label: t('customer:steps.review') },
            ].map(({ key, label }, i) => (
              <button
                key={key}
                aria-current={step === i ? 'step' : undefined}
                disabled={
                  workflow.commit.kind === 'pending' || !!cartCompletion ||
                  (i > step &&
                    // Existing quantities must remain reachable to remove a row
                    // whose image can no longer support the shared position.
                    (i === 1 ? !ready && !qty : !ready || !qty || hasQuantityErrors || !productionReady))
                }
                onClick={() => {
                  dispatch({ type: 'step-selected', step: i as 0 | 1 | 2 });
                }}
              >
                <span className="step-number" aria-hidden="true">
                  {step > i ? <IconCheck size={14} /> : <span className="step-count">{i + 1}</span>}
                </span>
                <span className="step-label">{label}</span>
              </button>
            ))}
          </nav>
        )}
        <div className="header-actions">
          {!artworkOnly && (
            <CustomerLanguagePicker
              preference={languagePreference}
              failure={languageChangeFailed}
              onPreferenceChange={onLanguagePreferenceSelect}
            />
          )}
          {!artworkOnly && <ThemeControl />}
          <button
            className="icon-button"
            aria-label={previewOnly ? t('customer:chrome.closeArtworkPreview') : t('customer:chrome.closeCustomizer')}
            onClick={previewOnly ? () => window.close() : requestReturnToProduct}
          >
            <IconX size={22} />
          </button>
        </div>
      </header>
      <main className="workspace">
        <section
          className="preview-panel"
          aria-label={t('customer:chrome.productPreview')}
          inert={workflow.commit.kind === 'pending' || !!cartCompletion}
        >
          <div className="preview-toolbar">
            {views.length > 1 && (
              <>
                <label className={`view-select${views.length <= 3 ? ' narrow-view-select' : ''}`}>
                  <span className="sr-only">{t('customer:chrome.productView')}</span>
                  <select
                    name="garment-view"
                    title={views.find((candidate) => candidate.id === view)?.label}
                    value={view}
                    onChange={(event) => {
                      dispatch({
                        type: 'view-selected',
                        view: event.currentTarget.value,
                      });
                      setFocusPrint(false);
                    }}
                  >
                    {views.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </label>
                {views.length <= 3 && (
                  <div
                    className="view-tabs"
                    role="group"
                    aria-label={t('customer:chrome.productView')}
                    style={{
                      gridTemplateColumns: `repeat(${Math.min(3, views.length)}, minmax(0, 1fr))`,
                    }}
                  >
                    {views.map((v) => (
                      <button
                        key={v.id}
                        aria-pressed={view === v.id}
                        onClick={() => {
                          dispatch({ type: 'view-selected', view: v.id });
                          setFocusPrint(false);
                        }}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            <div className="preview-options">
              {focused && (
                <button
                  className={`preview-toggle ${focusPolicy?.movementArea ? 'inline-preview-toggle' : ''}`}
                  aria-label={
                    focusPolicy?.movementArea
                      ? previewExpanded
                        ? t('customer:chrome.reducePreview')
                        : t('customer:chrome.enlargePreview')
                      : focusPrint
                        ? t('customer:chrome.showFullProduct')
                        : t('customer:chrome.focusOnArtwork')
                  }
                  title={
                    focusPolicy?.movementArea
                      ? previewExpanded
                        ? t('customer:chrome.reducePreview')
                        : t('customer:chrome.enlargePreview')
                      : focusPrint
                        ? t('customer:chrome.showFullProduct')
                        : t('customer:chrome.focusOnArtwork')
                  }
                  aria-pressed={focusPolicy?.movementArea ? previewExpanded : focusPrint}
                  onClick={() =>
                    focusPolicy?.movementArea ? setPreviewExpanded(!previewExpanded) : setFocusPrint(!focusPrint)
                  }
                >
                  <IconFrame size={18} />
                  <span>
                    {focusPolicy?.movementArea
                      ? previewExpanded
                        ? t('customer:chrome.reducePreview')
                        : t('customer:chrome.enlargePreview')
                      : focusPrint
                        ? t('customer:chrome.fullProduct')
                        : t('customer:chrome.focusArtwork')}
                  </span>
                </button>
              )}
              {step === 0 && colors.length > 1 && (
                <button
                  className={`mobile-color-trigger${isNamedChoice ? ' named-choice-trigger' : ''}`}
                  aria-label={t('customer:options.mobileOptionSummary', {
                    optionLabel: rowOptionLabel,
                    optionValue: selectedColor ? colorName(selectedColor) : '',
                    count: colors.length,
                  })}
                  title={t('customer:options.mobileOptionTitle', {
                    optionLabel: rowOptionLabel,
                    optionValue: selectedColor ? colorName(selectedColor) : '',
                  })}
                  aria-haspopup="dialog"
                  onClick={() => {
                    openModal({ kind: 'colors', mode: 'choose' });
                  }}
                >
                  {isNamedChoice ? (
                    <span className="mobile-option-name">{selectedColor ? colorName(selectedColor) : ''}</span>
                  ) : (
                    <span className="color-dot" style={{ background: selectedColor?.hex }} />
                  )}
                  <IconChevronDown size={16} />
                </button>
              )}
            </div>
          </div>
          <div className="garment-stage">
            <div className="garment-image-wrap" style={focusStyle}>
              {config.preview === 'photo' &&
              imageFor(color, view) &&
              imageDimensions[imageFor(color, view) ?? ''] !== null ? (
                <img
                  className="garment-photo"
                  src={imageFor(color, view)}
                  width={1200}
                  height={1200}
                  alt={t('customer:chrome.productViewAlt', {
                    colorName: selectedColor ? colorName(selectedColor) : '',
                    productName: config.productName,
                    viewName: views.find((v) => v.id === view)?.label ?? '',
                  })}
                  onError={() => {
                    const src = imageFor(color, view);
                    if (src) {
                      setImageDimensions((current) => ({ ...current, [src]: null }));
                      onPreviewFailure?.(src);
                    }
                  }}
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    const src = imageFor(color, view);
                    if (src && image.naturalWidth && image.naturalHeight)
                      setImageDimensions((current) => ({
                        ...current,
                        [src]: {
                          width: image.naturalWidth,
                          height: image.naturalHeight,
                        },
                      }));
                  }}
                />
              ) : config.preview === 'photo' && imageFor(color, view) ? (
                <div className="empty-state" role="status">
                  {t('customer:artwork.selectedPreviewFailed')}
                </div>
              ) : (
                <GarmentIllustration
                  className="garment-photo"
                  garment={config.preview === 'illustration' ? config.garment : undefined}
                  color={isNamedChoice ? '#fafafa' : (selectedColor?.hex ?? '#fafafa')}
                  view={views.find((entry) => entry.id === view)?.illustration ?? 'front'}
                  label={t('customer:chrome.productViewAlt', {
                    colorName: selectedColor ? colorName(selectedColor) : '',
                    productName: config.productName,
                    viewName: views.find((v) => v.id === view)?.label ?? '',
                  })}
                />
              )}
              {(config.preview === 'photo' &&
              imageFor(color, view) && imageDimensions[imageFor(color, view) ?? ''] === null
                ? []
                : visiblePrints
              ).map((p) => {
                const pos = positionFor(p.id);
                const art = artworks.find((a) => a.id === p.artworkId);
                const imageAspect = imageAspectFor(pos) ?? 1;
                const width = art
                  ? printWidthPercentForArtwork(pos, p.size, art.width / art.height, imageAspect)
                  : printWidthPercent(pos, p.size);
                const contentWidth = Math.min(1, imageAspect);
                const contentHeight = Math.min(1, 1 / imageAspect);
                if (pos.movementArea && art) {
                  const constraints = inlineConstraints(pos, art);
                  return (
                    <InlineArtwork
                      key={`${p.id}:${art.id}`}
                      config={artworkOnly ? { ...config, artworkOnly: true } : config}
                      position={pos}
                      print={p}
                      artwork={art}
                      imageAspectRatio={imageAspect}
                      imageAspectRatios={constraints.aspects}
                      constraintMessage={constraints.message}
                      selected={step === 0 && expanded === p.id}
                      onSelect={() => {
                        selectPosition(p.id);
                        dispatch({ type: 'step-selected', step: 0 });
                      }}
                      onChange={commitPosition}
                      onArtworkError={() => setFailedArtworks((current) => new Set([...current, art.id]))}
                    />
                  );
                }
                return (
                  <button
                    key={p.id}
                    className={`print-overlay ${!art || p.artworkId === 'later' ? 'empty-print-target' : ''} ${step === 0 && expanded === p.id ? 'selected' : ''} ${step === 0 && expanded === p.id ? 'guides' : ''}`}
                    style={{
                      left: `${(100 - contentWidth * 100) / 2 + pos.x * contentWidth}%`,
                      top: `${(100 - contentHeight * 100) / 2 + pos.y * contentHeight}%`,
                      width: art ? `${width * contentWidth}%` : undefined,
                    }}
                    onClick={() => {
                      selectPosition(p.id);
                      dispatch({ type: 'step-selected', step: 0 });
                      if (!art) openModal({ kind: 'artwork', positionId: p.id });
                    }}
                    aria-label={t(art ? 'customer:artwork.editPositionArtwork' : 'customer:artwork.addPositionArtwork', {
                      positionName: pos.name,
                    })}
                  >
                    {art ? (
                      <img src={art.url} alt={artworkName(art.name)} />
                    ) : (
                      <span className="placeholder-print" aria-hidden="true">
                        +
                      </span>
                    )}
                  </button>
                );
              })}
              {step === 0 &&
                prints.length > 0 &&
                visiblePrints.length === 0 &&
                positions.some((position) => position.view === view && !prints.some((p) => p.id === position.id)) && (
                  <button className="empty-hotspot" onClick={() => requestPosition(view)}>
                    <span aria-hidden="true">+</span>
                    {t('customer:artwork.addArtwork')}
                  </button>
                )}
            </div>
          </div>
          {step === 0 && (
            <div className="color-section">
              <div className="color-label">
                {previewOnly ? (
                  <strong>{colorName(colors.find((c) => c.id === color))}</strong>
                ) : (
                  <>
                    {rowOptionLabel} <strong>{colorName(colors.find((c) => c.id === color))}</strong>
                  </>
                )}
              </div>
              <div className={`swatches${isNamedChoice ? ' named-choice-swatches' : ''}`}>
                {colors.length > 1 &&
                  visibleColors.map((c) => (
                    <button
                      key={c.id}
                      aria-label={t('customer:options.chooseOption', {
                        optionName: colorName(c),
                      })}
                      aria-pressed={color === c.id}
                      className={
                        isNamedChoice
                          ? `named-choice-inline-option${color === c.id ? ' chosen' : ''}`
                          : color === c.id
                            ? 'chosen'
                            : ''
                      }
                      onClick={() => chooseColor(c.id)}
                    >
                      {isNamedChoice ? (
                        <>
                          <span className="named-choice-inline-label">{colorName(c)}</span>
                          {color === c.id && <IconCheck size={14} aria-hidden="true" />}
                        </>
                      ) : (
                        <>
                          <span style={{ background: c.hex }} />
                          {color === c.id && (
                            <IconCheck
                              size={14}
                              style={{
                                color: swatchInk(c.hex ?? '#ffffff'),
                              }}
                              aria-hidden="true"
                            />
                          )}
                        </>
                      )}
                    </button>
                  ))}
                {colors.length > visibleColors.length && (
                  <button
                    className="more-colors"
                    // The name starts with the visible "+n" (label in name), then says what it opens.
                    aria-label={`+${colors.length - visibleColors.length}, ${t('customer:options.allOptions', {
                      count: colors.length,
                    })}`}
                    onClick={() => {
                      openModal({ kind: 'colors', mode: 'choose' });
                    }}
                  >
                    +{colors.length - visibleColors.length}
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
        <section className="control-panel" aria-label={t('customer:chrome.designControls')}>
          <div
            className="panel-content"
            inert={workflow.commit.kind === 'pending' || !!cartCompletion}
            ref={panelRef}
            id="design-controls"
            tabIndex={-1}
          >
            <ValidationSummary issues={validationIssues} summaryRef={summaryRef} onNavigate={navigateIssue} />
            {step === 0 && (
              <>
                {prints.length === 0 && (
                  <div className="empty-state">
                    <h2>{t('customer:artwork.emptyTitle')}</h2>
                    <p>{t('customer:artwork.emptyDescription')}</p>
                    <button className="primary-button" onClick={() => requestPosition()}>
                      {t('customer:artwork.addArtwork')}
                    </button>
                  </div>
                )}
                <div className="print-list">
                  {prints.map((p) => {
                    const pos = positionFor(p.id);
                    const art = artworks.find((a) => a.id === p.artworkId);
                    const isExpanded = expanded === p.id;
                    return (
                      <article
                        className={`print-card ${isExpanded ? 'active' : ''} ${validationIssues.some((issue) => issue.position === p.id) ? 'has-error' : ''}`}
                        key={p.id}
                      >
                        <h2 className="print-card-title">
                          <button
                            id={`print-heading-${p.id}`}
                            type="button"
                            className="print-card-heading"
                            aria-expanded={isExpanded}
                            aria-controls={`print-panel-${p.id}`}
                            onClick={() =>
                              isExpanded
                                ? dispatch({
                                    type: 'position-expanded',
                                    positionId: null,
                                  })
                                : selectPosition(p.id)
                            }
                          >
                            <span>
                              <strong>{pos.name}</strong>
                              {!isExpanded && (
                                <small>
                                  {art ? (
                                    <FileName name={art.name} />
                                  ) : p.artworkId === 'later' ? (
                                    t('customer:artwork.artworkToFollow')
                                  ) : (
                                    t('customer:artwork.artworkNeeded')
                                  )}
                                </small>
                              )}
                            </span>
                            {!artworkOnly && <span className="print-card-price">+{money(printPrice(p))}</span>}
                            <span className="chevron">
                              {isExpanded ? <IconChevronUp size={20} /> : <IconChevronDown size={20} />}
                            </span>
                          </button>
                        </h2>
                        <PrintPanel
                          expanded={isExpanded}
                          id={`print-panel-${p.id}`}
                          labelledBy={`print-heading-${p.id}`}
                        >
                          <button
                            id={`artwork-${p.id}`}
                            aria-invalid={validationIssues.some((issue) => issue.position === p.id) || undefined}
                            aria-describedby={
                              validationIssues.some((issue) => issue.position === p.id)
                                ? `artwork-error-${p.id}`
                                : undefined
                            }
                            className={`artwork-choice ${!art ? 'needs-artwork' : ''}`}
                            onClick={() => openModal({ kind: 'artwork', positionId: p.id })}
                          >
                            <span className="artwork-thumb">
                              {art ? (
                                <img src={art.url} alt="" width={56} height={56} />
                              ) : (
                                <IconCloudUpload size={24} />
                              )}
                            </span>
                            <span>
                              <strong>
                                {art ? (
                                  <FileName name={art.name} />
                                ) : p.artworkId === 'later' ? (
                                  t('customer:artwork.artworkToFollow')
                                ) : (
                                  t('customer:artwork.chooseArtwork')
                                )}
                              </strong>
                            </span>
                            {/* Empty: "Choose artwork" already says the action, so the trailing "Choose" is
                                decoration. A merchant wording whose heading lacks the action word keeps it in the
                                name (label in name). */}
                            <span
                              className="text-action"
                              aria-hidden={
                                !art &&
                                p.artworkId !== 'later' &&
                                t('customer:artwork.chooseArtwork')
                                  .toLocaleLowerCase(formatLocale)
                                  .includes(t('customer:artwork.choose').toLocaleLowerCase(formatLocale).trim())
                                  ? true
                                  : undefined
                              }
                            >
                              {art ? t('customer:artwork.change') : t('customer:artwork.choose')}
                            </span>
                          </button>
                          {validationIssues.some((issue) => issue.position === p.id) && (
                            <p className="field-error" id={`artwork-error-${p.id}`}>
                              {positionIsValid(p)
                                ? t('customer:validation.chooseArtworkForPosition', {
                                    positionName: pos.name,
                                  })
                                : (positionConstraintMessage(positionImageConstraints(pos).messageReason) ??
                                  t('customer:artwork.adjustArtworkInstructions'))}
                            </p>
                          )}
                          {pos.movementArea && art ? (
                            <InlinePositionControls
                              config={artworkOnly ? { ...config, artworkOnly: true } : config}
                              position={pos}
                              print={p}
                              artwork={art}
                              imageAspectRatio={imageAspectFor(pos) ?? 1}
                              imageAspectRatios={inlineConstraints(pos, art).aspects}
                              constraintMessage={inlineConstraints(pos, art).message}
                              priceForSize={
                                pos.methodSizePrices
                                  ? (sizeIndex) =>
                                      isCombinationAvailable(pos.id, sizeIndex, p.method)
                                        ? printPrice({ ...p, size: sizeIndex })
                                        : null
                                  : undefined
                              }
                              onChange={commitPosition}
                              canUndo={positionUndo[p.id] !== undefined}
                              onUndo={() => undoPosition(p.id)}
                            />
                          ) : pos.dimensions.length === 1 ? (
                            <div className="fixed-detail">
                              <span>
                                {pos.sizeLabels ? t('customer:artwork.decorationSize') : t('customer:artwork.width')}
                              </span>
                              <strong>{printSizeDisplayLabel(pos, 0)}</strong>
                            </div>
                          ) : pos.dimensions.length > 6 ? (
                            <FloatingSelect
                              className="width-select"
                              label={
                                pos.sizeLabels ? t('customer:artwork.decorationSize') : t('customer:artwork.width')
                              }
                              value={p.size}
                              name={`width-${p.id}`}
                              onChange={(value) =>
                                dispatch({
                                  type: 'print-size-selected',
                                  positionId: p.id,
                                  size: Number(value),
                                })
                              }
                            >
                              {pos.dimensions.map((cm, i) => (
                                <option
                                  key={pos.sizeBounds ? i : cm}
                                  value={i}
                                  disabled={
                                    !(pos.methodSizePrices
                                      ? isCombinationAvailable(pos.id, i, p.method)
                                      : pos.methodIds.some((method) => isCombinationAvailable(pos.id, i, method))) ||
                                    !artworkFitsSize(pos, p, i, art)
                                  }
                                >
                                  {printSizeDisplayLabel(pos, i)}
                                  {(() => {
                                    const label = sizePriceLabel(pos, p, i);
                                    return label ? ` (${label})` : '';
                                  })()}
                                </option>
                              ))}
                            </FloatingSelect>
                          ) : (
                            <fieldset className="width-options">
                              <legend>
                                {pos.sizeLabels ? t('customer:artwork.decorationSize') : t('customer:artwork.width')}
                              </legend>
                              <div
                                className="size-options"
                                style={{
                                  gridTemplateColumns: `repeat(${pos.dimensions.length === 4 ? 2 : Math.min(3, pos.dimensions.length)},minmax(0,1fr))`,
                                }}
                              >
                                {pos.dimensions.map((cm, i) => (
                                  <button
                                    key={pos.sizeBounds ? i : cm}
                                    aria-pressed={p.size === i}
                                    disabled={
                                      !(pos.methodSizePrices
                                        ? isCombinationAvailable(pos.id, i, p.method)
                                        : pos.methodIds.some((method) => isCombinationAvailable(pos.id, i, method))) ||
                                      !artworkFitsSize(pos, p, i, art)
                                    }
                                    onClick={() =>
                                      dispatch({
                                        type: 'print-size-selected',
                                        positionId: p.id,
                                        size: i,
                                      })
                                    }
                                  >
                                    <span>{printSizeDisplayLabel(pos, i)}</span>
                                    {sizePriceLabel(pos, p, i) && <small>{sizePriceLabel(pos, p, i)}</small>}
                                  </button>
                                ))}
                              </div>
                            </fieldset>
                          )}
                          {pos.methodIds.length === 1 ? (
                            <div className="fixed-method-detail">
                              {methodFor(p.method).description ? (
                                <details>
                                  <summary className="method-detail-summary">
                                    <span className="method-detail-name"><span>{t('customer:artwork.method')}</span><strong>{methodFor(p.method).label}</strong></span>
                                    <IconChevronDown size={16} aria-hidden="true" />
                                  </summary>
                                  <p>{methodFor(p.method).description}</p>
                                </details>
                              ) : (
                                <div className="method-detail-summary">
                                  <span className="method-detail-name"><span>{t('customer:artwork.method')}</span><strong>{methodFor(p.method).label}</strong></span>
                                </div>
                              )}
                            </div>
                          ) : pos.methodIds.length > 2 ? (
                            <>
                              <FloatingSelect
                                className="method-select"
                                label={t('customer:artwork.method')}
                                value={p.method}
                                name={`method-${p.id}`}
                                onChange={(value) =>
                                  dispatch({
                                    type: 'print-method-selected',
                                    positionId: p.id,
                                    method: value,
                                  })
                                }
                              >
                                {pos.methodIds.map((id) => {
                                  const method = methodFor(id);
                                  return (
                                    <option key={id} value={id}>
                                      {method.label}
                                      {methodPriceLabel(pos, id) ? ` (${methodPriceLabel(pos, id)})` : ''}
                                    </option>
                                  );
                                })}
                              </FloatingSelect>
                              {methodFor(p.method).description && <p>{methodFor(p.method).description}</p>}
                            </>
                          ) : (
                            <fieldset className="method-options">
                              <legend>{t('customer:artwork.method')}</legend>
                              {pos.methodIds.map((id) => {
                                const method = methodFor(id);
                                return (
                                  <label key={id}>
                                    <input
                                      type="radio"
                                      name={`method-${p.id}`}
                                      value={id}
                                      checked={p.method === id}
                                      disabled={
                                        !pos.dimensions.some((_, sizeIndex) =>
                                          isCombinationAvailable(pos.id, sizeIndex, id),
                                        )
                                      }
                                      onChange={() =>
                                        dispatch({
                                          type: 'print-method-selected',
                                          positionId: p.id,
                                          method: id,
                                        })
                                      }
                                    />
                                    <span>
                                      {method.label}
                                      {method.description && <small>{method.description}</small>}
                                    </span>
                                    {methodPriceLabel(pos, id) && <small>{methodPriceLabel(pos, id)}</small>}
                                  </label>
                                );
                              })}
                            </fieldset>
                          )}
                          <div className="print-card-bottom">
                            <button onClick={() => removePrint(p.id)}>{t('customer:artwork.removeArtwork')}</button>
                          </div>
                        </PrintPanel>
                      </article>
                    );
                  })}
                </div>
                {prints.length > 0 && prints.length < positions.length && (
                  <button
                    className="add-print"
                    onClick={() => requestPosition()}
                    disabled={prints.length === positions.length}
                  >
                    <span aria-hidden="true">+</span> {t('customer:artwork.addArtwork')}
                  </button>
                )}
              </>
            )}
            {step === 1 && (
              <>
                <QuantityEntry
                  config={config}
                  quantities={quantities}
                  colorRows={colorRows}
                  validationIssues={validationIssues}
                  onChange={changeQuantity}
                  onSelectRow={(color) => dispatch({ type: 'quantity-focused', color })}
                  onRemoveQuantity={(key) => dispatch({ type: 'quantity-removed', key })}
                  onRemoveRow={(color, name, nameSource) => {
                    dispatch({
                      type: 'color-row-removed',
                      color,
                      name,
                      ...(nameSource ? { nameSource } : {}),
                    });
                    window.requestAnimationFrame(() =>
                      panelRef.current?.querySelector<HTMLInputElement>('input[inputmode="numeric"]:enabled')?.focus(),
                    );
                  }}
                  onAddRow={() => openModal({ kind: 'colors', mode: 'add' })}
                />
                {config.productionOptions?.map((option) => (
                  <div className="review-section floating-select" key={option.id}>
                    <label htmlFor={`production-${option.id}`}>{option.label}</label>
                    <select
                      id={`production-${option.id}`}
                      value={workflow.productionChoices[option.id] ?? ''}
                      aria-invalid={
                        !option.values.some((value) => value.id === workflow.productionChoices[option.id]) || undefined
                      }
                      onChange={(event) =>
                        dispatch({
                          type: 'production-option-selected',
                          optionId: option.id,
                          valueId: event.currentTarget.value,
                        })
                      }
                    >
                      <option value="">{t('customer:artwork.chooseOption')}</option>
                      {option.values.map((value) => (
                        <option key={value.id} value={value.id}>
                          {value.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </>
            )}
            {step === 2 && (
              <ReviewPanel
                {...(quoteStatus ? { quoteStatus } : {})}
                productionChoices={workflow.productionChoices}
                {...(quoteReview ? { quoteReview } : {})}
                {...(onSelectQuoteGroup ? { onSelectQuoteGroup: (id: string) => { if (id === quoteReview?.currentGroupId) dispatch({ type: 'step-selected', step: 1 }); else onSelectQuoteGroup(id); } } : {})}
                config={artworkOnly ? { ...config, artworkOnly: true } : config}
                prints={prints}
                artworks={artworks}
                quantities={quantities}
                colorRows={colorRows}
                onEditArtwork={(id) => {
                  selectPosition(id);
                  dispatch({ type: 'step-selected', step: 0 });
                  window.requestAnimationFrame(() => {
                    const heading = document.getElementById(`print-heading-${id}`);
                    heading?.scrollIntoView({ block: 'nearest' });
                    heading?.focus({ preventScroll: true });
                  });
                }}
                onEditQuantities={() => {
                  dispatch({ type: 'step-selected', step: 1 });
                  window.requestAnimationFrame(() => {
                    const field = panelRef.current?.querySelector<HTMLInputElement>('input[inputmode="numeric"]:enabled');
                    field?.scrollIntoView({ block: 'nearest' });
                    field?.focus({ preventScroll: true });
                  });
                }}
              />
            )}
            {error && !modalKind && (
              <p className="form-error" role="alert">
                <IconAlertTriangle size={17} />
                {error}
              </p>
            )}
          </div>
          {!artworkOnly && (prints.length > 0 || step > 0) && (
            <footer className="panel-footer">
              {cartCompletion && <div role="status"><h2>{t('customer:chrome.added')}</h2><p>{t('customer:chrome.openingCart')}</p><button type="button" className="primary-button" onClick={() => onCartCompletion?.(cartCompletion, false)}>{t('customer:chrome.viewCart')}</button></div>}
              {!cartCompletion && <>
              {failureView && (
                <div className="cart-submit-error" role="alert">
                  <IconAlertTriangle size={18} />
                  <span>{failureView.detail || message(failureView.message)}</span>
                </div>
              )}
              {validationIssues.length > 0 && (
                <button className="validation-return" onClick={showValidation}>
                  {t('customer:validation.issueCount', {
                    count: validationIssues.length,
                  })}
                </button>
              )}
              <div className="footer-price">
                {/* Until the whole-cart review arrives, the local count may omit retained cart designs. */}
                <span {...(step === 2 && !quoteReview && quoteStatus === 'loading' ? { 'data-pending': '', 'aria-hidden': true } : {})}>
                  {qty
                    ? t('customer:quantities.quantityCount', {
                        count: step === 2 && quoteReview ? quoteReview.customizedQuantity : qty,
                      })
                    : t('customer:chrome.perItem')}
                </span>
                <strong>
                  {step === 2 && quoteStatus
                    ? t(quoteStatus === 'unavailable' ? 'common:summary.unavailable' : 'customer:chrome.calculatingQuote')
                    : step === 2 && quoteReview
                    ? quoteReview.totalMinor !== undefined
                      ? quoteReviewMoney(
                          quoteReview.totalMinor,
                          quoteReview.currency,
                          quoteReview.exponent,
                          formatLocale,
                        )
                      : t('common:summary.unavailable')
                    : money(qty ? (hasQuantityErrors ? unit * qty : totalPrice(prints, quantities)) : unit)}
                </strong>
              </div>
              <div className="footer-buttons">
                {step > 0 && (
                  <button
                    className="back-button"
                    aria-label={t('customer:steps.previousStep')}
                    disabled={workflow.commit.kind === 'pending'}
                    onClick={() => {
                      dispatch({
                        type: 'step-selected',
                        step: step === 2 ? 1 : 0,
                      });
                    }}
                  >
                    <IconArrowLeft size={19} />
                  </button>
                )}
                <button
                  className={`primary-button ${step === 2 ? 'cart-button' : ''}`}
                  disabled={
                    footerBusy ||
                    (step === 2 && !!ports.review && (!editing || unappliedDraft) && !runtime.prepared && !quoteExpired && workflow.commit.kind !== 'failed') ||
                    (step === 1 && !quantitiesLayout.cells.some((cell) => cell.available)) ||
                    // Retry waits for the server's Retry-After; the runtime's timer releases it.
                    (step === 2 && !!failureView?.waiting)
                  }
                  aria-busy={footerBusy}
                  onClick={step === 2 ? (failureAction?.run ?? (editing && !unappliedDraft ? returnToProduct : addToCart)) : goNext}
                >
                  {footerBusy
                    ? workflow.commit.kind === 'preparing'
                      ? t('customer:chrome.preparingQuote')
                      : editing
                        ? t('customer:steps.updatingCart')
                        : t('customer:steps.addingToCart')
                    : failureAction
                      ? failureAction.label
                    : step === 0
                      ? t('customer:steps.chooseQuantities')
                      : step === 1
                        ? t('customer:steps.review')
                        : addLabel}
                  {step === 2 && (failureAction?.cart ?? true) && <IconShoppingCart size={18} />}
                </button>
              </div>
              </>}
            </footer>
          )}
        </section>
      </main>
      {notice && (
        <div className="toast" role="status">
          {recovery.kind === 'message' && recovery.reason === 'draft-unavailable' ? (
            <IconAlertTriangle size={18} />
          ) : (
            <IconCheck size={18} />
          )}
          {notice}
          {(removed || removedColor) && (
            <button
              onClick={() => {
                dispatch({ type: 'recovery-undone' });
                window.requestAnimationFrame(() => panelRef.current?.focus());
              }}
            >
              {t('customer:recovery.undo')}
            </button>
          )}
          <button
            aria-label={t('customer:recovery.dismissNotification')}
            onClick={() => dispatch({ type: 'recovery-dismissed' })}
          >
            <IconX size={16} />
          </button>
        </div>
      )}
      {modalKind && (
        <dialog
          className={dialogClassName}
          onCancel={(e) => {
            e.preventDefault();
            requestCloseModal();
          }}
          onClick={(e) => {
            const bounds = e.currentTarget.getBoundingClientRect();
            if (
              e.target === e.currentTarget &&
              (e.clientX < bounds.left ||
                e.clientX > bounds.right ||
                e.clientY < bounds.top ||
                e.clientY > bounds.bottom)
            )
              requestCloseModal();
          }}
          aria-labelledby="dialog-title"
          aria-describedby={modalKind === 'confirm-close' || modalKind === 'confirm-upload-cancel' || modalKind === 'resume-draft' ? 'close-dialog-help' : undefined}
        >
          <div className="dialog-header">
            <div>
              <h2 id="dialog-title">
                {modalKind === 'confirm-upload-cancel'
                  ? t('customer:artwork.cancelTitle')
                  : modalKind === 'confirm-close'
                  ? t('customer:close.title')
                  : modalKind === 'resume-draft'
                  ? t('customer:resume.title')
                  : modalKind === 'artwork'
                  ? t('customer:artwork.dialogArtworkTitle', {
                      positionName: positionFor(artworkTarget).name,
                    })
                  : modalKind === 'positions'
                    ? t('customer:artwork.dialogPositionsTitle')
                    : t('customer:artwork.dialogOptionTitle')}
                {modalKind === 'colors' && pickerColors.length > 12 && (
                  <small className="dialog-count">
                    {' '}
                    {pickerColors.length}
                    <span className="sr-only"> {t('customer:artwork.optionsAvailable')}</span>
                  </small>
                )}
              </h2>
            </div>
            <button className="icon-button" aria-label={t('customer:artwork.closeDialog')} onClick={requestCloseModal}>
              <IconX size={22} />
            </button>
          </div>
          {modalKind === 'confirm-close' && (
            <>
              <p id="close-dialog-help" className="close-dialog-help">{t('customer:close.help')}</p>
              <div className="close-dialog-actions">
                <button className="secondary-button" onClick={returnToProduct}>{t('customer:close.leave')}</button>
                <button className="primary-button" data-keep-editing onClick={closeModal}>{t('customer:close.keepEditing')}</button>
              </div>
            </>
          )}
          {modalKind === 'resume-draft' && (
            <>
              <p id="close-dialog-help" className="close-dialog-help">{t('customer:resume.help')}</p>
              <div className="close-dialog-actions">
                <button className="secondary-button" onClick={() => { newDesign(); onDraftDiscarded?.(); }}>{t('customer:resume.startNew')}</button>
                <button className="primary-button" data-keep-editing onClick={closeModal}>{t('customer:resume.continue')}</button>
              </div>
            </>
          )}
          {modalKind === 'confirm-upload-cancel' && (
            <>
              {uploadFileName && <div className="upload-filename"><FileName name={uploadFileName} /></div>}
              <p id="close-dialog-help" className="close-dialog-help">{t('customer:artwork.cancelHelp')}</p>
              <div className="close-dialog-actions">
                <button className="secondary-button" onClick={confirmUploadCancellation}>{t('customer:artwork.cancelUpload')}</button>
                <button className="primary-button" data-keep-editing onClick={keepUploading}>{t('customer:artwork.keepUploading')}</button>
              </div>
            </>
          )}
          {modalKind === 'artwork' && (
            <div className="artwork-dialog-body">
              <div
                className={`upload-zone ${uploading ? 'is-uploading' : ''} ${error ? 'has-error' : ''} ${dragging ? 'dragging' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!uploading) setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                {uploading ? <span className="upload-spinner" aria-hidden="true" /> : error ? <IconAlertTriangle size={28} /> : <IconCloudUpload size={32} />}
                <strong role={uploading ? 'status' : undefined} aria-live="polite">{error ? t('customer:artwork.uploadErrorTitle') : uploading ? workflow.upload.kind === 'reading' && workflow.upload.phase === 'processing' ? t('customer:artwork.processingFile') : workflow.upload.kind === 'reading' && workflow.upload.phase === 'uploading' ? t('customer:artwork.uploadingFile') : t('customer:artwork.openingFile') : t('customer:artwork.dropFile')}</strong>
                {uploadFileName && <div className="upload-filename"><FileName name={uploadFileName} /></div>}
                {error ? (
                  <>
                    <p className="upload-error" id="artwork-upload-error" role="alert">{error}</p>
                    <div className="upload-failure-actions">
                      {workflow.upload.kind === 'failed' && (workflow.upload.reason === 'session-limited' || workflow.upload.reason === 'rate-limited') ? (
                        <button className="secondary-button" onClick={closeModal}>{t('customer:artwork.closeUploadError')}</button>
                      ) : (
                        <>
                          {workflow.upload.kind === 'failed' && ['upload-failed', 'processing-failed', 'processing-timeout'].includes(workflow.upload.reason) && retryFile.current?.name === uploadFileName && (
                            <button className="primary-button" onClick={() => void upload(retryFile.current ?? undefined)}>{t('customer:artwork.retryUpload')}</button>
                          )}
                          <button className="secondary-button" onClick={() => fileRef.current?.click()}>{t('customer:artwork.chooseAnotherFile')}</button>
                        </>
                      )}
                    </div>
                  </>
                ) : uploading ? (
                  <button className="upload-cancel" onClick={cancelArtworkUpload}>{t('customer:artwork.cancelUpload')}</button>
                ) : (
                  <span>
                    {t('customer:artwork.or')}{' '}
                    <button onClick={() => fileRef.current?.click()}>{t('customer:artwork.browseFiles')}</button>
                  </span>
                )}
                <small>{t('customer:artwork.fileRequirements', { maxSizeMb: 5 })}</small>
                <input
                  ref={fileRef}
                  type="file"
                  accept={ARTWORK_UPLOAD_ACCEPT}
                  className="sr-only"
                  aria-label={t('customer:artwork.uploadArtworkFile')}
                  aria-invalid={Boolean(error) || undefined}
                  aria-describedby={error ? 'artwork-upload-error' : undefined}
                  onChange={(e: TargetedEvent<HTMLInputElement>) => void upload(e.currentTarget.files?.[0])}
                />
              </div>
              {artworks.length > 0 && (
                <>
                  <div className="section-label">
                    <h3>
                      {artworks.some((artwork) => !artwork.sample)
                        ? t('customer:artwork.files')
                        : t('customer:artwork.samples')}
                    </h3>
                  </div>
                  <div className="artwork-library">
                    {artworks.map((a) => (
                      <ArtworkFile key={a.id} artwork={a} onChoose={(id) => applyArtwork(id, artworkTarget)} />
                    ))}
                  </div>
                </>
              )}
              {canDeferArtwork(artworkTarget) && (
                <button className="later-button" onClick={() => applyArtwork('later', artworkTarget)}>
                  <IconCloudUpload size={18} />
                  <span>
                    <strong>{t('customer:artwork.provideArtworkLater')}</strong>
                  </span>
                  <IconArrowRight size={17} />
                </button>
              )}
            </div>
          )}
          {modalKind === 'colors' && (
            <ColorPicker
              colors={pickerColors}
              selected={color}
              presentation={config.optionPresentation}
              onChoose={(id) => {
                if (colorMode === 'add') {
                  dispatch({ type: 'color-added', color: id });
                } else chooseColor(id);
                closeModal();
              }}
            />
          )}
          {modalKind === 'positions' && (
            <PositionPicker
              config={artworkOnly ? { ...config, artworkOnly: true } : config}
              color={color}
              usedIds={prints.map((p) => p.id)}
              initialView={placementView}
              onChoose={addPosition}
            />
          )}
          {error && modalKind !== 'artwork' && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </dialog>
      )}
    </div>
    {closedView}
    </>
  );
}
interface PrintPanelProps {
  expanded: boolean;
  id: string;
  labelledBy: string;
  children: ComponentChildren;
}

function PrintPanel({ expanded, id, labelledBy, children }: PrintPanelProps) {
  return (
    <div id={id} className="print-panel" hidden={!expanded} role="region" aria-labelledby={labelledBy}>
      <div className="print-card-body">{children}</div>
    </div>
  );
}
