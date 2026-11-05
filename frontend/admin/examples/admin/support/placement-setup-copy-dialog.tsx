/** Shared, preview-only staged dialog for copying product setup drafts. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useAdminLocale } from '../../../src/shared/admin-i18n.js';
import PlacementCopyDestinations from './placement-copy-destinations.tsx';
import {
  inspectPlacementPreviewState,
  type PlacementSetupExample,
  placementPreviewStorageKey,
  readPlacementPreviewProduct,
  readPlacementPreviewState,
  readPlacementSetupExample,
  writePlacementPreviewProduct,
} from './placement-preview-storage.mts';
import {
  type CopyPlacementSetupError,
  type CopyPlacementSetupSummary,
  copyPlacementSetup,
} from './placement-setup-copy.mts';
import PlacementSetupCopyReview from './placement-setup-copy-review.tsx';
import { applyPlacementSetupExample } from './placement-workflow-examples.mts';
import {
  type PlacementProduct,
  placementProductSchema,
  validatePlacementProduct,
} from './placement-workflow-model.mts';

const reportPrefix = 'insignia-placement-copy-report-v1:';

type CopyStatus = 'copied' | 'failed' | 'blocked' | 'already-configured' | 'unavailable';
type PreflightStatus = Extract<CopyStatus, 'blocked' | 'already-configured' | 'unavailable'>;
type CopyResultReason =
  | CopyPlacementSetupError
  | 'product-unavailable'
  | 'target-state-unavailable'
  | 'blocked-by-another-target'
  | 'retry-after-review'
  | 'storage-write-failed'
  | 'copy-unexpected-failure'
  | 'copied';
type LocalErrorCode = 'source-changed' | 'choose-target' | 'review-targets';
type CopyCountKind = 'product' | 'setup' | 'view' | 'placement';
type AdminTranslator = ReturnType<typeof useAdminLocale>['t'];

interface CopyPreflightBlocker {
  id: string;
  product: PlacementProduct | undefined;
  status: PreflightStatus;
  reason: CopyResultReason;
}

export interface PlacementSetupCopyTargetResult {
  targetId: string;
  title: string;
  status: CopyStatus;
  reason: CopyResultReason;
  summary?: CopyPlacementSetupSummary;
}

export interface PlacementSetupCopyReport {
  version: 2;
  example: PlacementSetupExample;
  sourceId: string;
  sourceTitle: string;
  sourceKind: 'current' | 'saved';
  /** Identifies the original source snapshot without storing another full product. */
  sourceSignature?: string;
  selectedViewIds: string[];
  includeMethods: boolean;
  includeProductPrices: boolean;
  results: PlacementSetupCopyTargetResult[];
}

export interface PlacementSetupCopyDialogProps {
  /** The editor's current valid snapshot. It takes precedence over a saved draft. */
  source?: PlacementProduct;
  /** When supplied, these overview-selected products are the complete target set. */
  targetIds?: string[];
  onClose(): void;
  onComplete?(report: PlacementSetupCopyReport): void;
}

function isIncompleteDraftIssue(key: string): boolean {
  return (
    key === 'views' ||
    key.endsWith('.placements') ||
    key.endsWith('.methods') ||
    key.endsWith('.sizes') ||
    // Older drafts can retain dimensions that no longer have an editor.
    // Ignore those legacy values here, just as save validation does.
    key.endsWith('.widthCm') ||
    key.endsWith('.heightCm') ||
    key.endsWith('.unavailable')
  );
}

/** Incomplete drafts are copyable; invalid entered values and malformed schemas are not. */
function isCopyableSource(product: PlacementProduct): boolean {
  if (!placementProductSchema.safeParse(product).success || product.views.length === 0) return false;
  const methodIds = new Set(product.methods.map((method) => method.id));
  if (methodIds.size !== product.methods.length) return false;
  if (product.views.some((view) => view.placements.some((area) => area.methodIds.some((id) => !methodIds.has(id)))))
    return false;
  return Object.keys(validatePlacementProduct(product)).every(isIncompleteDraftIssue);
}

function makeReportKey(example: PlacementSetupExample): string {
  return `${reportPrefix}${example}`;
}

function readCopyReport(example: PlacementSetupExample): PlacementSetupCopyReport | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(makeReportKey(example));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return null;
    const report = value;
    if (
      (report.version !== 1 && report.version !== 2) ||
      report.example !== example ||
      typeof report.sourceId !== 'string' ||
      typeof report.sourceTitle !== 'string' ||
      (report.sourceKind !== 'current' && report.sourceKind !== 'saved') ||
      (report.sourceSignature !== undefined &&
        (typeof report.sourceSignature !== 'string' || !/^[a-f0-9]{64}$/.test(report.sourceSignature))) ||
      !Array.isArray(report.selectedViewIds) ||
      !report.selectedViewIds.every((id) => typeof id === 'string') ||
      typeof report.includeMethods !== 'boolean' ||
      typeof report.includeProductPrices !== 'boolean' ||
      !Array.isArray(report.results) ||
      !report.results.every((result) => isCopyTargetResult(result, report.version === 1))
    )
      return null;

    const results: PlacementSetupCopyTargetResult[] = [];
    for (const value of report.results) {
      if (
        !isRecord(value) ||
        !isCopyStatus(value.status) ||
        typeof value.targetId !== 'string' ||
        typeof value.title !== 'string'
      )
        return null;
      const reason = isCopyResultReason(value.reason)
        ? value.reason
        : report.version === 1 && typeof value.message === 'string'
          ? legacyResultReason(value.status)
          : null;
      if (!reason) return null;
      let summary: CopyPlacementSetupSummary | undefined;
      if (value.summary !== undefined) {
        if (
          !isRecord(value.summary) ||
          typeof value.summary.views !== 'number' ||
          !Number.isFinite(value.summary.views) ||
          typeof value.summary.placements !== 'number' ||
          !Number.isFinite(value.summary.placements) ||
          typeof value.summary.methods !== 'number' ||
          !Number.isFinite(value.summary.methods) ||
          typeof value.summary.prices !== 'number' ||
          !Number.isFinite(value.summary.prices)
        )
          return null;
        summary = {
          views: value.summary.views,
          placements: value.summary.placements,
          methods: value.summary.methods,
          prices: value.summary.prices,
        };
      }
      results.push({
        targetId: value.targetId,
        title: value.title,
        status: value.status,
        reason,
        ...(summary ? { summary } : {}),
      });
    }

    return {
      version: 2,
      example,
      sourceId: report.sourceId,
      sourceTitle: report.sourceTitle,
      sourceKind: report.sourceKind,
      ...(typeof report.sourceSignature === 'string' ? { sourceSignature: report.sourceSignature } : {}),
      selectedViewIds: report.selectedViewIds,
      includeMethods: report.includeMethods,
      includeProductPrices: report.includeProductPrices,
      results,
    };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isCopyStatus(value: unknown): value is CopyStatus {
  return (
    value === 'copied' ||
    value === 'failed' ||
    value === 'blocked' ||
    value === 'already-configured' ||
    value === 'unavailable'
  );
}

