import type { MerchantDraft } from '@insignia/contracts';
import { formatExactCount } from '@insignia/ui-localization/core';
import type { Visualizer } from '@insignia/ui-visualizer';
import {
  applyGeometryCommand,
  type EditorState,
  type GeometryCommand,
  type GeometryV1,
  projectScene,
  type RenderStatus,
  type Viewport,
  validateGeometry,
  validateRect,
} from '@insignia/ui-visualizer/geometry';
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import AdminDisclosure from '../components/AdminDisclosure';
import AdminSaveBar from '../components/AdminSaveBar';
import AdminSkeleton from '../components/AdminSkeleton';
import DecorationPriceReview from '../components/DecorationPriceReview';
import { useAdminLocale, withAdminLocale } from '../shared/admin-i18n.js';
import { useAdminPageReady } from '../shared/admin-page-ready';
import { authenticatedJson } from '../shared/admin-request';
import { noSelection, selectedValue } from '../shared/admin-select';
import type { ConfigView, PublicationState } from '../shared/admin-view.js';
import { type ProductDraftRemoval, removeProductDraftChoice } from '../shared/product-draft-removal';
import { productEditorReturnPath } from '../shared/products-return-path';
import ArtworkUpload from './ArtworkUpload';
import {
  createMerchantConfigEditorWorkflow,
  isEditableMerchantDraft,
  isMerchantPublicationContinuing,
  type MerchantConfigEditorLoadOutcome,
  type MerchantConfigEditorProductList,
} from './merchant-config-editor-workflow';
import { type ConfigWriteRequest, publicationRequestOf, saveRequestOf } from './merchant-config-transaction';

