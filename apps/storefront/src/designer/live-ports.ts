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
  onPriceRefresh?(source: BuyerConfig, request?: CartRequest): void;
  onNeedsReview?(canStart: boolean, targetAvailable: boolean, canRemoveAll: boolean, request?: CartRequest): void;
  onReview?(review: DesignerQuoteReview, request?: CartRequest): void;
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
  const issuedSignatures = new Map<string, string>();
  const issuanceAttempted = new Set<string>();
  const prepared = new Map<string, Prepared>();
  const reviewSelections = new Map<string, DesiredGroup>();
  const draftSaves = new Map<string, { group: DesiredGroup; original?: DesiredGroup }>();
  async function observe(signal?: AbortSignal) {
    const observed = await cart.read(signal);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const restore = observed.customized.length
      ? await api.private<{ groups: DesiredGroup[]; labels?: Record<string, string>; repairRequired?: boolean }>(
          'cart-state',
          { lines: observed.customized },
          signal,
        )
      : { groups: [] };
    return {
      cart: observed,
      groups: restore.groups,
      labels: 'labels' in restore ? (restore.labels ?? {}) : {},
      // The server rebuilt groups from current cart quantities; they differ from the signed set.
      repairRequired: 'repairRequired' in restore && restore.repairRequired === true,
    };
  }
  async function refreshGroups(groups: DesiredGroup[], signal?: AbortSignal) {
    const labels = new Map<string, string>();
    const configs = new Map<string, Promise<BuyerConfig>>([[source.productId, Promise.resolve(source)]]);
    for (let offset = 0; offset < groups.length; offset += 4) {
      await Promise.all(
        groups.slice(offset, offset + 4).map(async (candidate, index) => {
          let reading = configs.get(candidate.productId);
          if (!reading) {
            reading = api.config(signal, candidate.productId);
            configs.set(candidate.productId, reading);
          }
          const config = await reading;
          signal?.throwIfAborted();
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
                  (option) =>
                    option.id === choice.optionId && option.values.some((value) => value.id === choice.valueId),
                ),
            )
          )
            throw new Error('A customized cart choice needs explicit repair');
          groups[offset + index] = {
            ...candidate,
            configRevisionId: config.revisionId,
            revisionContentHash: config.contentHash,
          };
          labels.set(candidate.productId, config.title ?? config.selectedSetup?.product.title ?? candidate.productId);
        }),
      );
    }
    return labels;
  }
  let prepareController: AbortController | undefined;
  async function prepare(request: CartRequest) {
    if (issuanceAttempted.has(request.idempotencyKey))
      throw new Error('Reconcile the existing authorization before preparing a different quote');
    prepareController?.abort();
    const controller = new AbortController();
    prepareController = controller;
    const signal = AbortSignal.any([request.signal, controller.signal]);
    try {
      const observedRead = observe(signal).catch(async (error) => {
        signal.throwIfAborted();
        let canRemoveAll = false;
        try {
          canRemoveAll = (await cart.read(signal)).customized.length > 0;
        } catch {
          /* Unknown cart contents. */
        }
        signal.throwIfAborted();
        input.onNeedsReview?.(false, false, canRemoveAll, request);
        throw error;
      });
      // The proposal does not wait for this read: the server re-checks the revision and re-prices
      // every group. The fresh config still gates presentation and takes precedence when it changed.
      const configRead = api.config(signal);
      configRead.catch(() => {});
      const observed = await observedRead;
      signal.throwIfAborted();
      // Show every owned group even if one cannot currently be repriced; unknown amounts stay unavailable.
      // Re-proposing an expired, displayed design keeps its total visible until the fresh proposal arrives.
      const displayed = prepared.get(request.idempotencyKey);
      const refreshingDisplayed =
        displayed?.signature === signature(request) && Date.parse(displayed.proposal.expiresAt) <= Date.now();
      reviewSelections.clear();
      const currentMapped = buildBuyerDesigner(source, { locale: input.locale, storeName: input.storeName });
      const currentGroup = currentMapped.desired(request.design);
      if (!source.shopCurrency) throw new Error('Shop currency unavailable');
      const previous = designs.get(request.design.id);
      const oldIndex = previous
        ? observed.groups.findIndex((group) => desiredGroupKey(group) === desiredGroupKey(previous))
        : -1;
      const pendingGroups = replaceGroup(observed.groups, currentGroup, oldIndex < 0 ? undefined : oldIndex);
      const pendingRows = [];
      let currentGroupId: string | undefined;
      const currentKey = desiredGroupKey(currentGroup);
      for (const candidate of pendingGroups) {
        const key = desiredGroupKey(candidate);
        const id = await advisoryFingerprint(key);
        signal.throwIfAborted();
        if (key === currentKey) currentGroupId = id;
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
      if (!refreshingDisplayed)
        input.onReview?.(
          {
            currency: source.shopCurrency,
            currentGroupId,
            exponent: 2,
            customizedQuantity: pendingRows.reduce((total, row) => total + row.quantity, 0),
            groups: pendingRows,
          },
          request,
        );
      // The current revision maps the design; an unchanged revision maps it identically after refresh.
      const group: DesiredGroup = currentGroup;
      const needsCartReview = request.operation === 'updated' && oldIndex < 0;
      let quoting:
        | Promise<{ labels: Map<string, string>; proposal: QuoteProposal; groups: DesiredGroup[] }>
        | undefined;
      if (!needsCartReview) {
        const groups = [...pendingGroups];
        draftSaves.set(request.design.id, { group, original: previous });
        // The proposal does not read the draft: save and proposal run concurrently and both must succeed.
        const saving = custody.save(request.design.id, group, previous, signal);
        const proposing = refreshGroups(groups, signal).then(async (labels) => {
          signal.throwIfAborted();
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
            signal,
          );
          return { labels, proposal, groups };
        });
        quoting = Promise.all([saving, proposing]).then(([, quoted]) => quoted);
        quoting.catch(() => {});
      }
      const refreshed = await configRead;
      signal.throwIfAborted();
      // Stable IDs and unchanged publication permit amount refresh without replacing the editing state.
      if (refreshed.revisionId !== source.revisionId || refreshed.contentHash !== source.contentHash) {
        let available = false;
        try {
          buildBuyerDesigner(refreshed, { locale: input.locale, storeName: input.storeName });
          available = true;
        } catch {}
        input.onNeedsReview?.(available, true, observed.cart.customized.length > 0, request);
        throw new Error('Published configuration changed; review the current product configuration');
      }
      buildBuyerDesigner(refreshed, { locale: input.locale, storeName: input.storeName });
      source = refreshed;
      input.onPriceRefresh?.(refreshed, request);
      if (!quoting) {
        input.onNeedsReview?.(true, false, observed.cart.customized.length > 0, request);
        throw new Error('Design requires current-cart review');
      }
      const { labels, proposal, groups } = await quoting;
      signal.throwIfAborted();
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
      // A click may already be queued with a pending display ID. Keep its owned
      // edit alias until the next prepare; it grants no purchase authority.
      for (const candidate of proposal.groups)
        if (candidate.selection && candidate.canonicalIdentitySha256)
          reviewSelections.set(candidate.canonicalIdentitySha256, candidate.selection);
      input.onReview?.(
        {
          currency: proposal.currency,
          currentGroupId: proposal.groups.find(
            (candidate) =>
              candidate.selection && desiredGroupKey(candidate.selection, false) === desiredGroupKey(group, false),
          )?.canonicalIdentitySha256,
          exponent: proposal.exponent,
          expiresAt: proposal.expiresAt,
          totalMinor: proposal.totalMinor,
          customizedQuantity: proposal.customizedQuantity,
          groups: proposal.groups.map((group, index) => ({
            id: group.canonicalIdentitySha256 ?? `${group.productId}-${index}`,
            editable: !!group.selection,
            label: labels.get(group.productId) ?? group.productId,
            quantity: group.quantity,
            totalMinor: group.totalMinor,
          })),
        },
        request,
      );
      return { expiresAt: proposal.expiresAt };
    } finally {
      controller.abort();
      if (prepareController === controller) prepareController = undefined;
    }
  }
  const renewArtwork: NonNullable<DesignerPorts['artwork']['renew']> = async (selected, request) => {
    let assetExpiresAt = selected.assetExpiresAt;
    if (!assetExpiresAt) {
      const status = await api.artwork<{ state: string; expiresAt: string }>(`/api/artwork/${selected.id}/status`, {
        signal: request.signal,
      });
      if (status.state !== 'USABLE') throw Object.assign(new Error('Artwork unavailable'), { status: 410 });
      assetExpiresAt = status.expiresAt;
    }
    const preview = await artwork.renew(
      {
        assetId: selected.id,
        url: selected.url,
        aspectRatio: selected.width / selected.height,
        expiresAt: selected.previewExpiresAt ?? '',
        assetExpiresAt,
      },
      request.signal,
    );
    return {
      ...selected,
      url: preview.url,
      width: preview.aspectRatio * 1000,
      height: 1000,
      previewExpiresAt: preview.expiresAt,
      assetExpiresAt: preview.assetExpiresAt,
    };
  };
  const ports: DesignerPorts = {
    review: { prepare },
    artwork: {
      renew: renewArtwork,
      apply: renewArtwork,
      async upload(file, request) {
        const preview = await artwork.upload(
          file,
          (state) => request.onProgress?.(state === 'Processing artwork' ? 'processing' : 'uploading'),
          request.signal,
        );
        return {
          id: preview.assetId,
          name: file.name,
          url: preview.url,
          width: preview.aspectRatio * 1000,
          height: 1000,
          previewExpiresAt: preview.expiresAt,
          assetExpiresAt: preview.assetExpiresAt,
        };
      },
    },
    cart: {
      async commit(request) {
        const issuedSignature = issuedSignatures.get(request.idempotencyKey);
        if (issuedSignature !== undefined && issuedSignature !== signature(request))
          throw new Error(
            'The existing authorization belongs to a different design. Reconcile it before applying changes.',
          );
        const completedReceipt = completed.get(request.idempotencyKey);
        if (completedReceipt) return { ...completedReceipt, requestId: request.requestId };
        if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        let review = prepared.get(request.idempotencyKey);
        let accepted = acceptedAttempts.get(request.idempotencyKey);
        if (!accepted) {
          const displayedHash = review?.signature === signature(request) ? review.proposal.hash : undefined;
          if (
            !review ||
            review.signature !== signature(request) ||
            (!issuanceAttempted.has(request.idempotencyKey) && Date.parse(review.proposal.expiresAt) <= Date.now())
          ) {
            request.onPreparing?.();
            const presentation = await prepare(request);
            const fresh = prepared.get(request.idempotencyKey);
            // An expired proposal for the displayed design is replaced in the same click only when the
            // fresh material hash equals the displayed one: that is the same reviewed terms (owner, 10 Nov 2026).
            if (!displayedHash || fresh?.signature !== signature(request) || fresh.proposal.hash !== displayedHash)
              throw Object.assign(new Error('Review the refreshed quote before applying it'), {
                reviewRequired: true,
                ...presentation,
              });
            review = fresh;
          }
          // A prepared, current quote stays in "Adding to cart"; only actual re-preparation or a
          // failure before issuance is reported as preparation (no "Preparing quote" flash).
          let current: CartSnapshot;
          try {
            current = await cart.read();
          } catch (error) {
            if (!issuanceAttempted.has(request.idempotencyKey)) request.onPreparing?.();
            throw error;
          }
          if (!issuanceAttempted.has(request.idempotencyKey) && current.fingerprint !== review.baseline.fingerprint) {
            request.onPreparing?.();
            const presentation = await prepare(request);
            throw Object.assign(new Error('Cart changed; review the refreshed quote'), {
              reviewRequired: true,
              ...presentation,
            });
          }
          // The final user action accepts only the hash displayed by the prepared review.
          request.signal.throwIfAborted();
          request.onMutating?.();
          issuedSignatures.set(request.idempotencyKey, signature(request));
          issuanceAttempted.add(request.idempotencyKey);
          // An acceptance may be ambiguous: keep the exact proposal/key for retry, never re-propose here.
          try {
            accepted = await api.private<AcceptedCart>(
              `quote-proposals/${review.proposal.proposalId}/accept`,
              { hash: review.proposal.hash, idempotencyKey: request.idempotencyKey },
              request.signal,
            );
            request.signal.throwIfAborted();
          } catch (error) {
            request.signal.throwIfAborted();
            if (
              error &&
              typeof error === 'object' &&
              'acceptanceOutcome' in error &&
              error.acceptanceOutcome === 'declined' &&
              prepared.get(request.idempotencyKey) === review &&
              issuedSignatures.get(request.idempotencyKey) === signature(request)
            ) {
              let canStart = false,
                targetAvailable = false,
                canRemoveAll = false;
              try {
                const [latest, observed] = await Promise.all([api.config(request.signal), observe(request.signal)]);
                request.signal.throwIfAborted();
                canRemoveAll = observed.cart.customized.length > 0;
                const original = designs.get(request.design.id);
                targetAvailable =
                  !!original &&
                  observed.groups.some(
                    (candidate) => desiredGroupKey(candidate, false, false) === desiredGroupKey(original, false, false),
                  );
                buildBuyerDesigner(latest, { locale: input.locale, storeName: input.storeName });
                canStart = latest.ready;
              } catch {
                /* Unavailable observations grant no recovery capability. */
              }
              request.signal.throwIfAborted();
              if (
                prepared.get(request.idempotencyKey) !== review ||
                issuedSignatures.get(request.idempotencyKey) !== signature(request)
              )
                throw error;
              prepared.delete(request.idempotencyKey);
              issuanceAttempted.delete(request.idempotencyKey);
              issuedSignatures.delete(request.idempotencyKey);
              input.onNeedsReview?.(canStart, targetAvailable, canRemoveAll, request);
            }
            throw error;
          }
          acceptedAttempts.set(request.idempotencyKey, accepted);
        }
        request.signal.throwIfAborted();
        request.onMutating?.();
        const applied = await cart.apply(accepted.buckets, { expectedFingerprint: review?.baseline.fingerprint ?? '' });
        const buckets = accepted.buckets;
        // A foreign edit that raced the final removal does not undo accepted lines that landed exactly.
        const landed =
          applied.reason === 'cart_changed' &&
          applied.cart?.customized.length === buckets.length &&
          buckets.every((bucket) =>
            applied.cart?.customized.some(
              (line) =>
                line.properties._insignia_line_v3 === bucket.properties._insignia_line_v3 &&
                line.quantity === bucket.quantity,
            ),
          );
        // `late_effects_possible` only repeats that an earlier unknown write was retired by explicit repair:
        // the cart is at the reviewed state, and its tombstone still refuses a late carrier.
        if ((applied.status !== 'applied' && !landed) || !applied.cart) {
          const reason = applied.reason;
          if (reason === 'cart_changed' || reason === 'vector_mismatch' || reason === 'mutation_unresolved') {
            // Never reapply this accepted set against a stale baseline or after an unknown outcome (#338).
            acceptedAttempts.delete(request.idempotencyKey);
            prepared.delete(request.idempotencyKey);
            issuanceAttempted.delete(request.idempotencyKey);
            issuedSignatures.delete(request.idempotencyKey);
          }
          if (reason === 'mutation_unresolved') {
            // An unknown write blocks this tab until the buyer confirms a repair, even with no visible line (#339).
            input.onNeedsReview?.(false, false, true, request);
          } else if (reason === 'cart_changed' || reason === 'vector_mismatch') {
            request.onPreparing?.();
            const presentation = await prepare(request);
            throw Object.assign(new Error('Cart changed; review the refreshed quote'), {
              reviewRequired: true,
              ...presentation,
            });
          }
          throw new Error('Cart needs review; an uncertain update is never retried automatically');
        }
        const selected =
          review?.group ??
          buildBuyerDesigner(source, { locale: input.locale, storeName: input.storeName }).desired(request.design);
        const appliedGroups = accepted.desired.filter(
          (group) => desiredGroupKey(group, false) === desiredGroupKey(selected, false),
        );
        if (appliedGroups.length === 1 && appliedGroups[0]) {
          designs.set(request.design.id, appliedGroups[0]);
          if (desiredGroupKey(appliedGroups[0]) !== desiredGroupKey(selected))
            await custody
              .save(request.design.id, appliedGroups[0], appliedGroups[0], request.signal)
              .catch(async () => custody.forget(request.design.id, appliedGroups[0]!))
              .catch(() => {});
        } else designs.delete(request.design.id);
        await api
          .confirmCartApplication(accepted.applicationId, {
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
  async function restoreArtwork(group: DesiredGroup, signal?: AbortSignal) {
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
          { signal },
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
          previewExpiresAt: preview.expiresAt,
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
    // Removing everything stays available with no visible line: it retires an unknown earlier write (#339).
    if (target && !baseline.customized.length) throw new Error('Customized cart changed');
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
    // Explicit removal is how an unknown earlier write is retired; its tombstone stays for late carriers.
    if (result.status !== 'applied' || !result.cart) throw new Error('Cart removal remains unresolved');
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
  return {
    ports,
    observe,
    readCart: cart.read,
    restoreArtwork,
    async restoreSaved(group: DesiredGroup, signal?: AbortSignal) {
      const restored = await custody.restore(group, signal, (id) => {
        draftSaves.set(id, { group, original: group });
      });
      if (restored) draftSaves.set(restored.id, { group: restored.value, original: group });
      return restored;
    },
    async discardDrafts() {
      for (const [id, saved] of draftSaves) {
        await custody.forget(id, saved.group);
        if (saved.original) await custody.forget(id, saved.original);
      }
      draftSaves.clear();
    },
    prepareRemoval,
    confirmRemoval,
    selectionFor: (id: string) => reviewSelections.get(id),
    registerDesign: (designId: string, group: DesiredGroup) => designs.set(designId, structuredClone(group)),
  };
}
