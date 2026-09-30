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
} from '@insignia/visualizer/geometry';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { CatalogProduct, ConfigView } from '../shared/admin-view.js';

type Props = { mode: 'picker' | 'config'; productId?: string };
type List = { products: CatalogProduct[]; nextCursor: string | null };
type SaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'ambiguous';
type PendingRequest = { method: 'POST' | 'PUT'; body: object; key: string; installationGeneration?: string };
const numberOf = (id: string) => /^gid:\/\/shopify\/(?:Product|ProductVariant)\/([1-9][0-9]*)$/.exec(id)?.[1];
const endpoint = (id: string) => `/api/admin/products/${encodeURIComponent(id)}/config`;
const freshId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
const defaultRect = () => ({ centerX: 0.5, centerY: 0.5, width: 0.3, height: 0.3 });
const publicationStorageKey = (productId: string) => `insignia:m5:publish:${productId}`;
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
let tokenRequest: Promise<string> | null = null;
async function browserDeadline<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Admin request timed out'));
    }, 10_000);
  });
  try {
    return await Promise.race([task(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function sessionToken(): Promise<string> {
  const bridge = (window as unknown as { shopify?: { idToken?: () => Promise<string> } }).shopify;
  const tokenGetter = bridge?.idToken?.bind(bridge);
  if (!tokenGetter) return Promise.reject(new Error('Open this page from Shopify Admin to verify your session.'));
  if (!tokenRequest)
    tokenRequest = browserDeadline(() => tokenGetter()).finally(() => {
      tokenRequest = null;
    });
  return tokenRequest;
}

async function jsonResponse<T>(response: Response): Promise<T> {
  let body: T & { error?: string; message?: string };
  try {
    body = (await response.json()) as T & { error?: string; message?: string };
  } catch {
    if (response.ok) throw new Error('Invalid successful Admin response');
    throw Object.assign(new Error(`Request failed (${response.status})`), { status: response.status });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    if (response.ok) throw new Error('Invalid successful Admin response');
    throw Object.assign(new Error(`Request failed (${response.status})`), { status: response.status });
  }
  if (!response.ok)
    throw Object.assign(new Error(body.message ?? body.error ?? `Request failed (${response.status})`), {
      status: response.status,
    });
  return body;
}
async function authenticatedJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  return browserDeadline(async (signal) => {
    const send = async () =>
      fetch(path, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init.headers).entries()),
          Authorization: 'Bearer ' + (await sessionToken()),
        },
        cache: 'no-store',
        redirect: 'error',
        signal,
      });
    let response = await send();
    if (response.status === 401) response = await send();
    return jsonResponse<T>(response);
  });
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
function currencyAmount() {
  return { shopDecimal: '0', presentmentOverrides: [] as { currency: string; decimal: string }[] };
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
type PricingScope = PricingRule['scope'];
function coherentRule(rule: PricingRule, role: PricingRule['role'], scope: PricingScope): PricingRule {
  const { methodUnitMultiplicity: previousMultiplicity, ...base } = rule;
  const methodUnitMultiplicity =
    role === 'unit' && scope.kind === 'method' ? (previousMultiplicity ?? 'perGarment') : undefined;
  const rate =
    role === 'setup' && rule.rate.kind === 'allUnits'
      ? { kind: 'fixed' as const, amount: rule.rate.tiers[0]?.amount ?? currencyAmount() }
      : rule.rate;
  return { ...base, role, scope, rate, ...(methodUnitMultiplicity ? { methodUnitMultiplicity } : {}) };
}
function withAmount(
  rule: PricingRule,
  index: number,
  edit: (amount: ReturnType<typeof currencyAmount>) => ReturnType<typeof currencyAmount>,
): PricingRule {
  if (rule.rate.kind === 'fixed') return { ...rule, rate: { ...rule.rate, amount: edit(rule.rate.amount) } };
  return {
    ...rule,
    rate: {
      ...rule.rate,
      tiers: rule.rate.tiers.map((tier, tierIndex) =>
        tierIndex === index ? { ...tier, amount: edit(tier.amount) } : tier,
      ),
    },
  };
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
function PublicationStatus({ config }: { config: NonNullable<ConfigView['config']> }) {
  const publication = config.publication;
  const labels: Record<typeof publication.state, string> = {
    DRAFT: 'Draft only',
    PUBLISH_REQUESTED: 'Publication requested',
    REMOTE_PENDING: 'Shopify publication pending',
    REMOTE_READY_ACTIVATION_PENDING: 'Remote ready; activation pending',
    ACTIVE: 'Active',
    CONFLICT: 'Publication conflict',
    OPERATOR_HOLD: 'Operator hold',
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
  const [previewStatus, setPreviewStatus] = useState('');
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const pending = useRef<PendingRequest | null>(null);
  const publicationPending = useRef<PendingRequest | null>(null);
  const requestId = useRef(0);
  const busyRef = useRef(false);
  const saveStateRef = useRef(saveState);
  const visualizerRef = useRef<Visualizer | null>(null);
  const projectRef = useRef(project);
  busyRef.current = busy;
  saveStateRef.current = saveState;
  editorRef.current = editor;
  projectRef.current = project;

  function syncPublication(data: ConfigView) {
    if (!productId) return;
    const terminal = ['REMOTE_READY_ACTIVATION_PENDING', 'ACTIVE', 'CONFLICT', 'OPERATOR_HOLD'];
    if (data.config && !terminal.includes(data.config.publication.state)) {
      const stored = readPublicationRequest(productId);
      const body = stored?.body as { action?: string; configId?: string; draftVersion?: string } | undefined;
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

  async function load(cursor: string | null = null, search = query) {
    const seq = ++requestId.current;
    visualizerRef.current?.destroy();
    visualizerRef.current = null;
    setView(null);
    setList(null);
    setDraft(null);
    setEditor(null);
    setStatus('Verifying Shopify Admin session…');
    try {
      if (mode === 'picker') {
        const params = new URLSearchParams({ q: search });
        if (cursor) params.set('cursor', cursor);
        const data = await authenticatedJson<List>(`/api/admin/products?${params}`);
        if (seq === requestId.current) {
          setList(data);
          setStatus('');
        }
      } else {
        if (!productId || !/^[1-9][0-9]*$/.test(productId)) throw new Error('Invalid product link');
        const data = await authenticatedJson<ConfigView>(endpoint(productId));
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
    }
  }
  useEffect(() => {
    const launchUrl = new URL(window.location.href);
    if (launchUrl.searchParams.has('id_token')) {
      launchUrl.searchParams.delete('id_token');
      window.history.replaceState(window.history.state, '', launchUrl.pathname + launchUrl.search + launchUrl.hash);
    }
    void load(null, '');
    const clear = () => {
      requestId.current++;
      visualizerRef.current?.destroy();
      visualizerRef.current = null;
      setView(null);
      setDraft(null);
      setEditor(null);
    };
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
      | { kind: 'select-placement'; placementId?: string }
      | { kind: 'select-step'; stepId?: string }
      | { kind: 'select-view'; viewId: string }
      | { kind: 'select-variant'; variantId?: string }
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
    setBusy(true);
    try {
      await send({ method: 'POST', body: { action: 'create' }, key: crypto.randomUUID() });
      await load();
    } catch (error) {
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
    pending.current = request;
    setSaveState('saving');
    setBusy(true);
    try {
      const response = await send(request);
      if (
        response.kind !== 'saved' ||
        typeof response.draftVersion !== 'string' ||
        !/^[1-9][0-9]*$/.test(response.draftVersion) ||
        BigInt(response.draftVersion) !== BigInt(view.config.draftVersion) + 1n
      )
        throw new Error('Invalid successful save response');
      const saved = (request.body as { draft: MerchantDraft }).draft;
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
      } catch {
        setStatus('Draft saved. Publication eligibility could not be verified. Reload before publishing.');
      }
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (status && status >= 400 && status < 500 && status !== 409) {
        pending.current = null;
        setSaveState('dirty');
        setStatus(error instanceof Error ? error.message : 'Save denied');
        return;
      }
      const body = request.body as { draftVersion: string; draft: MerchantDraft };
      const result = await authenticatedJson<ConfigView>(endpoint(productId)).catch(() => null);
      if (
        result?.config &&
        result.config.draftVersion !== body.draftVersion &&
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
    if (!productId || !view?.config) throw new Error('Publication context unavailable');
    const data = await authenticatedJson<ConfigView>(endpoint(productId));
    const config = data.config;
    if (
      data.product.id !== view.product.id ||
      !config ||
      config.configId !== view.config.configId ||
      config.installationGeneration !== view.config.installationGeneration
    )
      throw new Error('Publication context changed. Reload before continuing.');
    syncPublication(data);
    const sameSavedDraft =
      config.draftVersion === view.config.draftVersion &&
      canonical(config.draft) === canonical(JSON.parse(JSON.stringify(view.config.draft)));
    setView({
      ...view,
      config: {
        ...view.config,
        publication: config.publication,
        currentShopCurrency: config.currentShopCurrency,
        publishEligibility: sameSavedDraft
          ? config.publishEligibility
          : { allowed: false, reason: 'The saved draft changed. Reload before requesting a new publication.' },
      },
    });
    // Continuation refreshes durable progress only: local geometry, edits, CAS base,
    // conflict/latest view and the exact uncertain save request remain owned by save/load.
  }
  async function publish() {
    if (!productId || !view?.config) return;
    const open = ['PUBLISH_REQUESTED', 'REMOTE_PENDING'].includes(view.config.publication.state);
    if (!open && !publicationPending.current && !['clean', 'saved'].includes(saveState)) return;
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
    publicationPending.current = request;
    writePublicationRequest(productId, request);
    setBusy(true);
    try {
      let phase = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await send(request);
        phase = String(result.state ?? '');
        if (!['PUBLISH_REQUESTED', 'REMOTE_PENDING'].includes(phase)) break;
      }
      await refreshPublication();
      if (['PUBLISH_REQUESTED', 'REMOTE_PENDING'].includes(phase))
        setStatus('Publication is pending. Continue the same request when ready.');
      else setStatus('Publication state refreshed.');
    } catch (error) {
      await refreshPublication().catch(() => {});
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
    const target = copyTarget.trim();
    if (!/^[1-9][0-9]*$/.test(target)) {
      setStatus('Enter a Shopify product number.');
      return;
    }
    setBusy(true);
    try {
      await send({
        method: 'POST',
        body: { action: 'copy', targetProductId: `gid://shopify/Product/${target}` },
        key: crypto.randomUUID(),
      });
      window.location.assign(`/admin/products/${target}/config`);
    } catch (error) {
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
    <s-page heading={mode === 'picker' ? 'Choose a product' : 'Product configuration'}>
      <nav aria-label="Admin navigation">
        <a href="/admin/products">Products</a>
      </nav>
      {status && <p role="status">{status}</p>}
      {mode === 'picker' && (
        <s-section heading="Shopify products">
          <label>
            Search products{' '}
            <input type="search" value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
          </label>
          <s-button onClick={() => void load(null, query)}>Search</s-button>
          {list?.products.map((product) => (
            <article key={product.id}>
              {product.imageUrl && <img src={product.imageUrl} width="72" height="72" alt="" />}
              <h2>{product.title}</h2>
              <p>
                {product.status} · {product.id}
              </p>
              <p>
                {product.variants
                  .slice(0, 5)
                  .map((variant) => variant.title)
                  .join(', ')}
              </p>
              {numberOf(product.id) && <a href={`/admin/products/${numberOf(product.id)}/config`}>Configure product</a>}
            </article>
          ))}
          {list && list.products.length === 0 && <p>No products found.</p>}
          {list?.nextCursor && <s-button onClick={() => void load(list.nextCursor, query)}>Next page</s-button>}
        </s-section>
      )}
      {mode === 'config' && view && (
        <>
          <s-section heading={view.product.title}>
            <p>
              {view.product.status} · {view.product.id}
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
              <s-section heading="Draft editor">
                <p>
                  Draft version {view.config.draftVersion} · {saveState}
                </p>
                <fieldset disabled={busy}>
                  <label>
                    Customization mode{' '}
                    <select
                      value={draft.mode}
                      onChange={(event) =>
                        change({ ...draft, mode: event.currentTarget.value as MerchantDraft['mode'] })
                      }
                    >
                      <option value="optional">Optional</option>
                      <option value="required">Required for all purchases</option>
                    </select>
                  </label>
                  <p>Draft shop currency: {draft.shopCurrency}</p>
                  {view.config.currentShopCurrency && view.config.currentShopCurrency !== draft.shopCurrency && (
                    <div role="alert">
                      <p>
                        Current shop currency: {view.config.currentShopCurrency}. Existing amounts are not converted.
                        Review every price before saving or publishing.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          const currency = view.config?.currentShopCurrency;
                          if (currency) change({ ...draft, shopCurrency: currency });
                        }}
                      >
                        Use current shop currency
                      </button>
                    </div>
                  )}
                  <h3>Decoration methods</h3>
                  {draft.methods.map((method) => (
                    <p key={method.id}>
                      <code>{method.id}</code>{' '}
                      <label>
                        Method name{' '}
                        <input
                          maxLength={80}
                          value={labelFor('methods', method.id)}
                          onInput={(event) => setLabel('methods', method.id, event.currentTarget.value)}
                        />
                      </label>{' '}
                      <button
                        type="button"
                        onClick={() =>
                          change({
                            ...draft,
                            methods: draft.methods.filter((item) => item.id !== method.id),
                            labels: removeChoiceLabels(draft.labels, 'methods', method.id),
                          })
                        }
                      >
                        Remove
                      </button>
                    </p>
                  ))}
                  <button
                    type="button"
                    onClick={() => change({ ...draft, methods: [...draft.methods, { id: freshId('method') }] })}
                  >
                    Add method
                  </button>
                  <h3>Product view and variant</h3>
                  <label>
                    View{' '}
                    <select
                      value={editor.viewId}
                      onChange={(event) => choose({ kind: 'select-view', viewId: event.currentTarget.value })}
                    >
                      {geometry.views.map((item) => (
                        <option key={item.id} value={item.id}>
                          {labelFor('views', item.id) || item.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    View name{' '}
                    <input
                      maxLength={80}
                      value={labelFor('views', editor.viewId)}
                      onInput={(event) => setLabel('views', editor.viewId, event.currentTarget.value)}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      updateGeometry((value) => ({
                        ...value,
                        views: [...value.views, { id: freshId('view'), variantImages: [], placements: [] }],
                      }))
                    }
                  >
                    Add view
                  </button>
                  <label>
                    Product variant{' '}
                    <select
                      value={editor.variantId ?? ''}
                      onChange={(event) =>
                        choose({ kind: 'select-variant', variantId: event.currentTarget.value || undefined })
                      }
                    >
                      <option value="">Featured image</option>
                      {view.product.variants.map((item) => (
                        <option key={item.id} value={'variant_' + numberOf(item.id)}>
                          {item.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  {view.product.variantsTruncated && (
                    <p role="alert">
                      This product has more than 500 variants. Only the first 500 are available here; review the full
                      catalog before saving variant-specific geometry.
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={!selectedImage || !imageSize}
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
                  >
                    Use selected product image
                  </button>
                  <h3>Placements</h3>
                  <label>
                    Placement{' '}
                    <select
                      value={editor.selectedPlacementId ?? ''}
                      onChange={(event) =>
                        choose({ kind: 'select-placement', placementId: event.currentTarget.value || undefined })
                      }
                    >
                      <option value="">None</option>
                      {selectedView?.placements.map((item) => (
                        <option key={item.id} value={item.id}>
                          {labelFor('placements', item.id) || item.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
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
                  >
                    Add placement to view
                  </button>
                  {selectedPlacement && selectedRect && (
                    <div>
                      <p>
                        <code>{selectedPlacement.id}</code>
                      </p>
                      <label>
                        Placement name{' '}
                        <input
                          maxLength={80}
                          value={labelFor('placements', selectedPlacement.id)}
                          onInput={(event) => setLabel('placements', selectedPlacement.id, event.currentTarget.value)}
                        />
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedPlacement.logoLaterAllowed}
                          onChange={(event) =>
                            setPlacement(selectedPlacement.id, (item) => ({
                              ...item,
                              logoLaterAllowed: event.currentTarget.checked,
                            }))
                          }
                        />{' '}
                        Allow logo later
                      </label>
                      <p>Allowed methods</p>
                      {draft.methods.map((item) => (
                        <label key={item.id}>
                          <input
                            type="checkbox"
                            checked={selectedPlacement.allowedMethodIds.includes(item.id)}
                            onChange={(event) =>
                              setPlacement(selectedPlacement.id, (placement) => ({
                                ...placement,
                                allowedMethodIds: event.currentTarget.checked
                                  ? [...placement.allowedMethodIds, item.id]
                                  : placement.allowedMethodIds.filter((id) => id !== item.id),
                              }))
                            }
                          />
                          {item.id}
                        </label>
                      ))}
                      <p>Allowed size steps</p>
                      {geometry.steps.map((item) => (
                        <label key={item.id}>
                          <input
                            type="checkbox"
                            checked={selectedPlacement.allowedStepIds.includes(item.id)}
                            onChange={(event) =>
                              setPlacement(selectedPlacement.id, (placement) => ({
                                ...placement,
                                allowedStepIds: event.currentTarget.checked
                                  ? [...placement.allowedStepIds, item.id]
                                  : placement.allowedStepIds.filter((id) => id !== item.id),
                              }))
                            }
                          />
                          {item.id}
                        </label>
                      ))}
                      {(['centerX', 'centerY', 'width', 'height'] as const).map((field) => (
                        <label key={field}>
                          {field}{' '}
                          <input
                            type="number"
                            min="0.01"
                            max="1"
                            step="0.01"
                            value={selectedRect[field]}
                            onChange={(event) => {
                              const value = Number(event.currentTarget.value);
                              if (Number.isFinite(value))
                                choose({
                                  kind: 'set-placement-rect',
                                  viewId: editor.viewId,
                                  variantId: editor.variantId,
                                  placementId: selectedPlacement.id,
                                  rect: { ...selectedRect, [field]: value },
                                });
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  )}
                  <h3>Size steps</h3>
                  <label>
                    Selected step{' '}
                    <select
                      value={editor.selectedStepId ?? ''}
                      onChange={(event) =>
                        choose({ kind: 'select-step', stepId: event.currentTarget.value || undefined })
                      }
                    >
                      <option value="">None</option>
                      {geometry.steps.map((item) => (
                        <option key={item.id} value={item.id}>
                          {labelFor('steps', item.id) || item.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedStep && (
                    <label>
                      Size step name{' '}
                      <input
                        maxLength={80}
                        value={labelFor('steps', selectedStep.id)}
                        onInput={(event) => setLabel('steps', selectedStep.id, event.currentTarget.value)}
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      updateGeometry((value) => ({
                        ...value,
                        steps: [...value.steps, { id: freshId('step'), widthFraction: 0.5, heightFraction: 0.5 }],
                      }))
                    }
                  >
                    Add size step
                  </button>
                  {selectedStep &&
                    (['widthFraction', 'heightFraction'] as const).map((field) => (
                      <label key={field}>
                        {field}{' '}
                        <input
                          type="number"
                          min="0.01"
                          max="1"
                          step="0.01"
                          value={selectedStep[field]}
                          onChange={(event) => {
                            const value = Number(event.currentTarget.value);
                            updateGeometry((current) => ({
                              ...current,
                              steps: current.steps.map((item) =>
                                item.id === selectedStep.id ? { ...item, [field]: value } : item,
                              ),
                            }));
                          }}
                        />
                      </label>
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
                  <h3>Production options</h3>
                  {draft.productionOptions.map((item) => (
                    <p key={item.id}>
                      <code>{item.id}</code>{' '}
                      <label>
                        Option name{' '}
                        <input
                          maxLength={80}
                          value={labelFor('options', item.id)}
                          onInput={(event) => setLabel('options', item.id, event.currentTarget.value)}
                        />
                      </label>{' '}
                      {item.allowedValueIds.map((id) => (
                        <label key={id}>
                          Value {id} name
                          <input
                            maxLength={80}
                            value={valueLabel(item.id, id)}
                            onInput={(event) => setValueLabel(item.id, id, event.currentTarget.value)}
                          />
                        </label>
                      ))}{' '}
                      <button
                        type="button"
                        onClick={() =>
                          change({
                            ...draft,
                            productionOptions: draft.productionOptions.filter((option) => option.id !== item.id),
                            labels: removeChoiceLabels(draft.labels, 'options', item.id),
                          })
                        }
                      >
                        Remove
                      </button>
                      <button
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
                      >
                        Add value
                      </button>
                    </p>
                  ))}
                  <button
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
                  >
                    Add production option
                  </button>
                  <h3>Pricing</h3>
                  {draft.pricingRules.map((rule) => {
                    const currentScope = rule.scope;
                    const update = (edit: (item: PricingRule) => PricingRule) =>
                      change({
                        ...draft,
                        pricingRules: draft.pricingRules.map((item) => (item.id === rule.id ? edit(item) : item)),
                      });
                    const scopeValue = JSON.stringify(
                      currentScope.kind === 'placement' || currentScope.kind === 'step'
                        ? (({ methodId: _methodId, ...scope }) => scope)(currentScope)
                        : currentScope,
                    );
                    const selectedPlacement =
                      currentScope.kind === 'placement' || currentScope.kind === 'step'
                        ? draft.placements.find((item) => item.id === currentScope.placementId)
                        : undefined;
                    const amounts =
                      rule.rate.kind === 'fixed'
                        ? [{ amount: rule.rate.amount, index: 0 }]
                        : rule.rate.tiers.map((tier, index) => ({ amount: tier.amount, index }));
                    return (
                      <div key={rule.id}>
                        <code>{rule.id}</code>
                        <label>
                          Price name{' '}
                          <input
                            maxLength={80}
                            value={labelFor('prices', rule.id)}
                            onInput={(event) => setLabel('prices', rule.id, event.currentTarget.value)}
                          />
                        </label>
                        <label>
                          Role{' '}
                          <select
                            value={rule.role}
                            onChange={(event) => {
                              const role = event.currentTarget.value as 'setup' | 'unit';
                              const firstMethod = draft.methods[0];
                              if (role === 'unit' && rule.scope.kind === 'general' && !firstMethod) return;
                              const scope =
                                role === 'unit' && rule.scope.kind === 'general' && firstMethod
                                  ? { kind: 'method' as const, methodId: firstMethod.id }
                                  : rule.scope;
                              update((item) => coherentRule(item, role, scope));
                            }}
                          >
                            <option value="setup">Setup once per design</option>
                            <option value="unit" disabled={rule.scope.kind === 'general' && !draft.methods.length}>
                              Unit
                            </option>
                          </select>
                        </label>
                        <label>
                          Scope{' '}
                          <select
                            value={scopeValue}
                            onChange={(event) => {
                              const scope = JSON.parse(event.currentTarget.value) as PricingScope;
                              update((item) =>
                                coherentRule(item, scope.kind === 'general' ? 'setup' : item.role, scope),
                              );
                            }}
                          >
                            <option value={JSON.stringify({ kind: 'general' })}>General setup</option>
                            {draft.methods.map((item) => (
                              <option key={item.id} value={JSON.stringify({ kind: 'method', methodId: item.id })}>
                                Method {item.id}
                              </option>
                            ))}
                            {draft.placements.map((item) => (
                              <option key={item.id} value={JSON.stringify({ kind: 'placement', placementId: item.id })}>
                                Placement {item.id}
                              </option>
                            ))}
                            {draft.placements.flatMap((placement) =>
                              placement.allowedStepIds.map((step) => (
                                <option
                                  key={JSON.stringify([placement.id, step])}
                                  value={JSON.stringify({ kind: 'step', placementId: placement.id, stepId: step })}
                                >
                                  Step {placement.id}/{step}
                                </option>
                              )),
                            )}
                          </select>
                        </label>
                        {selectedPlacement && (
                          <label>
                            Specific method{' '}
                            <select
                              value={
                                rule.scope.kind === 'placement' || rule.scope.kind === 'step'
                                  ? (rule.scope.methodId ?? '')
                                  : ''
                              }
                              onChange={(event) =>
                                update((item) => {
                                  if (item.scope.kind !== 'placement' && item.scope.kind !== 'step') return item;
                                  const { methodId: _removed, ...scope } = item.scope;
                                  return {
                                    ...item,
                                    scope: event.currentTarget.value
                                      ? { ...scope, methodId: event.currentTarget.value }
                                      : scope,
                                  };
                                })
                              }
                            >
                              <option value="">Any allowed method</option>
                              {selectedPlacement.allowedMethodIds.map((id) => (
                                <option key={id} value={id}>
                                  {id}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <label>
                          Rate{' '}
                          <select
                            value={rule.rate.kind}
                            onChange={(event) =>
                              update((item) => {
                                const amount =
                                  item.rate.kind === 'fixed' ? item.rate.amount : item.rate.tiers[0]!.amount;
                                return {
                                  ...item,
                                  rate:
                                    event.currentTarget.value === 'allUnits'
                                      ? { kind: 'allUnits', tiers: [{ minQuantity: 1, amount }] }
                                      : { kind: 'fixed', amount },
                                };
                              })
                            }
                          >
                            <option value="fixed">Fixed amount</option>
                            {rule.role === 'unit' && <option value="allUnits">All-units quantity tiers</option>}
                          </select>
                        </label>
                        {rule.rate.kind === 'allUnits' && (
                          <button
                            type="button"
                            onClick={() =>
                              update((item) =>
                                item.rate.kind === 'allUnits'
                                  ? {
                                      ...item,
                                      rate: {
                                        ...item.rate,
                                        tiers: [
                                          ...item.rate.tiers,
                                          {
                                            minQuantity: item.rate.tiers.at(-1)!.minQuantity + 1,
                                            amount: currencyAmount(),
                                          },
                                        ],
                                      },
                                    }
                                  : item,
                              )
                            }
                          >
                            Add quantity tier
                          </button>
                        )}
                        {amounts.map(({ amount, index }) => (
                          <div key={index}>
                            {rule.rate.kind === 'allUnits' && (
                              <label>
                                Minimum quantity{' '}
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={rule.rate.tiers[index]!.minQuantity}
                                  disabled={index === 0}
                                  onChange={(event) =>
                                    update((item) =>
                                      item.rate.kind === 'allUnits'
                                        ? {
                                            ...item,
                                            rate: {
                                              ...item.rate,
                                              tiers: item.rate.tiers.map((tier, tierIndex) =>
                                                tierIndex === index
                                                  ? { ...tier, minQuantity: Number(event.currentTarget.value) }
                                                  : tier,
                                              ),
                                            },
                                          }
                                        : item,
                                    )
                                  }
                                />
                              </label>
                            )}
                            <label>
                              Shop amount ({draft.shopCurrency}){' '}
                              <input
                                value={amount.shopDecimal}
                                onInput={(event) =>
                                  update((item) =>
                                    withAmount(item, index, (current) => ({
                                      ...current,
                                      shopDecimal: event.currentTarget.value,
                                    })),
                                  )
                                }
                              />
                            </label>
                            {amount.presentmentOverrides.map((override, overrideIndex) => (
                              <span key={`${override.currency}:${overrideIndex}`}>
                                <label>
                                  Presentment currency{' '}
                                  <input
                                    value={override.currency}
                                    maxLength={3}
                                    onInput={(event) =>
                                      update((item) =>
                                        withAmount(item, index, (current) => ({
                                          ...current,
                                          presentmentOverrides: current.presentmentOverrides.map((entry, entryIndex) =>
                                            entryIndex === overrideIndex
                                              ? { ...entry, currency: event.currentTarget.value.toUpperCase() }
                                              : entry,
                                          ),
                                        })),
                                      )
                                    }
                                  />
                                </label>
                                <label>
                                  Presentment amount{' '}
                                  <input
                                    value={override.decimal}
                                    onInput={(event) =>
                                      update((item) =>
                                        withAmount(item, index, (current) => ({
                                          ...current,
                                          presentmentOverrides: current.presentmentOverrides.map((entry, entryIndex) =>
                                            entryIndex === overrideIndex
                                              ? { ...entry, decimal: event.currentTarget.value }
                                              : entry,
                                          ),
                                        })),
                                      )
                                    }
                                  />
                                </label>
                                <button
                                  type="button"
                                  onClick={() =>
                                    update((item) =>
                                      withAmount(item, index, (current) => ({
                                        ...current,
                                        presentmentOverrides: current.presentmentOverrides.filter(
                                          (_, entryIndex) => entryIndex !== overrideIndex,
                                        ),
                                      })),
                                    )
                                  }
                                >
                                  Remove presentment
                                </button>
                              </span>
                            ))}
                            <button
                              type="button"
                              onClick={() =>
                                update((item) =>
                                  withAmount(item, index, (current) => ({
                                    ...current,
                                    presentmentOverrides: [
                                      ...current.presentmentOverrides,
                                      { currency: draft.shopCurrency === 'EUR' ? 'USD' : 'EUR', decimal: '0' },
                                    ],
                                  })),
                                )
                              }
                            >
                              Add presentment override
                            </button>
                            {rule.rate.kind === 'allUnits' && index > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  update((item) =>
                                    item.rate.kind === 'allUnits'
                                      ? {
                                          ...item,
                                          rate: {
                                            ...item.rate,
                                            tiers: item.rate.tiers.filter((_, tierIndex) => tierIndex !== index),
                                          },
                                        }
                                      : item,
                                  )
                                }
                              >
                                Remove tier
                              </button>
                            )}
                          </div>
                        ))}
                        {rule.role === 'unit' && rule.scope.kind === 'method' && (
                          <label>
                            Unit count{' '}
                            <select
                              value={rule.methodUnitMultiplicity ?? 'perGarment'}
                              onChange={(event) =>
                                update((item) => ({
                                  ...item,
                                  methodUnitMultiplicity: event.currentTarget.value as 'perGarment' | 'perPlacement',
                                }))
                              }
                            >
                              <option value="perGarment">Per garment</option>
                              <option value="perPlacement">Per decorated placement</option>
                            </select>
                          </label>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            change({
                              ...draft,
                              pricingRules: draft.pricingRules.filter((item) => item.id !== rule.id),
                              labels: removeChoiceLabels(draft.labels, 'prices', rule.id),
                            })
                          }
                        >
                          Remove price
                        </button>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() =>
                      change({
                        ...draft,
                        pricingRules: [
                          ...draft.pricingRules,
                          {
                            id: freshId('price'),
                            role: 'setup',
                            scope: { kind: 'general' },
                            rate: { kind: 'fixed', amount: currencyAmount() },
                          },
                        ],
                      })
                    }
                  >
                    Add fixed price
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdvanced(!advanced);
                      setAdvancedText(JSON.stringify(draft, null, 2));
                      setAdvancedError('');
                    }}
                  >
                    Advanced JSON draft
                  </button>
                  {advanced && (
                    <div>
                      <label>
                        Advanced JSON{' '}
                        <textarea
                          rows={16}
                          value={advancedText}
                          onInput={(event) => setAdvancedText(event.currentTarget.value)}
                        />
                      </label>
                      <button
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
                      >
                        Apply JSON
                      </button>
                      {advancedError && <p role="alert">{advancedError}</p>}
                    </div>
                  )}
                </fieldset>
                <s-button disabled={busy || !!advancedError || saveState !== 'dirty'} onClick={() => void save()}>
                  Save draft
                </s-button>
                {saveState === 'ambiguous' && pending.current && (
                  <s-button disabled={busy} onClick={() => void save(true)}>
                    Retry exact save
                  </s-button>
                )}
                {latest && (
                  <s-button
                    onClick={() => {
                      if (isDraft(latest.draft)) {
                        setDraft(latest.draft);
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
                  <s-button onClick={() => void load()}>Reload current draft</s-button>
                )}
              </s-section>
              <s-section heading="Publication request">
                {!view.config.publishEligibility.allowed && (
                  <p role="alert">
                    {view.config.publishEligibility.reason ?? 'Publication is not available for this configuration.'}
                  </p>
                )}
                <s-button
                  disabled={
                    busy ||
                    (!publicationPending.current &&
                      !['PUBLISH_REQUESTED', 'REMOTE_PENDING'].includes(view.config.publication.state) &&
                      (!view.config.publishEligibility.allowed || !['clean', 'saved'].includes(saveState)))
                  }
                  onClick={() => void publish()}
                >
                  {publicationPending.current ||
                  ['PUBLISH_REQUESTED', 'REMOTE_PENDING'].includes(view.config.publication.state)
                    ? 'Continue publication'
                    : 'Request publication'}
                </s-button>
              </s-section>
              <s-section heading="Copy to another product">
                <label>
                  Target Shopify product number{' '}
                  <input value={copyTarget} onInput={(event) => setCopyTarget(event.currentTarget.value)} />
                </label>
                <s-button disabled={busy || !['clean', 'saved'].includes(saveState)} onClick={() => void copy()}>
                  Copy independent draft
                </s-button>
              </s-section>
            </>
          )}
        </>
      )}
    </s-page>
  );
}
