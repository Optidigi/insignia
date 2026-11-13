import { buyerCartCapacityExceeded } from '@insignia/contracts';
import { createCustomerTranslator } from '@insignia/ui-localization/customer';
import type { Design } from '../../../../frontend/designer/src/model';
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
  earlierSessionCart,
  type QuoteProposal,
  replaceGroup,
} from '../buyer';
import { readBuyerSession, sharedBuyerStorage } from '../buyer-session';
import { type CartSnapshot, createAjaxCartAdapter } from '../cart';
import { createSelectedDesignCustody } from './design-custody';
import { desiredGroupKey } from './group-key';
import { buildBuyerDesigner } from './published';
import type { RepairState } from './repair-state';

/**
 * Autosave of the unfinished design (#366): this long after its last change, and at least this long after the
 * previous autosave began. A draft save costs two of the session's 60 writes a minute (request admission and the
 * save), so continuous editing spends about 12 of them.
 */
const AUTOSAVE_DELAY_MS = 2_000;
const AUTOSAVE_SPACING_MS = 10_000;
/** A refused write that names no `Retry-After` is the session's per-minute limit: its window is a minute long. */
const AUTOSAVE_PAUSE_DEFAULT_MS = 60_000;
/** Longest pause for one refusal, whatever `Retry-After` asks: a shorter wait than a visit, never a lasting stop. */
const AUTOSAVE_PAUSE_MAX_MS = 300_000;
type Prepared = {
  signature: string;
  proposal: QuoteProposal;
  groups: DesiredGroup[];
  baseline: CartSnapshot;
  group: DesiredGroup;
};
const signature = (request: CartRequest) =>
  JSON.stringify([request.design, request.artworks.map((artwork) => artwork.id)]);