function isCopyResultReason(value: unknown): value is CopyResultReason {
  return (
    value === 'same-product' ||
    value === 'target-has-views' ||
    value === 'no-source-views' ||
    value === 'no-views-selected' ||
    value === 'unknown-source-view' ||
    value === 'duplicate-source-method' ||
    value === 'duplicate-target-method' ||
    value === 'missing-source-method' ||
    value === 'id-collision' ||
    value === 'product-unavailable' ||
    value === 'target-state-unavailable' ||
    value === 'blocked-by-another-target' ||
    value === 'retry-after-review' ||
    value === 'storage-write-failed' ||
    value === 'copy-unexpected-failure' ||
    value === 'copied'
  );
}

function isCopyTargetResult(value: unknown, legacy: boolean): boolean {
  if (
    !isRecord(value) ||
    typeof value.targetId !== 'string' ||
    typeof value.title !== 'string' ||
    !isCopyStatus(value.status)
  )
    return false;
  if (isCopyResultReason(value.reason) || (legacy && typeof value.message === 'string')) return true;
  return false;
}

function legacyResultReason(status: CopyStatus): CopyResultReason {
  switch (status) {
    case 'copied':
      return 'copied';
    case 'failed':
      return 'copy-unexpected-failure';
    case 'blocked':
      return 'blocked-by-another-target';
    case 'already-configured':
      return 'target-has-views';
    case 'unavailable':
      return 'product-unavailable';
  }
}

function statusLabel(status: CopyStatus, t: AdminTranslator): string {
  switch (status) {
    case 'copied':
      return t('editor:placementSetupCopyDialog.status.copied');
    case 'failed':
      return t('editor:placementSetupCopyDialog.status.failed');
    case 'blocked':
      return t('editor:placementSetupCopyDialog.status.blocked');
    case 'already-configured':
      return t('editor:placementSetupCopyDialog.status.alreadyConfigured');
    case 'unavailable':
      return t('editor:placementSetupCopyDialog.status.unavailable');
  }
}

function resultMessage(reason: CopyResultReason, t: AdminTranslator): string {
  switch (reason) {
    case 'same-product':
      return t('editor:placementSetupCopyDialog.results.sameProduct');
    case 'target-has-views':
      return t('editor:placementSetupCopyDialog.results.targetAlreadyConfigured');
    case 'no-source-views':
      return t('editor:placementSetupCopyDialog.errors.copyReason_noSourceViews');
    case 'no-views-selected':
      return t('editor:placementSetupCopyDialog.errors.copyReason_noViewsSelected');
    case 'unknown-source-view':
      return t('editor:placementSetupCopyDialog.errors.copyReason_unknownSourceView');
    case 'duplicate-source-method':
      return t('editor:placementSetupCopyDialog.errors.copyReason_duplicateSourceMethod');
    case 'duplicate-target-method':
      return t('editor:placementSetupCopyDialog.errors.copyReason_duplicateTargetMethod');
    case 'missing-source-method':
      return t('editor:placementSetupCopyDialog.errors.copyReason_missingSourceMethod');
    case 'id-collision':
      return t('editor:placementSetupCopyDialog.errors.copyReason_idCollision');
    case 'product-unavailable':
      return t('editor:placementSetupCopyDialog.results.productUnavailable');
    case 'target-state-unavailable':
      return t('editor:placementSetupCopyDialog.results.targetStateCouldNotBeChecked');
    case 'blocked-by-another-target':
      return t('editor:placementSetupCopyDialog.results.noTargetsCopied');
    case 'retry-after-review':
      return t('editor:placementSetupCopyDialog.results.retryAfterReview');
    case 'storage-write-failed':
      return t('editor:placementSetupCopyDialog.results.draftStorageFailed');
    case 'copy-unexpected-failure':
      return t('editor:placementSetupCopyDialog.results.unexpectedCopyFailure');
    case 'copied':
      return t('editor:placementSetupCopyDialog.results.copiedMessage');
  }
}

function statusTone(status: CopyStatus): 'success' | 'critical' | 'warning' {
  if (status === 'copied') return 'success';
  if (status === 'failed') return 'critical';
  return 'warning';
}

function countLabel(count: number, kind: CopyCountKind, t: AdminTranslator, locale: string): string {
  const params = { count, formattedCount: new Intl.NumberFormat(locale).format(count) };
  switch (kind) {
    case 'product':
      return t('editor:placementSetupCopyDialog.counts.product', params);
    case 'setup':
      return t('editor:placementSetupCopyDialog.counts.setup', params);
    case 'view':
      return t('editor:placementSetupCopyDialog.counts.view', params);
    case 'placement':
      return t('editor:placementSetupCopyDialog.counts.placement', params);
  }
}

