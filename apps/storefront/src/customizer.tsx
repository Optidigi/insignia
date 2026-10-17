import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
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
import { customizerCss as css } from './customizer-style';

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
function StepIcon({ kind }: { kind: string }) {
  const paths: Record<string, string> = {
    Upload: 'M7 17H5a4 4 0 0 1-1-8 8 8 0 0 1 15-1 5 5 0 0 1 0 10h-2M12 21V10m-4 4 4-4 4 4',
    Placement: 'M12 22s8-7 8-13a8 8 0 1 0-16 0c0 6 8 13 8 13Zm0-10a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
    Size: 'M4 8 8 4l12 12-4 4Zm3-1 3 3m0-6 3 3m0 3 3 3',
    Preview: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
    Review: 'M6 5H4v17h16V5h-2M8 2h8v6H8Zm0 12 3 3 5-6',
    Close: 'm6 6 12 12M6 18 18 6',
    Complete: 'm4 12 5 5L20 5',
  };
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
    >
      <path d={paths[kind] ?? paths.Preview} />
    </svg>
  );
}
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
  const [confirmClose, setConfirmClose] = useState(false);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const [previewSheet, setPreviewSheet] = useState(false);
  const [zoomed, setZoomed] = useState(true);
  const previewClose = useRef<HTMLButtonElement>(null);
  const previewTrigger = useRef<HTMLButtonElement>(null);
  const swipeStart = useRef<{ x: number; y: number }>();
  const sheetDrag = useRef<number>();
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
      selectedPlacementId: wizard === 0 ? undefined : state.placementId,
      placements: state.group?.design.placements ?? [],
      previews: artworkPreviews,
      imageUrls: state.config.imageUrls,
    });
    const display = { ...scene, placements: [] };
    latestScene.current = display;
    renderer.current?.update(display);
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
    setWizard(3);
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
        setWizard(3);
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
  function requestClose() {
    if (state.phase === 'authorizing' || state.phase === 'applying') return;
    if (previewSheet) {
      setPreviewSheet(false);
      return;
    }
    if (confirmClose) {
      setConfirmClose(false);
      return;
    }
    if (
      state.phase !== 'applied' &&
      (defaultArtwork || state.group?.design.placements.length || state.group?.variants.length)
    )
      setConfirmClose(true);
    else setOpen(false);
  }
  useLayoutEffect(() => {
    if (confirmClose) keepEditing.current?.focus();
    else if (open) dialog.current?.querySelector<HTMLButtonElement>('.close-customizer')?.focus();
  }, [confirmClose]);
  useLayoutEffect(() => {
    if (previewSheet) previewClose.current?.focus();
    else if (open) previewTrigger.current?.focus();
  }, [previewSheet]);
  function quantity(variantId: string, value: number) {
    if (!state.group || !Number.isSafeInteger(value) || value < 0 || value > 10000) return;
    dispatch({ kind: 'variant', id: variantId });
    edit({
      ...state.group,
      variants: [
        ...state.group.variants.filter((variant) => variant.variantId !== variantId),
        ...(value ? [{ variantId, quantity: value }] : []),
      ],
    });
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
  const previewView = config?.geometry.views.find((view) => view.id === state.viewId);
  const previewPlacement = previewView?.placements.find((value) => value.id === state.placementId);
  const zoomRect =
    previewPlacement?.variantOverrides?.find(
      (value) => value.variantId.replace('gid://shopify/ProductVariant/', '') === state.variantId,
    )?.rect ?? previewPlacement?.rect;
  const zoomImage =
    previewView?.variantImages.find(
      (value) => value.variantId.replace('gid://shopify/ProductVariant/', '') === state.variantId,
    )?.image ?? previewView?.image;
  const imageAspect = zoomImage ? zoomImage.width / zoomImage.height : 1;
  const imageWidth = Math.min(1, imageAspect),
    imageHeight = Math.min(1, 1 / imageAspect);
  const zoomScale = zoomRect ? Math.max(1, Math.min(4, 0.2 / (zoomRect.width * imageWidth))) : 1;
  const previewTransform =
    zoomed && wizard > 0 && zoomRect && zoomImage && zoomScale > 1.001
      ? `translate(${(0.5 - (0.5 + (zoomRect.centerX - 0.5) * imageWidth) * zoomScale) * 100}%, ${(0.5 - (0.5 + (zoomRect.centerY - 0.5) * imageHeight) * zoomScale) * 100}%) scale(${zoomScale})`
      : undefined;
  function changeView(direction: number) {
    const index = availableViews.findIndex((view) => view.id === state.viewId);
    if (availableViews.length > 1)
      dispatch({
        kind: 'view',
        id: availableViews[(index + direction + availableViews.length) % availableViews.length].id,
      });
  }
  function next() {
    if (wizard === 1 && state.group?.design.placements[0])
      dispatch({ kind: 'placement', id: state.group.design.placements[0].placementId });
    setWizard(wizard === 2 ? 3 : wizard + 1);
  }
  function back() {
    setWizard(wizard === 3 ? 2 : wizard - 1);
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
            requestClose();
          }}
        >
          <header class="modal-header" inert={confirmClose || previewSheet}>
            <h2>Customize your product</h2>
            {config && state.group && (
              <ol class="wizard" aria-label="Customization steps">
                {['Upload', 'Placement', allOneSize ? 'Preview' : 'Size', 'Review'].map((label, index) => (
                  <li data-completed={index < wizard} aria-current={index === wizard ? 'step' : undefined}>
                    <StepIcon kind={index < wizard ? 'Complete' : label} />
                    <span>{label}</span>
                  </li>
                ))}
              </ol>
            )}
            <button
              class="close-customizer"
              type="button"
              aria-label="Close customization"
              disabled={busy}
              onClick={requestClose}
            >
              <StepIcon kind="Close" />
            </button>
          </header>
          <div class="modal-layout" inert={confirmClose}>
            {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: the same preview has dialog role only while its modal sheet is open. */}
            <aside
              class="preview-panel"
              role={previewSheet ? 'dialog' : 'complementary'}
              aria-label="Product preview"
              aria-modal={previewSheet ? 'true' : undefined}
              data-sheet-open={previewSheet}
              data-mobile-visible={wizard === 1 || wizard === 2}
              onKeyDown={(event) => {
                if (!previewSheet || event.key !== 'Tab') return;
                const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
                const first = buttons[0],
                  last = buttons[buttons.length - 1];
                const active = (event.currentTarget.getRootNode() as ShadowRoot).activeElement;
                if (event.shiftKey && active === first) {
                  event.preventDefault();
                  last?.focus();
                } else if (!event.shiftKey && active === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }}
            >
              {previewSheet && (
                <div class="sheet-header">
                  <button
                    class="sheet-handle"
                    type="button"
                    aria-label="Drag down to close preview"
                    onClick={() => setPreviewSheet(false)}
                    onPointerDown={(event) => {
                      sheetDrag.current = event.clientY;
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerUp={(event) => {
                      if (sheetDrag.current !== undefined && event.clientY - sheetDrag.current > 80)
                        setPreviewSheet(false);
                      sheetDrag.current = undefined;
                    }}
                    onPointerCancel={() => {
                      sheetDrag.current = undefined;
                    }}
                  />
                  <h3>Product preview</h3>
                  <button ref={previewClose} type="button" onClick={() => setPreviewSheet(false)}>
                    Close preview
                  </button>
                </div>
              )}
              {hasPreview ? (
                <div
                  class="preview"
                  onTouchStart={(event) => {
                    const point = event.touches[0];
                    if (point) swipeStart.current = { x: point.clientX, y: point.clientY };
                  }}
                  onTouchEnd={(event) => {
                    const first = swipeStart.current,
                      last = event.changedTouches[0];
                    swipeStart.current = undefined;
                    if (
                      first &&
                      last &&
                      Math.abs(last.clientX - first.x) > 50 &&
                      Math.abs(last.clientX - first.x) > Math.abs(last.clientY - first.y) * 2
                    )
                      changeView(last.clientX < first.x ? 1 : -1);
                  }}
                >
                  <div class="preview-canvas" style={{ transform: previewTransform }} ref={canvas} />
                </div>
              ) : (
                <p class="reassurance">Your decoration choices will be shown here when product images are available.</p>
              )}
              {hasPreview && (availableViews.length > 1 || (zoomScale > 1.001 && wizard > 0)) && (
                <fieldset class="row view-controls">
                  <legend>Product views</legend>
                  {availableViews.length > 1 && (
                    <button type="button" aria-label="Previous product view" onClick={() => changeView(-1)}>
                      ‹
                    </button>
                  )}
                  {availableViews.length > 1 &&
                    availableViews.map((view) => (
                      <button
                        type="button"
                        aria-pressed={view.id === state.viewId}
                        onClick={() => dispatch({ kind: 'view', id: view.id })}
                      >
                        {view.id}
                      </button>
                    ))}
                  {availableViews.length > 1 && (
                    <button type="button" aria-label="Next product view" onClick={() => changeView(1)}>
                      ›
                    </button>
                  )}
                  {zoomRect && zoomScale > 1.001 && wizard > 0 && (
                    <button type="button" aria-pressed={zoomed} onClick={() => setZoomed(!zoomed)}>
                      {zoomed ? 'Show full garment' : 'Focus selected placement'}
                    </button>
                  )}
                </fieldset>
              )}
            </aside>
            <main class="customization-content" inert={previewSheet}>
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
                <fieldset disabled={busy}>
                  <section hidden={wizard !== 0 || !!state.proposal} aria-label="Upload artwork">
                    <h3>Upload your logo</h3>
                    <p>SVG, PNG or JPEG, up to 5 MiB. Files are inspected before use.</p>
                    <fieldset
                      class="artwork-upload"
                      onDragOver={(event) => {
                        if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const file = event.dataTransfer?.files[0];
                        const input = event.currentTarget.querySelector<HTMLInputElement>('input[type=file]');
                        if (busy || !file || !input || input.matches(':disabled')) return;
                        const transfer = new DataTransfer();
                        transfer.items.add(file);
                        input.files = transfer.files;
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                      }}
                    >
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
                    </fieldset>
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
                            <span class="later-icon" aria-hidden="true">
                              ?
                            </span>
                            Provide logo later
                            <span class="later-chevron" aria-hidden="true">
                              ›
                            </span>
                          </button>
                        )}
                        <p>For placements that allow logo later, the merchant can attach artwork after purchase.</p>
                      </>
                    )}
                    <fieldset class="method-choices">
                      <legend>Decoration method</legend>
                      {config.methods.map((method) => (
                        <label class="card method-card">
                          <input
                            type="radio"
                            name="default-method"
                            value={method.id}
                            checked={defaultMethod === method.id}
                            onChange={() => setDefaultMethod(method.id)}
                          />
                          <span>{method.label}</span>
                        </label>
                      ))}
                    </fieldset>
                  </section>
                  <section hidden={wizard !== 1 || !!state.proposal} aria-label="Placement selection">
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
                  </section>
                  <section hidden={wizard !== 2 || !!state.proposal} aria-label="Decoration sizing">
                    <h3>{allOneSize ? 'Review decoration settings' : 'Choose size for each placement'}</h3>
                    {state.group.design.placements.length > 1 && (
                      <fieldset class="row placement-tabs">
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
                    {!previewAvailable && (
                      <p class="reassurance">
                        Preview unavailable for this placement/view. Your size selections remain available.
                      </p>
                    )}
                    {wizard === 2 && selected && (
                      <>
                        <h4 class="placement-title">{currentPolicy?.label}</h4>
                        {config.methods.filter((method) => currentPolicy?.allowedMethodIds.includes(method.id)).length >
                        1 ? (
                          <label class="control-card method-setting">
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
                        ) : (
                          <p class="method-setting-single">
                            {config.methods.find((method) => method.id === selected.methodId)?.label}
                          </p>
                        )}

                        {sizeControlKind(activeSteps.length) === 'slider' ? (
                          <label class="control-card size-setting">
                            <span class="size-label">
                              Decoration size
                              <strong>{activeSteps.find((step) => step.id === selected.stepId)?.label}</strong>
                            </span>
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
                            <span class="range-labels" aria-hidden="true">
                              {activeSteps.map((step) => (
                                <span data-selected={step.id === selected.stepId}>{step.label}</span>
                              ))}
                            </span>
                          </label>
                        ) : sizeControlKind(activeSteps.length) === 'cards' ? (
                          <fieldset class="size-cards">
                            <legend>Decoration size</legend>
                            {activeSteps.map((step) => (
                              <label class="card size-card">
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
                          <p class="reassurance">
                            This placement has one configured size. No size adjustment is needed.
                          </p>
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
                    <p>Exact prices are confirmed in cart review.</p>
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
                  <section hidden={wizard !== 3 || !!state.proposal} aria-label="Garment quantity review">
                    {invalidOverrides.length > 0 && (
                      <p role="alert">
                        Finish uploading a verified logo for each changed placement before reviewing prices.
                      </p>
                    )}
                    <h3>Review your design and garment quantities</h3>
                    <section class="design-summary" aria-label="Design summary">
                      <div class="summary-artwork">
                        <span class="artwork-mark" aria-hidden="true">
                          {state.group.design.placements.some((value) => value.artwork.kind === 'deferred') ? '?' : '✓'}
                        </span>
                        <div>
                          <strong>Artwork</strong>
                          <span>
                            {state.group.design.placements.some((value) => value.artwork.kind === 'deferred')
                              ? 'Merchant attaches artwork after purchase'
                              : 'Verified original selected'}
                          </span>
                        </div>
                      </div>
                      <div class="summary-row">
                        <span>Garment selection</span>
                        <strong>
                          {state.group.variants.length
                            ? state.group.variants
                                .map(
                                  (value) => config.variants.find((variant) => variant.id === value.variantId)?.label,
                                )
                                .join(', ')
                            : 'Choose quantities below'}
                        </strong>
                      </div>
                      <div class="summary-row">
                        <span>
                          <StepIcon kind="Placement" />
                          {[
                            ...new Set(
                              state.group.design.placements.map(
                                (value) => config.methods.find((method) => method.id === value.methodId)?.label,
                              ),
                            ),
                          ].join(', ')}
                        </span>
                        <span>Decoration method</span>
                      </div>
                      <div class="summary-section">
                        <strong>Customizations</strong>
                        <span>
                          {state.group.design.placements.length} placement
                          {state.group.design.placements.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      {state.group.design.placements.map((value) => (
                        <div class="summary-row">
                          <span>
                            <StepIcon kind="Placement" />
                            {config.placements.find((policy) => policy.id === value.placementId)?.label} ·{' '}
                            {config.steps.find((step) => step.id === value.stepId)?.label}
                          </span>
                          <span>{value.artwork.kind === 'deferred' ? 'Logo later' : 'Verified artwork'}</span>
                        </div>
                      ))}
                      <div class="summary-row summary-final">
                        <strong>Per-garment price</strong>
                        <span>Confirmed at price review</span>
                      </div>
                    </section>
                    {state.group.design.placements.some((value) => value.artwork.kind === 'deferred') && (
                      <p class="artwork-note">
                        <strong>Logo later</strong>Arrange artwork with the merchant. The merchant attaches it after
                        purchase.
                      </p>
                    )}
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
                    <fieldset class="quantity-grid">
                      <legend>Garment quantities</legend>
                      {config.variants.map((variant) => (
                        <div
                          class="quantity-card"
                          data-selected={
                            (state.group?.variants.find((value) => value.variantId === variant.id)?.quantity ?? 0) > 0
                          }
                        >
                          <label for={`quantity-${variant.id}`}>
                            {variant.label}
                            {!variant.available ? ' — Sold out' : ''}
                          </label>
                          <div class="quantity-stepper">
                            <button
                              type="button"
                              aria-label={`Decrease ${variant.label} quantity`}
                              disabled={
                                !variant.available ||
                                !state.group?.variants.find((v) => v.variantId === variant.id)?.quantity
                              }
                              onClick={() =>
                                quantity(
                                  variant.id,
                                  (state.group?.variants.find((v) => v.variantId === variant.id)?.quantity ?? 0) - 1,
                                )
                              }
                            >
                              −
                            </button>
                            <input
                              id={`quantity-${variant.id}`}
                              type="number"
                              min="0"
                              max="10000"
                              step="1"
                              disabled={!variant.available}
                              value={state.group?.variants.find((v) => v.variantId === variant.id)?.quantity ?? 0}
                              onFocus={() => dispatch({ kind: 'variant', id: variant.id })}
                              onInput={(event) => quantity(variant.id, Number(event.currentTarget.value))}
                            />
                            <button
                              type="button"
                              aria-label={`Increase ${variant.label} quantity`}
                              disabled={
                                !variant.available ||
                                (state.group?.variants.find((v) => v.variantId === variant.id)?.quantity ?? 0) >= 10000
                              }
                              onClick={() =>
                                quantity(
                                  variant.id,
                                  (state.group?.variants.find((v) => v.variantId === variant.id)?.quantity ?? 0) + 1,
                                )
                              }
                            >
                              +
                            </button>
                          </div>
                        </div>
                      ))}
                    </fieldset>
                  </section>
                  <footer class="step-footer" role="contentinfo" aria-label="Customization navigation">
                    {wizard > 0 && (
                      <button
                        class="back"
                        type="button"
                        onClick={() => {
                          if (state.proposal && state.group) edit({ ...state.group });
                          else back();
                        }}
                      >
                        ← Back
                      </button>
                    )}
                    {wizard === 3 && hasPreview && (
                      <button
                        class="preview-trigger"
                        aria-label="Preview your design"
                        ref={previewTrigger}
                        type="button"
                        onClick={() => setPreviewSheet(true)}
                      >
                        <StepIcon kind="Preview" />
                      </button>
                    )}
                    {wizard < 3 && !state.proposal && (
                      <button
                        class="next-step"
                        type="button"
                        disabled={
                          (wizard === 0 && !defaultArtwork) || (wizard === 1 && !state.group.design.placements.length)
                        }
                        onClick={next}
                      >
                        Continue to{' '}
                        {wizard === 0 ? 'Placement' : wizard === 1 ? (allOneSize ? 'Preview' : 'Size') : 'Review'}
                      </button>
                    )}
                    {wizard === 3 && !state.proposal && (
                      <button
                        class="next-step"
                        type="button"
                        disabled={
                          busy ||
                          invalidOverrides.some((id) =>
                            state.group?.design.placements.some((p) => p.placementId === id),
                          ) ||
                          !state.group.variants.length ||
                          !state.group.design.placements.length
                        }
                        onClick={() => void review()}
                      >
                        Review complete customized cart
                      </button>
                    )}
                    {state.proposal && (
                      <button
                        class="add-cart"
                        type="button"
                        disabled={busy || state.phase === 'applied'}
                        onClick={() => void accept()}
                      >
                        Add to Cart —{' '}
                        {formatMinor(state.proposal.totalMinor, state.proposal.currency, state.proposal.exponent)}
                      </button>
                    )}
                  </footer>
                </fieldset>
              )}
              {state.proposal && (
                <section aria-label="Customized cart price review">
                  <h3>Complete customized cart review</h3>
                  <p>{state.proposal.customizedQuantity} customized garments, including retained designs.</p>
                  <div class="price-summaries">
                    {state.proposal.groups.map((group, index) => (
                      <section class="design-summary" aria-label={`Design ${index + 1} prices`}>
                        <div class="summary-section">
                          <strong>Design {index + 1}</strong>
                          <span>
                            {group.quantity} garment{group.quantity === 1 ? '' : 's'}
                          </span>
                        </div>
                        <dl>
                          <div class="summary-row">
                            <dt>Garment base total</dt>
                            <dd>{formatMinor(group.baseTotalMinor, proposalCurrency, proposalExponent)}</dd>
                          </div>
                          <div class="summary-row">
                            <dt>Decoration per garment</dt>
                            <dd>{formatMinor(group.customizationUnitMinor, proposalCurrency, proposalExponent)}</dd>
                          </div>
                          <div class="summary-row summary-final">
                            <dt>Design total</dt>
                            <dd>{formatMinor(group.totalMinor, proposalCurrency, proposalExponent)}</dd>
                          </div>
                        </dl>
                      </section>
                    ))}
                  </div>
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
                </section>
              )}
              {(state.phase === 'repair' || retained.current.length > 0 || state.accepted) && (
                <button type="button" disabled={busy} onClick={() => void removeCustomized()}>
                  Remove all customized items from cart
                </button>
              )}
              {(state.accepted || restoredQuoteId.current) && (
                <button type="button" disabled={busy} onClick={() => void renew()}>
                  Renew accepted cart offer
                </button>
              )}
              {state.phase === 'applied' && <a href={`${cartRoot}cart`}>Go to cart</a>}
            </main>
          </div>
          {previewSheet && (
            <button
              class="preview-backdrop"
              type="button"
              aria-label="Dismiss product preview"
              onClick={() => setPreviewSheet(false)}
            />
          )}
          {confirmClose && (
            <div class="confirm-backdrop">
              <section
                class="confirm-close"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="discard-title"
                aria-describedby="discard-detail"
                onKeyDown={(event) => {
                  if (event.key === 'Tab') {
                    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button');
                    const first = buttons[0];
                    const last = buttons[buttons.length - 1];
                    const active =
                      event.currentTarget.getRootNode() instanceof ShadowRoot
                        ? (event.currentTarget.getRootNode() as ShadowRoot).activeElement
                        : document.activeElement;
                    if (event.shiftKey && active === first) {
                      event.preventDefault();
                      last.focus();
                    } else if (!event.shiftKey && active === last) {
                      event.preventDefault();
                      first.focus();
                    }
                  }
                }}
              >
                <h3 id="discard-title">Discard customization?</h3>
                <p id="discard-detail">
                  Your current design selections will be discarded. Items already in your cart will stay there.
                </p>
                <div class="row">
                  <button ref={keepEditing} type="button" onClick={() => setConfirmClose(false)}>
                    Keep editing
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmClose(false);
                      setOpen(false);
                    }}
                  >
                    Discard design
                  </button>
                </div>
              </section>
            </div>
          )}
        </dialog>
      )}
    </>
  );
}