/** Retained and edited groups share one signed set. The Designer names the limit for this code, as for the 422 (#335). */
function assertCartCapacity(groups: readonly DesiredGroup[], ordinaryLineCount: number) {
  const exceeded = buyerCartCapacityExceeded(groups, ordinaryLineCount);
  if (exceeded)
    throw Object.assign(new Error('Cart customization limit reached'), {
      code: 'CAPACITY_EXCEEDED',
      ...(exceeded === 'CART_LINES' ? { cartLines: true } : {}),
    });
}
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
  /**
   * This tab's cart journal and cart-line draft hints. The session capability, draft quantity bases and the
   * latest unfinished design are shared by every tab (buyer-session.ts).
   */
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  onPriceRefresh?(source: BuyerConfig, request?: CartRequest): void;
  /**
   * Why the cart needs review. `canRemoveGroup` says this design's own cart line is still there; the host offers it
   * only for a design opened from the cart.
   */
  onNeedsReview?(state: RepairState, request?: CartRequest): void;
  onReview?(review: DesignerQuoteReview, request?: CartRequest): void;
  onApplied?(groups: DesiredGroup[]): void;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const api = createBuyerApi({
    proxyBase: input.proxyBase,
    productId: input.productId,
    country: input.country,
    fetchImpl,
  });
  const shared = sharedBuyerStorage();
  const custody = createSelectedDesignCustody({
    api,
    storage: input.storage,
    namespace: input.proxyBase,
    shared,
    session: () => readBuyerSession(shared, input.proxyBase)?.sessionId,
  });
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
  /** The save waiting for its debounce: the design's draft group, computed when it is sent. */
  type PendingAutosave = { id: string; group(): DesiredGroup; retried: boolean };
  let autosave: (PendingAutosave & { timer: ReturnType<typeof setTimeout> }) | undefined;
  const autosaving = new Set<AbortController>();
  let lastAutosave = Number.NEGATIVE_INFINITY;
  // The session's lifetime quota is exhausted (429 SESSION_QUOTA), or a 429 is not clearly the transient per-minute
  // limit: further autosaves would only spend the writes a quote or Add to cart needs, so they stop for the rest of
  // the page load. Review still saves the draft as before.
  let autosaveStopped = false;
  // The transient per-minute limit (429 RATE_LIMITED, normally with no Retry-After) only pauses autosave: nothing is
  // sent before this time, then the latest pending design is saved (§8.2).
  let autosaveNotBefore = Number.NEGATIVE_INFINITY;
  /** Drop the pending autosave and fence any in flight: its late answer no longer sets a reopen pointer. */
  function cancelAutosave() {
    if (autosave) clearTimeout(autosave.timer);
    autosave = undefined;
    for (const controller of autosaving) controller.abort();
    autosaving.clear();
  }
  function queueAutosave(pending: PendingAutosave) {
    if (autosaveStopped) return;
    if (autosave) clearTimeout(autosave.timer);
    const now = Date.now();
    const wait = Math.max(AUTOSAVE_DELAY_MS, lastAutosave + AUTOSAVE_SPACING_MS - now, autosaveNotBefore - now);
    autosave = { ...pending, timer: setTimeout(() => void flushAutosave(), wait) };
  }
  function scheduleAutosave(design: Design) {
    queueAutosave({
      id: design.id,
      group: () => buildBuyerDesigner(source, { locale: input.locale, storeName: input.storeName }).draft(design),
      retried: false,
    });
  }
  /**
   * A design saved earlier is empty again, or back at its cart line (#366). A new design is no longer offered after a
   * reload; a cart line's draft becomes the cart version again, so reopening the line starts from the cart.
   */
  function revertDraft(id: string) {
    cancelAutosave();
    const original = designs.get(id);
    if (original) {
      queueAutosave({ id, group: () => original, retried: false });
      return;
    }
    const saved = draftSaves.get(id);
    draftSaves.delete(id);
    if (saved) void custody.forget(id, saved.group).catch(() => {});
    else custody.forgetLatest(input.productId, id);
  }
  /**
   * How a failed draft write was refused with 429: `stop` for the lifetime session quota (nothing succeeds until the
   * session expires) and for a 429 that is not clearly the transient limit; otherwise the pause until a retry can
   * succeed, from `Retry-After` when sent. Not a rate limit: undefined.
   */
  function rateLimit(error: unknown): 'stop' | { pauseMs: number } | undefined {
    if (!error || typeof error !== 'object' || !('status' in error) || error.status !== 429) return undefined;
    const { code, reason, retryAfter } = error as { code?: unknown; reason?: unknown; retryAfter?: unknown };
    const seconds = typeof retryAfter === 'number' && retryAfter > 0 ? retryAfter : 0;
    if (reason === 'SESSION_QUOTA' || !(seconds || code === 'RATE_LIMITED' || code === 'SESSION_RATE_LIMITED'))
      return 'stop';
    return { pauseMs: Math.min(seconds ? seconds * 1000 : AUTOSAVE_PAUSE_DEFAULT_MS, AUTOSAVE_PAUSE_MAX_MS) };
  }
  async function flushAutosave() {
    const pending = autosave;
    autosave = undefined;
    if (!pending || autosaveStopped) return;
    let group: DesiredGroup;
    try {
      group = pending.group();
    } catch {
      return;
    }
    const original = designs.get(pending.id);
    const controller = new AbortController();
    autosaving.add(controller);
    lastAutosave = Date.now();
    draftSaves.set(pending.id, { group, original });
    try {
      // The same custody save as Review: same draft ID, CAS version and reopen pointers. Unchanged content writes nothing.
      await custody.save(pending.id, group, original, controller.signal, { onlyChanges: true });
    } catch (error) {
      const refusal = rateLimit(error);
      if (refusal === 'stop') autosaveStopped = true;
      else if (refusal) {
        // Pause, then send the latest design: a newer change already waiting is moved to after the pause, otherwise
        // this refused one waits (its refusal does not use up the retry), unless a cancellation has dropped it.
        autosaveNotBefore = Date.now() + refusal.pauseMs;
        const latest = autosave ?? (controller.signal.aborted ? undefined : pending);
        if (latest) queueAutosave(latest);
      }
      // Any other failure is retried once, unless a newer change or a cancellation has replaced it.
      else if (!controller.signal.aborted && !autosave && !pending.retried)
        queueAutosave({ ...pending, retried: true });
    } finally {
      autosaving.delete(controller);
    }
  }
  async function observe(signal?: AbortSignal) {
    const observed = await cart.read(signal);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const restore = observed.customized.length
      ? await api.private<{ groups: DesiredGroup[]; labels?: Record<string, string> }>(
          'cart-state',
          { lines: observed.customized },
          signal,
        )
      : { groups: [] };
    return {
      cart: observed,
      groups: restore.groups,
      labels: 'labels' in restore ? (restore.labels ?? {}) : {},
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
        const lines = earlierSessionCart(error);
        input.onNeedsReview?.(
          lines ? { cause: 'earlier-session', lines, canRemoveAll } : { cause: 'unavailable', canRemoveAll },
          request,
        );
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
      // This design's own cart line, even with quantities changed natively; another tab may have removed it.
      const inCart =
        !!previous &&
        observed.groups.some(
          (candidate) => desiredGroupKey(candidate, false, false) === desiredGroupKey(previous, false, false),
        );
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
        // The proposal does not read the draft, so the two run concurrently. The draft only lets the buyer reopen
        // this design later, so a failed save never blocks the quote (#337). It leaves the reopen pointer as it was:
        // none, or an earlier save from this visit. The storefront has no logging channel to record it.
        const saving = custody.save(request.design.id, group, previous, signal).catch(() => {});
        const proposing = refreshGroups(groups, signal).then(async (labels) => {
          signal.throwIfAborted();
          assertCartCapacity(groups, observed.cart.ordinary.length);
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
        input.onNeedsReview?.(
          {
            cause: 'review-required',
            canStart: available,
            canRemoveGroup: inCart,
            canRemoveAll: observed.cart.customized.length > 0,
          },
          request,
        );
        throw new Error('Published configuration changed; review the current product configuration');
      }
      buildBuyerDesigner(refreshed, { locale: input.locale, storeName: input.storeName });
      source = refreshed;
      input.onPriceRefresh?.(refreshed, request);
      if (!quoting) {
        input.onNeedsReview?.(
          inCart
            ? { cause: 'cart-changed' }
            : {
                cause: 'review-required',
                canStart: true,
                canRemoveGroup: false,
                canRemoveAll: observed.cart.customized.length > 0,
              },
          request,
        );
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
    draft: { changed: scheduleAutosave, reverted: revertDraft },
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
        // Review saved this design; a late autosave must not race the cart write or re-point it as unfinished.
        cancelAutosave();
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
              input.onNeedsReview?.(
                { cause: 'review-required', canStart, canRemoveGroup: targetAvailable, canRemoveAll },
                request,
              );
            } else if (
              error &&
              typeof error === 'object' &&
              'status' in error &&
              error.status === 409 &&
              'code' in error &&
              error.code === 'REVIEW_REQUIRED' &&
              prepared.get(request.idempotencyKey) === review &&
              issuedSignatures.get(request.idempotencyKey) === signature(request)
            ) {
              // A plain 409 REVIEW_REQUIRED (republished, price or stock changed) committed nothing: like a changed
              // cart, retire this proposal and show the current terms, never resend the same acceptance (#337).
              // A changed publication routes to repair inside prepare.
              prepared.delete(request.idempotencyKey);
              issuanceAttempted.delete(request.idempotencyKey);
              issuedSignatures.delete(request.idempotencyKey);
              request.onPreparing?.();
              const presentation = await prepare(request);
              throw Object.assign(new Error('Review the current terms before applying them'), {
                reviewRequired: true,
                ...presentation,
              });
            }
            throw error;
          }
          acceptedAttempts.set(request.idempotencyKey, accepted);
        }
        request.signal.throwIfAborted();
        request.onMutating?.();
        const applied = await cart.apply(accepted.buckets, { expectedFingerprint: review?.baseline.fingerprint ?? '' });
        // `late_effects_possible` only repeats that an earlier unknown write was retired by explicit repair:
        // the cart is at the reviewed state, and its tombstone still refuses a late carrier.
        if (applied.status !== 'applied' || !applied.cart) {
          const reason = applied.reason;
          if (
            reason === 'cart_changed' ||
            reason === 'vector_mismatch' ||
            reason === 'mutation_unresolved' ||
            reason === 'rejected'
          ) {
            // Never reapply this accepted set: the baseline is stale, its outcome unknown or Shopify refused it.
            acceptedAttempts.delete(request.idempotencyKey);
            prepared.delete(request.idempotencyKey);
            issuanceAttempted.delete(request.idempotencyKey);
            issuedSignatures.delete(request.idempotencyKey);
          }
          if (reason === 'mutation_unresolved') {
            // An unknown write blocks this tab until the buyer confirms a repair, even with no visible line (#339).
            input.onNeedsReview?.({ cause: 'unresolved-write' }, request);
          } else if (reason === 'cart_changed' || reason === 'vector_mismatch') {
            request.onPreparing?.();
            const presentation = await prepare(request);
            throw Object.assign(new Error('Cart changed; review the refreshed quote'), {
              reviewRequired: true,
              ...presentation,
            });
          } else if (reason === 'busy') {
            // Another tab or the repair view is applying the cart. The accepted set is kept, so Retry applies it.
            throw Object.assign(new Error('Cart update in progress elsewhere'), { code: 'CART_BUSY' });
          } else if (reason === 'rejected') {
            // A definite refusal (typically stock) with the buyer's lines intact: say so, never "uncertain".
            throw Object.assign(new Error('Shopify refused the cart update'), {
              cartRejected: true,
              // Only Shopify's 422 is a stock or limit refusal; other 4xx get neutral wording.
              stock: applied.refusal === 422,
              ...(applied.detail ? { detail: applied.detail } : {}),
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
          await custody.rebase(request.design.id, appliedGroups[0]).catch(() => {});
          if (desiredGroupKey(appliedGroups[0]) !== desiredGroupKey(selected))
            await custody
              .save(request.design.id, appliedGroups[0], appliedGroups[0], request.signal)
              .catch(async () => custody.forget(request.design.id, appliedGroups[0]!))
              .catch(() => {});
        } else designs.delete(request.design.id);
        // In the cart now, it is no longer the product's unfinished design (#347).
        custody.forgetLatest(selected.productId, request.design.id);
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
          // Drafts keep IDs only, never file names; the Designer labels a nameless artwork in its current language.
          name: '',
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
      // Native cart edits may have taken the retained designs over the limit: named as when adding (#371).
      assertCartCapacity(groups, baseline.ordinary.length);
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
      removal: true,
    });
    // Another tab or the Designer is applying the cart. The reviewed removal and its accepted set are kept, so Retry
    // applies the same set (#371).
    if (result.reason === 'busy')
      throw Object.assign(new Error('Cart update in progress elsewhere'), { code: 'CART_BUSY' });
    // Explicit removal is how an unknown earlier write is retired; its tombstone stays for late carriers until a
    // later successful repair or removal observes none of its lines, or it expires (#371).
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
    /** Whether an unfinished design of this session may be offered; reads only browser storage (#347). */
    hasLatestDraft: () => custody.hasLatest(input.productId),
    /**
     * The product's latest unfinished design, registered for explicit abandonment (Start new). The server keeps a
     * draft after it is applied, so one this session's cart already holds is not unfinished: an Add whose answer
     * was lost, or another tab's Add after this one continued it, leaves its pointer behind. It is dropped here.
     */
    async restoreLatest(signal?: AbortSignal) {
      const latest = await custody.latest(input.productId, signal);
      if (!latest) return null;
      const draft = desiredGroupKey(latest.value, false, false);
      if ((await observe(signal)).groups.some((group) => desiredGroupKey(group, false, false) === draft)) {
        custody.forgetLatest(input.productId, latest.id);
        return null;
      }
      draftSaves.set(latest.id, { group: latest.value });
      return latest;
    },
    async discardDrafts() {
      cancelAutosave();
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
