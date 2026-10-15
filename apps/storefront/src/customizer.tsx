import { useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import type { projectScene } from '../../../packages/visualizer/src/geometry';
import { createVisualizer, type Visualizer } from '../../../packages/visualizer/src/renderer';
import type { ArtworkPreview, ArtworkSelection } from '../../web/src/islands/artwork-upload';
import GuestArtworkUpload from '../../web/src/islands/GuestArtworkUpload';
import {
  type AcceptedCart,
  advisoryFingerprint,
  applyDefaultArtwork,
  type BuyerConfig,
  buildBuyerScene,
  cartJournal,
  createBuyerApi,
  createRequestLane,
  type DesiredGroup,
  formatMinor,
  type QuoteProposal,
  replaceGroup,
  sizeControlKind,
} from './buyer';
import { type CartSnapshot, createAjaxCartAdapter } from './cart';

type State = {
  config?: BuyerConfig;
  group?: DesiredGroup;
  viewId: string;
  placementId: string;
  variantId?: string;
  proposal?: QuoteProposal;
  accepted?: AcceptedCart;
  phase: 'loading' | 'editing' | 'review' | 'authorizing' | 'applying' | 'applied' | 'repair';
  error?: string;
};
type Action =
  | { kind: 'loaded'; config: BuyerConfig }
  | { kind: 'edit'; group: DesiredGroup }
  | { kind: 'view'; id: string }
  | { kind: 'placement'; id: string }
  | { kind: 'variant'; id: string }
  | { kind: 'proposal'; proposal: QuoteProposal }
  | { kind: 'phase'; phase: State['phase'] }
  | { kind: 'accepted'; accepted: AcceptedCart }
  | { kind: 'error'; message: string }
  | { kind: 'cleared'; warning?: string };
export function buyerReducer(state: State, action: Action): State {
  switch (action.kind) {
    case 'cleared':
      return {
        ...state,
        accepted: undefined,
        proposal: undefined,
        phase: action.warning ? 'repair' : 'applied',
        error: action.warning,
      };
    case 'loaded':
      return {
        ...state,
        proposal: undefined,
        accepted: undefined,
        error: undefined,
        config: action.config,
        group: {
          productId: action.config.productId,
          configRevisionId: action.config.revisionId,
          revisionContentHash: action.config.contentHash,
          design: {
            placements: [],
            options: action.config.options.map((option) => ({
              optionId: option.id,
              valueId: option.values[0]?.id ?? '',
            })),
          },
          variants: [],
        },
        viewId:
          action.config.geometry.views.find((view) =>
            [view.image, ...view.variantImages.map((v) => v.image)].some(
              (image) => image && action.config.imageUrls[image.revisionId],
            ),
          )?.id ??
          action.config.geometry.views[0]?.id ??
          '',
        placementId: action.config.placements[0]?.id ?? '',
        phase: 'editing',
      };
    case 'edit':
      return {
        ...state,
        group: action.group,
        proposal: undefined,
        accepted: undefined,
        phase: 'editing',
        error: undefined,
      };
    case 'view':
      return { ...state, viewId: action.id };
    case 'placement':
      return { ...state, placementId: action.id };
    case 'variant':
      return { ...state, variantId: action.id };
    case 'proposal':
      return { ...state, proposal: action.proposal, phase: 'review', error: undefined };
    case 'phase':
      return { ...state, phase: action.phase, error: undefined };
    case 'accepted':
      return { ...state, accepted: action.accepted, phase: 'applying' };
    case 'error':
      return { ...state, phase: 'repair', error: action.message };
  }
}
const css = `:host{font:16px system-ui;color:#17212b}button,select,input{font:inherit;padding:.6rem;border:1px solid #bbc1c6;border-radius:6px}button{cursor:pointer;background:white}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #146cce}dialog{max-width:1050px;width:calc(100% - 40px);max-height:90dvh;border:0;border-radius:12px;padding:24px}dialog::backdrop{background:#0008}.layout{display:grid;grid-template-columns:minmax(220px,1fr) minmax(240px,1fr);gap:24px}.preview{height:350px;background:#f3f4f5}.row{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}label{display:block;margin:10px 0}input[type=number]{width:75px;margin-left:12px}table{width:100%;border-collapse:collapse}td,th{padding:8px;text-align:left;border-bottom:1px solid #ddd}.error{color:#962020}.wizard{display:flex;gap:14px;padding:0;list-style:none;flex-wrap:wrap}.wizard [aria-current=step]{font-weight:bold;color:#146cce}.card{padding:15px;border:1px solid #ccd1d6;border-radius:8px;display:block}.badge{color:#795700;background:#fff4cd;padding:6px;border-radius:5px}.reassurance{background:#f1f4f8;padding:20px}.total{background:linear-gradient(120deg,#1E3A8A,#2563EB);color:white;padding:20px;border-radius:8px}.add-cart{background:#16803d;color:white;border:0}.back{border:0;text-decoration:underline}.or{text-align:center}input[type=range]{width:90%;touch-action:pan-y}button:disabled{opacity:.5;cursor:wait}@media(max-width:650px){.layout{grid-template-columns:1fr}dialog{padding:15px}.preview{height:230px}}`;
export function BuyerCustomizer({
  productId,
  proxyBase,
  cartRoot,
  country,
  marketId,
  repair = false,
  triggerLabel = 'Customize this product',
}: {
  productId: string;
  proxyBase: string;
  cartRoot: string;
  country: string;
  marketId: string;
  repair?: boolean;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, dispatch] = useReducer(buyerReducer, { viewId: '', placementId: '', phase: 'loading' });
  const [wizard, setWizard] = useState(0);
  const [defaultArtwork, setDefaultArtwork] = useState<DesiredGroup['design']['placements'][number]['artwork']>();
  const [defaultMethod, setDefaultMethod] = useState('');
  const [overridePlacements, setOverridePlacements] = useState<string[]>([]);
  const [invalidOverrides, setInvalidOverrides] = useState<string[]>([]);
  const [artworkPreviews, setArtworkPreviews] = useState<Record<string, ArtworkPreview>>({});
  const [asset, setAsset] = useState<ArtworkSelection | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const renderer = useRef<Visualizer>();
  const latestScene = useRef<ReturnType<typeof projectScene>>();
  const lane = useMemo(() => createRequestLane(), []);
  const api = useMemo(() => createBuyerApi({ proxyBase, productId, storage: sessionStorage }), [proxyBase, productId]);
  const cart = useMemo(
    () => createAjaxCartAdapter({ root: cartRoot, journal: cartJournal(localStorage, cartRoot) }),
    [cartRoot],
  );
  const retained = useRef<DesiredGroup[]>([]);
  const baseline = useRef<CartSnapshot>();
  const editingIndex = useRef<number>();
  const restoredQuoteId = useRef<string>();
  const deferred = useRef(crypto.randomUUID());
  const overrideAssets = useRef<Record<string, string>>({});
  const acceptKeys = useRef(new Map<string, string>());
  const renewalKeys = useRef(new Map<string, string>());
  useEffect(() => () => lane.cancel(), [lane]);
  useEffect(() => {
    if (!open) return;
    const heading = dialog.current?.querySelector<HTMLElement>('section:not([hidden]) h3');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
  }, [open, wizard]);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    if (!element) return;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    element.showModal();
    element.querySelector<HTMLButtonElement>('button')?.focus();
    const request = lane.next();
    void (async () => {
      const config = await api.config(request.signal);
      if (!config.ready) throw new Error('Customization is not available for this product.');
      const observed = await cart.read();
      const restore = observed.customized.length
        ? await api.private<{ groups: DesiredGroup[]; quoteId?: string; repairRequired: boolean }>(
            'cart-state',
            { lines: observed.customized },
            request.signal,
          )
        : { groups: [] };
      if (!lane.current(request.id)) return;
      baseline.current = observed;
      retained.current = restore.groups;
      restoredQuoteId.current = 'quoteId' in restore ? restore.quoteId : undefined;
      setWizard(0);
      setDefaultArtwork(undefined);
      setDefaultMethod(config.methods[0]?.id ?? '');
      setOverridePlacements([]);
      setInvalidOverrides([]);
      overrideAssets.current = {};
      dispatch({ kind: 'loaded', config });
    })().catch((error) => {
      if (lane.current(request.id)) dispatch({ kind: 'error', message: error.message });
    });
    return () => {
      lane.cancel();
      element.close();
      document.documentElement.style.overflow = previous;
      trigger.current?.focus();
    };
  }, [open, api, cart, lane]);
  const selected = state.group?.design.placements.find((p) => p.placementId === state.placementId);
  useEffect(() => {
    if (!open || !state.config || !canvas.current) return;
    let dead = false;
    void createVisualizer({
      element: canvas.current,
      onCommand: (command) => {
        if (command.kind === 'select-placement') dispatch({ kind: 'placement', id: command.placementId ?? '' });
      },
      onStatus: () => {},
    }).then((value) => {
      if (dead) value.destroy();
      else {
        renderer.current = value;
        value.setMode('preview');
        if (latestScene.current) value.update(latestScene.current);
      }
    });
    return () => {
      dead = true;
      renderer.current?.destroy();
      renderer.current = undefined;
    };
  }, [open, state.config, wizard, state.placementId, state.viewId]);
  useEffect(() => {
    if (!state.config) return;
    const scene = buildBuyerScene({
      geometry: state.config.geometry,
      viewId: state.viewId,
      variantId: state.variantId,
      selectedPlacementId: state.placementId,
      placements: state.group?.design.placements ?? [],
      previews: artworkPreviews,
      imageUrls: state.config.imageUrls,
    });
    latestScene.current = scene;
    renderer.current?.update(scene);
  }, [state.config, state.group, state.viewId, state.variantId, state.placementId, artworkPreviews, wizard]);
  function edit(group: DesiredGroup) {
    lane.cancel();
    dispatch({ kind: 'edit', group });
  }
  function placement(change: Partial<DesiredGroup['design']['placements'][number]>) {
    if (!state.group || !state.config) return;
    const policy = state.config.placements.find((p) => p.id === state.placementId);
    if (!policy || !selected) return;
    edit({
      ...state.group,
      design: {
        ...state.group.design,
        placements: state.group.design.placements.map((value) =>
          value.placementId === policy.id ? { ...value, ...change } : value,
        ),
      },
    });
  }
  function choosePlacement(id: string, checked: boolean) {
    if (!state.group || !state.config) return;
    if (!checked) {
      edit({
        ...state.group,
        design: {
          ...state.group.design,
          placements: state.group.design.placements.filter((p) => p.placementId !== id),
        },
      });
      return;
    }
    const policy = state.config.placements.find((p) => p.id === id);
    if (!policy || !defaultArtwork || (defaultArtwork.kind === 'deferred' && !policy.logoLaterAllowed)) return;
    const methodId = policy.allowedMethodIds.includes(defaultMethod) ? defaultMethod : policy.allowedMethodIds[0];
    if (!methodId || !policy.allowedStepIds[0]) return;
    edit({
      ...state.group,
      design: {
        ...state.group.design,
        placements: [
          ...state.group.design.placements,
          { placementId: id, methodId, stepId: policy.allowedStepIds[0], artwork: defaultArtwork },
        ],
      },
    });
    dispatch({ kind: 'placement', id });
  }
  function setDefaultChoice(choice: DesiredGroup['design']['placements'][number]['artwork']) {
    setDefaultArtwork(choice);
    if (state.group)
      edit(
        applyDefaultArtwork(
          {
            ...state.group,
            design: {
              ...state.group.design,
              placements: state.group.design.placements.filter(
                (p) =>
                  choice.kind !== 'deferred' ||
                  state.config?.placements.find((policy) => policy.id === p.placementId)?.logoLaterAllowed ||
                  overridePlacements.includes(p.placementId),
              ),
            },
          },
          choice,
          new Set(overridePlacements),
        ),
      );
  }
  function receivePreview(value: ArtworkPreview | null, assetId?: string) {
    setArtworkPreviews((old) => {
      const next = { ...old };
      if (value) next[value.assetId] = value;
      else if (assetId) delete next[assetId];
      return next;
    });
  }
  function loadExistingGroup(group: DesiredGroup) {
    const first = group.design.placements[0];
    setDefaultArtwork(first?.artwork);
    setDefaultMethod(first?.methodId ?? '');
    setInvalidOverrides([]);
    setOverridePlacements(
      group.design.placements
        .filter((p) => JSON.stringify(p.artwork) !== JSON.stringify(first?.artwork))
        .map((p) => p.placementId),
    );
    if (first) dispatch({ kind: 'placement', id: first.placementId });
    setWizard(4);
    edit(structuredClone(group));
  }
  function desired() {
    if (!state.group || !baseline.current) throw new Error('Customization not ready');
    return {
      country,
      marketId,
      groups: replaceGroup(retained.current, state.group, editingIndex.current),
      capacity: {
        ordinaryLineCount: baseline.current.ordinary.length,
        inputBytes: new TextEncoder().encode(JSON.stringify(baseline.current.items)).byteLength,
      },
    };
  }
  async function review(groupsOverride?: DesiredGroup[]) {
    const request = lane.next();
    try {
      const observed = await cart.read();
      if (editingIndex.current !== undefined && baseline.current?.fingerprint !== observed.fingerprint)
        throw new Error('Cart changed while editing. Reopen the customizer and select the current design.');
      baseline.current = observed;
      const restored = baseline.current.customized.length
        ? await api.private<{ groups: DesiredGroup[] }>(
            'cart-state',
            { lines: baseline.current.customized },
            request.signal,
          )
        : { groups: [] };
      if (!lane.current(request.id)) return;
      retained.current = restored.groups;
      const requestBody = desired();
      const requestedGroups = groupsOverride ?? requestBody.groups;
      const currentConfigs = new Map<string, BuyerConfig>();
      for (const group of requestedGroups) {
        if (!currentConfigs.has(group.productId))
          currentConfigs.set(group.productId, await api.config(request.signal, group.productId));
      }
      if (!lane.current(request.id)) return;
      // Repricing is an explicit new review, unlike renewal of the historical offer.
      // Preserve every choice and require compatibility with each product's current rules.
      const groups = requestedGroups.map((group) => {
        const config = currentConfigs.get(group.productId);
        const incompatible =
          !config?.ready ||
          group.design.placements.some((choice) => {
            const policy = config.placements.find((value) => value.id === choice.placementId);
            return (
              !policy ||
              !policy.allowedMethodIds.includes(choice.methodId) ||
              !config.methods.some((value) => value.id === choice.methodId) ||
              !policy.allowedStepIds.includes(choice.stepId) ||
              !config.steps.some((value) => value.id === choice.stepId) ||
              (choice.artwork.kind === 'deferred' && !policy.logoLaterAllowed)
            );
          }) ||
          group.design.options.length !== config.options.length ||
          group.design.options.some(
            (choice) =>
              !config.options.some(
                (option) => option.id === choice.optionId && option.values.some((value) => value.id === choice.valueId),
              ),
          ) ||
          group.variants.some(
            (choice) => !config.variants.some((value) => value.id === choice.variantId && value.available),
          );
        if (incompatible || !config)
          throw new Error(
            'Product configuration changed. Repair incompatible design choices before reviewing current prices.',
          );
        return { ...group, configRevisionId: config.revisionId, revisionContentHash: config.contentHash };
      });
      const proposal = await api.private<QuoteProposal>(
        'quote-proposals',
        {
          ...requestBody,
          groups,
          observedFingerprint: await advisoryFingerprint(baseline.current.fingerprint),
        },
        request.signal,
      );
      if (lane.current(request.id)) {
        setWizard(4);
        dispatch({ kind: 'proposal', proposal });
      }
    } catch (error) {
      if (lane.current(request.id))
        dispatch({ kind: 'error', message: error instanceof Error ? error.message : 'Review unavailable' });
    }
  }
  async function apply(accepted: AcceptedCart) {
    dispatch({ kind: 'accepted', accepted });
    const result = await cart.apply(accepted.buckets, { expectedFingerprint: baseline.current?.fingerprint ?? '' });
    if (result.status !== 'applied') {
      dispatch({
        kind: 'error',
        message:
          result.reason === 'mutation_unresolved'
            ? 'A cart update has an uncertain result. Check your cart before continuing; automatic retry is stopped.'
            : 'Your cart changed. Review the complete customized cart again.',
      });
      return;
    }
    baseline.current = result.cart ?? undefined;
    await api
      .private(`cart-applications/${accepted.applicationId}/confirm`, {
        fingerprint: await advisoryFingerprint(result.cart?.fingerprint ?? ''),
        vector: accepted.buckets,
      })
      .catch(() => {});
    window.dispatchEvent(new CustomEvent('insignia-cart-updated'));
    if (result.recovery)
      dispatch({
        kind: 'error',
        message:
          'The reviewed cart is applied, but an earlier update may still arrive. Check the cart before checkout.',
      });
    else dispatch({ kind: 'phase', phase: 'applied' });
  }
  async function removeCustomized() {
    dispatch({ kind: 'phase', phase: 'applying' });
    try {
      const observed = await cart.read();
      const result = await cart.apply([], { expectedFingerprint: observed.fingerprint, repair: true });
      if (result.status !== 'applied')
        throw new Error(
          result.reason === 'mutation_unresolved'
            ? 'Cart update is unresolved. Automatic retry is stopped.'
            : 'Cart changed. Check it before removing customized items.',
        );
      retained.current = [];
      baseline.current = result.cart ?? undefined;
      restoredQuoteId.current = undefined;
      window.dispatchEvent(new CustomEvent('insignia-cart-updated'));
      dispatch({
        kind: 'cleared',
        ...(result.recovery
          ? {
              warning:
                'Observed customized items were removed. An earlier update may still arrive; review your cart again before checking out.',
            }
          : {}),
      });
    } catch (error) {
      dispatch({ kind: 'error', message: error instanceof Error ? error.message : 'Cart removal unavailable' });
    }
  }
  async function accept() {
    if (!state.proposal) return;
    if (Date.parse(state.proposal.expiresAt) <= Date.now()) {
      dispatch({ kind: 'error', message: 'Price review expired. Review current prices again.' });
      return;
    }
    dispatch({ kind: 'phase', phase: 'authorizing' });
    try {
      const accepted = await api.private<AcceptedCart>(`quote-proposals/${state.proposal.proposalId}/accept`, {
        hash: state.proposal.hash,
        idempotencyKey:
          acceptKeys.current.get(state.proposal.proposalId) ??
          (() => {
            const key = crypto.randomUUID();
            acceptKeys.current.set(state.proposal.proposalId, key);
            return key;
          })(),
      });
      await apply(accepted);
    } catch (error) {
      dispatch({ kind: 'error', message: error instanceof Error ? error.message : 'Acceptance unavailable' });
    }
  }
  async function renew() {
    const quoteId = state.accepted?.quoteId ?? restoredQuoteId.current;
    if (!quoteId) return;
    dispatch({ kind: 'phase', phase: 'authorizing' });
    const renewalKey = renewalKeys.current.get(quoteId) ?? crypto.randomUUID();
    renewalKeys.current.set(quoteId, renewalKey);
    try {
      const observed = await cart.read();
      if (!baseline.current || baseline.current.fingerprint !== observed.fingerprint)
        throw new Error('Cart changed. Reopen customization and review the complete current cart before renewing.');
      const accepted = await api.private<AcceptedCart>(`quotes/${quoteId}/renew`, {
        ...desired(),
        groups: state.accepted?.desired ?? retained.current,
        idempotencyKey: renewalKey,
      });
      // An acknowledged issuance is complete even when subsequent cart repair fails.
      // Only an uncertain API outcome retains its command key for exact retry.
      renewalKeys.current.delete(quoteId);
      await apply(accepted);
    } catch (error) {
      dispatch({ kind: 'error', message: error instanceof Error ? error.message : 'Renewal needs a new price review' });
    }
  }
  const busy = state.phase === 'authorizing' || state.phase === 'applying';
  const config = state.config;
  const proposalCurrency = state.proposal?.currency ?? 'XXX';
  const proposalExponent = state.proposal?.exponent ?? 2;
  const selectedPolicies =
    config?.placements.filter((p) => state.group?.design.placements.some((value) => value.placementId === p.id)) ?? [];
  const allOneSize = selectedPolicies.length > 0 && selectedPolicies.every((p) => p.allowedStepIds.length <= 1);
  const availableViews =
    config?.geometry.views.filter((view) =>
      [view.image, ...view.variantImages.map((value) => value.image)].some(
        (image) => image && config.imageUrls[image.revisionId],
      ),
    ) ?? [];
  const hasPreview = availableViews.length > 0;
  const currentPolicy = config?.placements.find((p) => p.id === state.placementId);
  const activeSteps = config?.steps.filter((step) => currentPolicy?.allowedStepIds.includes(step.id)) ?? [];
  const previewAvailable =
    hasPreview &&
    !!config?.geometry.views
      .find((view) => view.id === state.viewId)
      ?.placements.some((p) => p.id === state.placementId);
  function next() {
    if (wizard === 1 && state.group?.design.placements[0])
      dispatch({ kind: 'placement', id: state.group.design.placements[0].placementId });
    setWizard(wizard === 2 && !hasPreview ? 4 : wizard + 1);
  }
  function back() {
    setWizard(wizard === 4 && !hasPreview ? 2 : wizard - 1);
  }
  return (
    <>
      <style>{css}</style>
      <button ref={trigger} type="button" onClick={() => setOpen(true)}>
        {repair ? 'Review customized cart' : triggerLabel}
      </button>
      {open && (
        <dialog
          ref={dialog}
          aria-label="Customize and review your cart"
          onCancel={(event) => {
            event.preventDefault();
            if (!busy) setOpen(false);
          }}
        >
          <button type="button" disabled={busy} onClick={() => setOpen(false)}>
            Close customization
          </button>
          <h2>Customize your product</h2>
          {retained.current.length > 0 && state.group && (
            <label>
              Edit retained design
              <select
                disabled={busy}
                value={editingIndex.current === undefined ? 'new' : String(editingIndex.current)}
                onChange={(event) => {
                  const index = Number(event.currentTarget.value);
                  if (event.currentTarget.value === 'new') {
                    editingIndex.current = undefined;
                    if (state.config) dispatch({ kind: 'loaded', config: state.config });
                  } else if (retained.current[index]?.productId === state.config?.productId) {
                    editingIndex.current = index;
                    loadExistingGroup(retained.current[index]);
                  } else {
                    const request = lane.next();
                    void api
                      .config(request.signal, retained.current[index].productId)
                      .then((config) => {
                        if (!lane.current(request.id)) return;
                        editingIndex.current = index;
                        dispatch({ kind: 'loaded', config });
                        loadExistingGroup(retained.current[index]);
                      })
                      .catch((error) => {
                        if (lane.current(request.id)) dispatch({ kind: 'error', message: error.message });
                      });
                  }
                }}
              >
                <option value="new">New design</option>
                {retained.current.map((_group, index) => (
                  <option value={String(index)}>Design {index + 1}</option>
                ))}
              </select>
            </label>
          )}
          {editingIndex.current !== undefined && retained.current.length > 1 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void review(retained.current.filter((_, index) => index !== editingIndex.current))}
            >
              Remove this design and review remaining cart
            </button>
          )}
          <p role="status" aria-live="polite">
            {state.phase === 'loading'
              ? 'Loading customization…'
              : state.phase === 'applied'
                ? 'Customized cart updated.'
                : (state.error ?? '')}
          </p>
          {state.error && (
            <p class="error" role="alert">
              {state.error}
            </p>
          )}
          {config && state.group && (
            <>
              <ol class="wizard" aria-label="Customization steps">
                {[
                  'Upload',
                  'Placement',
                  allOneSize ? 'Decoration' : 'Size',
                  ...(hasPreview ? ['Preview'] : []),
                  'Review',
                ].map((label, index) => (
                  <li aria-current={index === (wizard === 4 && !hasPreview ? 3 : wizard) ? 'step' : undefined}>
                    {label}
                  </li>
                ))}
              </ol>
              <fieldset disabled={busy}>
                <section hidden={wizard !== 0} aria-label="Upload artwork">
                  <h3>Upload your logo</h3>
                  <p>SVG, PNG or JPEG, up to 5 MiB. Files are inspected before use.</p>
                  <GuestArtworkUpload
                    proxyBase={proxyBase}
                    productId={config.productId}
                    injectedJsonApi={api.artwork}
                    onPreview={(value) => receivePreview(value, asset?.assetId)}
                    onAssetChange={(value) => {
                      setAsset(value);
                      if (value) setDefaultChoice({ kind: 'revision', revisionId: value.assetId });
                      else if (asset && defaultArtwork?.kind === 'revision') {
                        setDefaultArtwork(undefined);
                        if (state.group)
                          edit({
                            ...state.group,
                            design: {
                              ...state.group.design,
                              placements: state.group.design.placements.filter((p) =>
                                overridePlacements.includes(p.placementId),
                              ),
                            },
                          });
                      }
                    }}
                  />
                  {!asset && (
                    <>
                      <p class="or">or</p>
                      {config.placements.some((p) => p.logoLaterAllowed) && (
                        <button
                          type="button"
                          class="card"
                          aria-pressed={defaultArtwork?.kind === 'deferred'}
                          onClick={() => setDefaultChoice({ kind: 'deferred', intentId: deferred.current })}
                        >
                          Provide logo later
                        </button>
                      )}
                      <p>For placements that allow logo later, the merchant can attach artwork after purchase.</p>
                    </>
                  )}
                  <label>
                    Decoration method
                    <select value={defaultMethod} onChange={(event) => setDefaultMethod(event.currentTarget.value)}>
                      {config.methods.map((method) => (
                        <option value={method.id}>{method.label}</option>
                      ))}
                    </select>
                  </label>
                  <button type="button" disabled={!defaultArtwork} onClick={next}>
                    Continue to Placement
                  </button>
                </section>
                <section hidden={wizard !== 1} aria-label="Placement selection">
                  <h3>Choose decoration placements</h3>
                  <p class="badge">{config.methods.find((method) => method.id === defaultMethod)?.label}</p>
                  {config.placements.map((policy) => (
                    <label class="card">
                      <input
                        type="checkbox"
                        checked={state.group?.design.placements.some((value) => value.placementId === policy.id)}
                        disabled={defaultArtwork?.kind === 'deferred' && !policy.logoLaterAllowed}
                        onChange={(event) => choosePlacement(policy.id, event.currentTarget.checked)}
                      />
                      {policy.label}
                      {defaultArtwork?.kind === 'deferred' && !policy.logoLaterAllowed
                        ? ' — verified artwork required'
                        : ''}
                    </label>
                  ))}
                  <button type="button" disabled={!state.group.design.placements.length} onClick={next}>
                    Continue to {allOneSize ? 'Decoration' : 'Size'}
                  </button>
                </section>
                <section
                  hidden={wizard !== 2 && wizard !== 3}
                  aria-label={wizard === 3 ? 'Product preview' : 'Decoration sizing'}
                >
                  <h3>
                    {wizard === 3
                      ? 'Preview your selected placements'
                      : allOneSize
                        ? 'Review decoration settings'
                        : 'Choose size for each placement'}
                  </h3>
                  {state.group.design.placements.length > 1 && (
                    <fieldset class="row">
                      <legend>Selected placements</legend>
                      {state.group.design.placements.map((value) => (
                        <button
                          type="button"
                          aria-pressed={value.placementId === state.placementId}
                          onClick={() => dispatch({ kind: 'placement', id: value.placementId })}
                        >
                          {config.placements.find((p) => p.id === value.placementId)?.label} —{' '}
                          {value.stepId ? 'done' : 'pending'}
                        </button>
                      ))}
                    </fieldset>
                  )}
                  {hasPreview && (
                    <fieldset class="row">
                      <legend>Product views</legend>
                      {availableViews.map((view) => (
                        <button
                          type="button"
                          aria-pressed={view.id === state.viewId}
                          onClick={() => dispatch({ kind: 'view', id: view.id })}
                        >
                          {view.id}
                        </button>
                      ))}
                    </fieldset>
                  )}
                  {previewAvailable ? (
                    <div class="preview" ref={canvas} />
                  ) : (
                    <p class="reassurance">
                      Preview unavailable for this placement/view. Your size selections remain available.
                    </p>
                  )}
                  {selected?.artwork.kind === 'deferred' && <p class="badge">LOGO — Merchant attaches later</p>}
                  {wizard === 2 && selected && (
                    <>
                      <label>
                        Placement decoration method
                        <select
                          value={selected.methodId}
                          onChange={(event) => placement({ methodId: event.currentTarget.value })}
                        >
                          {config.methods
                            .filter((m) => currentPolicy?.allowedMethodIds.includes(m.id))
                            .map((m) => (
                              <option value={m.id}>{m.label}</option>
                            ))}
                        </select>
                      </label>
                      {sizeControlKind(activeSteps.length) === 'slider' ? (
                        <label>
                          Decoration size
                          <input
                            type="range"
                            min="0"
                            max={activeSteps.length - 1}
                            step="1"
                            value={Math.max(
                              0,
                              activeSteps.findIndex((step) => step.id === selected.stepId),
                            )}
                            aria-valuetext={activeSteps.find((step) => step.id === selected.stepId)?.label}
                            list="insignia-size-ticks"
                            onInput={(event) =>
                              placement({ stepId: activeSteps[Number(event.currentTarget.value)].id })
                            }
                          />
                          <datalist id="insignia-size-ticks">
                            {activeSteps.map((step, index) => (
                              <option value={index} label={step.label} />
                            ))}
                          </datalist>
                          <span>{activeSteps.find((step) => step.id === selected.stepId)?.label}</span>
                        </label>
                      ) : sizeControlKind(activeSteps.length) === 'cards' ? (
                        <fieldset>
                          <legend>Decoration size</legend>
                          {activeSteps.map((step) => (
                            <label class="card">
                              <input
                                type="radio"
                                name={`size-${state.placementId}`}
                                checked={selected.stepId === step.id}
                                onChange={() => placement({ stepId: step.id })}
                              />
                              {step.label}
                              {config.geometry.steps.find((s) => s.id === step.id)?.physicalMm && (
                                <span>
                                  {' '}
                                  — {config.geometry.steps.find((s) => s.id === step.id)?.physicalMm?.width} ×{' '}
                                  {config.geometry.steps.find((s) => s.id === step.id)?.physicalMm?.height} mm
                                </span>
                              )}
                            </label>
                          ))}
                        </fieldset>
                      ) : (
                        <p class="reassurance">This placement has one configured size. No size adjustment is needed.</p>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setOverridePlacements((ids) =>
                            ids.includes(state.placementId) ? ids : [...ids, state.placementId],
                          )
                        }
                      >
                        Change logo for this placement
                      </button>
                    </>
                  )}
                  <p>
                    Review each selected placement across the available views. Prices are confirmed in the complete cart
                    review.
                  </p>
                  <button type="button" onClick={next}>
                    Continue to {wizard === 2 && hasPreview ? 'Preview' : 'Review'}
                  </button>
                </section>
                {overridePlacements.map((id) => (
                  <section
                    hidden={wizard !== 2 || state.placementId !== id}
                    aria-label={`Artwork override ${config.placements.find((p) => p.id === id)?.label}`}
                  >
                    <h4>Logo for {config.placements.find((p) => p.id === id)?.label}</h4>
                    <GuestArtworkUpload
                      proxyBase={proxyBase}
                      productId={config.productId}
                      injectedJsonApi={api.artwork}
                      onPreview={(value) => receivePreview(value, overrideAssets.current[id])}
                      onAssetChange={(value) => {
                        if (!state.group) return;
                        const current = state.group.design.placements.find((p) => p.placementId === id);
                        if (!current) return;
                        if (value) {
                          overrideAssets.current[id] = value.assetId;
                          setInvalidOverrides((ids) => ids.filter((value) => value !== id));
                        } else if (overrideAssets.current[id]) {
                          delete overrideAssets.current[id];
                          setInvalidOverrides((ids) => (ids.includes(id) ? ids : [...ids, id]));
                          edit({ ...state.group });
                        }
                        if (value)
                          edit({
                            ...state.group,
                            design: {
                              ...state.group.design,
                              placements: state.group.design.placements.map((p) =>
                                p.placementId === id
                                  ? { ...p, artwork: { kind: 'revision', revisionId: value.assetId } }
                                  : p,
                              ),
                            },
                          });
                      }}
                    />
                    {config.placements.find((p) => p.id === id)?.logoLaterAllowed && (
                      <button
                        type="button"
                        onClick={() => {
                          setInvalidOverrides((ids) => ids.filter((value) => value !== id));
                          placement({ artwork: { kind: 'deferred', intentId: crypto.randomUUID() } });
                        }}
                      >
                        Logo later for this placement
                      </button>
                    )}
                  </section>
                ))}
                <section hidden={wizard !== 4} aria-label="Garment quantity review">
                  {invalidOverrides.length > 0 && (
                    <p role="alert">
                      Finish uploading a verified logo for each changed placement before reviewing prices.
                    </p>
                  )}
                  <h3>Review your design and garment quantities</h3>
                  <ul>
                    {state.group.design.placements.map((p) => (
                      <li>
                        {config.placements.find((policy) => policy.id === p.placementId)?.label} —{' '}
                        {config.methods.find((m) => m.id === p.methodId)?.label} —{' '}
                        {config.steps.find((step) => step.id === p.stepId)?.label}
                        {p.artwork.kind === 'deferred' ? (
                          <span class="badge"> Merchant attaches later</span>
                        ) : (
                          <span> Verified artwork</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {config.options.map((option) => (
                    <label>
                      {option.label}
                      <select
                        value={state.group?.design.options.find((v) => v.optionId === option.id)?.valueId ?? ''}
                        onChange={(event) => {
                          if (state.group)
                            edit({
                              ...state.group,
                              design: {
                                ...state.group.design,
                                options: state.group.design.options.map((value) =>
                                  value.optionId === option.id
                                    ? { ...value, valueId: event.currentTarget.value }
                                    : value,
                                ),
                              },
                            });
                        }}
                      >
                        {option.values.map((value) => (
                          <option value={value.id}>{value.label}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <fieldset>
                    <legend>Garment quantities</legend>
                    {config.variants.map((variant) => (
                      <label>
                        {variant.label}
                        <input
                          type="number"
                          min="0"
                          max="10000"
                          step="1"
                          disabled={!variant.available}
                          value={state.group?.variants.find((v) => v.variantId === variant.id)?.quantity ?? 0}
                          onFocus={() => dispatch({ kind: 'variant', id: variant.id })}
                          onInput={(event) => {
                            const quantity = Number(event.currentTarget.value);
                            if (state.group && Number.isSafeInteger(quantity) && quantity >= 0 && quantity <= 10000)
                              edit({
                                ...state.group,
                                variants: [
                                  ...state.group.variants.filter((v) => v.variantId !== variant.id),
                                  ...(quantity ? [{ variantId: variant.id, quantity }] : []),
                                ],
                              });
                          }}
                        />
                        {!variant.available ? ' Sold out' : ''}
                      </label>
                    ))}
                  </fieldset>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      invalidOverrides.some((id) => state.group?.design.placements.some((p) => p.placementId === id)) ||
                      !state.group.variants.length ||
                      !state.group.design.placements.length
                    }
                    onClick={() => void review()}
                  >
                    Review complete customized cart
                  </button>
                </section>
                {wizard > 0 && (
                  <button class="back" type="button" onClick={back}>
                    ← Back
                  </button>
                )}
              </fieldset>
            </>
          )}
          {state.proposal && (
            <section aria-label="Customized cart price review">
              <h3>Complete customized cart review</h3>
              <p>{state.proposal.customizedQuantity} customized garments, including retained designs.</p>
              <table>
                <thead>
                  <tr>
                    <th>Design</th>
                    <th>Quantity</th>
                    <th>Setup once</th>
                    <th>Garment base total</th>
                    <th>Customization per garment</th>
                    <th>Group total</th>
                  </tr>
                </thead>
                <tbody>
                  {state.proposal.groups.map((group, index) => (
                    <tr>
                      <td>Design {index + 1}</td>
                      <td>{group.quantity}</td>
                      <td>{formatMinor(group.setupMinor, proposalCurrency, proposalExponent)}</td>
                      <td>{formatMinor(group.baseTotalMinor, proposalCurrency, proposalExponent)}</td>
                      <td>{formatMinor(group.customizationUnitMinor, proposalCurrency, proposalExponent)}</td>
                      <td>{formatMinor(group.totalMinor, proposalCurrency, proposalExponent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p class="total">
                Total:{' '}
                <strong>
                  {formatMinor(state.proposal.totalMinor, state.proposal.currency, state.proposal.exponent)}
                </strong>
              </p>
              {state.proposal.changedGroups.length > 0 && (
                <p>Updated prices affect {state.proposal.changedGroups.length} design groups.</p>
              )}
              <p>Review expires {new Date(state.proposal.expiresAt).toLocaleTimeString()}.</p>
              <button
                class="add-cart"
                type="button"
                disabled={busy || state.phase === 'applied'}
                onClick={() => void accept()}
              >
                Add to Cart — {formatMinor(state.proposal.totalMinor, state.proposal.currency, state.proposal.exponent)}
              </button>
            </section>
          )}
          <button type="button" disabled={busy} onClick={() => void removeCustomized()}>
            Remove all customized items from cart
          </button>
          {(state.accepted || restoredQuoteId.current) && (
            <button type="button" disabled={busy} onClick={() => void renew()}>
              Renew accepted cart offer
            </button>
          )}
          {state.phase === 'applied' && <a href={`${cartRoot}cart`}>Go to cart</a>}
        </dialog>
      )}
    </>
  );
}
