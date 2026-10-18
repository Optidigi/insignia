import type { MerchantDraft } from '@insignia/contracts';
import type { Visualizer } from '@insignia/visualizer';
import {
  applyGeometryCommand,
  type EditorState,
  type GeometryCommand,
  type GeometryV1,
  projectScene,
  type Viewport,
  validateGeometry,
  validateRect,
} from '@insignia/visualizer/geometry';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { authenticatedJson } from '../shared/admin-request';
import type { CatalogProduct, ConfigView, PublicationState } from '../shared/admin-view.js';
import ArtworkUpload from './ArtworkUpload';
import ReadinessPermissions from './ReadinessPermissions';

type Props = {
  mode: 'picker' | 'config';
  productId?: string;
};
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
      min={0.01}
      max={1}
      step={0.01}
      value={String(text ?? value)}
      onInput={(event) => {
        const raw = event.currentTarget.value;
        lastInput.current = Number(raw);
        setText(raw);
        onInput(Number(raw));
      }}
      onChange={(event) => onChange(Number(event.currentTarget.value))}
      onBlur={() => {
        lastInput.current = null;
        setText(null);
      }}
      label={label}
      disabled={disabled}
    />
  );
}
type List = {
  products: CatalogProduct[];
  nextCursor: string | null;
};
type SaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'ambiguous';
type PendingRequest = {
  method: 'POST' | 'PUT';
  body: object;
  key: string;
  installationGeneration?: string;
};
const numberOf = (id: string) => /^gid:\/\/shopify\/(?:Product|ProductVariant)\/([1-9][0-9]*)$/.exec(id)?.[1];
const endpoint = (id: string) => `/api/admin/products/${encodeURIComponent(id)}/config`;
const freshId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
const defaultRect = () => ({ centerX: 0.5, centerY: 0.5, width: 0.3, height: 0.3 });
const publicationStorageKey = (productId: string) => `insignia:m5:publish:${productId}`;
const continuingPublication = (state: string) =>
  [
    'PUBLISH_REQUESTED',
    'REMOTE_PENDING',
    'REMOTE_READY_ACTIVATION_PENDING',
    'ACTIVATION_WAITING_RELEASE',
    'ACTIVATION_WAITING_HOLD',
    'HELD_ACTIVATION_PENDING',
    'ACTIVATED_RESTORATION_PENDING',
  ].includes(state);
