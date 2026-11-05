import { createCustomerTranslator } from '@insignia/ui-localization/customer';
import type { DesignerQuoteReview } from '../../../../frontend/designer/src/quote-review';
import type { CartReceipt, CartRequest, DesignerPorts } from '../../../../frontend/designer/src/runtime';
import { createArtworkUpload } from '../../../web/src/islands/artwork-upload';
import {
  type AcceptedCart,
  advisoryFingerprint,
  type BuyerConfig,
  cartJournal,
  createBuyerApi,
  type DesiredGroup,
  type QuoteProposal,
  replaceGroup,
} from '../buyer';
import { type CartSnapshot, createAjaxCartAdapter } from '../cart';
import { createSelectedDesignCustody } from './design-custody';
import { desiredGroupKey } from './group-key';
import { buildBuyerDesigner } from './published';

type Prepared = {
  signature: string;
  proposal: QuoteProposal;
  groups: DesiredGroup[];
  baseline: CartSnapshot;
  group: DesiredGroup;
};
const signature = (request: CartRequest) =>
  JSON.stringify([request.design, request.artworks.map((artwork) => artwork.id)]);
export function createLiveDesignerPorts(input: {
  source: BuyerConfig;
  productId: string;
  proxyBase: string;
  cartRoot: string;
  country: string;
  marketId: string;
  locale: string;
  storeName: string;
  fetchImpl?: typeof fetch;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  onPriceRefresh?(source: BuyerConfig): void;
  onNeedsReview?(canStart: boolean, targetAvailable?: boolean): void;
  onReview?(review: DesignerQuoteReview): void;
  onApplied?(groups: DesiredGroup[]): void;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const api = createBuyerApi({
    proxyBase: input.proxyBase,
    productId: input.productId,
    country: input.country,
    fetchImpl,
    storage: input.storage,
  });
  const custody = createSelectedDesignCustody({ api, storage: input.storage, namespace: input.proxyBase });
  const cart = createAjaxCartAdapter({
    root: input.cartRoot,
    fetchImpl,
    journal: cartJournal(input.storage, input.cartRoot),
  });
  const artwork = createArtworkUpload({ api: api.artwork, put: fetchImpl });
  let source = input.source;
  const designs = new Map<string, DesiredGroup>();
  const completed = new Map<string, CartReceipt>();
  const acceptedAttempts = new Map<string, AcceptedCart>();
  const issuanceAttempted = new Set<string>();
  const prepared = new Map<string, Prepared>();
  const reviewSelections = new Map<string, DesiredGroup>();
  let currentSelection: DesiredGroup | undefined;
  async function observe(signal?: AbortSignal) {
    const observed = await cart.read();
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const restore = observed.customized.length
      ? await api.private<{ groups: DesiredGroup[]; labels?: Record<string, string> }>(
          'cart-state',
          { lines: observed.customized },
          signal,
        )
      : { groups: [] };
    return { cart: observed, groups: restore.groups, labels: 'labels' in restore ? (restore.labels ?? {}) : {} };
  }
  async function refreshGroups(groups: DesiredGroup[], signal?: AbortSignal) {
    const labels = new Map<string, string>();
    for (let index = 0; index < groups.length; index++) {
      const candidate = groups[index];
      if (!candidate) continue;
      const config = candidate.productId === source.productId ? source : await api.config(signal, candidate.productId);
      if (
        !config.ready ||
        candidate.design.placements.some((choice) => {
          const placement = config.placements.find((placement) => placement.id === choice.placementId);
          return (
            !placement ||
            !placement.allowedMethodIds.includes(choice.methodId) ||
            !placement.allowedStepIds.includes(choice.stepId) ||
            (choice.artwork.kind === 'deferred' && !placement.logoLaterAllowed)
          );
        }) ||
        candidate.design.options.length !== config.options.length ||
        candidate.design.options.some(
          (choice) =>
            !config.options.some(
              (option) => option.id === choice.optionId && option.values.some((value) => value.id === choice.valueId),
            ),
        )
      )
        throw new Error('A customized cart choice needs explicit repair');
      groups[index] = { ...candidate, configRevisionId: config.revisionId, revisionContentHash: config.contentHash };
      labels.set(candidate.productId, config.title ?? config.selectedSetup?.product.title ?? candidate.productId);
    }
    return labels;
  }
  async function prepare(request: CartRequest) {
    if (issuanceAttempted.has(request.idempotencyKey))
      throw new Error('Reconcile the existing authorization before preparing a different quote');
    let observed: Awaited<ReturnType<typeof observe>>;
    try {
      observed = await observe(request.signal);
    } catch (error) {
      input.onNeedsReview?.(false, false);
      throw error;
    }
    // Show every owned group even if one cannot currently be repriced; unknown amounts stay unavailable.
    reviewSelections.clear();
    const currentMapped = buildBuyerDesigner(source, { locale: input.locale, storeName: input.storeName });
    const currentGroup = currentMapped.desired(request.design);
    currentSelection = currentGroup;
    if (!source.shopCurrency) throw new Error('Shop currency unavailable');
    const previous = designs.get(request.design.id);
    const oldIndex = previous
      ? observed.groups.findIndex((group) => desiredGroupKey(group) === desiredGroupKey(previous))
      : -1;
    const pendingGroups = replaceGroup(observed.groups, currentGroup, oldIndex < 0 ? undefined : oldIndex);
    const pendingRows = [];
    for (const candidate of pendingGroups) {
      const id = await advisoryFingerprint(desiredGroupKey(candidate));
      reviewSelections.set(id, candidate);
      pendingRows.push({
        id,
        editable: true,
        label:
          observed.labels[candidate.productId] ??
          (candidate.productId === source.productId
            ? (source.title ?? source.selectedSetup?.product.title)
            : createCustomerTranslator(input.locale).t('customer:steps.artwork')) ??
          createCustomerTranslator(input.locale).t('customer:steps.artwork'),
        quantity: candidate.variants.reduce((total, variant) => total + variant.quantity, 0),
      });
    }
    input.onReview?.({
      currency: source.shopCurrency,
      exponent: 2,
      customizedQuantity: pendingRows.reduce((total, row) => total + row.quantity, 0),
      groups: pendingRows,
    });
    const refreshed = await api.config(request.signal);
    // Stable IDs and unchanged publication permit amount refresh without replacing the editing state.
    if (refreshed.revisionId !== source.revisionId || refreshed.contentHash !== source.contentHash) {
      let available = false;
      try {
        buildBuyerDesigner(refreshed, { locale: input.locale, storeName: input.storeName });
        available = true;
      } catch {}
      input.onNeedsReview?.(available);
      throw new Error('Published configuration changed; review the current product configuration');
    }
    source = refreshed;
    input.onPriceRefresh?.(refreshed);
    const mapped = buildBuyerDesigner(source, { locale: input.locale, storeName: input.storeName });
    const group: DesiredGroup = mapped.desired(request.design);
    const old = designs.get(request.design.id);
    const index = old ? observed.groups.findIndex((group) => desiredGroupKey(group) === desiredGroupKey(old)) : -1;
    if (request.operation === 'updated' && index < 0) {
      input.onNeedsReview?.(true, false);
      throw new Error('Design requires current-cart review');
    }
    const groups = replaceGroup(observed.groups, group, index < 0 ? undefined : index);
    await custody.save(request.design.id, group, old, request.signal);
    const labels = await refreshGroups(groups, request.signal);
    const proposal = await api.private<QuoteProposal>(
      'quote-proposals',
      {
        country: input.country,
        marketId: input.marketId,
        groups,
        capacity: {
          ordinaryLineCount: observed.cart.ordinary.length,
          inputBytes: new TextEncoder().encode(JSON.stringify(observed.cart.items)).byteLength,
        },
        observedFingerprint: await advisoryFingerprint(observed.cart.fingerprint),
      },
      request.signal,
    );
    if (
      proposal.currency !== source.shopCurrency ||
      proposal.exponent !== 2 ||
      Date.parse(proposal.expiresAt) <= Date.now()
    )
      throw new Error('Current quote unavailable');
    prepared.set(request.idempotencyKey, {
      signature: signature(request),
      proposal,
      groups,
      baseline: observed.cart,
      group,
    });
    currentSelection = group;
    reviewSelections.clear();
    for (const candidate of proposal.groups)
      if (candidate.selection && candidate.canonicalIdentitySha256)
        reviewSelections.set(candidate.canonicalIdentitySha256, candidate.selection);
    input.onReview?.({
      currency: proposal.currency,
      exponent: proposal.exponent,
      totalMinor: proposal.totalMinor,
      customizedQuantity: proposal.customizedQuantity,
      groups: proposal.groups.map((group, index) => ({
        id: group.canonicalIdentitySha256 ?? `${group.productId}-${index}`,
        editable: !!group.selection,
        label: labels.get(group.productId) ?? group.productId,
        quantity: group.quantity,
        totalMinor: group.totalMinor,
      })),
    });
  }
  const ports: DesignerPorts = {
    review: { prepare },
    artwork: {
      async upload(file, request) {
        const preview = await artwork.upload(file, () => {}, request.signal);
        return {
          id: preview.assetId,
          name: file.name,
          url: preview.url,
          width: preview.aspectRatio * 1000,
          height: 1000,
        };
      },
    },
    cart: {
      async commit(request) {
        const completedReceipt = completed.get(request.idempotencyKey);
        if (completedReceipt) return { ...completedReceipt, requestId: request.requestId };
        if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const review = prepared.get(request.idempotencyKey);
        let accepted = acceptedAttempts.get(request.idempotencyKey);
        if (!accepted) {
          if (
            !review ||
            review.signature !== signature(request) ||
            (!issuanceAttempted.has(request.idempotencyKey) && Date.parse(review.proposal.expiresAt) <= Date.now())
          ) {
            await prepare(request);
            throw new Error('Review the refreshed quote before applying it');
          }
          const current = await cart.read();
          if (!issuanceAttempted.has(request.idempotencyKey) && current.fingerprint !== review.baseline.fingerprint) {
            await prepare(request);
            throw new Error('Cart changed; review the refreshed quote');
          }
          // The final user action accepts only the hash displayed by the prepared review.
          issuanceAttempted.add(request.idempotencyKey);
          // An acceptance may be ambiguous: keep the exact proposal/key for retry, never re-propose here.
          accepted = await api.private<AcceptedCart>(
            `quote-proposals/${review.proposal.proposalId}/accept`,
            { hash: review.proposal.hash, idempotencyKey: request.idempotencyKey },
            request.signal,
          );
          acceptedAttempts.set(request.idempotencyKey, accepted);
        }
        const applied = await cart.apply(accepted.buckets, { expectedFingerprint: review?.baseline.fingerprint ?? '' });
        if (applied.status !== 'applied' || applied.recovery || !applied.cart)
          throw new Error('Cart needs review; an uncertain update is never retried automatically');
        designs.set(
          request.design.id,
          review?.group ??
            buildBuyerDesigner(source, { locale: input.locale, storeName: input.storeName }).desired(request.design),
        );
        await api
          .private(`cart-applications/${accepted.applicationId}/confirm`, {
            fingerprint: await advisoryFingerprint(applied.cart.fingerprint),
            vector: accepted.buckets,
          })
          .catch(() => {});
        const receipt: CartReceipt = {
          kind: 'applied',
          requestId: request.requestId,
          designId: request.design.id,
          operation: request.operation,
          authority: 'shopify',
        };
        completed.set(request.idempotencyKey, receipt);
        input.onApplied?.(accepted.desired);
        window.dispatchEvent(new CustomEvent('insignia-cart-updated'));
        return receipt;
      },
    },
  };
  async function restoreArtwork(group: DesiredGroup) {
    const assets = [];
    const ids = [
      ...new Set(
        group.design.placements.flatMap((placement) =>
          placement.artwork.kind === 'revision' ? [placement.artwork.revisionId] : [],
        ),
      ),
    ];
    for (const id of ids) {
      try {
        const preview = await api.artwork<{ url: string; width: number; height: number; expiresAt: string }>(
          `/api/artwork/${id}/preview`,
        );
        if (
          !/^https:\/\//.test(preview.url) ||
          !Number.isFinite(preview.width) ||
          !Number.isFinite(preview.height) ||
          preview.width <= 0 ||
          preview.height <= 0 ||
          Date.parse(preview.expiresAt) <= Date.now()
        )
          continue;
        assets.push({
          id,
          name: createCustomerTranslator(input.locale).t('customer:steps.artwork'),
          url: preview.url,
          width: preview.width,
          height: preview.height,
        });
      } catch {
        /* Missing/expired originals remain missing; no substituted preview or ownership is invented. */
      }
    }
    return assets;
  }
  let removal:
    | { baseline: CartSnapshot; groups: DesiredGroup[]; proposal?: QuoteProposal; accepted?: AcceptedCart; key: string }
    | undefined;
  async function prepareRemoval(target?: DesiredGroup): Promise<DesignerQuoteReview> {
    const baseline = await cart.read();
    if (!baseline.customized.length) throw new Error('Customized cart changed');
    let groups: DesiredGroup[] = [];
    if (target) {
      const owned = await api.private<{ groups: DesiredGroup[] }>('cart-state', { lines: baseline.customized });
      const matches = owned.groups
        .map((group, index) => (desiredGroupKey(group) === desiredGroupKey(target) ? index : -1))
        .filter((index) => index >= 0);
      if (matches.length !== 1) throw new Error('Customized cart changed');
      groups = owned.groups.filter((_group, index) => index !== matches[0]);
    }
    const labels = await refreshGroups(groups);
    let proposal: QuoteProposal | undefined;
    if (groups.length) {
      proposal = await api.private<QuoteProposal>('quote-proposals', {
        country: input.country,
        marketId: input.marketId,
        groups,
        capacity: {
          ordinaryLineCount: baseline.ordinary.length,
          inputBytes: new TextEncoder().encode(JSON.stringify(baseline.items)).byteLength,
        },
        observedFingerprint: await advisoryFingerprint(baseline.fingerprint),
      });
      if (
        proposal.currency !== source.shopCurrency ||
        proposal.exponent !== 2 ||
        Date.parse(proposal.expiresAt) <= Date.now()
      )
        throw new Error('Current quote unavailable');
    }
    removal = { baseline, groups, proposal, key: crypto.randomUUID() };
    if (!source.shopCurrency) throw new Error('Shop currency unavailable');
    return {
      currency: source.shopCurrency,
      exponent: 2,
      totalMinor: proposal?.totalMinor ?? '0',
      customizedQuantity: proposal?.customizedQuantity ?? 0,
      groups:
        proposal?.groups.map((group) => ({
          id: group.canonicalIdentitySha256 ?? group.productId,
          label: labels.get(group.productId) ?? group.productId,
          quantity: group.quantity,
          totalMinor: group.totalMinor,
        })) ?? [],
    };
  }
  async function confirmRemoval() {
    const reviewed = removal;
    if (!reviewed) throw new Error('Removal review required');
    if (reviewed.proposal && !reviewed.accepted) {
      if (Date.parse(reviewed.proposal.expiresAt) <= Date.now()) throw new Error('Removal review expired');
      // Exact proposal/key survives an ambiguous acceptance; no new quote or consent is fabricated.
      reviewed.accepted = await api.private<AcceptedCart>(`quote-proposals/${reviewed.proposal.proposalId}/accept`, {
        hash: reviewed.proposal.hash,
        idempotencyKey: reviewed.key,
      });
    }
    const buckets = reviewed.accepted?.buckets ?? [];
    const result = await cart.apply(buckets, {
      expectedFingerprint: reviewed.baseline.fingerprint,
      repair: buckets.length === 0,
    });
    if (result.status !== 'applied' || result.recovery || !result.cart)
      throw new Error('Cart removal remains unresolved');
    if (reviewed.accepted)
      await api
        .private(`cart-applications/${reviewed.accepted.applicationId}/confirm`, {
          fingerprint: await advisoryFingerprint(result.cart.fingerprint),
          vector: buckets,
        })
        .catch(() => {});
    removal = undefined;
    input.onApplied?.(reviewed.accepted?.desired ?? []);
    window.dispatchEvent(new CustomEvent('insignia-cart-updated'));
  }
  function rebase(groups: DesiredGroup[]) {
    for (const [id, old] of designs) {
      const matching = groups.filter(
        (group) => desiredGroupKey(group, true, false) === desiredGroupKey(old, true, false),
      );
      if (matching.length === 1 && matching[0]) designs.set(id, matching[0]);
    }
    for (const key of prepared.keys()) if (!issuanceAttempted.has(key)) prepared.delete(key);
  }
  return {
    ports,
    observe,
    restoreArtwork,
    restoreSaved: custody.restore,
    prepareRemoval,
    confirmRemoval,
    rebase,
    currentSelection: () => currentSelection,
    selectionFor: (id: string) => reviewSelections.get(id),
    registerDesign: (designId: string, group: DesiredGroup) => designs.set(designId, structuredClone(group)),
  };
}