function saveCopyReport(report: PlacementSetupCopyReport): boolean {
  try {
    globalThis.sessionStorage?.setItem(makeReportKey(report.example), JSON.stringify(report));
    return !!globalThis.sessionStorage;
  } catch {
    return false;
  }
}

function effectiveTarget(product: PlacementProduct, example: PlacementSetupExample): PlacementProduct {
  const saved = readPlacementPreviewProduct(example, product.id);
  if (saved) return { ...saved, title: product.title, images: saved.images.map((image) => ({ ...image })) };
  return applyPlacementSetupExample(product, example);
}

/** A published snapshot still protects a product when its editable draft is empty. */
type TargetReadiness = 'ready' | 'configured' | 'unavailable';

function targetReadiness(product: PlacementProduct, example: PlacementSetupExample): TargetReadiness {
  const inspection = inspectPlacementPreviewState(example, product.id);
  if (inspection.status === 'malformed' || inspection.status === 'unavailable') return 'unavailable';
  if (new Set(product.methods.map((method) => method.id)).size !== product.methods.length) return 'unavailable';
  const state = readPlacementPreviewState(example, product.id);
  if (product.views.length > 0 || (state !== null && state.published !== null)) return 'configured';
  return 'ready';
}

function productEditorHref(productId: string): string {
  const prefix = 'gid://shopify/Product/';
  const numericId = productId.startsWith(prefix) ? productId.slice(prefix.length) : '';
  return numericId ? `/admin/products/${encodeURIComponent(numericId)}/config` : '/admin/products';
}