function readPublicationRequest(productId: string): PendingRequest | null {
  try {
    return JSON.parse(sessionStorage.getItem(publicationStorageKey(productId)) ?? 'null') as PendingRequest | null;
  } catch {
    return null;
  }
}
function writePublicationRequest(productId: string, request: PendingRequest): void {
  try {
    sessionStorage.setItem(publicationStorageKey(productId), JSON.stringify(request));
  } catch {
    // Deterministic command keys still recover when embedded storage is unavailable.
  }
}
function clearPublicationRequest(productId: string): void {
  try {
    sessionStorage.removeItem(publicationStorageKey(productId));
  } catch {
    // Storage is optional for the signed bearer transport.
  }
}
function isDraft(value: unknown): value is MerchantDraft {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as MerchantDraft;
  try {
    return candidate.version === 'm5-merchant-draft-v1' && !!validateGeometry(candidate.geometry as GeometryV1);
  } catch {
    return false;
  }
}
function viewGeometry(draft: MerchantDraft): GeometryV1 {
  return draft.geometry as GeometryV1;
}
function initialEditor(draft: MerchantDraft): EditorState {
  const geometry = viewGeometry(draft);
  return { version: 0, geometry, viewId: geometry.views[0]?.id ?? 'front', artwork: { kind: 'logo-later' } };
}
function snapshotDraft(value: MerchantDraft): MerchantDraft {
  const copy = structuredClone(value);
  if (copy.labels)
    for (const group of Object.values({ ...copy.labels, values: undefined }))
      if (group) for (const [id, label] of Object.entries(group)) group[id] = label.trim();
  if (copy.labels?.values)
    for (const group of Object.values(copy.labels.values))
      for (const [id, label] of Object.entries(group)) group[id] = label.trim();
  return copy;
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
function LeanPriceInput({
  disabled,
  value,
  label,
  onPrice,
  onValidity,
}: {
  disabled: boolean;
  value: string;
  label: string;
  onPrice(value: string): void;
  onValidity(valid: boolean): void;
}) {
  const [typed, setTyped] = useState<{
    base: string;
    text: string;
  } | null>(null);
  const text = typed?.base === value ? typed.text : value;
  const valid = text === '' || leanDecimal(text);
  useEffect(() => onValidity(valid), [value, valid]);
  return (
    <>
      <s-text-field
        placeholder="Unavailable"
        value={text}
        aria-invalid={!valid}
        onInput={(event) => {
          const next = event.currentTarget.value;
          setTyped({ base: value, text: next });
          const allowed = next === '' || leanDecimal(next);
          onValidity(allowed);
          if (allowed) onPrice(next);
        }}
        label={label}
        disabled={disabled}
      />
      {!valid && <p role="alert">Enter a nonnegative amount with at most two decimal places.</p>}
    </>
  );
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
function disambiguateNames(names: readonly string[], kind: string): readonly string[] {
  // Number the complete group when names collide, including labels that mimic
  // a generated suffix. Distinct final suffixes keep every choice identifiable.
  return new Set(names).size < names.length
    ? names.map((name, index) => `${name} (${kind.toLowerCase()} ${index + 1})`)
    : names;
}
function choiceName(
  ids: readonly string[],
  labels: Readonly<Record<string, string>> | undefined,
  id: string,
  kind: string,
) {
  const names = ids.map((choice, index) => labels?.[choice]?.trim() || `${kind} ${index + 1}`);
  return disambiguateNames(names, kind)[ids.indexOf(id)] ?? `${kind} unavailable`;
}
function operatorPublication(state: PublicationState) {
  return ['OPERATOR_HOLD', 'RESTORATION_CONFLICT', 'CONFLICT'].includes(state);
}
function PublicationStatus({ config }: { config: NonNullable<ConfigView['config']> }) {
  const publication = config.publication;
  const labels: Record<typeof publication.state, string> = {
    DRAFT: 'Draft only',
    PUBLISH_REQUESTED: 'Publishing changes',
    REMOTE_PENDING: 'Updating product settings in Shopify',
    REMOTE_READY_ACTIVATION_PENDING: 'Shopify settings updated; activation is pending',
    ACTIVATION_WAITING_RELEASE: 'Publishing paused while app setup is verified',
    ACTIVATION_WAITING_HOLD: 'Preparing the product for a safe update',
    HELD_ACTIVATION_PENDING: 'Product temporarily unavailable while changes activate',
    ACTIVATED_RESTORATION_PENDING: 'Changes activated; restoring product availability',
    RESTORATION_CONFLICT: 'Changes activated; product availability needs support',
    ACTIVE: 'Active',
    CONFLICT: 'Product changed in Shopify; review before publishing',
    OPERATOR_HOLD: 'Publishing paused; support is required',
    FAILED: 'Publishing failed; the previous published settings are unchanged',
  };
  return (
    <s-section heading="Publication">
      <p role="status">{labels[publication.state]}</p>
      {publication.revisionId && <p>Latest revision: {publication.revisionId}</p>}
      {publication.activeRevisionId && <p>Effective revision: {publication.activeRevisionId}</p>}
      {publication.reason && <p>{publication.reason}</p>}
      {publication.requiresAllChannelHold !== null && (
        <p>All-channel hold required: {publication.requiresAllChannelHold ? 'Yes' : 'No'}</p>
      )}
      {publication.functionReadiness && <p>Function readiness: {publication.functionReadiness}</p>}
    </s-section>
  );
}
export default function MerchantConfigEditor({ mode, productId }: Props) {
  const [status, setStatus] = useState('Verifying Shopify Admin session…');
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<List | null>(null);
  const [view, setView] = useState<ConfigView | null>(null);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<MerchantDraft | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const editorRef = useRef<EditorState | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('clean');
  const [latest, setLatest] = useState<ConfigView['config'] | null>(null);
  const [copyTarget, setCopyTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [advancedText, setAdvancedText] = useState('');
  const [advancedError, setAdvancedError] = useState('');
  const [priceErrors, setPriceErrors] = useState<Record<string, boolean>>({});
  const [priceProposalStarted, setPriceProposalStarted] = useState(false);
  const [priceRevision, setPriceRevision] = useState(0);
  const [previewStatus, setPreviewStatus] = useState('');
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
  const pending = useRef<PendingRequest | null>(null);
  const publicationPending = useRef<PendingRequest | null>(null);
  const requestId = useRef(0);
  const observationId = useRef(0);
  const busyRef = useRef(false);
  const saveStateRef = useRef(saveState);
  const visualizerRef = useRef<Visualizer | null>(null);
  const projectRef = useRef(project);
  const viewRef = useRef(view);
  const refreshRef = useRef(refreshPublication);
  busyRef.current = busy;
  saveStateRef.current = saveState;
  editorRef.current = editor;
  projectRef.current = project;
  viewRef.current = view;
  refreshRef.current = refreshPublication;
  function clearPrivate() {
    requestId.current++;
    visualizerRef.current?.destroy();
    visualizerRef.current = null;
    viewRef.current = null;
    editorRef.current = null;
    pending.current = null;
    publicationPending.current = null;
    setView(null);
    setList(null);
    setDraft(null);
    setEditor(null);
    setLatest(null);
    setAdvancedText('');
    setAdvancedError('');
    setPriceErrors({});
    setPriceProposalStarted(false);
    setCopyTarget('');
    setValidationIssues([]);
    setPreviewStatus('');
    setImageSize(null);
    setBusy(false);
    setLoading(false);
  }
  function authorizationDenied(error: unknown) {
    const status = (
      error as {
        status?: number;
      }
    )?.status;
    if (status !== 401 && status !== 403) return false;
    clearPrivate();
    setStatus(error instanceof Error ? error.message : 'Current authorization required');
    return true;
  }
  function syncPublication(data: ConfigView) {
    if (!productId) return;
    const terminal = ['RESTORATION_CONFLICT', 'ACTIVE', 'CONFLICT', 'OPERATOR_HOLD', 'FAILED'];
    const owned = publicationPending.current ?? readPublicationRequest(productId);
    const ownedBody = owned?.body as
      | {
          action?: string;
          configId?: string;
          draftVersion?: string;
        }
      | undefined;
    if (
      data.config &&
      terminal.includes(data.config.publication.state) &&
      owned?.method === 'POST' &&
      ownedBody?.action === 'publish' &&
      ownedBody.configId === data.config.configId &&
      typeof ownedBody.draftVersion === 'string' &&
      typeof owned.key === 'string' &&
      owned.key.length > 0 &&
      owned.installationGeneration === data.config.installationGeneration &&
      (data.config.publication.requestKey !== owned.key ||
        data.config.publication.sourceDraftVersion !== ownedBody.draftVersion)
    ) {
      publicationPending.current = owned;
      return;
    }
    if (data.config && !terminal.includes(data.config.publication.state)) {
      const stored = readPublicationRequest(productId);
      const body = stored?.body as
        | {
            action?: string;
            configId?: string;
            draftVersion?: string;
          }
        | undefined;
      const source = data.config.publication.sourceDraftVersion;
      const originalKey = data.config.publication.requestKey;
      const serverMatches =
        data.config.publication.state === 'DRAFT' ||
        (body?.draftVersion === source && (!originalKey || stored?.key === originalKey));
      publicationPending.current =
        stored?.method === 'POST' &&
        body?.action === 'publish' &&
        body.configId === data.config.configId &&
        stored.installationGeneration === data.config.installationGeneration &&
        typeof body.draftVersion === 'string' &&
        serverMatches
          ? stored
          : null;
      if (!publicationPending.current && stored) clearPublicationRequest(productId);
    } else {
      publicationPending.current = null;
      clearPublicationRequest(productId);
    }
  }
  async function load(cursor: string | null = null, search = query, freshSession = false) {
    const seq = ++requestId.current;
    setLoading(true);
    visualizerRef.current?.destroy();
    visualizerRef.current = null;
    setView(null);
    setList(null);
    setDraft(null);
    setEditor(null);
    setPriceErrors({});
    setPriceProposalStarted(false);
    setValidationIssues([]);
    setStatus('Verifying Shopify Admin session…');
    try {
      if (mode === 'picker') {
        const params = new URLSearchParams({ q: search });
        if (cursor) params.set('cursor', cursor);
        const data = await authenticatedJson<List>(`/api/admin/products?${params}`, {}, freshSession);
        if (seq === requestId.current) {
          setList(data);
          setStatus('');
        }
      } else {
        if (!productId || !/^[1-9][0-9]*$/.test(productId)) throw new Error('Invalid product link');
        const data = await authenticatedJson<ConfigView>(endpoint(productId), {}, freshSession);
        if (seq === requestId.current) {
          syncPublication(data);
          setView(data);
          const value = data.config && isDraft(data.config.draft) ? data.config.draft : null;
          setDraft(value);
          setEditor(value ? initialEditor(value) : null);
          setSaveState('clean');
          setLatest(null);
          pending.current = null;
          setStatus(data.config && !value ? 'This draft version cannot be edited in this admin build.' : '');
        }
      }
    } catch (error) {
      if (seq === requestId.current) setStatus(error instanceof Error ? error.message : 'Admin data unavailable');
    } finally {
      if (seq === requestId.current) setLoading(false);
    }
  }
  useEffect(() => {
    const launchUrl = new URL(window.location.href);
    if (launchUrl.searchParams.has('id_token')) {
      launchUrl.searchParams.delete('id_token');
      window.history.replaceState(window.history.state, '', launchUrl.pathname + launchUrl.search + launchUrl.hash);
    }
    void load(null, '');
    const clear = clearPrivate;
    const visible = () => {
      if (
        !document.hidden &&
        !busyRef.current &&
        !pending.current &&
        !['dirty', 'saving', 'ambiguous', 'conflict'].includes(saveStateRef.current)
      )
        void load(null, '');
    };
    window.addEventListener('pagehide', clear);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clear();
      window.removeEventListener('pagehide', clear);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [mode, productId]);
  useEffect(() => {
    if (mode !== 'config') return;
    let refreshing = false;
    let stopped = false;
    const timer = setInterval(async () => {
      if (stopped || refreshing || document.hidden || busyRef.current || !viewRef.current?.config) return;
      refreshing = true;
      try {
        await refreshRef.current();
      } catch (error) {
        if (stopped) return;
        const status = (
          error as {
            status?: number;
          }
        )?.status;
        if (status === 401 || status === 403) {
          clearPrivate();
        } else {
          setView((current) =>
            current?.config
              ? {
                  ...current,
                  config: {
                    ...current.config,
                    publishEligibility: { allowed: false, reason: 'Current readiness could not be verified.' },
                  },
                }
              : current,
          );
        }
        setStatus(error instanceof Error ? error.message : 'Current Admin state unavailable');
      } finally {
        refreshing = false;
      }
    }, 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [mode, productId]);
  function apply(command: GeometryCommand) {
    const current = editorRef.current;
    if (!current || busyRef.current) return;
    try {
      const next = applyGeometryCommand(current, command);
      editorRef.current = next;
      setEditor(next);
      if (next.geometry !== current.geometry) {
        setDraft((old) => (old ? { ...old, geometry: next.geometry } : old));
        setSaveState('dirty');
        pending.current = null;
      }
    } catch (error) {
      setPreviewStatus(error instanceof Error ? error.message : 'Preview change rejected');
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
    setValidationIssues([]);
    if (busyRef.current) return;
    setDraft(next);
    setSaveState('dirty');
    pending.current = null;
    const current = editorRef.current;
    if (current && next.geometry !== current.geometry) {
      const geometry = validateGeometry(next.geometry as GeometryV1);
      const newViewId = geometry.views.some((item) => item.id === current.viewId)
        ? current.viewId
        : geometry.views[0]!.id;
      const updated = { ...current, version: current.version + 1, geometry, viewId: newViewId };
      editorRef.current = updated;
      setEditor(updated);
    }
  }
  function updateGeometry(update: (geometry: GeometryV1) => GeometryV1) {
    if (!draft) return;
    try {
      change({ ...draft, geometry: validateGeometry(update(viewGeometry(draft))) });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Geometry change rejected');
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
    if (!editor || mode !== 'config') return;
    const element = document.getElementById('insignia-visualizer');
    if (!element) return;
    let cancelled = false;
    void import('@insignia/visualizer')
      .then(async ({ createVisualizer }) => {
        const renderer = await createVisualizer({ element, onCommand: apply, onStatus: setPreviewStatus });
        if (cancelled) {
          renderer.destroy();
          return;
        }
        renderer.setMode('edit-placement');
        visualizerRef.current = renderer;
        const current = editorRef.current;
        if (current) updateRenderer(current);
      })
      .catch(() => {
        if (!cancelled) setPreviewStatus('Visual preview unavailable.');
      });
    return () => {
      cancelled = true;
      visualizerRef.current?.destroy();
      visualizerRef.current = null;
    };
  }, [mode, !!view?.config]);
  function project(current: EditorState) {
    const viewport: Viewport = {
      width: Math.max(1, document.getElementById('insignia-visualizer')?.clientWidth ?? 600),
      height: 420,
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
  async function send(request: PendingRequest) {
    if (!productId) throw new Error('Product link unavailable');
    return authenticatedJson<Record<string, unknown>>(endpoint(productId), {
      method: request.method,
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': request.key },
      body: JSON.stringify(request.body),
    });
  }
  async function create() {
    const epoch = requestId.current;
    observationId.current++;
    setBusy(true);
    try {
      await send({ method: 'POST', body: { action: 'create' }, key: crypto.randomUUID() });
      if (epoch !== requestId.current) return;
      await load();
    } catch (error) {
      if (epoch !== requestId.current || authorizationDenied(error)) return;
      setStatus(error instanceof Error ? error.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }
  async function save(retry = false) {
    if (!productId || !view?.config || !draft || (!retry && (saveState !== 'dirty' || advancedError))) return;
    const request =
      retry && pending.current
        ? pending.current
        : {
            method: 'PUT' as const,
            body: {
              action: 'save',
              configId: view.config.configId,
              draftVersion: view.config.draftVersion,
              draft: snapshotDraft(draft),
            },
            key: crypto.randomUUID(),
          };
    const epoch = requestId.current;
    observationId.current++;
    pending.current = request;
    setSaveState('saving');
    setBusy(true);
    try {
      const response = await send(request);
      if (epoch !== requestId.current) return;
      if (
        response.kind !== 'saved' ||
        typeof response.draftVersion !== 'string' ||
        !/^[1-9][0-9]*$/.test(response.draftVersion) ||
        BigInt(response.draftVersion) !== BigInt(view.config.draftVersion) + 1n
      )
        throw new Error('Invalid successful save response');
      const saved = (
        request.body as {
          draft: MerchantDraft;
        }
      ).draft;
      const savedVersion = response.draftVersion;
      setView({
        ...view,
        config: {
          ...view.config,
          draft: saved,
          draftVersion: savedVersion,
          publishEligibility: {
            allowed: false,
            reason: 'Publication eligibility has not been verified for this saved draft. Reload before publishing.',
          },
        },
      });
      setDraft(saved);
      setSaveState('saved');
      setStatus('Draft saved.');
      pending.current = null;
      try {
        const refreshed = await authenticatedJson<ConfigView>(endpoint(productId));
        if (epoch !== requestId.current) return;
        const config = refreshed.config;
        if (
          refreshed.product.id !== view.product.id ||
          !config ||
          config.configId !== view.config.configId ||
          config.installationGeneration !== view.config.installationGeneration ||
          config.draftVersion !== savedVersion ||
          canonical(config.draft) !== canonical(JSON.parse(JSON.stringify(saved))) ||
          typeof config.publishEligibility?.allowed !== 'boolean' ||
          !(config.publishEligibility.reason === null || typeof config.publishEligibility.reason === 'string')
        )
          throw new Error('Publication eligibility does not match the saved draft');
        setView(refreshed);
      } catch (error) {
        if (epoch !== requestId.current || authorizationDenied(error)) return;
        setStatus('Draft saved. Publication eligibility could not be verified. Reload before publishing.');
      }
    } catch (error) {
      if (epoch !== requestId.current || authorizationDenied(error)) return;
      const status = (
        error as {
          status?: number;
        }
      )?.status;
      if (status && status >= 400 && status < 500 && status !== 409) {
        const issues = (
          error as {
            validationIssues?: {
              path: string;
              message: string;
            }[];
          }
        ).validationIssues;
        setValidationIssues(Array.isArray(issues) ? issues.slice(0, 20) : []);
        pending.current = null;
        setSaveState('dirty');
        setStatus(error instanceof Error ? error.message : 'Save denied');
        return;
      }
      const body = request.body as {
        draftVersion: string;
        draft: MerchantDraft;
      };
      const result = await authenticatedJson<ConfigView>(endpoint(productId)).catch((readError) => {
        if (epoch === requestId.current) authorizationDenied(readError);
        return null;
      });
      if (epoch !== requestId.current) return;
      if (
        result &&
        (result.product.id !== view.product.id ||
          result.config?.configId !== view.config.configId ||
          result.config.installationGeneration !== view.config.installationGeneration)
      ) {
        authorizationDenied(
          Object.assign(new Error('Save context changed. Reload before continuing.'), { status: 403 }),
        );
        return;
      }
      if (status === 409) {
        pending.current = null;
        setLatest(result?.config ?? null);
        setSaveState('conflict');
        setStatus('Another editor changed this draft. Review the latest version.');
        return;
      }
      if (
        result?.product.id === view.product.id &&
        result?.config &&
        result.config.configId === view.config.configId &&
        result.config.installationGeneration === view.config.installationGeneration &&
        /^[1-9][0-9]*$/.test(result.config.draftVersion) &&
        BigInt(result.config.draftVersion) === BigInt(body.draftVersion) + 1n &&
        canonical(result.config.draft) === canonical(body.draft)
      ) {
        setView(result);
        setDraft(result.config.draft as MerchantDraft);
        setSaveState('saved');
        setStatus('Draft saved; verified after an interrupted response.');
        pending.current = null;
      } else {
        setLatest(result?.config ?? null);
        const conflict = status === 409 || !!(result?.config && result.config.draftVersion !== body.draftVersion);
        setSaveState(conflict ? 'conflict' : 'ambiguous');
        setStatus(
          conflict
            ? 'Another editor changed this draft. Review the latest version.'
            : 'Save result is uncertain. Retry the exact request or reload.',
        );
      }
    } finally {
      setBusy(false);
    }
  }
  async function refreshPublication() {
    const view = viewRef.current;
    if (!productId || !view?.config) throw new Error('Publication context unavailable');
    const epoch = requestId.current;
    const observation = ++observationId.current;
    let data: ConfigView;
    try {
      data = await authenticatedJson<ConfigView>(endpoint(productId));
    } catch (error) {
      if (epoch !== requestId.current) return;
      const status = (
        error as {
          status?: number;
        }
      )?.status;
      if (observation !== observationId.current && status !== 401 && status !== 403) return;
      throw error;
    }
    if (epoch !== requestId.current || observation !== observationId.current) return;
    const config = data.config;
    if (
      data.product.id !== view.product.id ||
      !config ||
      config.configId !== view.config.configId ||
      config.installationGeneration !== view.config.installationGeneration
    )
      throw Object.assign(new Error('Publication context changed. Reload before continuing.'), { status: 403 });
    syncPublication(data);
    const sameSavedDraft =
      config.draftVersion === view.config.draftVersion &&
      canonical(config.draft) === canonical(JSON.parse(JSON.stringify(view.config.draft)));
    setView((current) =>
      current?.config &&
      current.config.configId === view.config!.configId &&
      current.config.draftVersion === view.config!.draftVersion
        ? {
            ...current,
            product: { ...current.product, status: data.product.status },
            config: {
              ...current.config,
              publication: config.publication,
              currentShopCurrency: config.currentShopCurrency,
              publishEligibility: sameSavedDraft
                ? config.publishEligibility
                : { allowed: false, reason: 'The saved draft changed. Reload before requesting a new publication.' },
            },
          }
        : current,
    );
    // Continuation refreshes durable progress and product status only: local geometry, edits, CAS base,
    // conflict/latest view and the exact uncertain save request remain owned by save/load.
    return config.publication;
  }
  async function publish() {
    if (!productId || !view?.config || operatorPublication(view.config.publication.state)) return;
    const open = continuingPublication(view.config.publication.state);
    if (!open && !publicationPending.current && (hasPriceErrors || !['clean', 'saved'].includes(saveState))) return;
    const sourceVersion = open ? view.config.publication.sourceDraftVersion : view.config.draftVersion;
    if (!publicationPending.current && !sourceVersion) {
      setStatus('The original publication request cannot be recovered. Contact an operator before retrying.');
      return;
    }
    const request =
      publicationPending.current ??
      ({
        method: 'POST',
        body: { action: 'publish', configId: view.config.configId, draftVersion: sourceVersion },
        installationGeneration: view.config.installationGeneration,
        key:
          open && view.config.publication.requestKey
            ? view.config.publication.requestKey
            : `m5pub_${view.config.configId}_${view.config.installationGeneration}_${sourceVersion}`,
      } satisfies PendingRequest);
    const epoch = requestId.current;
    observationId.current++;
    publicationPending.current = request;
    writePublicationRequest(productId, request);
    setBusy(true);
    try {
      let phase = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await send(request);
        if (epoch !== requestId.current) return;
        phase = String(result.state ?? '');
        if (!['PUBLISH_REQUESTED', 'REMOTE_PENDING'].includes(phase)) break;
      }
      await refreshPublication();
      if (epoch !== requestId.current) return;
      if (['PUBLISH_REQUESTED', 'REMOTE_PENDING'].includes(phase))
        setStatus('Publication is pending. Continue the same request when ready.');
      else setStatus('Publication state refreshed.');
    } catch (error) {
      if (epoch !== requestId.current || authorizationDenied(error)) return;
      const observed = await refreshPublication().catch((refreshError) => {
        authorizationDenied(refreshError);
        return undefined;
      });
      if (epoch !== requestId.current) return;
      if (
        observed?.requestKey === request.key &&
        observed.sourceDraftVersion ===
          (
            request.body as {
              draftVersion?: string;
            }
          ).draftVersion &&
        (observed.state === 'ACTIVE' || observed.state === 'FAILED' || operatorPublication(observed.state))
      ) {
        setStatus('Publication state refreshed.');
        return;
      }
      setStatus(
        error instanceof Error
          ? `${error.message}. Continue the same publication request after checking its current state.`
          : 'Publication result is uncertain. Continue the same request.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (hasPriceErrors) return;
    const target = copyTarget.trim();
    if (!/^[1-9][0-9]*$/.test(target)) {
      setStatus('Enter a Shopify product number.');
      return;
    }
    const epoch = requestId.current;
    observationId.current++;
    setBusy(true);
    try {
      await send({
        method: 'POST',
        body: { action: 'copy', targetProductId: `gid://shopify/Product/${target}` },
        key: crypto.randomUUID(),
      });
      if (epoch !== requestId.current) return;
      window.location.assign(`/admin/products/${target}/config`);
    } catch (error) {
      if (epoch !== requestId.current || authorizationDenied(error)) return;
      setStatus(error instanceof Error ? error.message : 'Copy failed');
    } finally {
      setBusy(false);
    }
  }
  const geometry = draft ? viewGeometry(draft) : null;
  const selectedView = geometry?.views.find((item) => item.id === editor?.viewId);
  const selectedPlacement = draft?.placements.find((item) => item.id === editor?.selectedPlacementId);
  const selectedGeometry = selectedView?.placements.find((item) => item.id === editor?.selectedPlacementId);
  const selectedRect =
    selectedGeometry?.variantOverrides?.find((item) => item.variantId === editor?.variantId)?.rect ??
    selectedGeometry?.rect;
  const selectedStep = geometry?.steps.find((item) => item.id === editor?.selectedStepId);
  type LabelKind = Exclude<keyof NonNullable<MerchantDraft['labels']>, 'values'>;
  const labelFor = (kind: LabelKind, id: string) => draft?.labels?.[kind]?.[id] ?? '';
  const choiceLabel = (kind: LabelKind, id: string) => {
    const groups = {
      methods: { name: 'Method', items: draft?.methods ?? [] },
      placements: { name: 'Placement', items: draft?.placements ?? [] },
      steps: { name: 'Size step', items: geometry?.steps ?? [] },
      views: { name: 'View', items: geometry?.views ?? [] },
      options: { name: 'Option', items: draft?.productionOptions ?? [] },
      prices: { name: 'Price', items: draft?.pricingRules ?? [] },
    };
    const group = groups[kind];
    return choiceName(
      group.items.map((item) => item.id),
      draft?.labels?.[kind],
      id,
      group.name,
    );
  };
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
  const priceCellNames = disambiguateNames(
    priceCells.map(
      (cell) =>
        `${choiceLabel('methods', cell.methodId)} / ${choiceLabel('placements', cell.placementId)} / ${choiceLabel('steps', cell.stepId)}`,
    ),
    'Price choice',
  );
  const hasPriceErrors = priceCells.some((cell) => priceErrors[cell.key]);
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
  return (
    <s-page
      heading={
        mode === 'picker' ? 'Products' : view?.product.title ? `Customize ${view.product.title}` : 'Customize product'
      }
    >
      {mode === 'config' && (
        <s-button slot="breadcrumb-actions" href="/admin/products" icon="arrow-left">
          Products
        </s-button>
      )}
      {status && (
        <p class="admin-status" role="status">
          {status}
        </p>
      )}
      {mode === 'config' && view === null && (
        <s-button disabled={loading} onClick={() => void load(null, '', true)}>
          Retry session
        </s-button>
      )}
      {(mode === 'picker' ? list !== null : view !== null) && (
        <div class="admin-setup">
          <ReadinessPermissions
            inspect={() =>
              authenticatedJson('/api/admin/readiness', {}, true).catch((error) => {
                authorizationDenied(error);
                throw error;
              })
            }
          />
        </div>
      )}
      {mode === 'picker' && (
        <s-section heading="Shopify products">
          <p class="admin-description">Choose a product to configure its customization options and preview.</p>
          <div class="product-search">
            <s-search-field
              label="Search products"
              placeholder="Search your catalog"
              value={query}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
            <s-button variant="primary" onClick={() => void load(null, query)}>
              Search
            </s-button>
          </div>
          {list && (
            <p class="product-result-count" role="status">
              {list.products.length} products on this page
            </p>
          )}
          <div class="product-results">
            {list?.products.map((product) => (
              <article class="product-card" key={product.id}>
                <div class="product-image">
                  {product.imageUrl ? (
                    <img src={product.imageUrl} width="72" height="72" alt="" />
                  ) : (
                    <span>No image</span>
                  )}
                </div>
                <div class="product-details">
                  <h2>{product.title}</h2>
                  <s-badge tone={product.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {product.status === 'ACTIVE'
                      ? 'Active'
                      : product.status === 'ARCHIVED'
                        ? 'Archived'
                        : product.status === 'DRAFT'
                          ? 'Draft'
                          : product.status}
                  </s-badge>
                  {product.variants.length > 0 && (
                    <p class="product-variants">
                      {product.variants
                        .slice(0, 5)
                        .map((variant) => variant.title)
                        .join(', ')}
                    </p>
                  )}
                </div>
                {numberOf(product.id) && (
                  <div class="product-action">
                    <s-link href={`/admin/products/${numberOf(product.id)}/config`}>Configure product</s-link>
                  </div>
                )}
              </article>
            ))}
          </div>
          {list && list.products.length === 0 && <p class="product-empty">No products found.</p>}
          {list?.nextCursor && <s-button onClick={() => void load(list.nextCursor, query)}>Next page</s-button>}
        </s-section>
      )}
      {mode === 'config' && view && (
        <>
          <s-section heading={view.product.title}>
            <p>
              Product status:{' '}
              {view.product.status === 'ACTIVE'
                ? 'Active'
                : view.product.status === 'ARCHIVED'
                  ? 'Archived'
                  : view.product.status === 'DRAFT'
                    ? 'Draft'
                    : view.product.status}
            </p>
            {view.product.imageUrl && <img src={view.product.imageUrl} width="160" alt="Product preview" />}
            {!view.config && (
              <s-button disabled={busy} onClick={() => void create()}>
                Create configuration
              </s-button>
            )}
          </s-section>
          {view.config && draft && geometry && editor && (
            <>
              <PublicationStatus config={view.config} />
              <s-section heading="Customization settings">
                {validationIssues.length > 0 && (
                  <div role="alert">
                    {validationIssues.map((issue) => (
                      <p key={issue.path}>
                        {issue.path}: {issue.message}
                      </p>
                    ))}
                  </div>
                )}
                <p>
                  <s-badge
                    tone={
                      saveState === 'conflict' || saveState === 'ambiguous'
                        ? 'warning'
                        : saveState === 'dirty'
                          ? 'info'
                          : 'success'
                    }
                  >
                    {
                      {
                        clean: 'All changes saved',
                        dirty: 'Unsaved changes',
                        saving: 'Saving changes…',
                        saved: 'All changes saved',
                        conflict: 'Newer changes found',
                        ambiguous: 'Save could not be confirmed',
                      }[saveState]
                    }
                  </s-badge>
                  <s-text color="subdued">
                    {' '}
                    Draft version {view.config.draftVersion}. Publish saved changes when you are ready for customers to
                    use them.
                  </s-text>
                </p>
                <s-stack gap="base">
                  <s-section heading="Customization rules">
                    <s-select
                      value={draft.mode}
                      onChange={(event) =>
                        change({ ...draft, mode: event.currentTarget.value as MerchantDraft['mode'] })
                      }
                      label={'Customization mode'}
                      disabled={busy}
                    >
                      <s-option value="optional">Optional</s-option>
                      <s-option value="required">Required for all purchases</s-option>
                    </s-select>
                    <p>Draft shop currency: {draft.shopCurrency}</p>
                    {view.config.currentShopCurrency && view.config.currentShopCurrency !== draft.shopCurrency && (
                      <div role="alert">
                        <p>
                          Current shop currency: {view.config.currentShopCurrency}. Existing amounts are not converted.
                          Review every price before saving or publishing.
                        </p>
                        <s-button
                          type="button"
                          onClick={() => {
                            const currency = view.config?.currentShopCurrency;
                            if (currency) change({ ...draft, shopCurrency: currency });
                          }}
                          disabled={busy}
                          icon="check"
                        >
                          Use current shop currency
                        </s-button>
                      </div>
                    )}
                  </s-section>
                  <s-section heading="Decoration methods">
                    {draft.methods.map((method) => (
                      <p key={method.id}>
                        <strong>{choiceLabel('methods', method.id)}</strong>{' '}
                        <s-text-field
                          maxLength={80}
                          value={labelFor('methods', method.id)}
                          onInput={(event) => setLabel('methods', method.id, event.currentTarget.value)}
                          label={'Method name'}
                          disabled={busy}
                        />{' '}
                        <s-button
                          type="button"
                          onClick={() =>
                            change({
                              ...draft,
                              methods: draft.methods.filter((item) => item.id !== method.id),
                              labels: removeChoiceLabels(draft.labels, 'methods', method.id),
                            })
                          }
                          disabled={busy}
                          icon="delete"
                        >
                          Remove method
                        </s-button>
                      </p>
                    ))}
                    <s-button
                      type="button"
                      onClick={() => change({ ...draft, methods: [...draft.methods, { id: freshId('method') }] })}
                      disabled={busy}
                      icon="plus"
                    >
                      Add method
                    </s-button>
                  </s-section>
                  <s-section heading="Product images">
                    <s-select
                      value={editor.viewId}
                      onChange={(event) => choose({ kind: 'select-view', viewId: event.currentTarget.value })}
                      label={'View'}
                      disabled={busy}
                    >
                      {geometry.views.map((item) => (
                        <s-option key={item.id} value={item.id}>
                          {choiceLabel('views', item.id)}
                        </s-option>
                      ))}
                    </s-select>
                    <s-text-field
                      maxLength={80}
                      value={labelFor('views', editor.viewId)}
                      onInput={(event) => setLabel('views', editor.viewId, event.currentTarget.value)}
                      label={'View name'}
                      disabled={busy}
                    />
                    <s-button
                      type="button"
                      onClick={() =>
                        updateGeometry((value) => ({
                          ...value,
                          views: [...value.views, { id: freshId('view'), variantImages: [], placements: [] }],
                        }))
                      }
                      disabled={busy}
                      icon="plus"
                    >
                      Add view
                    </s-button>
                    <s-select
                      value={editor.variantId ?? ''}
                      onChange={(event) =>
                        choose({ kind: 'select-variant', variantId: event.currentTarget.value || undefined })
                      }
                      label={'Product variant'}
                      disabled={busy}
                    >
                      <s-option value="">Featured image</s-option>
                      {view.product.variants.map((item) => (
                        <s-option key={item.id} value={'variant_' + numberOf(item.id)}>
                          {item.title}
                        </s-option>
                      ))}
                    </s-select>
                    {view.product.variantsTruncated && (
                      <p role="alert">
                        This product has more than 500 variants. Only the first 500 are available here; review the full
                        catalog before saving variant-specific geometry.
                      </p>
                    )}
                    <s-button
                      type="button"
                      disabled={busy || !selectedImage || !imageSize}
                      onClick={() => {
                        if (!selectedImage || !imageSize || !selectedView) return;
                        const ref = { revisionId: editor.variantId ?? `product_${productId}`, ...imageSize };
                        updateGeometry((value) => ({
                          ...value,
                          views: value.views.map((item) =>
                            item.id !== editor.viewId
                              ? item
                              : editor.variantId
                                ? {
                                    ...item,
                                    variantImages: [
                                      ...item.variantImages.filter((entry) => entry.variantId !== editor.variantId),
                                      { variantId: editor.variantId!, image: ref },
                                    ],
                                  }
                                : { ...item, image: ref },
                          ),
                        }));
                      }}
                      icon="check"
                    >
                      Use selected product image
                    </s-button>
                  </s-section>
                  <s-section heading="Print areas">
                    <p>
                      Choose where customers can add artwork. Position and dimensions use fractions of the product
                      image: 0.5 is halfway across or half its size.
                    </p>
                    <s-select
                      value={editor.selectedPlacementId ?? ''}
                      onChange={(event) =>
                        choose({ kind: 'select-placement', placementId: event.currentTarget.value || undefined })
                      }
                      label="Print area"
                      disabled={busy}
                    >
                      <s-option value="">None</s-option>
                      {selectedView?.placements.map((item) => (
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
                      disabled={busy}
                      icon="plus"
                    >
                      Add placement to view
                    </s-button>
                    {selectedPlacement && selectedRect && (
                      <div>
                        <p>
                          <strong>{choiceLabel('placements', selectedPlacement.id)}</strong>
                        </p>
                        <s-text-field
                          maxLength={80}
                          value={labelFor('placements', selectedPlacement.id)}
                          onInput={(event) => setLabel('placements', selectedPlacement.id, event.currentTarget.value)}
                          label={'Placement name'}
                          disabled={busy}
                        />
                        <s-checkbox
                          checked={selectedPlacement.logoLaterAllowed}
                          onChange={(event) =>
                            setPlacement(selectedPlacement.id, (item) => ({
                              ...item,
                              logoLaterAllowed: event.currentTarget.checked,
                            }))
                          }
                          label={'Allow logo later'}
                          disabled={busy}
                        />
                        <p>Allowed methods</p>
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
                            disabled={busy}
                            key={item.id}
                          />
                        ))}
                        <p>Allowed size steps</p>
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
                            disabled={busy}
                            key={item.id}
                          />
                        ))}
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
                                centerX: 'Horizontal position',
                                centerY: 'Vertical position',
                                width: 'Print area width',
                                height: 'Print area height',
                              }[field]
                            }
                            disabled={busy}
                          />
                        ))}
                      </div>
                    )}
                  </s-section>
                  <s-section heading="Print sizes">
                    <p>
                      Define the artwork sizes customers can choose. Width and height are fractions of the selected
                      print area; 1 fills it.
                    </p>
                    <s-select
                      value={editor.selectedStepId ?? ''}
                      onChange={(event) =>
                        choose({ kind: 'select-step', stepId: event.currentTarget.value || undefined })
                      }
                      label="Print size"
                      disabled={busy}
                    >
                      <s-option value="">None</s-option>
                      {geometry.steps.map((item) => (
                        <s-option key={item.id} value={item.id}>
                          {choiceLabel('steps', item.id)}
                        </s-option>
                      ))}
                    </s-select>
                    {selectedStep && (
                      <s-text-field
                        maxLength={80}
                        value={labelFor('steps', selectedStep.id)}
                        onInput={(event) => setLabel('steps', selectedStep.id, event.currentTarget.value)}
                        label={'Size step name'}
                        disabled={busy}
                      />
                    )}
                    <s-button
                      type="button"
                      onClick={() =>
                        updateGeometry((value) => ({
                          ...value,
                          steps: [...value.steps, { id: freshId('step'), widthFraction: 0.5, heightFraction: 0.5 }],
                        }))
                      }
                      disabled={busy}
                      icon="plus"
                    >
                      Add size step
                    </s-button>
                    {selectedStep &&
                      (['widthFraction', 'heightFraction'] as const).map((field) => (
                        <s-number-field
                          min={0.01}
                          max={1}
                          step={0.01}
                          value={String(selectedStep[field])}
                          onChange={(event) => {
                            const value = Number(event.currentTarget.value);
                            updateGeometry((current) => ({
                              ...current,
                              steps: current.steps.map((item) =>
                                item.id === selectedStep.id ? { ...item, [field]: value } : item,
                              ),
                            }));
                          }}
                          label={
                            {
                              widthFraction: 'Width relative to print area',
                              heightFraction: 'Height relative to print area',
                            }[field]
                          }
                          disabled={busy}
                          key={field}
                        />
                      ))}
                    <div
                      role="img"
                      id="insignia-visualizer"
                      data-editor-version={editor.version}
                      data-selected-placement={editor.selectedPlacementId ?? ''}
                      data-publication-state={JSON.stringify({
                        state: view.config.publication.state,
                        revisionId: view.config.publication.revisionId,
                        sourceDraftVersion: view.config.publication.sourceDraftVersion,
                      })}
                      style="width:100%;height:420px"
                      aria-label="Product placement preview"
                    ></div>
                    {previewStatus && <p role="status">Preview: {previewStatus}</p>}
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
                  </s-section>
                  <s-section heading="Customer options">
                    {draft.productionOptions.map((item) => (
                      <p key={item.id}>
                        <strong>{choiceLabel('options', item.id)}</strong>{' '}
                        <s-text-field
                          maxLength={80}
                          value={labelFor('options', item.id)}
                          onInput={(event) => setLabel('options', item.id, event.currentTarget.value)}
                          label={'Option name'}
                          disabled={busy}
                        />{' '}
                        {item.allowedValueIds.map((id, index) => (
                          <s-text-field
                            maxLength={80}
                            value={valueLabel(item.id, id)}
                            onInput={(event) => setValueLabel(item.id, id, event.currentTarget.value)}
                            label={['Value', index + 1, 'name'].join(' ')}
                            disabled={busy}
                            key={id}
                          />
                        ))}{' '}
                        <s-button
                          type="button"
                          onClick={() =>
                            change({
                              ...draft,
                              productionOptions: draft.productionOptions.filter((option) => option.id !== item.id),
                              labels: removeChoiceLabels(draft.labels, 'options', item.id),
                            })
                          }
                          disabled={busy}
                          icon="delete"
                        >
                          Remove option
                        </s-button>
                        <s-button
                          type="button"
                          onClick={() =>
                            change({
                              ...draft,
                              productionOptions: draft.productionOptions.map((option) =>
                                option.id === item.id
                                  ? { ...option, allowedValueIds: [...option.allowedValueIds, freshId('value')] }
                                  : option,
                              ),
                            })
                          }
                          disabled={busy}
                          icon="plus"
                        >
                          Add value
                        </s-button>
                      </p>
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
                      disabled={busy}
                      icon="plus"
                    >
                      Add production option
                    </s-button>
                  </s-section>
                  <s-section heading="Decoration prices">
                    {legacyPricing ? (
                      <section aria-label="Historical pricing">
                        <p>
                          This draft uses historical pricing that is unavailable for new offers. Existing prices are
                          read-only; saved publications and purchases keep their original terms.
                        </p>
                        <ul>
                          {draft.pricingRules.map((rule) => (
                            <li key={rule.id}>
                              {choiceLabel('prices', rule.id)}:{' '}
                              {rule.role === 'setup'
                                ? 'Setup'
                                : rule.methodUnitMultiplicity === 'perPlacement'
                                  ? 'Per decorated placement'
                                  : 'Per garment'}{' '}
                              —{' '}
                              {rule.scope.kind === 'general'
                                ? 'General'
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
                            </li>
                          ))}
                        </ul>
                        <p>
                          Start a new local price proposal, enter and review every available choice, then save and
                          publish a new revision. This does not convert or change a published revision.
                        </p>
                        <s-button
                          type="button"
                          onClick={() => {
                            setPriceErrors({});
                            setPriceProposalStarted(true);
                            change({
                              ...draft,
                              pricingRules: [],
                              labels: draft.labels ? { ...draft.labels, prices: {} } : draft.labels,
                            });
                          }}
                          disabled={busy}
                        >
                          Set decoration prices
                        </s-button>
                      </section>
                    ) : (
                      <>
                        <p>
                          Final decoration surcharge per garment, added to the garment price for each selected
                          placement. Blank means unavailable; enter 0 only for an explicitly free choice.
                        </p>
                        {priceProposalStarted && (
                          <p role="status">
                            New local price proposal: review all choices before saving and publishing. Published history
                            has not changed.
                          </p>
                        )}
                        {priceCells.length ? (
                          <table>
                            <caption>Decoration prices ({draft.shopCurrency})</caption>
                            <thead>
                              <tr>
                                <th>Method</th>
                                <th>Placement</th>
                                <th>Size</th>
                                <th>Surcharge per garment</th>
                              </tr>
                            </thead>
                            <tbody>
                              {priceCells.map((cell, cellIndex) => {
                                const rule = draft.pricingRules.find(
                                  (item) =>
                                    item.scope.kind === 'step' &&
                                    item.scope.methodId === cell.methodId &&
                                    item.scope.placementId === cell.placementId &&
                                    item.scope.stepId === cell.stepId,
                                );
                                const value = rule?.rate.kind === 'fixed' ? rule.rate.amount.shopDecimal : '';
                                const names = priceCellNames[cellIndex];
                                return (
                                  <tr key={cell.key}>
                                    <td>{choiceLabel('methods', cell.methodId)}</td>
                                    <td>{choiceLabel('placements', cell.placementId)}</td>
                                    <td>{choiceLabel('steps', cell.stepId)}</td>
                                    <td>
                                      <LeanPriceInput
                                        key={`${cell.key}:${priceRevision}`}
                                        value={value}
                                        label={`${names} — surcharge (${draft.shopCurrency})`}
                                        onPrice={(amount) => updateLeanPrice(cell, amount)}
                                        onValidity={(valid) =>
                                          setPriceErrors((old) => ({ ...old, [cell.key]: !valid }))
                                        }
                                        disabled={busy}
                                      />
                                      {rule ? (
                                        <s-button
                                          type="button"
                                          onClick={() => {
                                            setPriceErrors((old) => ({ ...old, [cell.key]: false }));
                                            updateLeanPrice(cell, '');
                                          }}
                                          disabled={busy}
                                        >
                                          Make unavailable
                                        </s-button>
                                      ) : (
                                        <span>Unavailable</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        ) : (
                          <p>Add a method, placement and allowed size to enter decoration prices.</p>
                        )}
                      </>
                    )}
                    <s-button
                      type="button"
                      onClick={() => {
                        setAdvanced(!advanced);
                        setAdvancedText(JSON.stringify(draft, null, 2));
                        setAdvancedError('');
                      }}
                      disabled={busy}
                    >
                      Advanced configuration (JSON)
                    </s-button>
                    {advanced && (
                      <div>
                        <s-text-area
                          label="Advanced JSON"
                          disabled={busy}
                          rows={16}
                          value={advancedText}
                          onInput={(event) => setAdvancedText(event.currentTarget.value)}
                        />
                        <s-button
                          type="button"
                          onClick={() => {
                            try {
                              const parsed = JSON.parse(advancedText) as MerchantDraft;
                              if (!isDraft(parsed)) throw new Error('Invalid draft geometry');
                              change(parsed);
                              setAdvancedError('');
                            } catch {
                              setAdvancedError('Invalid draft JSON or geometry');
                            }
                          }}
                          disabled={busy}
                        >
                          Apply JSON
                        </s-button>
                        {advancedError && <p role="alert">{advancedError}</p>}
                      </div>
                    )}
                  </s-section>
                </s-stack>
                <s-button
                  disabled={busy || !!advancedError || legacyPricing || hasPriceErrors || saveState !== 'dirty'}
                  onClick={() => void save()}
                >
                  Save draft
                </s-button>
                {saveState === 'ambiguous' && pending.current && (
                  <s-button disabled={busy} onClick={() => void save(true)}>
                    Retry saving
                  </s-button>
                )}
                {latest && (
                  <s-button
                    onClick={() => {
                      if (isDraft(latest.draft)) {
                        setDraft(latest.draft);
                        setPriceErrors({});
                        setPriceRevision((old) => old + 1);
                        setEditor(initialEditor(latest.draft));
                        setView({ ...view, config: latest });
                        setLatest(null);
                        setSaveState('clean');
                        pending.current = null;
                      }
                    }}
                  >
                    Review latest saved draft
                  </s-button>
                )}
                {(saveState === 'conflict' || saveState === 'ambiguous') && (
                  <s-button disabled={busy} onClick={() => void load()}>
                    Reload current draft
                  </s-button>
                )}
              </s-section>
              <s-section heading="Publish changes">
                {!view.config.publishEligibility.allowed && (
                  <p role="alert">
                    {view.config.publishEligibility.reason ?? 'Publication is not available for this configuration.'}
                  </p>
                )}
                <s-button
                  disabled={
                    busy ||
                    operatorPublication(view.config.publication.state) ||
                    (!publicationPending.current &&
                      !continuingPublication(view.config.publication.state) &&
                      (hasPriceErrors ||
                        !view.config.publishEligibility.allowed ||
                        !['clean', 'saved'].includes(saveState)))
                  }
                  onClick={() => void publish()}
                >
                  {publicationPending.current || continuingPublication(view.config.publication.state)
                    ? 'Continue publication'
                    : 'Publish saved changes'}
                </s-button>
              </s-section>
              <s-section heading="Copy to another product">
                <s-text-field
                  value={copyTarget}
                  onInput={(event) => setCopyTarget(event.currentTarget.value)}
                  label={'Shopify product ID'}
                  disabled={busy}
                />
                <s-button
                  disabled={busy || hasPriceErrors || !['clean', 'saved'].includes(saveState)}
                  onClick={() => void copy()}
                >
                  Copy configuration
                </s-button>
              </s-section>
            </>
          )}
        </>
      )}
    </s-page>
  );
}