function PlacementDetails({
  label,
  expanded,
  children,
}: {
  label: string;
  expanded: boolean;
  children: ComponentChildren;
}) {
  return expanded ? (
    <s-stack gap="base">{children}</s-stack>
  ) : (
    <AdminDisclosure label={label}>{children}</AdminDisclosure>
  );
}
type Props = { productId: string; returnTo?: string };
// Preserve typed spelling until blur; only validated numeric values become geometry.
function RectNumberInput({
  id,
  label,
  disabled,
  value,
  onInput,
  onChange,
}: {
  id: string;
  label: string;
  disabled: boolean;
  value: number;
  onInput: (value: number) => void;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const lastInput = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (value !== lastInput.current) setText(null);
  }, [value]);
  return (
    <s-number-field
      id={id}
      min={0.1}
      max={100}
      step={1}
      suffix="%"
      inputMode="decimal"
      value={String(text ?? Number((value * 100).toFixed(6)))}
      onInput={(event) => {
        const raw = event.currentTarget.value;
        lastInput.current = Number(raw) / 100;
        setText(raw);
        onInput(Number(raw) / 100);
      }}
      onChange={(event) => onChange(Number(event.currentTarget.value) / 100)}
      onBlur={() => {
        lastInput.current = null;
        setText(null);
      }}
      label={label}
      disabled={disabled}
    />
  );
}
const numberOf = (id: string) => /^gid:\/\/shopify\/(?:Product|ProductVariant)\/([1-9][0-9]*)$/.exec(id)?.[1];
const endpoint = (id: string) => `/api/admin/products/${encodeURIComponent(id)}/config`;
const freshId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
const defaultRect = () => ({ centerX: 0.5, centerY: 0.5, width: 0.3, height: 0.3 });
const publicationStorageKey = (productId: string) => `insignia:m5:publish:${productId}`;
const continuingPublication = isMerchantPublicationContinuing;
function storedPublicationRequest(value: unknown): value is ConfigWriteRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Record<string, unknown>;
  return (
    (request.method === 'POST' || request.method === 'PUT') &&
    typeof request.key === 'string' &&
    !!request.body &&
    typeof request.body === 'object' &&
    (request.installationGeneration === undefined || typeof request.installationGeneration === 'string')
  );
}
function viewGeometry(draft: MerchantDraft): GeometryV1 {
  return draft.geometry as GeometryV1;
}
function initialEditor(draft: MerchantDraft): EditorState {
  const geometry = viewGeometry(draft);
  return { version: 0, geometry, viewId: geometry.views[0]?.id ?? 'front', artwork: { kind: 'logo-later' } };
}
function removeChoiceLabels(
  labels: MerchantDraft['labels'],
  kind: 'methods' | 'options' | 'prices',
  id: string,
): MerchantDraft['labels'] {
  if (!labels) return labels;
  const next = { ...labels };
  if (labels[kind]) {
    const group = { ...labels[kind] };
    delete group[id];
    next[kind] = group;
  }
  if (kind === 'options' && labels.values) {
    next.values = { ...labels.values };
    delete next.values[id];
  }
  return next;
}
type PricingRule = MerchantDraft['pricingRules'][number];
const leanDecimal = (text: string) => /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(text);
function leanPricing(draft: MerchantDraft): boolean {
  const seen = new Set<string>();
  return draft.pricingRules.every((rule) => {
    if (
      rule.role !== 'unit' ||
      rule.scope.kind !== 'step' ||
      !rule.scope.methodId ||
      rule.rate.kind !== 'fixed' ||
      rule.methodUnitMultiplicity !== undefined ||
      rule.rate.amount.presentmentOverrides.length ||
      !leanDecimal(rule.rate.amount.shopDecimal)
    )
      return false;
    const scope = rule.scope;
    const placement = draft.placements.find((item) => item.id === scope.placementId);
    if (
      !placement?.allowedMethodIds.includes(rule.scope.methodId) ||
      !placement.allowedStepIds.includes(rule.scope.stepId)
    )
      return false;
    const key = JSON.stringify([rule.scope.methodId, rule.scope.placementId, rule.scope.stepId]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
type ProductionDimensionText = { width: string; height: string };
const positiveDimension = (text: string) => text.trim() !== '' && Number.isFinite(Number(text)) && Number(text) > 0;
const validProductionDimensions = (text: ProductionDimensionText) =>
  (text.width.trim() === '' && text.height.trim() === '') ||
  (positiveDimension(text.width) && positiveDimension(text.height));
type PriceText = { base: string; text: string };
function LeanPriceInput({
  id,
  typed,
  onText,
  disabled,
  value,
  label,
  onPrice,
  onValidity,
}: {
  id: string;
  typed?: PriceText;
  onText(value: string): void;
  disabled: boolean;
  value: string;
  label: string;
  onPrice(value: string): void;
  onValidity(valid: boolean): void;
}) {
  const { t: translateUi } = useAdminLocale();
  const text = typed?.base === value ? typed.text : value;
  const valid = text === '' || leanDecimal(text);
  useEffect(() => onValidity(valid), [value, valid]);
  return (
    <>
      <s-text-field
        id={id}
        placeholder={translateUi('editor:merchantConfigEditor.unavailable')}
        value={text}
        error={valid ? undefined : translateUi('editor:configuration.prices.inputError')}
        onInput={(event) => {
          const next = event.currentTarget.value;
          onText(next);
          const allowed = next === '' || leanDecimal(next);
          onValidity(allowed);
          if (allowed) onPrice(next);
        }}
        label={label}
        disabled={disabled}
      />
    </>
  );
}
type ChoiceKind = 'method' | 'placement' | 'size' | 'view' | 'option' | 'price' | 'price-choice';
type AdminT = ReturnType<typeof useAdminLocale>['t'];
function choiceKindKey(kind: ChoiceKind) {
  return (
    {
      method: 'editor:configuration.choiceKinds.method',
      placement: 'editor:configuration.choiceKinds.placement',
      size: 'editor:configuration.choiceKinds.size',
      view: 'editor:configuration.choiceKinds.view',
      option: 'editor:configuration.choiceKinds.option',
      price: 'editor:configuration.choiceKinds.price',
      'price-choice': 'editor:configuration.choiceKinds.priceChoice',
    } as const
  )[kind];
}
function disambiguateNames(names: readonly string[], kind: ChoiceKind, t: AdminT, locale: string): readonly string[] {
  // Number the complete group when names collide, including labels that mimic
  // a generated suffix. Distinct final suffixes keep every choice identifiable.
  const kindLabel = t(choiceKindKey(kind));
  return new Set(names).size < names.length
    ? names.map((name, index) =>
        t('editor:configuration.disambiguatedChoice', {
          name,
          kind: kindLabel,
          number: formatExactCount(BigInt(index + 1), locale).formatted,
        }),
      )
    : names;
}
function choiceName(
  ids: readonly string[],
  labels: Readonly<Record<string, string>> | undefined,
  id: string,
  kind: ChoiceKind,
  t: AdminT,
  locale: string,
) {
  const kindLabel = t(choiceKindKey(kind));
  const names = ids.map(
    (choice, index) =>
      labels?.[choice]?.trim() ||
      t('editor:configuration.choiceFallback', {
        kind: kindLabel,
        number: formatExactCount(BigInt(index + 1), locale).formatted,
      }),
  );
  return (
    disambiguateNames(names, kind, t, locale)[ids.indexOf(id)] ??
    t('editor:configuration.choiceUnavailable', { kind: kindLabel })
  );
}
function operatorPublication(state: PublicationState) {
  return ['OPERATOR_HOLD', 'RESTORATION_CONFLICT', 'CONFLICT'].includes(state);
}
function PublicationStatus({
  config,
  compact = false,
}: {
  config: NonNullable<ConfigView['config']>;
  compact?: boolean;
}) {
  const { t: translateUi } = useAdminLocale();
  const publication = config.publication;
  const label = translateUi(`editor:configuration.publication.states.${publication.state}`);
  const functionReadiness = publication.functionReadiness;
  const readinessKey =
    functionReadiness === 'RELEASE_BOUND'
      ? 'editor:configuration.publication.readiness.RELEASE_BOUND'
      : functionReadiness === 'RELEASE_BOUND_REQUIRED'
        ? 'editor:configuration.publication.readiness.RELEASE_BOUND_REQUIRED'
        : functionReadiness === 'ACTIVATION_PENDING'
          ? 'editor:configuration.publication.readiness.ACTIVATION_PENDING'
          : 'editor:configuration.publication.readiness.unknown';
  if (compact)
    return (
      <s-stack gap="small">
        <s-badge
          tone={
            publication.state === 'ACTIVE' ? 'success' : operatorPublication(publication.state) ? 'warning' : 'neutral'
          }
        >
          {label}
        </s-badge>
        {operatorPublication(publication.state) && (
          <s-banner tone="warning" heading={translateUi('editor:configuration.publication.needsAttention')}>
            {translateUi('editor:configuration.publication.contactSupport')}
          </s-banner>
        )}
      </s-stack>
    );
  return (
    <s-section heading={translateUi('editor:merchantConfigEditor.publication')}>
      <s-stack gap="base">
        <div role="status">
          <s-paragraph>{label}</s-paragraph>
        </div>
        <s-paragraph>
          {publication.activeRevisionId
            ? translateUi('editor:configuration.publication.draftDescriptionActive')
            : translateUi('editor:configuration.publication.draftDescriptionNew')}
        </s-paragraph>
        {operatorPublication(publication.state) && (
          <s-banner tone="warning" heading={translateUi('editor:configuration.publication.needsAttention')}>
            {translateUi('editor:configuration.publication.contactSupport')}
          </s-banner>
        )}
        <AdminDisclosure label={translateUi('editor:configuration.publication.technicalDetails')}>
          {publication.revisionId && (
            <s-paragraph>
              {translateUi('editor:configuration.publication.latestRevision', { revision: publication.revisionId })}
            </s-paragraph>
          )}
          {publication.activeRevisionId && (
            <s-paragraph>
              {translateUi('editor:configuration.publication.effectiveRevision', {
                revision: publication.activeRevisionId,
              })}
            </s-paragraph>
          )}
          {publication.reason && (
            <s-paragraph>{translateUi('editor:configuration.publication.reasonUnavailable')}</s-paragraph>
          )}
          {publication.requiresAllChannelHold !== null && (
            <s-paragraph>
              {translateUi('editor:configuration.publication.allChannelHold', {
                value: translateUi(
                  publication.requiresAllChannelHold
                    ? 'editor:configuration.publication.yes'
                    : 'editor:configuration.publication.no',
                ),
              })}
            </s-paragraph>
          )}
          {publication.functionReadiness && (
            <s-paragraph>
              {translateUi('editor:configuration.publication.functionReadiness', {
                readiness: translateUi(readinessKey),
              })}
            </s-paragraph>
          )}
        </AdminDisclosure>
      </s-stack>
    </s-section>
  );
}
const setupSteps = [
  { id: 'rules', anchor: 'customization-rules', icon: 'product' },
  { id: 'design', anchor: 'product-images', icon: 'image' },
  { id: 'prices', anchor: 'decoration-prices', icon: 'price-list' },
  { id: 'review', anchor: 'publish-changes', icon: 'check' },
] as const;
type SetupStep = (typeof setupSteps)[number]['id'] | 'all';
type EditorNoticeReason =
  | 'session-verifying'
  | 'load-failed'
  | 'authorization-required'
  | 'product-unverified'
  | 'context-changed'
  | 'save-committed-after-return'
  | 'save-conflict'
  | 'save-uncertain'
  | 'saved'
  | 'saved-unverified'
  | 'saved-after-interruption'
  | 'publication-refreshed'
  | 'publication-pending'
  | 'publication-uncertain'
  | 'publication-unrecoverable'
  | 'publication-rejected'
  | 'publication-unavailable'
  | 'publication-refresh-failed'
  | 'save-rejected'
  | 'save-failed'
  | 'creation-failed'
  | 'copy-invalid-target'
  | 'copy-search-failed'
  | 'copy-failed'
  | 'geometry-change-rejected'
  | 'advanced-json-invalid';
type EditorPreviewStatus = RenderStatus | 'placement-outside-image' | 'change-rejected' | 'preview-unavailable' | '';
function editorPreviewStatusKey(status: EditorPreviewStatus) {
  switch (status) {
    case 'missing-image':
      return 'editor:configuration.previewStatus.missingImage';
    case 'missing-geometry':
      return 'editor:configuration.previewStatus.missingGeometry';
    case 'image-error':
      return 'editor:configuration.previewStatus.imageError';
    case 'placement-outside-image':
      return 'editor:configuration.previewStatus.placementOutsideImage';
    case 'change-rejected':
      return 'editor:configuration.previewStatus.changeRejected';
    case 'preview-unavailable':
      return 'editor:configuration.previewStatus.unavailable';
    case 'ready':
    case '':
      return null;
  }
}
function productStatusKey(status: string) {
  switch (status) {
    case 'ACTIVE':
      return 'editor:configuration.productStatus.ACTIVE';
    case 'ARCHIVED':
      return 'editor:configuration.productStatus.ARCHIVED';
    case 'DRAFT':
      return 'editor:configuration.productStatus.DRAFT';
    default:
      return 'editor:configuration.productStatus.unknown';
  }
}
function MerchantConfigEditor({ productId, returnTo }: Props) {
  const { t: translateUi, formatLocale } = useAdminLocale();
  const [library, setLibrary] = useState<{ id: string; name: string; version: string }[] | null>(null);
  const [libraryChoice, setLibraryChoice] = useState('');
  const [removingMethod, setRemovingMethod] = useState<string | null>(null);
  const [removingChoice, setRemovingChoice] = useState<ProductDraftRemoval | null>(null);
  const choiceRemoval = useRef<HTMLElementTagNameMap['s-modal']>(null);
  useEffect(() => {
    let cancelled = false;
    void customElements.whenDefined('s-modal').then(() => {
      if (cancelled) return;
      if (removingChoice) choiceRemoval.current?.showOverlay();
      else choiceRemoval.current?.hideOverlay();
    });
    return () => {
      cancelled = true;
    };
  }, [removingChoice]);
  const methodRemoval = useRef<HTMLElementTagNameMap['s-modal']>(null);
  useEffect(() => {
    let cancelled = false;
    void customElements.whenDefined('s-modal').then(() => {
      if (cancelled) return;
      if (removingMethod) methodRemoval.current?.showOverlay();
      else methodRemoval.current?.hideOverlay();
    });
    return () => {
      cancelled = true;
    };
  }, [removingMethod]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState(false);
  const libraryRequestId = useRef(0);
  async function loadMethodLibrary() {
    if (libraryLoading) return;
    const epoch = libraryRequestId.current;
    setLibraryLoading(true);
    setLibraryError(false);
    try {
      const result = await authenticatedJson<{ methods: { id: string; name: string; version: string }[] }>(
        '/api/admin/methods',
      );
      if (epoch !== libraryRequestId.current) return;
      setLibrary(result.methods);
      setLibraryChoice(result.methods[0]?.id ?? '');
    } catch (error) {
      if (epoch !== libraryRequestId.current || authorizationDenied(error)) return;
      setLibraryError(true);
    } finally {
      if (epoch === libraryRequestId.current) setLibraryLoading(false);
    }
  }
  const [setupStep, setSetupStep] = useState<SetupStep>('rules');
  const [variantFilter, setVariantFilter] = useState('');
  const [viewFilter, setViewFilter] = useState('');
  const [placementFilter, setPlacementFilter] = useState('');
  const setupIndex = setupSteps.findIndex((step) => step.id === setupStep);
  const currentSetup = setupSteps[setupIndex];
  const previousSetup = setupSteps[setupIndex - 1];
  const nextSetup = setupSteps[setupIndex + 1];
  const setupStepLabel = (step: SetupStep) =>
    translateUi(step === 'all' ? 'editor:configuration.setupSteps.all' : `editor:configuration.setupSteps.${step}`);
  const visibleStage = (stage: SetupStep) => setupStep === stage || setupStep === 'all';
  useEffect(() => {
    const sync = () => {
      const url = new URL(window.location.href);
      if (url.searchParams.get('view') === 'all') {
        setSetupStep('all');
        return;
      }
      const step = setupSteps.find((step) => '#' + step.anchor === url.hash);
      if (step) setSetupStep(step.id);
      else if (!url.hash) setSetupStep('rules');
    };
    sync();
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);
  function selectSetupStep(step: SetupStep) {
    const url = new URL(window.location.href);
    if (step === 'all') url.searchParams.set('view', 'all');
    else {
      url.searchParams.delete('view');
      url.hash = setupSteps.find((item) => item.id === step)!.anchor;
    }
    window.history.pushState(null, '', url.pathname + url.search + url.hash);
    setSetupStep(step);
    requestAnimationFrame(() => {
      document.getElementById('setup-stage-heading')?.focus({ preventScroll: true });
      document.getElementById('editor-flow')?.scrollIntoView({ block: 'start' });
    });
  }
  function focusPlacementPreview() {
    requestAnimationFrame(() => {
      const preview = document.getElementById('insignia-visualizer');
      preview?.scrollIntoView({ block: 'center' });
      preview?.focus({ preventScroll: true });
    });
  }
  const [status, setStatusText] = useState<EditorNoticeReason | null>('session-verifying');
  const [statusTone, setStatusTone] = useState<'info' | 'critical' | 'success' | 'warning'>('info');
  function setStatus(reason: EditorNoticeReason | null) {
    setStatusText(reason);
    setStatusTone('info');
  }
  function setFailure(reason: EditorNoticeReason) {
    setStatusText(reason);
    setStatusTone('critical');
  }
  function setWarning(reason: EditorNoticeReason) {
    setStatusText(reason);
    setStatusTone('warning');
  }
  function setSuccess(reason: EditorNoticeReason) {
    setStatusText(reason);
    setStatusTone('success');
  }
  const workflow = useMemo(
    () =>
      createMerchantConfigEditorWorkflow({
        productId,
        readCurrent: (freshSession = false) => authenticatedJson<ConfigView>(endpoint(productId), {}, freshSession),
        send: (request) =>
          authenticatedJson<Record<string, unknown>>(endpoint(productId), {
            method: request.method,
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': request.key },
            body: JSON.stringify(request.body),
          }),
        readProducts: (query) =>
          authenticatedJson<MerchantConfigEditorProductList>(
            `/api/admin/products?${new URLSearchParams({ q: query })}`,
          ),
        publicationRequests: {
          read: (id) => {
            try {
              const value: unknown = JSON.parse(sessionStorage.getItem(publicationStorageKey(id)) ?? 'null');
              return storedPublicationRequest(value) ? value : null;
            } catch {
              return null;
            }
          },
          write: (id, request) => sessionStorage.setItem(publicationStorageKey(id), JSON.stringify(request)),
          clear: (id) => sessionStorage.removeItem(publicationStorageKey(id)),
        },
        newRequestKey: () => crypto.randomUUID(),
      }),
    [productId],
  );
  const [, setWorkflowRevision] = useState(0);
  useEffect(() => workflow.subscribe(() => setWorkflowRevision((revision) => revision + 1)), [workflow]);
  const workflowState = workflow.getSnapshot();
  const { view, draft, latest, busy, loading, copyCandidates } = workflowState;
  useAdminPageReady(!loading);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const editorRef = useRef<EditorState | null>(null);
  const transaction = workflowState.transaction;
  const saveState = transaction.save.kind;
  const savePending = saveRequestOf(transaction);
  const publicationPending = publicationRequestOf(transaction);
  const [copyTarget, setCopyTarget] = useState('');
  const [copyQuery, setCopyQuery] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [advancedText, setAdvancedText] = useState('');
  const [advancedError, setAdvancedError] = useState(false);
  const [dimensionTexts, setDimensionTexts] = useState<Record<string, ProductionDimensionText>>({});
  const [dimensionRecoveryOpen, setDimensionRecoveryOpen] = useState(false);
  const [priceErrors, setPriceErrors] = useState<Record<string, boolean>>({});
  const [priceTexts, setPriceTexts] = useState<Record<string, PriceText>>({});
  const [pricePage, setPricePage] = useState(0);
  const [pricePlacementFilter, setPricePlacementFilter] = useState('');
  const [priceMethodFilter, setPriceMethodFilter] = useState('');
  const [priceProposalStarted, setPriceProposalStarted] = useState(false);
  const [priceRevision, setPriceRevision] = useState(0);
  const [previewStatus, setPreviewStatus] = useState<EditorPreviewStatus>('');
  const [validationIssues, setValidationIssues] = useState<
    {
      path: string;
      message: string;
    }[]
  >([]);
  const [imageSize, setImageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const visualizerRef = useRef<Visualizer | null>(null);
  const projectRef = useRef(project);
  // Publication operates on its immutable saved revision; local draft editing remains independent.
  // An unresolved save, however, must retain its original request until reconciliation.
  const editLocked = busy || !!saveRequestOf(transaction);
  const editLockedRef = useRef(editLocked);
  editLockedRef.current = editLocked;
  useEffect(() => {
    visualizerRef.current?.setMode(isEditorLocked() ? 'preview' : 'edit-placement');
  }, [editLocked]);
  function isEditorLocked() {
    const current = workflow.getSnapshot();
    return current.busy || !!saveRequestOf(current.transaction);
  }
  editorRef.current = editor;
  projectRef.current = project;
  function clearPrivateUI() {
    libraryRequestId.current++;
    setRemovingMethod(null);
    setRemovingChoice(null);
    setVariantFilter('');
    setViewFilter('');
    setPlacementFilter('');
    setPricePlacementFilter('');
    setPriceMethodFilter('');
    setLibrary(null);
    setLibraryChoice('');
    setLibraryError(false);
    setLibraryLoading(false);
    visualizerRef.current?.destroy();
    visualizerRef.current = null;
    editorRef.current = null;
    setEditor(null);
    setAdvancedText('');
    setAdvancedError(false);
    setDimensionTexts({});
    setDimensionRecoveryOpen(false);
    setPriceErrors({});
    setPriceTexts({});
    setPricePage(0);
    setPriceProposalStarted(false);
    setCopyTarget('');
    setCopyQuery('');
    setValidationIssues([]);
    setPreviewStatus('');
    setImageSize(null);
  }
  function clearPrivate() {
    workflow.clearAuthorization();
    clearPrivateUI();
  }
  function suspendPrivate() {
    workflow.suspend();
    clearPrivateUI();
  }
  function authorizationDenied(error: unknown) {
    const status = (
      error as {
        status?: number;
      }
    )?.status;
    if (status !== 401 && status !== 403) return false;
    clearPrivate();
    setFailure('authorization-required');
    return true;
  }
  function prepareLoadUi() {
    visualizerRef.current?.destroy();
    visualizerRef.current = null;
    editorRef.current = null;
    setEditor(null);
    setDimensionTexts({});
    setDimensionRecoveryOpen(false);
    setPriceErrors({});
    setPriceTexts({});
    setPricePage(0);
    setPriceProposalStarted(false);
    setValidationIssues([]);
  }
  function applyLoadOutcome(outcome: MerchantConfigEditorLoadOutcome) {
    if (outcome.kind === 'ignored') return;
    if (outcome.kind === 'denied') {
      clearPrivateUI();
      setFailure('authorization-required');
      return;
    }
    if (outcome.kind === 'failed') {
      setFailure('load-failed');
      return;
    }
    prepareLoadUi();
    const currentDraft = workflow.getSnapshot().draft;
    const currentEditor = currentDraft ? initialEditor(currentDraft) : null;
    editorRef.current = currentEditor;
    setEditor(currentEditor);
    switch (outcome.reason) {
      case 'context-changed':
        setWarning('context-changed');
        break;
      case 'save-committed':
        setSuccess('save-committed-after-return');
        break;
      case 'save-conflict':
        setWarning('save-conflict');
        break;
      case 'save-uncertain':
        setStatus('save-uncertain');
        break;
      case 'unsupported':
        setStatus(null);
        break;
      case 'regular':
        setStatus(null);
        break;
    }
  }
  async function load(freshSession = false) {
    prepareLoadUi();
    setStatus('session-verifying');
    applyLoadOutcome(freshSession ? await workflow.resume() : await workflow.load());
  }
  async function reloadSavedSetup() {
    await load(true);
    requestAnimationFrame(() => {
      const destination =
        document.getElementById('setup-stage-heading') ??
        document.getElementById('unsupported-setup-recovery') ??
        document.getElementById('setup-read-status');
      destination?.focus({ preventScroll: true });
    });
  }
  useEffect(() => {
    const launchUrl = new URL(window.location.href);
    if (launchUrl.searchParams.has('id_token')) {
      launchUrl.searchParams.delete('id_token');
      window.history.replaceState(window.history.state, '', launchUrl.pathname + launchUrl.search + launchUrl.hash);
    }
    void load();
    const visible = () => {
      if (!document.hidden)
        void workflow.refreshWhenIdle().then((outcome) => {
          if (outcome.kind !== 'ignored') applyLoadOutcome(outcome);
        });
    };
    const suspend = () => suspendPrivate();
    const resume = (event: Event) => {
      event.preventDefault();
      void load(true);
    };
    window.addEventListener('pagehide', suspend);
    document.addEventListener('insignia:admin-bfcache-resume', resume);
    document.addEventListener('visibilitychange', visible);
    return () => {
      workflow.dispose();
      clearPrivateUI();
      window.removeEventListener('pagehide', suspend);
      document.removeEventListener('insignia:admin-bfcache-resume', resume);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [productId, workflow]);
  useEffect(() => {
    let refreshing = false;
    let stopped = false;
    const timer = setInterval(async () => {
      const current = workflow.getSnapshot();
      if (stopped || refreshing || document.hidden || current.busy || !current.view?.config) return;
      refreshing = true;
      try {
        const result = await workflow.refreshPublication();
        if (stopped) return;
        if (result.kind === 'denied') {
          clearPrivateUI();
          setFailure('authorization-required');
        } else if (result.kind === 'failed') setFailure('publication-refresh-failed');
      } finally {
        refreshing = false;
      }
    }, 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [workflow]);
  function apply(command: GeometryCommand) {
    const current = editorRef.current;
    if (!current || isEditorLocked()) return;
    try {
      const next = applyGeometryCommand(current, command);
      editorRef.current = next;
      setEditor(next);
      if (next.geometry !== current.geometry) {
        workflow.editDraft((old) => (old ? { ...old, geometry: next.geometry } : old));
      }
    } catch (error) {
      setPreviewStatus(command.kind === 'set-placement-rect' ? 'placement-outside-image' : 'change-rejected');
    }
  }
  function choose(
    command:
      | {
          kind: 'select-placement';
          placementId?: string;
        }
      | {
          kind: 'select-step';
          stepId?: string;
        }
      | {
          kind: 'select-view';
          viewId: string;
        }
      | {
          kind: 'select-variant';
          variantId?: string;
        }
      | {
          kind: 'set-placement-rect';
          viewId: string;
          variantId?: string;
          placementId: string;
          rect: GeometryV1['views'][number]['placements'][number]['rect'];
        },
  ) {
    const current = editorRef.current;
    if (current) apply({ ...command, baseVersion: current.version } as GeometryCommand);
  }
  function change(next: MerchantDraft) {
    if (isEditorLocked()) return;
    setValidationIssues([]);
    workflow.editDraft(next);
    const current = editorRef.current;
    if (current && next.geometry !== current.geometry) {
      const geometry = validateGeometry(next.geometry as GeometryV1);
      setDimensionTexts((texts) =>
        Object.fromEntries(Object.entries(texts).filter(([id]) => geometry.steps.some((step) => step.id === id))),
      );
      const newViewId = geometry.views.some((item) => item.id === current.viewId)
        ? current.viewId
        : geometry.views[0]!.id;
      const selectedPlacementId = geometry.views
        .find((item) => item.id === newViewId)
        ?.placements.some((item) => item.id === current.selectedPlacementId)
        ? current.selectedPlacementId
        : undefined;
      const selectedStepId = geometry.steps.some((item) => item.id === current.selectedStepId)
        ? current.selectedStepId
        : undefined;
      const updated = {
        ...current,
        version: current.version + 1,
        geometry,
        viewId: newViewId,
        selectedPlacementId,
        selectedStepId,
      };
      editorRef.current = updated;
      setEditor(updated);
    }
  }
  function updateGeometry(update: (geometry: GeometryV1) => GeometryV1) {
    if (!draft) return;
    try {
      change({ ...draft, geometry: validateGeometry(update(viewGeometry(draft))) });
    } catch (error) {
      setFailure('geometry-change-rejected');
    }
  }
  const selectedImage = editor?.variantId
    ? (view?.product.variants.find((item) => 'variant_' + numberOf(item.id) === editor.variantId)?.imageUrl ??
      view?.product.imageUrl)
    : view?.product.imageUrl;
  useEffect(() => {
    setImageSize(null);
    if (!selectedImage) return;
    const image = new Image();
    image.onload = () => setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
    image.src = selectedImage;
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [selectedImage]);
  useEffect(() => {
    if (!editor || !visibleStage('design')) return;
    const element = document.getElementById('insignia-visualizer');
    if (!element) return;
    let cancelled = false;
    void import('@insignia/ui-visualizer')
      .then(async ({ createVisualizer }) => {
        const renderer = await createVisualizer({ element, onCommand: apply, onStatus: setPreviewStatus });
        if (cancelled) {
          renderer.destroy();
          return;
        }
        renderer.setMode(editLockedRef.current ? 'preview' : 'edit-placement');
        visualizerRef.current = renderer;
        const current = editorRef.current;
        if (current) updateRenderer(current);
      })
      .catch(() => {
        if (!cancelled) setPreviewStatus('preview-unavailable');
      });
    return () => {
      cancelled = true;
      visualizerRef.current?.destroy();
      visualizerRef.current = null;
    };
  }, [!!editor, !!view?.config, visibleStage('design')]);
  function project(current: EditorState) {
    const viewport: Viewport = {
      width: Math.max(1, document.getElementById('insignia-visualizer')?.clientWidth ?? 600),
      height: Math.max(1, document.getElementById('insignia-visualizer')?.clientHeight ?? 360),
      pixelRatio: Math.max(1, devicePixelRatio || 1),
    };
    const images: Record<string, string> = {};
    const product = view?.product;
    if (product) {
      if (product.imageUrl) images[`product_${numberOf(product.id)}`] = product.imageUrl;
      for (const variant of product.variants) {
        const url = variant.imageUrl ?? product.imageUrl;
        if (url) images[`variant_${numberOf(variant.id)}`] = url;
      }
    }
    return projectScene(current, viewport, images);
  }
  function updateRenderer(current: EditorState) {
    const renderer = visualizerRef.current;
    const element = document.getElementById('insignia-visualizer');
    if (!renderer || !element) return;
    const scene = projectRef.current(current);
    renderer.update(scene);
    element.setAttribute('data-projected-geometry', JSON.stringify(scene));
  }
  useEffect(() => {
    if (editor) updateRenderer(editor);
  }, [editor, view?.product]);
  async function create() {
    const outcome = await workflow.createConfiguration();
    switch (outcome.kind) {
      case 'created':
        applyLoadOutcome(outcome.load);
        break;
      case 'denied':
        clearPrivateUI();
        setFailure('authorization-required');
        break;
      case 'failed':
        setFailure('creation-failed');
        break;
      case 'ignored':
        break;
    }
  }
  async function save(retry = false) {
    const outcome = retry
      ? await workflow.retrySave()
      : await workflow.saveDraft(!advancedError && !hasDimensionErrors && !hasPriceErrors);
    switch (outcome.kind) {
      case 'saved':
        setSuccess('saved');
        break;
      case 'saved-unverified':
        setStatus('saved-unverified');
        break;
      case 'saved-after-interruption': {
        const currentDraft = workflow.getSnapshot().draft;
        const currentEditor = currentDraft ? initialEditor(currentDraft) : null;
        editorRef.current = currentEditor;
        setEditor(currentEditor);
        setSuccess('saved-after-interruption');
        break;
      }
      case 'conflict':
        if (outcome.draftReset) {
          const currentDraft = workflow.getSnapshot().draft;
          const currentEditor = currentDraft ? initialEditor(currentDraft) : null;
          editorRef.current = currentEditor;
          setEditor(currentEditor);
        }
        setWarning('save-conflict');
        break;
      case 'context-changed': {
        const currentDraft = workflow.getSnapshot().draft;
        const currentEditor = currentDraft ? initialEditor(currentDraft) : null;
        editorRef.current = currentEditor;
        setEditor(currentEditor);
        setWarning('context-changed');
        break;
      }
      case 'uncertain':
        setStatus('save-uncertain');
        break;
      case 'rejected':
        setValidationIssues(outcome.validationIssues);
        setFailure('save-rejected');
        break;
      case 'denied':
        clearPrivateUI();
        setFailure('authorization-required');
        break;
      case 'failed':
        setFailure('save-failed');
        break;
      case 'ignored':
        break;
    }
  }
  async function publish() {
    const outcome = await workflow.publish(!hasPriceErrors && !hasDimensionErrors);
    switch (outcome.kind) {
      case 'refreshed':
        setStatus('publication-refreshed');
        break;
      case 'pending':
        setStatus('publication-pending');
        break;
      case 'uncertain':
      case 'unrecoverable':
      case 'failed':
        setStatus(outcome.kind === 'unrecoverable' ? 'publication-unrecoverable' : 'publication-uncertain');
        break;
      case 'rejected':
        setWarning('publication-rejected');
        break;
      case 'denied':
        clearPrivateUI();
        setFailure('authorization-required');
        break;
      case 'ignored':
        break;
    }
  }
  async function findCopyProducts() {
    setCopyTarget('');
    const outcome = await workflow.searchCopyProducts(copyQuery);
    if (outcome.kind === 'denied') {
      clearPrivateUI();
      setFailure('authorization-required');
    } else if (outcome.kind === 'failed') {
      setFailure('copy-search-failed');
    }
  }
  async function copy() {
    const outcome = await workflow.copyTo(copyTarget, !hasPriceErrors && !hasDimensionErrors);
    if (outcome.kind === 'invalid-target') {
      setStatus('copy-invalid-target');
    } else if (outcome.kind === 'copied') {
      window.location.assign(outcome.path);
    } else if (outcome.kind === 'denied') {
      clearPrivateUI();
      setFailure('authorization-required');
    } else if (outcome.kind === 'failed') {
      setFailure('copy-failed');
    }
  }
  const geometry = draft ? viewGeometry(draft) : null;
  const selectedView = geometry?.views.find((item) => item.id === editor?.viewId);
  const selectedPlacement = draft?.placements.find((item) => item.id === editor?.selectedPlacementId);
  const selectedGeometry = selectedView?.placements.find((item) => item.id === editor?.selectedPlacementId);
  const selectedRect =
    selectedGeometry?.variantOverrides?.find((item) => item.variantId === editor?.variantId)?.rect ??
    selectedGeometry?.rect;
  const hasVariantChanges =
    !!editor?.variantId &&
    !!(
      selectedView?.variantImages.some((entry) => entry.variantId === editor.variantId) ||
      selectedView?.placements.some((placement) =>
        placement.variantOverrides?.some((entry) => entry.variantId === editor.variantId),
      )
    );
  const selectedStep = geometry?.steps.find((item) => item.id === editor?.selectedStepId);
  type LabelKind = Exclude<keyof NonNullable<MerchantDraft['labels']>, 'values'>;
  const labelFor = (kind: LabelKind, id: string) => draft?.labels?.[kind]?.[id] ?? '';
  const choiceLabel = (kind: LabelKind, id: string) => {
    const groups = {
      methods: { kind: 'method', items: draft?.methods ?? [] },
      placements: { kind: 'placement', items: draft?.placements ?? [] },
      steps: { kind: 'size', items: geometry?.steps ?? [] },
      views: { kind: 'view', items: geometry?.views ?? [] },
      options: { kind: 'option', items: draft?.productionOptions ?? [] },
      prices: { kind: 'price', items: draft?.pricingRules ?? [] },
    } as const;
    const group = groups[kind];
    if (kind === 'steps') {
      const names = group.items.map(
        (item, index) =>
          labelFor('steps', item.id).trim() ||
          translateUi('editor:configuration.choiceFallback', {
            kind: translateUi(choiceKindKey('size')),
            number: formatExactCount(BigInt(index + 1), formatLocale).formatted,
          }),
      );
      const contextual = names.map((name, index) => {
        if (names.filter((other) => other === name).length === 1) return name;
        const stepId = group.items[index]?.id;
        const areas = draft?.placements
          .filter((placement) => stepId && placement.allowedStepIds.includes(stepId))
          .map((placement) =>
            choiceName(
              (draft?.placements ?? []).map((item) => item.id),
              draft?.labels?.placements,
              placement.id,
              'placement',
              translateUi,
              formatLocale,
            ),
          );
        const context = areas?.length
          ? new Intl.ListFormat(formatLocale, { style: 'long', type: 'conjunction' }).format(areas)
          : translateUi('editor:configuration.notAssigned');
        return translateUi('editor:configuration.choiceWithContext', { name, context });
      });
      return (
        disambiguateNames(contextual, 'size', translateUi, formatLocale)[
          group.items.findIndex((item) => item.id === id)
        ] ?? translateUi('editor:configuration.choiceUnavailable', { kind: translateUi(choiceKindKey('size')) })
      );
    }
    return choiceName(
      group.items.map((item) => item.id),
      draft?.labels?.[kind],
      id,
      group.kind,
      translateUi,
      formatLocale,
    );
  };
  const placementStepLabel = (placementId: string, stepId: string) => {
    const ids = draft?.placements.find((placement) => placement.id === placementId)?.allowedStepIds ?? [];
    const labels = Object.fromEntries(ids.map((id) => [id, labelFor('steps', id).trim() || choiceLabel('steps', id)]));
    return choiceName(ids, labels, stepId, 'size', translateUi, formatLocale);
  };
  const invalidDimensionStep = geometry?.steps.find((step) => {
    const text = dimensionTexts[step.id];
    return text && !validProductionDimensions(text);
  });
  const hasDimensionErrors = !!invalidDimensionStep;
  const selectedDimensionText = selectedStep
    ? (dimensionTexts[selectedStep.id] ?? {
        width: selectedStep.physicalMm ? String(selectedStep.physicalMm.width) : '',
        height: selectedStep.physicalMm ? String(selectedStep.physicalMm.height) : '',
      })
    : { width: '', height: '' };
  function setProductionDimension(field: keyof ProductionDimensionText, value: string) {
    if (isEditorLocked() || !selectedStep) return;
    const text = { ...selectedDimensionText, [field]: value };
    setDimensionTexts((current) => ({ ...current, [selectedStep.id]: text }));
    workflow.markDraftEdited();
    setValidationIssues([]);
    if (!validProductionDimensions(text)) return;
    updateGeometry((current) => ({
      ...current,
      steps: current.steps.map((item) => {
        if (item.id !== selectedStep.id) return item;
        const step = { ...item };
        if (text.width.trim() === '' && text.height.trim() === '') delete step.physicalMm;
        else step.physicalMm = { width: Number(text.width), height: Number(text.height) };
        return step;
      }),
    }));
  }
  function revealInvalidDimensions() {
    if (!invalidDimensionStep) return;
    selectSetupStep('design');
    choose({ kind: 'select-step', stepId: invalidDimensionStep.id });
    setDimensionRecoveryOpen(true);
    requestAnimationFrame(() => {
      const text = dimensionTexts[invalidDimensionStep.id];
      const field = text && !positiveDimension(text.width) ? 'width' : 'height';
      const element = document.getElementById(`production-dimension-${field}`);
      element?.scrollIntoView({ block: 'center' });
      element?.focus({ preventScroll: true });
    });
  }
  const legacyPricing = draft ? !leanPricing(draft) : false;
  const priceCells =
    draft?.placements.flatMap((placement) =>
      placement.allowedMethodIds.flatMap((methodId) =>
        placement.allowedStepIds.map((stepId) => ({
          methodId,
          placementId: placement.id,
          stepId,
          key: JSON.stringify([methodId, placement.id, stepId]),
        })),
      ),
    ) ?? [];
  const priceRulesByCell = new Map<string, PricingRule>();
  for (const rule of draft?.pricingRules ?? []) {
    if (rule.scope.kind !== 'step' || !rule.scope.methodId) continue;
    const key = JSON.stringify([rule.scope.methodId, rule.scope.placementId, rule.scope.stepId]);
    if (!priceRulesByCell.has(key)) priceRulesByCell.set(key, rule);
  }
  const priceCellNames = disambiguateNames(
    priceCells.map(
      (cell) =>
        `${choiceLabel('methods', cell.methodId)} / ${choiceLabel('placements', cell.placementId)} / ${placementStepLabel(cell.placementId, cell.stepId)}`,
    ),
    'price-choice',
    translateUi,
    formatLocale,
  );
  const hasPriceErrors = priceCells.some((cell) => priceErrors[cell.key]);
  const pricePageSize = 25;
  const activePricePlacement = draft?.placements.some((item) => item.id === pricePlacementFilter)
    ? pricePlacementFilter
    : '';
  const activePriceMethod = draft?.methods.some((item) => item.id === priceMethodFilter) ? priceMethodFilter : '';
  const filteredPriceCells = priceCells
    .map((cell, index) => ({ ...cell, index }))
    .filter(
      (cell) =>
        (!activePricePlacement || cell.placementId === activePricePlacement) &&
        (!activePriceMethod || cell.methodId === activePriceMethod),
    );
  const currentPricePage = Math.min(pricePage, Math.max(0, Math.ceil(filteredPriceCells.length / pricePageSize) - 1));
  const visiblePriceCells = filteredPriceCells.slice(
    currentPricePage * pricePageSize,
    (currentPricePage + 1) * pricePageSize,
  );
  function revealInvalidPrice() {
    const index = priceCells.findIndex((cell) => priceErrors[cell.key]);
    const cell = priceCells[index];
    if (!cell) return;
    setPricePlacementFilter('');
    setPriceMethodFilter('');
    setPricePage(Math.floor(index / pricePageSize));
    selectSetupStep('prices');
    requestAnimationFrame(() => {
      const field = document.getElementById(`price-choice-${cell.key}`);
      field?.scrollIntoView({ block: 'center' });
      field?.focus({ preventScroll: true });
    });
  }

  const updateLeanPrice = (cell: (typeof priceCells)[number], amount: string) => {
    if (!draft || legacyPricing) return;
    const existing = draft.pricingRules.find(
      (rule) =>
        rule.scope.kind === 'step' &&
        rule.scope.methodId === cell.methodId &&
        rule.scope.placementId === cell.placementId &&
        rule.scope.stepId === cell.stepId,
    );
    const rules = draft.pricingRules.filter((rule) => rule !== existing);
    if (amount !== '') {
      const rule: PricingRule = {
        id: existing?.id ?? freshId('price'),
        role: 'unit',
        scope: { kind: 'step', placementId: cell.placementId, stepId: cell.stepId, methodId: cell.methodId },
        rate: { kind: 'fixed', amount: { shopDecimal: amount, presentmentOverrides: [] } },
      };
      change({
        ...draft,
        pricingRules: existing ? draft.pricingRules.map((item) => (item === existing ? rule : item)) : [...rules, rule],
      });
    } else
      change({
        ...draft,
        pricingRules: rules,
        labels: existing ? removeChoiceLabels(draft.labels, 'prices', existing.id) : draft.labels,
      });
  };
  const setLabel = (kind: LabelKind, id: string, value: string) => {
    if (!draft) return;
    const labels = { ...draft.labels };
    const group = { ...labels[kind] };
    if (value.trim()) group[id] = value;
    else delete group[id];
    labels[kind] = group;
    change({ ...draft, labels });
  };
  const valueLabel = (optionId: string, valueId: string) => draft?.labels?.values?.[optionId]?.[valueId] ?? '';
  const setValueLabel = (optionId: string, valueId: string, value: string) => {
    if (!draft) return;
    const labels = { ...draft.labels };
    const values = { ...labels.values };
    const group = { ...values[optionId] };
    if (value.trim()) group[valueId] = value;
    else delete group[valueId];
    if (Object.keys(group).length) values[optionId] = group;
    else delete values[optionId];
    labels.values = values;
    change({ ...draft, labels });
  };
  const setPlacement = (
    id: string,
    update: (placement: MerchantDraft['placements'][number]) => MerchantDraft['placements'][number],
  ) => {
    if (draft) change({ ...draft, placements: draft.placements.map((item) => (item.id === id ? update(item) : item)) });
  };
  const editorReturnPath = productEditorReturnPath(returnTo ?? null);
  const returnsToStorefront = editorReturnPath.startsWith('/admin/settings/storefront');
  const previewStatusKey = editorPreviewStatusKey(previewStatus);
  const statusMessageKey = status
    ? (
        {
          'session-verifying': 'editor:configuration.notice.sessionVerifying',
          'load-failed': 'editor:configuration.notice.loadFailed',
          'authorization-required': 'editor:configuration.notice.authorizationRequired',
          'product-unverified': 'editor:configuration.notice.productUnverified',
          'context-changed': 'editor:configuration.notice.contextChanged',
          'save-committed-after-return': 'editor:configuration.notice.saveCommittedAfterReturn',
          'save-conflict': 'editor:configuration.notice.saveConflict',
          'save-uncertain': 'editor:configuration.notice.saveUncertain',
          saved: 'editor:configuration.notice.saved',
          'saved-unverified': 'editor:configuration.notice.savedUnverified',
          'saved-after-interruption': 'editor:configuration.notice.savedAfterInterruption',
          'publication-refreshed': 'editor:configuration.notice.publicationRefreshed',
          'publication-pending': 'editor:configuration.notice.publicationPending',
          'publication-uncertain': 'editor:configuration.notice.publicationUncertain',
          'publication-unrecoverable': 'editor:configuration.notice.publicationUnrecoverable',
          'publication-rejected': 'editor:configuration.notice.publicationRejected',
          'publication-unavailable': 'editor:configuration.notice.publicationUnavailable',
          'publication-refresh-failed': 'editor:configuration.notice.publicationRefreshFailed',
          'save-rejected': 'editor:configuration.notice.saveRejected',
          'save-failed': 'editor:configuration.notice.saveFailed',
          'creation-failed': 'editor:configuration.notice.creationFailed',
          'copy-invalid-target': 'editor:configuration.notice.copyInvalidTarget',
          'copy-search-failed': 'editor:configuration.notice.copySearchFailed',
          'copy-failed': 'editor:configuration.notice.copyFailed',
          'geometry-change-rejected': 'editor:configuration.notice.geometryChangeRejected',
          'advanced-json-invalid': 'editor:configuration.notice.advancedJsonInvalid',
        } as const
      )[status]
    : undefined;
  return (
    <s-page
      inlineSize="large"
      heading={
        view?.product.title
          ? translateUi('editor:configuration.pageTitleWithName', { productName: view.product.title })
          : translateUi('editor:configuration.pageTitle')
      }
    >
      <s-button slot="secondary-actions" href="/admin/settings" icon="settings">
        {translateUi('editor:merchantConfigEditor.settings')}
      </s-button>

      <s-link slot="breadcrumb-actions" href={editorReturnPath}>
        {translateUi(
          returnsToStorefront
            ? 'editor:configuration.breadcrumbs.storefront'
            : 'editor:configuration.breadcrumbs.products',
        )}
      </s-link>
      {status && !loading && (
        <s-banner tone={statusTone} slot="supplemental-start">
          <div id="setup-read-status" tabIndex={-1} role={statusTone === 'critical' ? 'alert' : 'status'}>
            {statusMessageKey && <s-paragraph>{translateUi(statusMessageKey)}</s-paragraph>}
          </div>
        </s-banner>
      )}
      {view?.config && !draft && !loading && (
        <s-banner
          heading={translateUi('editor:merchantConfigEditor.savedSetupUnavailable')}
          tone="warning"
          slot="supplemental-start"
        >
          <div id="unsupported-setup-recovery" tabIndex={-1}>
            <s-stack gap="base">
              <s-paragraph>
                {translateUi(
                  'editor:merchantConfigEditor.yourSavedSetupHasnTBeenChangedReloadItToTryAgainIfItStillWonTOpenContactInsigniaSupport',
                )}
              </s-paragraph>
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-button onClick={() => void reloadSavedSetup()}>
                  {translateUi('editor:merchantConfigEditor.reloadSetup')}
                </s-button>
                <s-button variant="tertiary" href={editorReturnPath}>
                  {translateUi(
                    returnsToStorefront
                      ? 'editor:configuration.breadcrumbs.backToStorefront'
                      : 'editor:configuration.breadcrumbs.backToProducts',
                  )}
                </s-button>
              </s-stack>
            </s-stack>
          </div>
        </s-banner>
      )}
      {view === null && !loading && (
        <s-button disabled={loading} onClick={() => void load(true)}>
          {translateUi('editor:merchantConfigEditor.retrySession')}
        </s-button>
      )}
      {loading && (
        <s-section>
          <s-stack gap="base">
            <AdminSkeleton
              variant="form"
              label={translateUi('editor:merchantConfigEditor.loadingProductConfiguration')}
              rows={4}
            />
          </s-stack>
        </s-section>
      )}
      {view && (
        <>
          {!view.config && (
            <s-section heading={view.product.title}>
              <s-stack gap="base">
                <s-paragraph>
                  {translateUi('editor:configuration.productStatusPrefix', {
                    status: translateUi(productStatusKey(view.product.status)),
                  })}
                </s-paragraph>
                {view.product.imageUrl && (
                  <s-thumbnail
                    src={view.product.imageUrl}
                    size="large"
                    alt={translateUi('editor:merchantConfigEditor.productPreview')}
                  />
                )}
                {!view.config && (
                  <s-button variant="primary" loading={busy} disabled={busy} onClick={() => void create()}>
                    {translateUi('editor:merchantConfigEditor.createConfiguration')}
                  </s-button>
                )}
              </s-stack>
            </s-section>
          )}
          {view.config && draft && geometry && editor && (
            <>
              <s-modal
                ref={choiceRemoval}
                id="remove-product-choice"
                heading={
                  removingChoice?.kind === 'view'
                    ? translateUi('editor:configurationExtra.removeViewHeading')
                    : removingChoice?.kind === 'step'
                      ? translateUi('editor:configurationExtra.removeSizeHeading')
                      : translateUi('editor:configurationExtra.removeAreaHeading')
                }
                onHide={() => setRemovingChoice(null)}
              >
                <s-stack gap="base">
                  <s-paragraph>
                    {removingChoice?.kind === 'view'
                      ? translateUi('editor:configurationExtra.removeViewBody')
                      : removingChoice?.kind === 'step'
                        ? translateUi('editor:configurationExtra.removeSizeBody')
                        : translateUi('editor:configurationExtra.removeAreaBody')}
                  </s-paragraph>
                  <s-paragraph>
                    {translateUi('editor:merchantConfigEditor.publishedSettingsChangeAfterYouSaveAndPublishThisDraft')}
                  </s-paragraph>
                </s-stack>
                <s-button
                  slot="primary-action"
                  variant="primary"
                  tone="critical"
                  disabled={editLocked || !removingChoice}
                  onClick={() => {
                    if (!removingChoice) return;
                    change(removeProductDraftChoice(draft, removingChoice));
                    setRemovingChoice(null);
                  }}
                >
                  {translateUi('editor:merchantConfigEditor.removeFromDraft')}
                </s-button>
                <s-button slot="secondary-actions" commandFor="remove-product-choice" command="--hide">
                  {translateUi('editor:merchantConfigEditor.cancel')}
                </s-button>
              </s-modal>
              <s-modal
                ref={methodRemoval}
                id="remove-product-method"
                heading={translateUi('editor:merchantConfigEditor.removeProductMethod')}
                onHide={() => setRemovingMethod(null)}
              >
                <s-paragraph>
                  {translateUi('editor:configurationExtra.removeMethodBody', {
                    methodName: removingMethod
                      ? choiceLabel('methods', removingMethod)
                      : translateUi('editor:configurationExtra.thisMethod'),
                  })}
                </s-paragraph>
                <s-button
                  slot="primary-action"
                  tone="critical"
                  variant="primary"
                  disabled={editLocked || !removingMethod}
                  onClick={() => {
                    if (!removingMethod) return;
                    const removedPrices = draft.pricingRules.filter(
                      (rule) => 'methodId' in rule.scope && rule.scope.methodId === removingMethod,
                    );
                    let labels = removeChoiceLabels(draft.labels, 'methods', removingMethod);
                    for (const rule of removedPrices) labels = removeChoiceLabels(labels, 'prices', rule.id);
                    change({
                      ...draft,
                      methods: draft.methods.filter((item) => item.id !== removingMethod),
                      placements: draft.placements.map((placement) => ({
                        ...placement,
                        allowedMethodIds: placement.allowedMethodIds.filter((id) => id !== removingMethod),
                      })),
                      pricingRules: draft.pricingRules.filter((rule) => !removedPrices.includes(rule)),
                      labels,
                    });
                    setRemovingMethod(null);
                  }}
                >
                  {translateUi('editor:merchantConfigEditor.removeMethodAndPrices')}
                </s-button>
                <s-button slot="secondary-actions" commandFor="remove-product-method" command="--hide">
                  {translateUi('editor:merchantConfigEditor.cancel')}
                </s-button>
              </s-modal>
              <s-box minInlineSize="0">
                <s-stack gap="base">
                  {invalidDimensionStep && (
                    <s-banner tone="critical">
                      {translateUi('editor:configurationExtra.invalidDimensions', {
                        sizeName: choiceLabel('steps', invalidDimensionStep.id),
                      })}{' '}
                      <s-button onClick={revealInvalidDimensions}>
                        {translateUi('editor:merchantConfigEditor.reviewProductionDimensions')}
                      </s-button>
                    </s-banner>
                  )}
                  <s-box id="editor-flow">
                    <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="end">
                      <s-select
                        label={translateUi('editor:merchantConfigEditor.configurationSection')}
                        value={setupStep}
                        onChange={(event) => {
                          const selected = event.currentTarget.value;
                          const step = setupSteps.find((item) => item.id === selected);
                          if (step || selected === 'all') selectSetupStep(step?.id ?? 'all');
                        }}
                      >
                        {setupSteps.map((step, index) => (
                          <s-option key={step.id} value={step.id}>
                            {formatExactCount(BigInt(index + 1), formatLocale).formatted}. {setupStepLabel(step.id)}
                          </s-option>
                        ))}
                        <s-option value="all">{translateUi('editor:merchantConfigEditor.allSettings')}</s-option>
                      </s-select>
                      <s-button
                        onClick={() => {
                          selectSetupStep('design');
                          focusPlacementPreview();
                        }}
                        variant="tertiary"
                        icon="image"
                      >
                        {translateUi('editor:merchantConfigEditor.preview')}
                      </s-button>
                    </s-grid>
                    <div id="setup-stage-heading" tabIndex={-1}>
                      <s-text color="subdued">
                        {currentSetup
                          ? translateUi('editor:configuration.progress', {
                              step: formatExactCount(BigInt(setupIndex + 1), formatLocale).formatted,
                              total: formatExactCount(BigInt(setupSteps.length), formatLocale).formatted,
                              section: setupStepLabel(currentSetup.id),
                            })
                          : setupStepLabel('all')}
                      </s-text>
                    </div>
                  </s-box>
                  <s-stack gap="base">
                    <section
                      class="admin-setup-panel"
                      aria-label={translateUi('editor:merchantConfigEditor.productRules')}
                      hidden={!visibleStage('rules')}
                    >
                      <s-stack gap="base">
                        <s-section
                          id="customization-rules"
                          heading={translateUi('editor:merchantConfigEditor.customizationRules')}
                        >
                          <s-stack gap="base">
                            <s-select
                              value={draft.mode}
                              onChange={(event) =>
                                change({ ...draft, mode: event.currentTarget.value as MerchantDraft['mode'] })
                              }
                              label={translateUi('editor:configurationExtra.customizationMode')}
                              disabled={editLocked}
                            >
                              <s-option value="optional">
                                {translateUi('editor:merchantConfigEditor.optional')}
                              </s-option>
                              <s-option value="required">
                                {translateUi('editor:merchantConfigEditor.requiredForAllPurchases')}
                              </s-option>
                            </s-select>
                            <s-paragraph>
                              {translateUi('editor:configurationExtra.draftCurrency', { currency: draft.shopCurrency })}
                            </s-paragraph>
                            {view.config.currentShopCurrency &&
                              view.config.currentShopCurrency !== draft.shopCurrency && (
                                <div role="alert">
                                  <s-paragraph>
                                    {translateUi('editor:configurationExtra.currentCurrencyChanged', {
                                      currency: view.config.currentShopCurrency,
                                    })}
                                  </s-paragraph>
                                  <s-button
                                    type="button"
                                    onClick={() => {
                                      const currency = view.config?.currentShopCurrency;
                                      if (currency) change({ ...draft, shopCurrency: currency });
                                    }}
                                    disabled={editLocked}
                                    icon="check"
                                  >
                                    {translateUi('editor:merchantConfigEditor.useCurrentShopCurrency')}
                                  </s-button>
                                </div>
                              )}
                          </s-stack>
                        </s-section>
                        <s-section heading={translateUi('editor:merchantConfigEditor.decorationMethods')}>
                          <s-stack gap="base">
                            <s-paragraph>
                              {translateUi(
                                'editor:merchantConfigEditor.chooseReusableMethodsFromSettingsOrAddAProductSpecificMethodSetThisProductSPricesAndAllowe',
                              )}
                            </s-paragraph>
                            <s-stack direction="inline" gap="base" alignItems="center">
                              <s-button
                                disabled={editLocked || libraryLoading}
                                onClick={() => void loadMethodLibrary()}
                              >
                                {translateUi('editor:merchantConfigEditor.chooseFromLibrary')}
                              </s-button>
                              <s-link href="/admin/methods" target="_blank">
                                {translateUi('editor:merchantConfigEditor.manageMethodLibrary')}
                              </s-link>
                            </s-stack>
                            {libraryLoading && (
                              <AdminSkeleton
                                label={translateUi('editor:merchantConfigEditor.loadingMethodLibrary')}
                                rows={1}
                              />
                            )}
                            {libraryError && (
                              <s-banner tone="critical">
                                {translateUi('editor:configuration.libraryUnavailable')}
                              </s-banner>
                            )}
                            {library && !libraryLoading && (
                              <s-box padding="base" background="subdued">
                                {library.length ? (
                                  <>
                                    <s-select
                                      label={translateUi('editor:merchantConfigEditor.libraryMethod')}
                                      value={libraryChoice}
                                      onChange={(event) => setLibraryChoice(event.currentTarget.value)}
                                      disabled={editLocked}
                                    >
                                      {library.map((method) => (
                                        <s-option key={method.id} value={method.id}>
                                          {method.name}
                                        </s-option>
                                      ))}
                                    </s-select>
                                    <s-button
                                      disabled={editLocked || !libraryChoice}
                                      onClick={() => {
                                        const source = library.find((method) => method.id === libraryChoice);
                                        if (!source) return;
                                        const id = freshId('method');
                                        change({
                                          ...draft,
                                          methods: [...draft.methods, { id }],
                                          labels: {
                                            ...draft.labels,
                                            methods: { ...draft.labels?.methods, [id]: source.name },
                                          },
                                        });
                                      }}
                                    >
                                      {translateUi('editor:merchantConfigEditor.addSelectedMethod')}
                                    </s-button>
                                    <s-paragraph>
                                      {translateUi(
                                        'editor:merchantConfigEditor.thisAddsAnUnsavedCopyConfigureItsPricesAndPrintAreasBeforePublishing',
                                      )}
                                    </s-paragraph>
                                  </>
                                ) : (
                                  <s-paragraph>
                                    {translateUi(
                                      'editor:merchantConfigEditor.yourLibraryIsEmptyAddYourStoreSMethodsInSettingsThenChooseFromTheLibraryAgain',
                                    )}
                                  </s-paragraph>
                                )}
                              </s-box>
                            )}

                            {draft.methods.map((method) => (
                              <s-stack gap="small" key={method.id}>
                                <s-text type="strong">{choiceLabel('methods', method.id)}</s-text>{' '}
                                <s-text-field
                                  maxLength={80}
                                  value={labelFor('methods', method.id)}
                                  onInput={(event) => setLabel('methods', method.id, event.currentTarget.value)}
                                  label={translateUi('editor:configurationExtra.methodName')}
                                  disabled={editLocked}
                                />{' '}
                                <s-button
                                  type="button"
                                  onClick={() => setRemovingMethod(method.id)}
                                  disabled={editLocked}
                                  icon="delete"
                                >
                                  {translateUi('editor:merchantConfigEditor.removeMethod')}
                                </s-button>
                              </s-stack>
                            ))}
                            <s-button
                              type="button"
                              onClick={() =>
                                change({ ...draft, methods: [...draft.methods, { id: freshId('method') }] })
                              }
                              disabled={editLocked}
                              icon="plus"
                            >
                              {translateUi('editor:merchantConfigEditor.addMethod')}
                            </s-button>
                          </s-stack>
                        </s-section>
                      </s-stack>
                    </section>
                    <section
                      class="admin-setup-panel"
                      aria-label={translateUi('editor:merchantConfigEditor.imagesAndPrintAreas')}
                      hidden={!visibleStage('design')}
                    >
                      <s-stack gap="base">
                        <s-section
                          id="product-images"
                          heading={translateUi('editor:merchantConfigEditor.productViews')}
                        >
                          <s-stack gap="base">
                            <div class="placement-context">
                              <s-stack gap="small">
                                {geometry.views.length > 8 && (
                                  <s-search-field
                                    label={translateUi('editor:merchantConfigEditor.findAView')}
                                    value={viewFilter}
                                    onInput={(event) => setViewFilter(event.currentTarget.value)}
                                  />
                                )}
                                <s-select
                                  value={editor.viewId}
                                  onChange={(event) =>
                                    choose({ kind: 'select-view', viewId: event.currentTarget.value })
                                  }
                                  label={translateUi('editor:configurationExtra.view')}
                                  disabled={editLocked}
                                >
                                  {geometry.views
                                    .filter(
                                      (item) =>
                                        item.id === editor.viewId ||
                                        choiceLabel('views', item.id)
                                          .toLocaleLowerCase()
                                          .includes(viewFilter.toLocaleLowerCase()),
                                    )
                                    .map((item) => (
                                      <s-option key={item.id} value={item.id}>
                                        {choiceLabel('views', item.id)}
                                      </s-option>
                                    ))}
                                </s-select>
                              </s-stack>
                              <s-stack gap="small">
                                {view.product.variants.length > 12 && (
                                  <s-search-field
                                    label={translateUi('editor:merchantConfigEditor.findAVariant')}
                                    value={variantFilter}
                                    onInput={(event) => setVariantFilter(event.currentTarget.value)}
                                  />
                                )}
                                <s-select
                                  value={editor.variantId ?? noSelection}
                                  onChange={(event) =>
                                    choose({
                                      kind: 'select-variant',
                                      variantId: selectedValue(event.currentTarget.value),
                                    })
                                  }
                                  label={translateUi('editor:configurationExtra.productVariant')}
                                  disabled={editLocked}
                                >
                                  <s-option value={noSelection}>
                                    {translateUi('editor:merchantConfigEditor.sharedAcrossVariants')}
                                  </s-option>
                                  {view.product.variants
                                    .filter(
                                      (item) =>
                                        'variant_' + numberOf(item.id) === editor.variantId ||
                                        item.title.toLocaleLowerCase().includes(variantFilter.toLocaleLowerCase()),
                                    )
                                    .map((item) => (
                                      <s-option key={item.id} value={'variant_' + numberOf(item.id)}>
                                        {item.title}
                                      </s-option>
                                    ))}
                                </s-select>
                              </s-stack>
                              <s-button
                                type="button"
                                onClick={() => {
                                  const id = freshId('view');
                                  updateGeometry((value) => ({
                                    ...value,
                                    views: [...value.views, { id, variantImages: [], placements: [] }],
                                  }));
                                  choose({ kind: 'select-view', viewId: id });
                                }}
                                disabled={editLocked}
                                icon="plus"
                              >
                                {translateUi('editor:merchantConfigEditor.addView')}
                              </s-button>
                            </div>
                            <PlacementDetails
                              label={translateUi('editor:merchantConfigEditor.viewNameAndImage')}
                              expanded={setupStep === 'all'}
                            >
                              <s-stack gap="base">
                                <s-text-field
                                  maxLength={80}
                                  value={labelFor('views', editor.viewId)}
                                  onInput={(event) => setLabel('views', editor.viewId, event.currentTarget.value)}
                                  label={translateUi('editor:configurationExtra.viewName')}
                                  disabled={editLocked}
                                />
                                <s-button
                                  tone="critical"
                                  disabled={editLocked || geometry.views.length <= 1}
                                  onClick={() => setRemovingChoice({ kind: 'view', id: editor.viewId })}
                                >
                                  {translateUi('editor:merchantConfigEditor.removeView')}
                                </s-button>
                                {selectedImage ? (
                                  <s-stack direction="inline" gap="base" alignItems="center">
                                    <s-thumbnail
                                      src={selectedImage}
                                      alt={translateUi('editor:merchantConfigEditor.selectedShopifyProductImage')}
                                      size="large"
                                    />
                                    <s-text color="subdued">
                                      {editor.variantId
                                        ? translateUi('editor:configurationExtra.variantImageDescription')
                                        : translateUi('editor:configurationExtra.sharedImageDescription')}
                                    </s-text>
                                  </s-stack>
                                ) : (
                                  <s-paragraph>
                                    {translateUi(
                                      'editor:merchantConfigEditor.addAProductImageInShopifyBeforeAssigningAnImageToThisView',
                                    )}
                                  </s-paragraph>
                                )}
                                {view.product.variantsTruncated && (
                                  <div role="alert">
                                    <s-paragraph>
                                      {translateUi(
                                        'editor:merchantConfigEditor.thisProductHasMoreThan500VariantsOnlyTheFirst500AreAvailableHereReviewTheFullCatalogBefore',
                                      )}
                                    </s-paragraph>
                                  </div>
                                )}
                                <s-button
                                  type="button"
                                  disabled={editLocked || !selectedImage || !imageSize}
                                  onClick={() => {
                                    if (!selectedImage || !imageSize || !selectedView) return;
                                    const ref = {
                                      revisionId: editor.variantId ?? `product_${productId}`,
                                      ...imageSize,
                                    };
                                    updateGeometry((value) => ({
                                      ...value,
                                      views: value.views.map((item) =>
                                        item.id !== editor.viewId
                                          ? item
                                          : editor.variantId
                                            ? {
                                                ...item,
                                                variantImages: [
                                                  ...item.variantImages.filter(
                                                    (entry) => entry.variantId !== editor.variantId,
                                                  ),
                                                  { variantId: editor.variantId!, image: ref },
                                                ],
                                              }
                                            : { ...item, image: ref },
                                      ),
                                    }));
                                  }}
                                  icon="check"
                                >
                                  {translateUi('editor:merchantConfigEditor.useSelectedProductImage')}
                                </s-button>
                                {editor.variantId &&
                                  selectedView?.variantImages.some((entry) => entry.variantId === editor.variantId) && (
                                    <s-button
                                      disabled={editLocked}
                                      onClick={() =>
                                        updateGeometry((value) => ({
                                          ...value,
                                          views: value.views.map((item) =>
                                            item.id === editor.viewId
                                              ? {
                                                  ...item,
                                                  variantImages: item.variantImages.filter(
                                                    (entry) => entry.variantId !== editor.variantId,
                                                  ),
                                                }
                                              : item,
                                          ),
                                        }))
                                      }
                                    >
                                      {translateUi('editor:merchantConfigEditor.useSharedImage')}
                                    </s-button>
                                  )}
                              </s-stack>
                            </PlacementDetails>
                            <s-paragraph color="subdued">
                              {editor.variantId
                                ? hasVariantChanges
                                  ? translateUi('editor:configurationExtra.variantOwnArea')
                                  : translateUi('editor:configurationExtra.variantSharedArea')
                                : translateUi('editor:configurationExtra.variantScope')}
                            </s-paragraph>
                          </s-stack>
                        </s-section>
                        <div class="placement-workspace">
                          <div class="placement-preview">
                            <s-section
                              id="product-preview"
                              heading={translateUi('editor:merchantConfigEditor.livePreview')}
                            >
                              <s-stack gap="base">
                                <s-paragraph>
                                  {choiceLabel('views', editor.viewId)}
                                  {editor.variantId
                                    ? ` · ${view.product.variants.find((item) => 'variant_' + numberOf(item.id) === editor.variantId)?.title ?? 'Selected variant'}`
                                    : translateUi('editor:configurationExtra.sharedAcrossVariants')}
                                </s-paragraph>
                                {!selectedView?.image &&
                                  !selectedView?.variantImages.some(
                                    (entry) => entry.variantId === editor.variantId,
                                  ) && (
                                    <s-paragraph>
                                      {translateUi(
                                        'editor:merchantConfigEditor.openViewNameAndImageThenUseTheSelectedProductImageToPreviewThisView',
                                      )}
                                    </s-paragraph>
                                  )}
                                {(selectedView?.placements.length ?? 0) > 8 && (
                                  <s-search-field
                                    label={translateUi('editor:merchantConfigEditor.findAPrintArea')}
                                    value={placementFilter}
                                    onInput={(event) => setPlacementFilter(event.currentTarget.value)}
                                  />
                                )}
                                <s-select
                                  value={editor.selectedPlacementId ?? noSelection}
                                  onChange={(event) =>
                                    choose({
                                      kind: 'select-placement',
                                      placementId: selectedValue(event.currentTarget.value),
                                    })
                                  }
                                  label={translateUi('editor:merchantConfigEditor.printArea')}
                                  disabled={editLocked}
                                >
                                  <s-option value={noSelection}>
                                    {translateUi('editor:merchantConfigEditor.chooseAPrintArea')}
                                  </s-option>
                                  {selectedView?.placements
                                    .filter(
                                      (item) =>
                                        item.id === editor.selectedPlacementId ||
                                        choiceLabel('placements', item.id)
                                          .toLocaleLowerCase()
                                          .includes(placementFilter.toLocaleLowerCase()),
                                    )
                                    .map((item) => (
                                      <s-option key={item.id} value={item.id}>
                                        {choiceLabel('placements', item.id)}
                                      </s-option>
                                    ))}
                                </s-select>
                                <s-button
                                  type="button"
                                  onClick={() => {
                                    const id = freshId('place');
                                    change({
                                      ...draft,
                                      placements: [
                                        ...draft.placements,
                                        { id, allowedMethodIds: [], allowedStepIds: [], logoLaterAllowed: true },
                                      ],
                                      geometry: {
                                        ...geometry,
                                        views: geometry.views.map((item) =>
                                          item.id === editor.viewId
                                            ? { ...item, placements: [...item.placements, { id, rect: defaultRect() }] }
                                            : item,
                                        ),
                                      },
                                    });
                                    choose({ kind: 'select-placement', placementId: id });
                                  }}
                                  disabled={editLocked}
                                  icon="plus"
                                >
                                  {translateUi('editor:merchantConfigEditor.addPlacementToView')}
                                </s-button>

                                <s-select
                                  value={editor.selectedStepId ?? noSelection}
                                  onChange={(event) =>
                                    choose({ kind: 'select-step', stepId: selectedValue(event.currentTarget.value) })
                                  }
                                  label={translateUi('editor:merchantConfigEditor.printSize')}
                                  disabled={editLocked}
                                >
                                  <s-option value={noSelection}>
                                    {translateUi('editor:merchantConfigEditor.none')}
                                  </s-option>
                                  {geometry.steps.map((item) => (
                                    <s-option key={item.id} value={item.id}>
                                      {choiceLabel('steps', item.id)}
                                    </s-option>
                                  ))}
                                </s-select>
                                <s-paragraph color="subdued">
                                  {translateUi(
                                    'editor:merchantConfigEditor.dragTheSelectedPrintAreaToMoveItDragACornerHandleToResizeIt',
                                  )}
                                </s-paragraph>
                                <s-box border="base" borderRadius="base" overflow="hidden" background="subdued">
                                  <div
                                    role="img"
                                    tabIndex={-1}
                                    id="insignia-visualizer"
                                    data-preview-state={previewStatus}
                                    data-editor-version={editor.version}
                                    data-selected-placement={editor.selectedPlacementId ?? ''}
                                    data-publication-state={JSON.stringify({
                                      state: view.config.publication.state,
                                      revisionId: view.config.publication.revisionId,
                                      sourceDraftVersion: view.config.publication.sourceDraftVersion,
                                    })}
                                    aria-label={translateUi('editor:merchantConfigEditor.productPlacementPreview')}
                                  ></div>
                                </s-box>
                                {selectedPlacement && selectedRect && (
                                  <PlacementDetails
                                    label={translateUi('editor:merchantConfigEditor.precisePositionAndSize')}
                                    expanded={setupStep === 'all'}
                                  >
                                    <s-stack gap="base">
                                      <s-paragraph>
                                        {translateUi(
                                          'editor:merchantConfigEditor.positionSetsTheCenterOfThePrintAreaMeasuredFromTheLeftAndTopOfTheImageWidthAndHeightSetIts',
                                        )}
                                      </s-paragraph>
                                      <s-grid gridTemplateColumns="repeat(2, minmax(0, 1fr))" gap="base">
                                        {(['centerX', 'centerY', 'width', 'height'] as const).map((field) => (
                                          <RectNumberInput
                                            id={`placement-rect-${field}`}
                                            key={JSON.stringify([
                                              productId,
                                              editor.viewId,
                                              editor.variantId,
                                              selectedPlacement.id,
                                              field,
                                            ])}
                                            value={selectedRect[field]}
                                            onInput={(value) => {
                                              if (!Number.isFinite(value)) return;
                                              const rect = { ...selectedRect, [field]: value };
                                              try {
                                                validateRect(rect);
                                              } catch {
                                                // Keep incomplete typing in the DOM; it is not geometry authority.
                                                return;
                                              }
                                              choose({
                                                kind: 'set-placement-rect',
                                                viewId: editor.viewId,
                                                variantId: editor.variantId,
                                                placementId: selectedPlacement.id,
                                                rect,
                                              });
                                            }}
                                            onChange={(value) => {
                                              if (Number.isFinite(value) && value !== selectedRect[field])
                                                choose({
                                                  kind: 'set-placement-rect',
                                                  viewId: editor.viewId,
                                                  variantId: editor.variantId,
                                                  placementId: selectedPlacement.id,
                                                  rect: { ...selectedRect, [field]: value },
                                                });
                                            }}
                                            label={
                                              {
                                                centerX: translateUi('editor:configurationExtra.horizontalPosition'),
                                                centerY: translateUi('editor:configurationExtra.verticalPosition'),
                                                width: translateUi('editor:configurationExtra.areaWidth'),
                                                height: translateUi('editor:configurationExtra.areaHeight'),
                                              }[field]
                                            }
                                            disabled={editLocked}
                                          />
                                        ))}
                                      </s-grid>
                                    </s-stack>
                                  </PlacementDetails>
                                )}
                                {previewStatusKey && (
                                  <div role="status">
                                    <s-paragraph>{translateUi(previewStatusKey)}</s-paragraph>
                                  </div>
                                )}
                                <PlacementDetails
                                  label={translateUi('editor:merchantConfigEditor.decorationSizeSettings')}
                                  expanded={setupStep === 'all' || dimensionRecoveryOpen}
                                >
                                  <s-stack gap="base">
                                    <s-paragraph>
                                      {translateUi(
                                        'editor:merchantConfigEditor.theseAreArtworkSizesSeparateFromGarmentSizesChangesApplyToEveryPrintAreaThatUsesThisSizePr',
                                      )}
                                    </s-paragraph>

                                    {selectedStep && (
                                      <s-text-field
                                        maxLength={80}
                                        value={labelFor('steps', selectedStep.id)}
                                        onInput={(event) =>
                                          setLabel('steps', selectedStep.id, event.currentTarget.value)
                                        }
                                        label={translateUi('editor:configurationExtra.sizeName')}
                                        disabled={editLocked}
                                      />
                                    )}
                                    <s-button
                                      type="button"
                                      onClick={() => {
                                        const id = freshId('step');
                                        updateGeometry((value) => ({
                                          ...value,
                                          steps: [...value.steps, { id, widthFraction: 0.5, heightFraction: 0.5 }],
                                        }));
                                        choose({ kind: 'select-step', stepId: id });
                                      }}
                                      disabled={editLocked}
                                      icon="plus"
                                    >
                                      {translateUi('editor:merchantConfigEditor.addSizeStep')}
                                    </s-button>
                                    {selectedStep && (
                                      <s-button
                                        tone="critical"
                                        disabled={editLocked}
                                        onClick={() => setRemovingChoice({ kind: 'step', id: selectedStep.id })}
                                      >
                                        {translateUi('editor:merchantConfigEditor.removeDecorationSize')}
                                      </s-button>
                                    )}
                                    {selectedStep &&
                                      (['widthFraction', 'heightFraction'] as const).map((field) => (
                                        <s-number-field
                                          min={0.1}
                                          max={100}
                                          step={1}
                                          suffix="%"
                                          inputMode="decimal"
                                          value={String(Number((selectedStep[field] * 100).toFixed(6)))}
                                          onChange={(event) => {
                                            const value = Number(event.currentTarget.value) / 100;
                                            updateGeometry((current) => ({
                                              ...current,
                                              steps: current.steps.map((item) =>
                                                item.id === selectedStep.id ? { ...item, [field]: value } : item,
                                              ),
                                            }));
                                          }}
                                          label={
                                            {
                                              widthFraction: translateUi('editor:configurationExtra.widthRelative'),
                                              heightFraction: translateUi('editor:configurationExtra.heightRelative'),
                                            }[field]
                                          }
                                          disabled={editLocked}
                                          key={field}
                                        />
                                      ))}
                                  </s-stack>
                                  {selectedStep && (
                                    <s-stack gap="base">
                                      <s-text type="strong">
                                        {translateUi('editor:merchantConfigEditor.productionDimensions')}
                                      </s-text>
                                      <s-paragraph color="subdued">
                                        {translateUi(
                                          'editor:merchantConfigEditor.optionalDimensionsInMillimetresForTheProductionSheetEnterTheIntendedArtworkSizeManuallyThe',
                                        )}
                                      </s-paragraph>
                                      <s-grid gridTemplateColumns="repeat(2, minmax(0, 1fr))" gap="base">
                                        {(['width', 'height'] as const).map((field) => (
                                          <s-number-field
                                            key={field}
                                            id={`production-dimension-${field}`}
                                            label={
                                              field === 'width'
                                                ? translateUi('editor:configurationExtra.productionWidth')
                                                : translateUi('editor:configurationExtra.productionHeight')
                                            }
                                            suffix="mm"
                                            inputMode="decimal"
                                            min={0}
                                            step={0.01}
                                            value={selectedDimensionText[field]}
                                            error={
                                              !validProductionDimensions(selectedDimensionText) &&
                                              !positiveDimension(selectedDimensionText[field])
                                                ? translateUi(
                                                    field === 'width'
                                                      ? 'editor:configurationExtra.invalidWidth'
                                                      : 'editor:configurationExtra.invalidHeight',
                                                  )
                                                : undefined
                                            }
                                            onInput={(event) =>
                                              setProductionDimension(field, event.currentTarget.value)
                                            }
                                            disabled={editLocked}
                                          />
                                        ))}
                                      </s-grid>
                                    </s-stack>
                                  )}
                                </PlacementDetails>
                                <PlacementDetails
                                  label={translateUi('editor:merchantConfigEditor.trySampleArtwork')}
                                  expanded={setupStep === 'all'}
                                >
                                  <ArtworkUpload
                                    disabled={busy}
                                    onAuthenticationDenied={authorizationDenied}
                                    onPreview={(preview) => {
                                      const current = editorRef.current;
                                      if (!current) return;
                                      const next: EditorState = {
                                        ...current,
                                        artwork: preview
                                          ? { kind: 'raster', url: preview.url, aspectRatio: preview.aspectRatio }
                                          : { kind: 'logo-later' },
                                      };
                                      editorRef.current = next;
                                      setEditor(next);
                                      updateRenderer(next);
                                    }}
                                  />
                                </PlacementDetails>
                              </s-stack>
                            </s-section>
                          </div>
                          <div class="placement-settings">
                            <s-section
                              heading={
                                selectedPlacement
                                  ? translateUi('editor:configurationExtra.namedAreaSettings', {
                                      placementName: choiceLabel('placements', selectedPlacement.id),
                                    })
                                  : translateUi('editor:configurationExtra.printAreaSettings')
                              }
                            >
                              <s-stack gap="base">
                                {!selectedPlacement && (selectedView?.placements.length ?? 0) > 0 && (
                                  <s-paragraph>
                                    {translateUi(
                                      'editor:merchantConfigEditor.chooseAPrintAreaInThePreviewToEditItsMethodsAndDecorationSizes',
                                    )}
                                  </s-paragraph>
                                )}
                                {selectedView?.placements.length === 0 && (
                                  <s-paragraph>
                                    {translateUi(
                                      'editor:merchantConfigEditor.thisViewHasNoPrintAreasAddOneToStartPositioningArtwork',
                                    )}
                                  </s-paragraph>
                                )}
                                {selectedPlacement && selectedRect && (
                                  <s-stack gap="base">
                                    <s-button variant="tertiary" icon="image" onClick={focusPlacementPreview}>
                                      {translateUi('editor:merchantConfigEditor.positionOnPreview')}
                                    </s-button>
                                    <s-text-field
                                      maxLength={80}
                                      value={labelFor('placements', selectedPlacement.id)}
                                      onInput={(event) =>
                                        setLabel('placements', selectedPlacement.id, event.currentTarget.value)
                                      }
                                      label={translateUi('editor:configurationExtra.placementName')}
                                      disabled={editLocked}
                                    />
                                    <s-button
                                      tone="critical"
                                      disabled={editLocked}
                                      onClick={() =>
                                        setRemovingChoice({
                                          kind: 'placement',
                                          id: selectedPlacement.id,
                                          viewId: editor.viewId,
                                        })
                                      }
                                    >
                                      {translateUi('editor:merchantConfigEditor.removePrintArea')}
                                    </s-button>

                                    <s-checkbox
                                      checked={selectedPlacement.logoLaterAllowed}
                                      onChange={(event) =>
                                        setPlacement(selectedPlacement.id, (item) => ({
                                          ...item,
                                          logoLaterAllowed: event.currentTarget.checked,
                                        }))
                                      }
                                      label={translateUi('editor:configurationExtra.allowLogoLater')}
                                      disabled={editLocked}
                                    />
                                    {selectedPlacement.logoLaterAllowed && (
                                      <s-paragraph color="subdued">
                                        {translateUi(
                                          'editor:merchantConfigEditor.customersCanOrderWithoutArtworkYouAddTheirArtworkFromTheOrderAfterPurchase',
                                        )}
                                      </s-paragraph>
                                    )}
                                    {(!selectedPlacement.allowedMethodIds.length ||
                                      !selectedPlacement.allowedStepIds.length) && (
                                      <s-paragraph>
                                        {translateUi(
                                          'editor:merchantConfigEditor.selectAtLeastOneMethodAndDecorationSizeToOfferThisPrintArea',
                                        )}
                                      </s-paragraph>
                                    )}

                                    <s-text type="strong">
                                      {translateUi('editor:merchantConfigEditor.decorationMethods')}
                                    </s-text>
                                    {draft.methods.length === 0 && (
                                      <s-paragraph>
                                        {translateUi(
                                          'editor:merchantConfigEditor.addADecorationMethodInProductRulesToMakeThisPrintAreaAvailable',
                                        )}
                                      </s-paragraph>
                                    )}
                                    {draft.methods.map((item) => (
                                      <s-checkbox
                                        checked={selectedPlacement.allowedMethodIds.includes(item.id)}
                                        onChange={(event) =>
                                          setPlacement(selectedPlacement.id, (placement) => ({
                                            ...placement,
                                            allowedMethodIds: event.currentTarget.checked
                                              ? [...placement.allowedMethodIds, item.id]
                                              : placement.allowedMethodIds.filter((id) => id !== item.id),
                                          }))
                                        }
                                        label={choiceLabel('methods', item.id)}
                                        disabled={editLocked}
                                        key={item.id}
                                      />
                                    ))}
                                    <s-text type="strong">
                                      {translateUi('editor:merchantConfigEditor.decorationSizes')}
                                    </s-text>
                                    {geometry.steps.length === 0 && (
                                      <s-paragraph>
                                        {translateUi(
                                          'editor:merchantConfigEditor.addADecorationSizeBelowThenAllowItForThisPrintArea',
                                        )}
                                      </s-paragraph>
                                    )}
                                    {geometry.steps.map((item) => (
                                      <s-checkbox
                                        checked={selectedPlacement.allowedStepIds.includes(item.id)}
                                        onChange={(event) =>
                                          setPlacement(selectedPlacement.id, (placement) => ({
                                            ...placement,
                                            allowedStepIds: event.currentTarget.checked
                                              ? [...placement.allowedStepIds, item.id]
                                              : placement.allowedStepIds.filter((id) => id !== item.id),
                                          }))
                                        }
                                        label={choiceLabel('steps', item.id)}
                                        disabled={editLocked}
                                        key={item.id}
                                      />
                                    ))}
                                    {editor.variantId &&
                                      selectedGeometry?.variantOverrides?.some(
                                        (entry) => entry.variantId === editor.variantId,
                                      ) && (
                                        <s-button
                                          disabled={editLocked}
                                          onClick={() =>
                                            updateGeometry((value) => ({
                                              ...value,
                                              views: value.views.map((item) =>
                                                item.id === editor.viewId
                                                  ? {
                                                      ...item,
                                                      placements: item.placements.map((placement) =>
                                                        placement.id === selectedPlacement.id
                                                          ? {
                                                              ...placement,
                                                              variantOverrides: placement.variantOverrides?.filter(
                                                                (entry) => entry.variantId !== editor.variantId,
                                                              ),
                                                            }
                                                          : placement,
                                                      ),
                                                    }
                                                  : item,
                                              ),
                                            }))
                                          }
                                        >
                                          {translateUi('editor:merchantConfigEditor.useSharedPrintArea')}
                                        </s-button>
                                      )}
                                  </s-stack>
                                )}
                              </s-stack>
                            </s-section>
                          </div>
                        </div>
                      </s-stack>
                    </section>
                    <section
                      class="admin-setup-panel"
                      aria-label={translateUi('editor:merchantConfigEditor.pricesAndCustomerOptions')}
                      hidden={!visibleStage('prices')}
                    >
                      <s-stack gap="base">
                        <s-section heading={translateUi('editor:merchantConfigEditor.customerOptions')}>
                          <s-stack gap="base">
                            {draft.productionOptions.map((item) => (
                              <s-paragraph key={item.id}>
                                <s-text type="strong">{choiceLabel('options', item.id)}</s-text>{' '}
                                <s-text-field
                                  maxLength={80}
                                  value={labelFor('options', item.id)}
                                  onInput={(event) => setLabel('options', item.id, event.currentTarget.value)}
                                  label={translateUi('editor:configurationExtra.optionName')}
                                  disabled={editLocked}
                                />{' '}
                                {item.allowedValueIds.map((id, index) => (
                                  <s-text-field
                                    maxLength={80}
                                    value={valueLabel(item.id, id)}
                                    onInput={(event) => setValueLabel(item.id, id, event.currentTarget.value)}
                                    label={translateUi('editor:configurationExtra.valueLabel', {
                                      formattedIndex: new Intl.NumberFormat(formatLocale).format(index + 1),
                                    })}
                                    disabled={editLocked}
                                    key={id}
                                  />
                                ))}{' '}
                                <s-button
                                  type="button"
                                  onClick={() =>
                                    change({
                                      ...draft,
                                      productionOptions: draft.productionOptions.filter(
                                        (option) => option.id !== item.id,
                                      ),
                                      labels: removeChoiceLabels(draft.labels, 'options', item.id),
                                    })
                                  }
                                  disabled={editLocked}
                                  icon="delete"
                                >
                                  {translateUi('editor:merchantConfigEditor.removeOption')}
                                </s-button>
                                <s-button
                                  type="button"
                                  onClick={() =>
                                    change({
                                      ...draft,
                                      productionOptions: draft.productionOptions.map((option) =>
                                        option.id === item.id
                                          ? {
                                              ...option,
                                              allowedValueIds: [...option.allowedValueIds, freshId('value')],
                                            }
                                          : option,
                                      ),
                                    })
                                  }
                                  disabled={editLocked}
                                  icon="plus"
                                >
                                  {translateUi('editor:merchantConfigEditor.addValue')}
                                </s-button>
                              </s-paragraph>
                            ))}
                            <s-button
                              type="button"
                              onClick={() =>
                                change({
                                  ...draft,
                                  productionOptions: [
                                    ...draft.productionOptions,
                                    { id: freshId('option'), allowedValueIds: [freshId('value')] },
                                  ],
                                })
                              }
                              disabled={editLocked}
                              icon="plus"
                            >
                              {translateUi('editor:merchantConfigEditor.addProductionOption')}
                            </s-button>
                          </s-stack>
                        </s-section>
                        <s-section
                          id="decoration-prices"
                          heading={translateUi('editor:merchantConfigEditor.decorationPrices')}
                        >
                          <s-stack gap="base">
                            {legacyPricing ? (
                              <section aria-label={translateUi('editor:merchantConfigEditor.historicalPricing')}>
                                <s-paragraph>
                                  {translateUi(
                                    'editor:merchantConfigEditor.thisDraftUsesHistoricalPricingThatIsUnavailableForNewOffersExistingPricesAreReadOnlySavedP',
                                  )}
                                </s-paragraph>
                                <s-unordered-list>
                                  {draft.pricingRules.map((rule) => (
                                    <s-list-item key={rule.id}>
                                      {choiceLabel('prices', rule.id)}:{' '}
                                      {rule.role === 'setup'
                                        ? translateUi('editor:configurationExtra.setup')
                                        : rule.methodUnitMultiplicity === 'perPlacement'
                                          ? translateUi('editor:configurationExtra.perPlacement')
                                          : translateUi('editor:configurationExtra.perGarment')}{' '}
                                      —{' '}
                                      {rule.scope.kind === 'general'
                                        ? translateUi('editor:configurationExtra.general')
                                        : rule.scope.kind === 'method'
                                          ? choiceLabel('methods', rule.scope.methodId)
                                          : `${choiceLabel('placements', rule.scope.placementId)}${rule.scope.kind === 'step' ? ' / ' + choiceLabel('steps', rule.scope.stepId) : ''}${rule.scope.methodId ? ' / ' + choiceLabel('methods', rule.scope.methodId) : ''}`}
                                      ;{' '}
                                      {rule.rate.kind === 'fixed'
                                        ? `${rule.rate.amount.shopDecimal} ${draft.shopCurrency}${rule.rate.amount.presentmentOverrides.map((entry) => `; ${entry.decimal} ${entry.currency}`).join('')}`
                                        : rule.rate.tiers
                                            .map(
                                              (tier) =>
                                                `${tier.minQuantity}+ garments: ${tier.amount.shopDecimal} ${draft.shopCurrency}${tier.amount.presentmentOverrides.map((entry) => `; ${entry.decimal} ${entry.currency}`).join('')}`,
                                            )
                                            .join('; ')}
                                    </s-list-item>
                                  ))}
                                </s-unordered-list>
                                <s-paragraph>
                                  {translateUi(
                                    'editor:merchantConfigEditor.startANewLocalPriceProposalEnterAndReviewEveryAvailableChoiceThenSaveAndPublishANewRevisio',
                                  )}
                                </s-paragraph>
                                <s-button
                                  type="button"
                                  onClick={() => {
                                    setPriceErrors({});
                                    setPriceTexts({});
                                    setPricePage(0);
                                    setPriceProposalStarted(true);
                                    change({
                                      ...draft,
                                      pricingRules: [],
                                      labels: draft.labels ? { ...draft.labels, prices: {} } : draft.labels,
                                    });
                                  }}
                                  disabled={editLocked}
                                >
                                  {translateUi('editor:merchantConfigEditor.setDecorationPrices')}
                                </s-button>
                              </section>
                            ) : (
                              <>
                                <s-paragraph>
                                  {translateUi(
                                    'editor:merchantConfigEditor.finalDecorationSurchargePerGarmentAddedToTheGarmentPriceForEachSelectedPlacementBlankMeans',
                                  )}
                                </s-paragraph>
                                {priceProposalStarted && (
                                  <div role="status">
                                    <s-paragraph>
                                      {translateUi(
                                        'editor:merchantConfigEditor.newLocalPriceProposalReviewAllChoicesBeforeSavingAndPublishingPublishedHistoryHasNotChange',
                                      )}
                                    </s-paragraph>
                                  </div>
                                )}
                                {hasPriceErrors && (
                                  <s-banner tone="critical">
                                    {translateUi('editor:configurationExtra.correctInvalidPrice')}{' '}
                                    <s-button onClick={revealInvalidPrice}>
                                      {translateUi('editor:merchantConfigEditor.goToInvalidPrice')}
                                    </s-button>
                                  </s-banner>
                                )}
                                {priceCells.length > pricePageSize && (
                                  <s-paragraph color="subdued">
                                    {translateUi('editor:configurationExtra.pricePage', {
                                      first: formatExactCount(
                                        BigInt(filteredPriceCells.length ? currentPricePage * pricePageSize + 1 : 0),
                                        formatLocale,
                                      ).formatted,
                                      last: formatExactCount(
                                        BigInt(
                                          Math.min((currentPricePage + 1) * pricePageSize, filteredPriceCells.length),
                                        ),
                                        formatLocale,
                                      ).formatted,
                                      total: formatExactCount(BigInt(filteredPriceCells.length), formatLocale)
                                        .formatted,
                                    })}
                                  </s-paragraph>
                                )}
                                {priceCells.length ? (
                                  <s-table
                                    paginate={filteredPriceCells.length > pricePageSize}
                                    hasPreviousPage={currentPricePage > 0}
                                    hasNextPage={(currentPricePage + 1) * pricePageSize < filteredPriceCells.length}
                                    onPreviousPage={() => setPricePage(Math.max(0, currentPricePage - 1))}
                                    onNextPage={() => setPricePage(currentPricePage + 1)}
                                  >
                                    {priceCells.length > pricePageSize &&
                                      (draft.placements.length > 1 || draft.methods.length > 1) && (
                                        <s-box slot="filters" padding="base">
                                          <s-grid
                                            gridTemplateColumns={
                                              draft.placements.length > 1 && draft.methods.length > 1
                                                ? 'repeat(2, minmax(0, 1fr))'
                                                : 'minmax(0, 1fr)'
                                            }
                                            gap="base"
                                          >
                                            {draft.placements.length > 1 && (
                                              <s-select
                                                label={translateUi(
                                                  'editor:merchantConfigEditor.filterPricesByPrintArea',
                                                )}
                                                value={activePricePlacement || noSelection}
                                                onChange={(event) => {
                                                  setPricePlacementFilter(
                                                    selectedValue(event.currentTarget.value) ?? '',
                                                  );
                                                  setPricePage(0);
                                                }}
                                              >
                                                <s-option value={noSelection}>
                                                  {translateUi('editor:merchantConfigEditor.allPrintAreas')}
                                                </s-option>
                                                {draft.placements.map((placement) => (
                                                  <s-option key={placement.id} value={placement.id}>
                                                    {choiceLabel('placements', placement.id)}
                                                  </s-option>
                                                ))}
                                              </s-select>
                                            )}
                                            {draft.methods.length > 1 && (
                                              <s-select
                                                label={translateUi('editor:merchantConfigEditor.filterPricesByMethod')}
                                                value={activePriceMethod || noSelection}
                                                onChange={(event) => {
                                                  setPriceMethodFilter(selectedValue(event.currentTarget.value) ?? '');
                                                  setPricePage(0);
                                                }}
                                              >
                                                <s-option value={noSelection}>
                                                  {translateUi('editor:merchantConfigEditor.allMethods')}
                                                </s-option>
                                                {draft.methods.map((method) => (
                                                  <s-option key={method.id} value={method.id}>
                                                    {choiceLabel('methods', method.id)}
                                                  </s-option>
                                                ))}
                                              </s-select>
                                            )}
                                          </s-grid>
                                        </s-box>
                                      )}

                                    <s-table-header-row>
                                      <s-table-header listSlot="primary">
                                        {translateUi('editor:merchantConfigEditor.method')}
                                      </s-table-header>
                                      <s-table-header listSlot="secondary">
                                        {translateUi('editor:merchantConfigEditor.placement')}
                                      </s-table-header>
                                      <s-table-header listSlot="inline">
                                        {translateUi('editor:merchantConfigEditor.size')}
                                      </s-table-header>
                                      <s-table-header listSlot="labeled" format="currency">
                                        {translateUi('editor:configurationExtra.surchargePerGarment', {
                                          currency: draft.shopCurrency,
                                        })}
                                      </s-table-header>
                                    </s-table-header-row>

                                    <s-table-body>
                                      {visiblePriceCells.map((cell) => {
                                        const rule = priceRulesByCell.get(cell.key);
                                        const value = rule?.rate.kind === 'fixed' ? rule.rate.amount.shopDecimal : '';
                                        const names =
                                          priceCellNames[cell.index] ??
                                          translateUi('editor:configuration.choiceKinds.priceChoice');
                                        return (
                                          <s-table-row key={cell.key}>
                                            <s-table-cell>{choiceLabel('methods', cell.methodId)}</s-table-cell>
                                            <s-table-cell>{choiceLabel('placements', cell.placementId)}</s-table-cell>
                                            <s-table-cell>
                                              {placementStepLabel(cell.placementId, cell.stepId)}
                                            </s-table-cell>
                                            <s-table-cell>
                                              <LeanPriceInput
                                                key={`${cell.key}:${priceRevision}`}
                                                id={`price-choice-${cell.key}`}
                                                typed={priceTexts[cell.key]}
                                                onText={(text) =>
                                                  setPriceTexts((old) => ({
                                                    ...old,
                                                    [cell.key]: { base: value, text },
                                                  }))
                                                }
                                                value={value}
                                                label={translateUi('editor:configurationExtra.surchargeAccessible', {
                                                  names,
                                                  currency: draft.shopCurrency,
                                                })}
                                                onPrice={(amount) => updateLeanPrice(cell, amount)}
                                                onValidity={(valid) =>
                                                  setPriceErrors((old) => ({ ...old, [cell.key]: !valid }))
                                                }
                                                disabled={editLocked}
                                              />
                                              {rule ? (
                                                <s-button
                                                  type="button"
                                                  onClick={() => {
                                                    setPriceErrors((old) => ({ ...old, [cell.key]: false }));
                                                    updateLeanPrice(cell, '');
                                                  }}
                                                  disabled={editLocked}
                                                >
                                                  {translateUi('editor:merchantConfigEditor.makeUnavailable')}
                                                </s-button>
                                              ) : (
                                                <s-text>
                                                  {translateUi('editor:merchantConfigEditor.unavailable')}
                                                </s-text>
                                              )}
                                            </s-table-cell>
                                          </s-table-row>
                                        );
                                      })}
                                    </s-table-body>
                                  </s-table>
                                ) : (
                                  <s-paragraph>
                                    {translateUi(
                                      'editor:merchantConfigEditor.addAMethodPlacementAndAllowedSizeToEnterDecorationPrices',
                                    )}
                                  </s-paragraph>
                                )}
                              </>
                            )}
                            <s-button
                              type="button"
                              onClick={() => {
                                setAdvanced(!advanced);
                                setAdvancedText(JSON.stringify(draft, null, 2));
                                setAdvancedError(false);
                              }}
                              disabled={editLocked}
                            >
                              {translateUi('editor:merchantConfigEditor.advancedConfigurationJSON')}
                            </s-button>
                            {advanced && (
                              <div>
                                <s-text-area
                                  label={translateUi('editor:merchantConfigEditor.advancedJSON')}
                                  disabled={editLocked}
                                  rows={16}
                                  value={advancedText}
                                  onInput={(event) => setAdvancedText(event.currentTarget.value)}
                                />
                                <s-button
                                  type="button"
                                  onClick={() => {
                                    try {
                                      const parsed = JSON.parse(advancedText) as MerchantDraft;
                                      if (!isEditableMerchantDraft(parsed)) throw new Error('Invalid draft geometry');
                                      change(parsed);
                                      setDimensionTexts({});
                                      setDimensionRecoveryOpen(false);
                                      setAdvancedError(false);
                                    } catch {
                                      setAdvancedError(true);
                                    }
                                  }}
                                  disabled={editLocked}
                                >
                                  {translateUi('editor:merchantConfigEditor.applyJSON')}
                                </s-button>
                                {advancedError && (
                                  <div role="alert">
                                    <s-paragraph>{translateUi('editor:configuration.invalidJson')}</s-paragraph>
                                  </div>
                                )}
                              </div>
                            )}
                          </s-stack>
                        </s-section>
                      </s-stack>
                    </section>
                  </s-stack>
                  <section
                    class="admin-setup-panel"
                    aria-label={translateUi('editor:merchantConfigEditor.reviewAndPublish')}
                    hidden={!visibleStage('review')}
                  >
                    <s-stack gap="base">
                      <PublicationStatus config={view.config} />
                      {hasPriceErrors && (
                        <s-banner tone="critical">
                          {translateUi('editor:configurationExtra.correctInvalidDecorationPrices')}{' '}
                          <s-button onClick={revealInvalidPrice}>
                            {translateUi('editor:merchantConfigEditor.reviewPrices')}
                          </s-button>
                        </s-banner>
                      )}
                      {!legacyPricing && !hasPriceErrors && (
                        <DecorationPriceReview
                          currency={draft.shopCurrency}
                          placements={draft.placements.map((placement) => ({
                            id: placement.id,
                            label: choiceLabel('placements', placement.id),
                            choices: priceCells
                              .filter((cell) => cell.placementId === placement.id)
                              .map((cell) => {
                                const rule = priceRulesByCell.get(cell.key);
                                const amount =
                                  rule?.rate.kind === 'fixed' && leanDecimal(rule.rate.amount.shopDecimal)
                                    ? rule.rate.amount.shopDecimal
                                    : null;
                                return {
                                  key: cell.key,
                                  label: `${choiceLabel('methods', cell.methodId)} / ${placementStepLabel(cell.placementId, cell.stepId)}`,
                                  amount,
                                  missingPrice: {
                                    placementName: choiceLabel('placements', cell.placementId),
                                    methodName: choiceLabel('methods', cell.methodId),
                                    sizeName: placementStepLabel(cell.placementId, cell.stepId),
                                  },
                                };
                              }),
                          }))}
                        />
                      )}
                      <s-section heading={translateUi('editor:merchantConfigEditor.reviewYourChoices')}>
                        <s-stack gap="base">
                          <s-paragraph>
                            {translateUi('editor:configurationExtra.reviewSummary', {
                              methods:
                                new Intl.ListFormat(formatLocale, { type: 'conjunction' }).format(
                                  draft.methods.map((method) => choiceLabel('methods', method.id)),
                                ) || translateUi('editor:configurationExtra.noneYet'),
                              views: formatExactCount(BigInt(geometry.views.length), formatLocale).formatted,
                              areas: formatExactCount(BigInt(draft.placements.length), formatLocale).formatted,
                              prices: formatExactCount(BigInt(draft.pricingRules.length), formatLocale).formatted,
                            })}
                          </s-paragraph>
                          <s-paragraph>
                            {translateUi(
                              'editor:merchantConfigEditor.blankPricesStayUnavailableReviewEveryOfferedMethodAreaAndSizeInThePreviewBeforePublishing',
                            )}
                          </s-paragraph>
                        </s-stack>
                      </s-section>
                      <s-section
                        id="publish-changes"
                        heading={translateUi('editor:merchantConfigEditor.publishChanges')}
                      >
                        <s-stack gap="base">
                          <s-paragraph>
                            {translateUi(
                              'editor:merchantConfigEditor.reviewThePreviewAndAllDecorationPricesBeforePublishingSaveAnyUnsavedChangesFirstPublicatio',
                            )}
                          </s-paragraph>
                          <s-link href="/admin/settings">
                            {translateUi('editor:merchantConfigEditor.checkStoreSetupInSettings')}
                          </s-link>
                          {!view.config.publishEligibility.allowed && (
                            <div role="alert">
                              <s-paragraph>
                                {translateUi('editor:configurationExtra.publicationUnavailable')}
                              </s-paragraph>
                            </div>
                          )}
                          <s-button
                            disabled={
                              busy ||
                              operatorPublication(view.config.publication.state) ||
                              (!publicationPending &&
                                !continuingPublication(view.config.publication.state) &&
                                (hasPriceErrors ||
                                  hasDimensionErrors ||
                                  !view.config.publishEligibility.allowed ||
                                  !['clean', 'saved'].includes(saveState)))
                            }
                            onClick={() => void publish()}
                          >
                            {publicationPending || continuingPublication(view.config.publication.state)
                              ? translateUi('editor:configurationExtra.continuePublication')
                              : translateUi('editor:configurationExtra.publishSaved')}
                          </s-button>
                        </s-stack>
                      </s-section>
                      <s-section heading={translateUi('editor:merchantConfigEditor.reuseThisConfiguration')}>
                        <s-stack gap="base">
                          <s-paragraph>
                            {translateUi(
                              'editor:merchantConfigEditor.copyTheSavedDraftToAnotherProductTheDestinationMustBeReviewedAndPublishedSeparately',
                            )}
                          </s-paragraph>
                          <AdminDisclosure label={translateUi('editor:merchantConfigEditor.copyToAnotherProduct')}>
                            <s-search-field
                              value={copyQuery}
                              onInput={(event) => setCopyQuery(event.currentTarget.value)}
                              label={translateUi('editor:merchantConfigEditor.searchDestinationProducts')}
                              disabled={busy}
                            />
                            <s-button onClick={() => void findCopyProducts()} disabled={busy}>
                              {translateUi('editor:merchantConfigEditor.findDestinationProducts')}
                            </s-button>
                            {copyCandidates && (
                              <>
                                <s-select
                                  value={copyTarget || noSelection}
                                  onChange={(event) => setCopyTarget(selectedValue(event.currentTarget.value) ?? '')}
                                  label={translateUi('editor:merchantConfigEditor.destinationProduct')}
                                  disabled={busy}
                                >
                                  <s-option value={noSelection}>
                                    {translateUi('editor:merchantConfigEditor.chooseAProduct')}
                                  </s-option>
                                  {copyCandidates.products
                                    .filter((product) => numberOf(product.id) !== productId)
                                    .map((product) => (
                                      <s-option key={product.id} value={numberOf(product.id)}>
                                        {product.title} · {product.status.toLowerCase()}
                                      </s-option>
                                    ))}
                                </s-select>
                                <s-paragraph>
                                  {translateUi(
                                    'editor:merchantConfigEditor.showingUpTo20MatchesRefineTheSearchIfYourDestinationIsMissingExistingDestinationConfigurat',
                                  )}
                                </s-paragraph>
                              </>
                            )}
                            <s-button
                              disabled={
                                busy ||
                                !copyTarget ||
                                hasPriceErrors ||
                                hasDimensionErrors ||
                                !['clean', 'saved'].includes(saveState)
                              }
                              onClick={() => void copy()}
                            >
                              {translateUi('editor:merchantConfigEditor.copyConfiguration')}
                            </s-button>
                          </AdminDisclosure>
                        </s-stack>
                      </s-section>
                      <s-section heading={translateUi('editor:merchantConfigEditor.nextStorefrontButton')}>
                        <s-stack gap="base">
                          <s-paragraph>
                            {translateUi(
                              'editor:merchantConfigEditor.oncePublicationIsActiveAddTheInsigniaCustomizationBlockToTheProductTemplateInShopify',
                            )}
                          </s-paragraph>
                          <s-link href="/admin/settings/storefront">
                            {translateUi('editor:merchantConfigEditor.openStorefrontSetup')}
                          </s-link>
                        </s-stack>
                      </s-section>
                    </s-stack>
                  </section>
                  {setupStep !== 'all' && (
                    <s-section>
                      <s-stack gap="base">
                        <s-stack direction="inline" gap="base">
                          {previousSetup && (
                            <s-button onClick={() => selectSetupStep(previousSetup.id)}>
                              {translateUi('editor:configuration.backToSection', {
                                section: setupStepLabel(previousSetup.id),
                              })}
                            </s-button>
                          )}
                          {nextSetup && (
                            <s-button variant="primary" onClick={() => selectSetupStep(nextSetup.id)}>
                              {nextSetup.id === 'review'
                                ? translateUi('editor:configuration.continueToReview')
                                : translateUi('editor:configuration.continueToSection', {
                                    section: setupStepLabel(nextSetup.id),
                                  })}
                            </s-button>
                          )}
                        </s-stack>
                      </s-stack>
                    </s-section>
                  )}
                </s-stack>
              </s-box>
              <s-box minInlineSize="0">
                <s-section accessibilityLabel={translateUi('editor:merchantConfigEditor.draftStatus')}>
                  <s-stack direction="inline" alignItems="center" gap="base">
                    {setupStep !== 'review' && setupStep !== 'all' && (
                      <PublicationStatus config={view.config} compact />
                    )}
                    {validationIssues.length > 0 && (
                      <div role="alert">
                        {(() => {
                          const exactCount = formatExactCount(BigInt(validationIssues.length), formatLocale);
                          return (
                            <s-paragraph>
                              {translateUi('editor:configuration.notice.validationIssues', {
                                count: exactCount.kind === 'plural' ? exactCount.count : validationIssues.length,
                                formattedCount: exactCount.formatted,
                              })}
                            </s-paragraph>
                          );
                        })()}
                      </div>
                    )}
                    <s-stack gap="small">
                      <s-badge
                        tone={
                          saveState === 'conflict' || saveState === 'ambiguous'
                            ? 'warning'
                            : saveState === 'dirty'
                              ? 'info'
                              : 'success'
                        }
                      >
                        {translateUi(`editor:configuration.saveStatus.${saveState}`)}
                      </s-badge>
                      <s-stack direction="inline" gap="base">
                        <s-text color="subdued">
                          {translateUi('editor:configuration.draftVersion', { version: view.config.draftVersion })}
                        </s-text>
                        <s-text color="subdued">
                          {translateUi('editor:configuration.productStatusPrefix', {
                            status: translateUi(productStatusKey(view.product.status)),
                          })}
                        </s-text>
                      </s-stack>
                    </s-stack>

                    {saveState === 'ambiguous' && savePending && (
                      <s-paragraph>
                        {translateUi(
                          'editor:merchantConfigEditor.retrySavingToReconcileThisRequestBeforeEditingDiscardingOrLoadingAnotherDraft',
                        )}
                      </s-paragraph>
                    )}
                    {saveState === 'ambiguous' && savePending && (
                      <s-button loading={busy} disabled={busy} onClick={() => void save(true)}>
                        {translateUi('editor:merchantConfigEditor.retrySaving')}
                      </s-button>
                    )}
                    {latest && (
                      <s-button
                        disabled={editLocked}
                        onClick={() => {
                          if (!isEditorLocked() && isEditableMerchantDraft(latest.draft)) {
                            const adopted = workflow.adoptLatest();
                            if (!adopted) return;
                            setDimensionTexts({});
                            setDimensionRecoveryOpen(false);
                            setPriceErrors({});
                            setPriceTexts({});
                            setPricePage(0);
                            setPriceRevision((old) => old + 1);
                            setEditor(initialEditor(adopted));
                          }
                        }}
                      >
                        {translateUi('editor:merchantConfigEditor.reviewLatestSavedDraft')}
                      </s-button>
                    )}
                    {(saveState === 'conflict' || saveState === 'ambiguous') && (
                      <s-button
                        disabled={editLocked}
                        onClick={() => {
                          if (!isEditorLocked()) void load();
                        }}
                      >
                        {translateUi('editor:merchantConfigEditor.reloadCurrentDraft')}
                      </s-button>
                    )}
                  </s-stack>
                  <s-stack direction="inline" gap="base">
                    {' '}
                    <AdminSaveBar
                      dirty={
                        ['dirty', 'saving', 'ambiguous', 'conflict'].includes(saveState) ||
                        hasPriceErrors ||
                        hasDimensionErrors ||
                        !!advancedError ||
                        editLocked
                      }
                      saving={busy}
                      canSave={
                        !editLocked &&
                        !advancedError &&
                        !legacyPricing &&
                        !hasPriceErrors &&
                        !hasDimensionErrors &&
                        saveState === 'dirty'
                      }
                      canDiscard={!editLocked && isEditableMerchantDraft(view.config.draft)}
                      onSave={(): void => void save()}
                      onDiscard={() => {
                        if (isEditorLocked()) return;
                        const saved = workflow.discardDraft();
                        if (!saved) return;
                        const restored = initialEditor(saved);
                        setEditor(restored);
                        editorRef.current = restored;
                        setDimensionTexts({});
                        setDimensionRecoveryOpen(false);
                        setPriceErrors({});
                        setPriceTexts({});
                        setPricePage(0);
                        setPriceRevision((old) => old + 1);
                        setPriceProposalStarted(false);
                        setAdvancedText('');
                        setAdvancedError(false);
                        setValidationIssues([]);
                        setStatus(null);
                      }}
                    />
                  </s-stack>
                </s-section>
              </s-box>
            </>
          )}
        </>
      )}
    </s-page>
  );
}

export default withAdminLocale(MerchantConfigEditor);