export default function PlacementSetupCopyDialog({
  source,
  targetIds,
  onClose,
  onComplete,
}: PlacementSetupCopyDialogProps) {
  const { t: translateUi, formatLocale } = useAdminLocale();
  const [example] = useState(() => readPlacementSetupExample());
  const [catalog, setCatalog] = useState<PlacementProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<'choose' | 'review'>('choose');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [chooserPage, setChooserPage] = useState(0);
  const [sourceId, setSourceId] = useState(source?.id ?? '');
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>(() => [...new Set(targetIds ?? [])]);
  const [selectedViewIds, setSelectedViewIds] = useState<string[]>(() => source?.views.map((view) => view.id) ?? []);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [includeProductPrices, setIncludeProductPrices] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<PlacementSetupCopyReport | null>(null);
  const [resumableReport, setResumableReport] = useState<PlacementSetupCopyReport | null>(() =>
    readCopyReport(readPlacementSetupExample()),
  );
  const [resumedReport, setResumedReport] = useState(false);
  const [reportStorageFailed, setReportStorageFailed] = useState(false);
  const [localError, setLocalError] = useState<LocalErrorCode | null>(null);
  const [sourceProof, setSourceProof] = useState<{ data: string; signature: string; failed: boolean } | null>(null);
  const fixedTargets = targetIds !== undefined;
  const targetIdsKey = targetIds?.join('\u0000') ?? '';
  const modal = useRef<HTMLElementTagNameMap['s-modal']>(null);
  const stageRoot = useRef<HTMLElement>(null);
  const active = useRef(true);
  const previousFocus = useRef(document.activeElement);

  useLayoutEffect(() => {
    const element = modal.current;
    element?.showOverlay();
    return () => {
      active.current = false;
      element?.hideOverlay();
      requestAnimationFrame(() => {
        const target = previousFocus.current;
        if (
          target instanceof HTMLElement &&
          target.isConnected &&
          !target.closest('[inert], [hidden], [aria-hidden="true"]')
        )
          target.focus({ preventScroll: true });
      });
    };
  }, []);

  useLayoutEffect(() => {
    if (loading) return;
    const frame = requestAnimationFrame(() => {
      stageRoot.current?.focus({ preventScroll: true });
      stageRoot.current?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [stage, loading]);

  useEffect(() => setChooserPage(0), [query, selectedOnly]);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setLoadError(false);
    const timeout = setTimeout(() => controller.abort(), 10_000);
    void fetch('/__preview/placement-workflow/catalog', {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Product catalog unavailable');
        const parsed = placementProductSchema.array().safeParse(await response.json());
        if (!parsed.success) throw new Error('Product catalog response was invalid');
        if (current) setCatalog(parsed.data);
      })
      .catch(() => {
        if (current) setLoadError(true);
      })
      .finally(() => {
        clearTimeout(timeout);
        if (current) setLoading(false);
      });
    return () => {
      current = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [loadAttempt]);

  useEffect(() => {
    setSourceId(source?.id ?? '');
    setSelectedViewIds(source?.views.map((view) => view.id) ?? []);
    setReport(null);
    setResumedReport(false);
  }, [source?.id]);

  useEffect(() => {
    if (fixedTargets) {
      const next = [...new Set(targetIds)];
      setSelectedTargetIds((current) =>
        current.length === next.length && current.every((id, index) => id === next[index]) ? current : next,
      );
      setReport(null);
      setResumedReport(false);
    }
  }, [fixedTargets, targetIdsKey]);

  const savedSources = useMemo(
    () =>
      catalog.flatMap((product) => {
        const saved = readPlacementPreviewProduct(example, product.id);
        try {
          if (!saved && sessionStorage.getItem(placementPreviewStorageKey(example, product.id))) return [];
        } catch {
          return [];
        }
        const candidate = saved ?? applyPlacementSetupExample(product, example);
        if (!isCopyableSource(candidate)) return [];
        return [{ ...candidate, title: product.title }];
      }),
    [catalog, catalogRevision, example],
  );
  const activeSource = source ?? savedSources.find((product) => product.id === sourceId);
  const sourceValid = !!activeSource && isCopyableSource(activeSource);
  const sourceData = useMemo(
    () => (sourceValid && activeSource ? JSON.stringify(placementProductSchema.parse(activeSource)) : ''),
    [activeSource, sourceValid],
  );
  const sourceSignature = sourceProof?.data === sourceData ? sourceProof.signature : '';
  const sourceProofFailed = sourceProof?.data === sourceData && sourceProof.failed;

  useEffect(() => {
    if (!sourceData) return;
    let cancelled = false;
    void crypto.subtle.digest('SHA-256', new TextEncoder().encode(sourceData)).then(
      (digest) => {
        if (cancelled) return;
        const signature = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
        setSourceProof({ data: sourceData, signature, failed: false });
      },
      () => {
        if (!cancelled) setSourceProof({ data: sourceData, signature: '', failed: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sourceData]);
  const targetProducts = useMemo(
    () => catalog.map((product) => effectiveTarget(product, example)),
    [catalog, catalogRevision, example],
  );
  const targetById = useMemo(() => new Map(targetProducts.map((product) => [product.id, product])), [targetProducts]);
  const sourceOptions = savedSources;
  const visibleTargets = useMemo(
    () =>
      (fixedTargets ? targetProducts.filter((product) => selectedTargetIds.includes(product.id)) : targetProducts)
        .filter((product) => fixedTargets || product.id !== activeSource?.id)
        .filter((product) => !selectedOnly || selectedTargetIds.includes(product.id))
        .filter((product) =>
          product.title.toLocaleLowerCase(formatLocale).includes(query.trim().toLocaleLowerCase(formatLocale)),
        ),
    [activeSource?.id, fixedTargets, formatLocale, query, selectedOnly, selectedTargetIds, targetProducts],
  );
  const visibleSources = sourceOptions.filter((product) =>
    product.title.toLocaleLowerCase(formatLocale).includes(query.trim().toLocaleLowerCase(formatLocale)),
  );
  const chooserItems = source ? visibleTargets : visibleSources;
  const pageCount = Math.max(1, Math.ceil(chooserItems.length / 25));
  const currentPage = Math.min(chooserPage, pageCount - 1);
  const pageItems = chooserItems.slice(currentPage * 25, (currentPage + 1) * 25);
  const chosenViews = activeSource?.views.filter((view) => selectedViewIds.includes(view.id)) ?? [];
  const showResultsOnly = report !== null;
  const preflightBlockers: { targetId: string; reason: CopyResultReason }[] = selectedTargetIds.flatMap(
    (id): { targetId: string; reason: CopyResultReason }[] => {
      if (!activeSource) return [];
      if (id === activeSource.id) return [{ targetId: id, reason: 'same-product' as const }];
      const target = targetById.get(id);
      if (!target) return [{ targetId: id, reason: 'product-unavailable' as const }];
      const readiness = targetReadiness(target, example);
      if (readiness === 'configured') return [{ targetId: id, reason: 'target-has-views' as const }];
      if (readiness === 'unavailable') return [{ targetId: id, reason: 'target-state-unavailable' as const }];
      return [];
    },
  );
  const canCopy =
    !loading &&
    !loadError &&
    !busy &&
    sourceValid &&
    sourceSignature.length > 0 &&
    chosenViews.length > 0 &&
    selectedTargetIds.length > 0 &&
    preflightBlockers.length === 0;

  function close() {
    if (!busy) onClose();
  }

  function toggleTarget(id: string, checked: boolean) {
    setSelectedTargetIds((current) =>
      checked ? (current.includes(id) ? current : [...current, id]) : current.filter((item) => item !== id),
    );
  }

  function chooseSource(product: PlacementProduct) {
    if (selectedTargetIds.includes(product.id)) return;
    if (sourceId !== product.id) {
      setSelectedViewIds(product.views.map((view) => view.id));
      setIncludeProductPrices(false);
    }
    setSourceId(product.id);
    setReport(null);
    setResumableReport(null);
    setResumedReport(false);
    setReportStorageFailed(false);
    setLocalError(null);
    setStage('review');
  }

  function backToChooser() {
    setStage('choose');
    setLocalError(null);
  }

  async function copyTo(targetSelection: readonly string[], retry = false) {
    const copyViewIds = retry && report ? report.selectedViewIds : selectedViewIds;
    const copyMethods = retry && report ? report.includeMethods : true;
    const copyPrices = retry && report ? report.includeProductPrices : includeProductPrices;
    if (busy || !activeSource || !sourceValid || !copyViewIds.length) return;
    if (!sourceSignature || (retry && report?.sourceSignature !== sourceSignature)) {
      setLocalError('source-changed');
      return;
    }
    if (!targetSelection.length) {
      setLocalError('choose-target');
      return;
    }
    const currentTargetById = new Map(
      catalog.map((product) => [product.id, effectiveTarget(product, example)] as const),
    );
    const targets = targetSelection.map((id) => ({ id, product: currentTargetById.get(id) }));
    const blockers: CopyPreflightBlocker[] = [];
    for (const { id, product } of targets) {
      if (id === activeSource.id) blockers.push({ id, product, status: 'blocked', reason: 'same-product' });
      else if (!product) blockers.push({ id, product, status: 'unavailable', reason: 'product-unavailable' });
      else {
        const readiness = targetReadiness(product, example);
        if (readiness === 'configured')
          blockers.push({ id, product, status: 'already-configured', reason: 'target-has-views' });
        else if (readiness === 'unavailable')
          blockers.push({ id, product, status: 'unavailable', reason: 'target-state-unavailable' });
      }
    }
    if (blockers.length) {
      const results: PlacementSetupCopyTargetResult[] =
        retry && report?.sourceId === activeSource.id ? [...report.results] : [];
      for (const { id, product } of targets) {
        const blocker = blockers.find((item) => item.id === id);
        const result: PlacementSetupCopyTargetResult = blocker
          ? {
              targetId: id,
              title: product?.title ?? id,
              status: blocker.status,
              reason: blocker.reason,
            }
          : {
              targetId: id,
              title: product?.title ?? id,
              status: retry ? 'failed' : 'blocked',
              reason: retry ? 'retry-after-review' : 'blocked-by-another-target',
            };
        const existing = results.findIndex((item) => item.targetId === id);
        if (existing < 0) results.push(result);
        else results[existing] = result;
      }
      const next: PlacementSetupCopyReport = {
        version: 2,
        example,
        sourceId: activeSource.id,
        sourceTitle: activeSource.title,
        sourceKind: source ? 'current' : 'saved',
        sourceSignature,
        selectedViewIds: [...copyViewIds],
        includeMethods: copyMethods,
        includeProductPrices: copyPrices,
        results,
      };
      setReport(next);
      setReportStorageFailed(!saveCopyReport(next));
      setLocalError('review-targets');
      return;
    }

    setBusy(true);
    setLocalError(null);
    setReportStorageFailed(false);
    const results: PlacementSetupCopyTargetResult[] =
      retry && report?.sourceId === activeSource.id ? [...report.results] : [];
    let reportSaveFailed = false;
    const baseReport = (): PlacementSetupCopyReport => ({
      version: 2,
      example,
      sourceId: activeSource.id,
      sourceTitle: activeSource.title,
      sourceKind: source ? 'current' : 'saved',
      sourceSignature,
      selectedViewIds: [...copyViewIds],
      includeMethods: copyMethods,
      includeProductPrices: copyPrices,
      results: [...results],
    });
    try {
      for (const { id, product } of targets) {
        if (!product) continue;
        const prior = results.findIndex((result) => result.targetId === id);
        let result: PlacementSetupCopyTargetResult;
        try {
          const copied = copyPlacementSetup(activeSource, product, {
            selectedViewIds: copyViewIds,
            includeMethods: copyMethods,
            includePrices: copyPrices,
          });
          if (copied.kind === 'error') {
            result = {
              targetId: id,
              title: product.title,
              status: copied.reason === 'id-collision' ? 'failed' : 'blocked',
              reason: copied.reason,
            };
          } else if (!writePlacementPreviewProduct(example, copied.product)) {
            result = {
              targetId: id,
              title: product.title,
              status: 'failed',
              reason: 'storage-write-failed',
            };
          } else {
            result = {
              targetId: id,
              title: product.title,
              status: 'copied',
              reason: 'copied',
              summary: copied.summary,
            };
            setCatalogRevision((revision) => revision + 1);
          }
        } catch {
          result = {
            targetId: id,
            title: product.title,
            status: 'failed',
            reason: 'copy-unexpected-failure',
          };
        }
        if (prior >= 0) results[prior] = result;
        else results.push(result);
        setReport(baseReport());
        if (!saveCopyReport(baseReport())) reportSaveFailed = true;
      }
      const completed = baseReport();
      setReport(completed);
      setReportStorageFailed(reportSaveFailed);
      if (completed.results.some((result) => result.status === 'copied')) onComplete?.(completed);
    } finally {
      setBusy(false);
    }
  }

  function retryFailed() {
    if (!report || report.sourceId !== activeSource?.id || report.sourceSignature !== sourceSignature) return;
    const ids = report.results.filter((result) => result.status === 'failed').map((result) => result.targetId);
    if (ids.length) void copyTo(ids, true);
  }

  const hasCopied = !!report?.results.some((result) => result.status === 'copied');
  const hasUncopied = !!report?.results.some((result) => result.status !== 'copied');
  const copiedResults = report?.results.filter((result) => result.status === 'copied') ?? [];
  const unresolvedResults = report?.results.filter((result) => result.status !== 'copied') ?? [];
  const heading = showResultsOnly
    ? hasCopied
      ? hasUncopied
        ? translateUi('editor:placementSetupCopyDialog.headings.someProductsNeedAttention')
        : translateUi('editor:placementSetupCopyDialog.headings.setupCopied')
      : translateUi('editor:placementSetupCopyDialog.headings.copyNeedsAttention')
    : stage === 'review' || source
      ? translateUi('editor:placementSetupCopyDialog.headings.copySetupToProducts')
      : translateUi('editor:placementSetupCopyDialog.headings.chooseSourceSetup');
  const localErrorMessage =
    localError === 'source-changed'
      ? translateUi(
          'editor:placementSetupCopyDialog.theSourceSetupHasChangedOrCanTBeVerifiedStartANewCopyForTheRemainingProducts',
        )
      : localError === 'choose-target'
        ? translateUi('editor:placementSetupCopyDialog.chooseAtLeastOneDestinationProduct')
        : localError === 'review-targets'
          ? translateUi('editor:placementSetupCopyDialog.errors.reviewTargetList')
          : '';
  const chosenTargets = selectedTargetIds.flatMap((id) => {
    const product = targetById.get(id);
    return product ? [product] : [];
  });

  function productImage(product: PlacementProduct | undefined) {
    if (!product) return null;
    return product.images[0] ? (
      <s-thumbnail src={product.images[0].url} alt="" size="small" />
    ) : (
      <span class="placement-setup-copy__product-image" aria-hidden="true">
        <s-icon type="product" />
      </span>
    );
  }

  function destinations() {
    return (
      <PlacementCopyDestinations
        products={chosenTargets}
        total={selectedTargetIds.length}
        busy={busy}
        onChange={!source ? close : undefined}
      />
    );
  }

  function blockers() {
    return (
      preflightBlockers.length > 0 && (
        <s-banner
          tone="warning"
          heading={translateUi('editor:placementSetupCopyDialog.someProductsCanTReceiveThisSetup')}
        >
          <div class="placement-setup-copy__blockers">
            {preflightBlockers.map((blocker) => (
              <div key={blocker.targetId} class="placement-setup-copy__blocker">
                <div>
                  <s-text type="strong">
                    {targetById.get(blocker.targetId)?.title ??
                      translateUi('editor:placementSetupCopyDialog.source.unavailableProduct')}
                  </s-text>
                  <s-text>{resultMessage(blocker.reason, translateUi)}</s-text>
                </div>
                <s-button
                  variant="tertiary"
                  accessibilityLabel={translateUi('editor:placementSetupCopyDialog.selection.removeFromSelection', {
                    productName: targetById.get(blocker.targetId)?.title ?? blocker.targetId,
                  })}
                  disabled={busy}
                  onClick={() => toggleTarget(blocker.targetId, false)}
                >
                  {translateUi('editor:placementSetupCopyDialog.remove')}
                </s-button>
              </div>
            ))}
          </div>
        </s-banner>
      )
    );
  }

  return (
    <s-modal
      ref={modal}
      data-method-dialog
      heading={heading}
      size="base"
      onAfterShow={() => modal.current?.querySelector<HTMLElement>('s-search-field, [data-copy-stage]')?.focus()}
      onAfterHide={() => {
        if (!active.current) return;
        if (busy) {
          // Keep a running copy visible if Escape or the native close control dismisses it.
          modal.current?.showOverlay();
          return;
        }
        onClose();
      }}
    >
      <div class="placement-setup-copy" aria-busy={loading || busy}>
        {loading ? (
          <div class="placement-setup-copy__loading" role="status">
            <s-spinner
              size="base"
              accessibilityLabel={translateUi('editor:placementSetupCopyDialog.loadingProducts')}
            />
          </div>
        ) : loadError ? (
          <s-banner tone="critical" heading={translateUi('editor:placementSetupCopyDialog.productsCouldNotBeLoaded')}>
            <s-button onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
              {translateUi('editor:placementSetupCopyDialog.tryAgain')}
            </s-button>
          </s-banner>
        ) : (
          <section
            ref={stageRoot}
            tabIndex={-1}
            data-copy-stage={stage}
            class="placement-setup-copy__stage"
            aria-label={heading}
          >
            {!showResultsOnly && stage === 'choose' && (
              <div class="placement-setup-copy__chooser">
                {!source && destinations()}
                {source && (
                  <div class="placement-setup-copy__source-context">
                    {productImage(source)}
                    <div>
                      <s-text color="subdued">{translateUi('editor:placementSetupCopyDialog.fromCurrentDraft')}</s-text>
                      <s-text type="strong">{source.title}</s-text>
                    </div>
                  </div>
                )}
                {source && !sourceValid && (
                  <s-banner
                    tone="critical"
                    heading={translateUi(
                      source.views.length
                        ? 'editor:placementSetupCopyDialog.headings.checkSourceSetup'
                        : 'editor:placementSetupCopyDialog.headings.addViewFirst',
                    )}
                  >
                    {source.views.length
                      ? translateUi('editor:placementSetupCopyDialog.errors.invalidSourceValues')
                      : translateUi('editor:placementSetupCopyDialog.errors.sourceNeedsView')}
                  </s-banner>
                )}
                <s-search-field
                  label={translateUi(
                    source
                      ? 'editor:placementSetupCopyDialog.search.destinationProducts'
                      : 'editor:placementSetupCopyDialog.search.sourceSetups',
                  )}
                  labelAccessibilityVisibility="exclusive"
                  name="copyResourceSearch"
                  placeholder={translateUi(
                    source
                      ? 'editor:placementSetupCopyDialog.search.productsPlaceholder'
                      : 'editor:placementSetupCopyDialog.search.savedSetupsPlaceholder',
                  )}
                  value={query}
                  onInput={(event) => setQuery(event.currentTarget.value)}
                />
                {source && (
                  <div class="placement-setup-copy__picker-toolbar">
                    <s-text type="strong">
                      {translateUi('editor:placementSetupCopyDialog.selection.destinationCount', {
                        count: selectedTargetIds.length,
                        formattedCount: new Intl.NumberFormat(formatLocale).format(selectedTargetIds.length),
                      })}
                    </s-text>
                    <s-button
                      variant="tertiary"
                      disabled={!selectedTargetIds.length && !selectedOnly}
                      onClick={() => setSelectedOnly((value) => !value)}
                    >
                      {selectedOnly
                        ? translateUi('editor:placementSetupCopyDialog.selection.showAll')
                        : translateUi('editor:placementSetupCopyDialog.selection.showSelected', {
                            count: selectedTargetIds.length,
                            formattedCount: new Intl.NumberFormat(formatLocale).format(selectedTargetIds.length),
                          })}
                    </s-button>
                  </div>
                )}
                {!source && (
                  <div class="placement-setup-copy__picker-toolbar">
                    <s-text type="strong">
                      {translateUi('editor:placementSetupCopyDialog.selection.sourceCount', {
                        count: visibleSources.length,
                        formattedCount: new Intl.NumberFormat(formatLocale).format(visibleSources.length),
                      })}
                    </s-text>
                  </div>
                )}
                {pageItems.length ? (
                  <fieldset
                    class="placement-setup-copy__picker-list"
                    aria-label={translateUi(
                      source
                        ? 'editor:placementSetupCopyDialog.selection.targetProducts'
                        : 'editor:placementSetupCopyDialog.selection.sourceSetups',
                    )}
                  >
                    {pageItems.map((product) => {
                      if (!source)
                        return (
                          <s-clickable
                            key={product.id}
                            inlineSize="100%"
                            accessibilityLabel={translateUi('editor:placementSetupCopyDialog.selection.useSetupFrom', {
                              productName: product.title,
                            })}
                            disabled={selectedTargetIds.includes(product.id)}
                            onClick={() => chooseSource(product)}
                          >
                            <div class="placement-setup-copy__resource-row placement-setup-copy__source-row">
                              {productImage(product)}
                              <div class="placement-setup-copy__resource-copy">
                                <s-text type="strong">{product.title}</s-text>
                                <s-text color="subdued">
                                  {selectedTargetIds.includes(product.id)
                                    ? translateUi('editor:placementSetupCopyDialog.selection.selectedAsDestination')
                                    : translateUi('editor:placementSetupCopyDialog.counts.sourceSummary', {
                                        viewSummary: countLabel(
                                          product.views.length,
                                          'view',
                                          translateUi,
                                          formatLocale,
                                        ),
                                        placementSummary: countLabel(
                                          product.views.reduce((sum, view) => sum + view.placements.length, 0),
                                          'placement',
                                          translateUi,
                                          formatLocale,
                                        ),
                                      })}
                                </s-text>
                              </div>
                              <s-icon type="chevron-right" />
                            </div>
                          </s-clickable>
                        );
                      const selected = selectedTargetIds.includes(product.id);
                      const readiness = targetReadiness(product, example);
                      const disabled = busy || readiness !== 'ready';
                      return (
                        // biome-ignore lint/a11y/noStaticElementInteractions: The native child checkbox is the selection control; this row only extends its pointer hit area.
                        // biome-ignore lint/a11y/useKeyWithClickEvents: Keyboard selection is handled once by the child checkbox, with no second tab stop.
                        <div
                          key={product.id}
                          class={`placement-setup-copy__resource-row${selected ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
                          onClick={(event) => {
                            // The native checkbox is the sole keyboard control; the row extends its pointer hit area.
                            if (disabled) return;
                            if (
                              event
                                .composedPath()
                                .some((node) => node instanceof HTMLElement && node.localName === 's-checkbox')
                            )
                              return;
                            toggleTarget(product.id, !selected);
                          }}
                        >
                          <s-checkbox
                            label={product.title}
                            labelAccessibilityVisibility="exclusive"
                            name="targetProducts"
                            checked={selected}
                            disabled={disabled}
                            onChange={(event) => toggleTarget(product.id, event.currentTarget.checked)}
                          />
                          {productImage(product)}
                          <span class="placement-setup-copy__product-title">{product.title}</span>
                          {readiness !== 'ready' && (
                            <s-badge tone="neutral">
                              {translateUi(
                                readiness === 'configured'
                                  ? 'editor:placementSetupCopyDialog.status.setupExists'
                                  : 'editor:placementSetupCopyDialog.status.couldNotVerify',
                              )}
                            </s-badge>
                          )}
                        </div>
                      );
                    })}
                  </fieldset>
                ) : (
                  <s-empty-state
                    heading={
                      query
                        ? translateUi('editor:placementSetupCopyDialog.empty.noMatchesFound')
                        : source
                          ? selectedOnly
                            ? translateUi('editor:placementSetupCopyDialog.empty.noProductsSelected')
                            : translateUi('editor:placementSetupCopyDialog.empty.noOtherProducts')
                          : translateUi('editor:placementSetupCopyDialog.empty.noSetupsToCopy')
                    }
                  >
                    <s-paragraph>
                      {query
                        ? translateUi('editor:placementSetupCopyDialog.empty.tryAnotherSearch')
                        : source
                          ? selectedOnly
                            ? translateUi('editor:placementSetupCopyDialog.empty.showAllProducts')
                            : translateUi('editor:placementSetupCopyDialog.empty.addProductFirst')
                          : translateUi('editor:placementSetupCopyDialog.empty.saveSetupFirst')}
                    </s-paragraph>
                  </s-empty-state>
                )}
                {pageCount > 1 && (
                  <div class="placement-setup-copy__pagination">
                    <s-button
                      icon="chevron-left"
                      accessibilityLabel={translateUi('editor:placementSetupCopyDialog.previousProducts')}
                      disabled={currentPage === 0}
                      onClick={() => setChooserPage((page) => Math.max(0, page - 1))}
                    />
                    <s-text>
                      {translateUi('editor:placementSetupCopyDialog.counts.pagination', {
                        start: new Intl.NumberFormat(formatLocale).format(currentPage * 25 + 1),
                        end: new Intl.NumberFormat(formatLocale).format(
                          Math.min((currentPage + 1) * 25, chooserItems.length),
                        ),
                        total: new Intl.NumberFormat(formatLocale).format(chooserItems.length),
                      })}
                    </s-text>
                    <s-button
                      icon="chevron-right"
                      accessibilityLabel={translateUi('editor:placementSetupCopyDialog.nextProducts')}
                      disabled={currentPage + 1 >= pageCount}
                      onClick={() => setChooserPage((page) => page + 1)}
                    />
                  </div>
                )}
                {source && (
                  <s-text color="subdued">
                    {translateUi('editor:placementSetupCopyDialog.existingSetupsAreProtected')}
                  </s-text>
                )}
                {!report && resumableReport && (
                  <s-button
                    variant="tertiary"
                    onClick={() => {
                      setReport(resumableReport);
                      setResumedReport(true);
                      setIncludeProductPrices(resumableReport.includeProductPrices);
                      if (!source) {
                        setSourceId(resumableReport.sourceId);
                        setSelectedViewIds(resumableReport.selectedViewIds);
                      }
                    }}
                  >
                    {translateUi('editor:placementSetupCopyDialog.previousCopyResults')}
                  </s-button>
                )}
              </div>
            )}
            {!showResultsOnly && stage === 'review' && activeSource && (
              <div class="placement-setup-copy__review">
                {blockers()}
                {selectedTargetIds.length === 0 && (
                  <s-banner tone="warning">
                    {translateUi('editor:placementSetupCopyDialog.chooseAtLeastOneDestinationProduct')}
                  </s-banner>
                )}
                {sourceProofFailed && (
                  <s-banner tone="critical">
                    {translateUi(
                      'editor:placementSetupCopyDialog.theSourceSetupCouldNotBeVerifiedReopenThisCopyTaskToTryAgain',
                    )}
                  </s-banner>
                )}
                <PlacementSetupCopyReview
                  source={activeSource}
                  sourceKind={source ? 'current' : 'saved'}
                  selectedViewIds={selectedViewIds}
                  includeProductPrices={includeProductPrices}
                  busy={busy}
                  onViewsChange={setSelectedViewIds}
                  onPricesChange={setIncludeProductPrices}
                >
                  {destinations()}
                </PlacementSetupCopyReview>
                {localErrorMessage && <s-banner tone="critical">{localErrorMessage}</s-banner>}
              </div>
            )}
            {reportStorageFailed && (
              <s-banner tone="warning">
                {translateUi('editor:placementSetupCopyDialog.theResultReportCouldNotBeSavedToThisBrowserSession')}
              </s-banner>
            )}
            {showResultsOnly && report && (
              <section
                class="placement-setup-copy__results"
                aria-label={translateUi('editor:placementSetupCopyDialog.copyResults')}
                aria-live="polite"
              >
                <s-text color="subdued">
                  {translateUi('editor:placementSetupCopyDialog.source.reportTitle', {
                    sourceTitle: report.sourceTitle,
                  })}
                </s-text>
                {copiedResults.length > 0 && (
                  <div class="placement-setup-copy__success" role="status">
                    <div class="placement-setup-copy__success-copy">
                      <s-text type="strong">
                        {translateUi('editor:placementSetupCopyDialog.results.copiedTo', {
                          count: copiedResults.length,
                          formattedCount: new Intl.NumberFormat(formatLocale).format(copiedResults.length),
                        })}
                      </s-text>
                      <s-text color="subdued">
                        {translateUi(
                          'editor:placementSetupCopyDialog.chooseATargetImageAndReviewAlignmentBeforePublishing',
                        )}
                      </s-text>
                    </div>
                    {copiedResults[0] && (
                      <s-link
                        href={productEditorHref(copiedResults[0].targetId)}
                        accessibilityLabel={translateUi('editor:placementSetupCopyDialog.actions.reviewCopiedSetup', {
                          productName: copiedResults[0].title,
                        })}
                      >
                        {translateUi('editor:placementSetupCopyDialog.reviewACopiedSetup')}
                      </s-link>
                    )}
                  </div>
                )}
                {unresolvedResults.length > 0 && (
                  <fieldset
                    class="placement-setup-copy__result-list"
                    aria-label={translateUi('editor:placementSetupCopyDialog.productsNeedingAttention')}
                  >
                    {unresolvedResults.map((result) => (
                      <div class="placement-setup-copy__result" key={result.targetId}>
                        {productImage(targetById.get(result.targetId))}
                        <div>
                          <s-text type="strong">{result.title}</s-text>
                          <s-paragraph>{resultMessage(result.reason, translateUi)}</s-paragraph>
                          {result.summary && (
                            <s-text color="subdued">
                              {translateUi('editor:placementSetupCopyDialog.counts.sourceSummary', {
                                viewSummary: countLabel(result.summary.views, 'view', translateUi, formatLocale),
                                placementSummary: countLabel(
                                  result.summary.placements,
                                  'placement',
                                  translateUi,
                                  formatLocale,
                                ),
                              })}
                            </s-text>
                          )}
                        </div>
                        <s-badge tone={statusTone(result.status)}>{statusLabel(result.status, translateUi)}</s-badge>
                      </div>
                    ))}
                  </fieldset>
                )}
                {report.results.some((result) => result.status === 'failed') && (
                  <>
                    <s-button
                      disabled={
                        busy ||
                        report.sourceId !== activeSource?.id ||
                        !sourceSignature ||
                        report.sourceSignature !== sourceSignature
                      }
                      onClick={retryFailed}
                    >
                      {translateUi('editor:placementSetupCopyDialog.retryFailedTargets')}
                    </s-button>
                    {(!report.sourceSignature ||
                      sourceProofFailed ||
                      (sourceSignature && report.sourceSignature !== sourceSignature)) && (
                      <s-paragraph>
                        {translateUi(
                          'editor:placementSetupCopyDialog.theSourceSetupHasChangedOrCanTBeVerifiedStartANewCopyForTheRemainingProducts',
                        )}
                      </s-paragraph>
                    )}
                  </>
                )}
                {!hasCopied && !resumedReport && (
                  <s-button
                    variant="tertiary"
                    onClick={() => {
                      setReport(null);
                      setLocalError(null);
                      setStage('review');
                    }}
                  >
                    {translateUi('editor:placementSetupCopyDialog.backToReview')}
                  </s-button>
                )}
              </section>
            )}
          </section>
        )}
      </div>
      {(showResultsOnly || source || stage === 'review') && (
        <s-button
          slot="primary-action"
          variant="primary"
          disabled={
            busy ||
            (!showResultsOnly &&
              (loading || !!loadError || (stage === 'review' ? !canCopy : !sourceValid || !selectedTargetIds.length)))
          }
          loading={busy}
          onClick={() => {
            if (showResultsOnly) close();
            else if (stage === 'choose') setStage('review');
            else void copyTo(selectedTargetIds);
          }}
        >
          {showResultsOnly
            ? translateUi('common:actions.close')
            : stage === 'choose'
              ? translateUi('editor:placementWorkflowPreview.publicationActions.reviewSetup')
              : translateUi('editor:placementSetupCopyDialog.actions.copyTo', {
                  count: selectedTargetIds.length,
                  formattedCount: new Intl.NumberFormat(formatLocale).format(selectedTargetIds.length),
                })}
        </s-button>
      )}
      {!showResultsOnly && (
        <s-button slot="secondary-actions" disabled={busy} onClick={stage === 'review' ? backToChooser : close}>
          {stage === 'review'
            ? translateUi('editor:placementSetupCopyDialog.actions.back')
            : translateUi('common:actions.cancel')}
        </s-button>
      )}
    </s-modal>
  );
}
