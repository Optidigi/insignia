import type { BuyerConfig, DesiredGroup } from '../buyer';
import { createBuyerApi, earlierSessionCart } from '../buyer';
import { createDesignerFrame } from './frame-host';
import { desiredGroupKey, restorableDesign } from './group-key';
import { createLiveDesignerPorts } from './live-ports';
import { createDesignerModal } from './modal';
import { buildBuyerDesigner } from './published';
import { type RepairState, repairOffers } from './repair-state';

type DesignerRecord = {
  frame: ReturnType<typeof createDesignerFrame>;
  live: ReturnType<typeof createLiveDesignerPorts>;
};
/** One selected state machine; switching cart designs confirms discarding unfinished edits. */
export async function mountLiveDesigner(input: {
  modal?: ReturnType<typeof createDesignerModal>;
  source: BuyerConfig;
  initiallyHidden?: boolean;
  proxyBase: string;
  cartRoot: string;
  country: string;
  marketId: string;
  locale: string;
  storeName: string;
  repair: boolean;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  onClose(): void;
  onError(): void;
  isCurrent(): boolean;
}) {
  if (input.initiallyHidden && input.repair) throw new Error('Background cart recovery is unavailable');
  const api = createBuyerApi({
    proxyBase: input.proxyBase,
    productId: input.source.productId,
    country: input.country,
  });
  const lifetime = new AbortController();
  let pendingModal: ReturnType<typeof createDesignerModal> | undefined;
  let pendingRead: AbortController | undefined;
  let active: DesignerRecord | undefined;
  let openingModal = input.modal;
  let destroyed = false;
  let initiallyHidden = input.initiallyHidden === true;
  let preparationFailed = false;
  let selectionGeneration = 0;
  // Only an editable Designer will make private calls (upload, draft, quote).
  let editable = false;
  const current = () => !destroyed && input.isCurrent();
  function openNativeCart() {
    if (current()) window.location.assign(`${input.cartRoot}cart`);
  }
  function close() {
    active?.frame.hide();
    input.onClose();
  }
  function discard(record: DesignerRecord) {
    record.frame.destroy();
    if (active === record) active = undefined;
  }
  async function show(
    group?: DesiredGroup,
    reset = false,
    targetProduct = input.source.productId,
    signal = lifetime.signal,
  ) {
    const generation = ++selectionGeneration;
    if (!current()) return;
    let source = input.source;
    let configRead = true;
    // What the repair view was last asked to show. Its offered actions also decide what Start does.
    let repairState: RepairState | undefined;
    if (group || reset) {
      try {
        const currentSource = await api.config(signal, group?.productId ?? targetProduct);
        source = currentSource;
      } catch {
        configRead = false;
      }
    }
    if (!current() || signal.aborted || generation !== selectionGeneration) return;
    const options = { locale: input.locale, storeName: input.storeName };
    let mapped: ReturnType<typeof buildBuyerDesigner> | undefined;
    try {
      if (configRead) mapped = buildBuyerDesigner(source, options);
    } catch {
      /* The current configuration cannot be shown: only repair is offered. */
    }
    // Only a design opened from the cart has its own cart line to remove or reopen.
    function forSelection(state: RepairState): RepairState {
      if (group) return state;
      if (state.cause === 'cart-changed')
        return { cause: 'review-required', canStart: true, canRemoveGroup: false, canRemoveAll: true };
      if (state.cause === 'review-required') return { ...state, canRemoveGroup: false };
      return state;
    }
    let record: DesignerRecord;
    const refreshedPreviews = new Set<string>();
    const live = createLiveDesignerPorts({
      ...input,
      source,
      productId: source.productId,
      onNeedsReview(state, request) {
        if (request?.signal.aborted) return;
        repairState = forSelection(state);
        record.frame.repair(repairState, request);
      },
      onPriceRefresh(next, request) {
        record.frame.prices(buildBuyerDesigner(next, options).config, next.wording, request);
      },
      onReview(quote, request) {
        record.frame.review(quote, request);
      },
    });
    let restored:
      | {
          initialDesign: ReturnType<ReturnType<typeof buildBuyerDesigner>['restore']>;
          initialBaseline: ReturnType<ReturnType<typeof buildBuyerDesigner>['restore']>;
          initialArtworks: Awaited<ReturnType<typeof live.restoreArtwork>>;
        }
      | undefined;
    let repair = !mapped;
    let original: DesiredGroup | undefined;
    if (group) {
      try {
        const observed = await live.observe(signal);
        const exact = observed.groups.filter(
          (candidate) => desiredGroupKey(candidate, false, false) === desiredGroupKey(group, false, false),
        );
        if (exact.length !== 1 || !exact[0]) throw new Error('Cart selection changed');
        original = exact[0];
        const retained = reset ? null : await live.restoreSaved(original, signal);
        if (!mapped) throw new Error('Current configuration unavailable');
        if (retained && ['choice-unavailable', 'configuration-unavailable'].includes(retained.compatibility))
          throw new Error('Saved choices require review');
        const id = reset ? crypto.randomUUID() : (retained?.id ?? crypto.randomUUID());
        const initialDesign = reset
          ? {
              id,
              prints: [],
              quantities: {},
              variants: [],
              ...(mapped.config.productionOptions?.length
                ? {
                    options: mapped.config.productionOptions.flatMap((option) => {
                      const first = option.values[0];
                      return first ? [{ optionId: option.id, valueId: first.id }] : [];
                    }),
                  }
                : {}),
            }
          : mapped.restore(restorableDesign(original, retained?.value, retained?.cartQuantitiesChanged === true), id);
        live.registerDesign(initialDesign.id, original);
        restored = {
          initialDesign,
          initialBaseline: mapped.restore(original, id),
          initialArtworks: reset ? [] : await live.restoreArtwork(retained?.value ?? original, signal),
        };
      } catch {
        repair = true;
      }
    }
    // An unfinished new design from an earlier page load, another tab or a browser restart (#347).
    let resumed:
      | {
          resumeDraft: ReturnType<ReturnType<typeof buildBuyerDesigner>['restore']>;
          initialArtworks: Awaited<ReturnType<typeof live.restoreArtwork>>;
        }
      | undefined;
    let draftUnavailable = false;
    if (!group && !reset && mapped) {
      // Reading it uses the buyer session, so it waits for the buyer to open the Designer.
      if (initiallyHidden && live.hasLatestDraft()) return;
      if (!initiallyHidden)
        try {
          const draft = await live.restoreLatest(signal);
          if (draft && ['choice-unavailable', 'configuration-unavailable'].includes(draft.compatibility)) {
            // Its choices are no longer offered: it is discarded, and the clean Designer says why (owner decision).
            await live.discardDrafts();
            draftUnavailable = true;
          } else if (
            draft &&
            (draft.value.design.placements.length > 0 || draft.value.variants.some((variant) => variant.quantity > 0))
          )
            resumed = {
              resumeDraft: mapped.restore(draft.value, draft.id),
              initialArtworks: await live.restoreArtwork(draft.value, signal),
            };
        } catch {
          /* A draft that cannot be read now is not offered: the Designer starts clean. */
        }
    }
    let canRemoveAll = !!original;
    if (!current() || signal.aborted || generation !== selectionGeneration) return;
    // Background preparation is only for a complete, brand-new product. A
    // repair path may read owned cart custody and must wait for the user.
    if (initiallyHidden && repair) return;
    if (repair && !original) {
      try {
        canRemoveAll = (await live.readCart()).customized.length > 0;
      } catch {
        /* Unknown cart contents confer no removal affordance. */
      }
    }
    if (!current() || signal.aborted || generation !== selectionGeneration) return;
    if (repair)
      repairState = original
        ? { cause: 'review-required', canStart: !!mapped, canRemoveGroup: true, canRemoveAll }
        : { cause: 'unavailable', canRemoveAll };
    const modal = openingModal;
    openingModal = undefined;
    const frame = createDesignerFrame({
      modal,
      initiallyHidden,
      ...(mapped ? { config: mapped.config } : {}),
      title: mapped ? source.title : undefined,
      onInitializationRetry: () => retryInitialization((signal) => show(group, reset, targetProduct, signal)),
      ...(repairState ? { repair: repairState } : {}),
      async onRepair(action) {
        if (action === 'retry') {
          if (repair) {
            discard(record);
            active = undefined;
            await show(group);
            return;
          }
          const latest = await api.config(lifetime.signal, source.productId);
          const observed = await live.observe();
          const target = group
            ? observed.groups.filter(
                (candidate) => desiredGroupKey(candidate, false, false) === desiredGroupKey(group, false, false),
              )
            : [];
          const targetAvailable = !group || target.length > 0;
          if (
            latest.revisionId !== source.revisionId ||
            latest.contentHash !== source.contentHash ||
            !targetAvailable
          ) {
            let canStart = true;
            try {
              buildBuyerDesigner(latest, options);
            } catch {
              canStart = false;
            }
            repairState = {
              cause: 'review-required',
              canStart,
              canRemoveGroup: !!group && targetAvailable,
              canRemoveAll: observed.cart.customized.length > 0,
            };
            record.frame.repair(repairState);
            throw new Error('Explicit customization review required');
          }
          // The cart line may have changed natively under the open Designer: the edit now replaces it as it is.
          if (restored && mapped && target.length === 1 && target[0]) {
            original = target[0];
            live.registerDesign(restored.initialDesign.id, original);
            // Quantities the buyer did not edit follow the cart, so Update cart cannot revert it.
            record.frame.cartLine(mapped.restore(original, restored.initialDesign.id));
          }
          repairState = undefined;
          record.frame.repair();
          return;
        }
        if (action === 'start') {
          const state = repairState;
          // Only an offered Start or Reopen proceeds. A design whose own cart line is there but was not restored
          // cannot be started over in its place.
          if (
            !state ||
            !repairOffers(state, 'start') ||
            (group && !original && state.cause === 'review-required' && state.canRemoveGroup)
          )
            throw new Error('Current customization unavailable');
          // A cart line changed natively under the Designer still holds this design: reopen it from the cart.
          const changed =
            group && state.cause === 'cart-changed'
              ? (await live.observe()).groups.filter(
                  (candidate) => desiredGroupKey(candidate, false, false) === desiredGroupKey(group, false, false),
                )
              : [];
          await live.discardDrafts();
          discard(record);
          active = undefined;
          if (changed.length === 1 && changed[0]) await show(changed[0], false, changed[0].productId);
          else
            await show(
              state.cause === 'review-required' && state.canRemoveGroup ? (original ?? group) : undefined,
              true,
              source.productId,
            );
          return;
        }
        if (action === 'remove-group') {
          const target = original ?? group;
          if (!target) throw new Error('Owned customization unavailable');
          return live.prepareRemoval(target);
        }
        if (action === 'remove-all') return live.prepareRemoval();
        if (action === 'cart') {
          openNativeCart();
          return;
        }
        await live.confirmRemoval();
        discard(record);
        close();
        openNativeCart();
      },

      wording: source.wording,
      onPreviewFailure(url) {
        if (initiallyHidden) {
          preparationFailed = true;
          return;
        }
        if (refreshedPreviews.has(url)) return;
        refreshedPreviews.add(url);
        void api
          .config(lifetime.signal, source.productId)
          .then((latest) => {
            if (
              !current() ||
              active !== record ||
              latest.revisionId !== source.revisionId ||
              latest.contentHash !== source.contentHash
            )
              return;
            record.frame.previews(buildBuyerDesigner(latest, options).config.colors);
          })
          .catch(() => {});
      },
      ports: live.ports,
      locale: options.locale,
      requiresCartReview: !!group,
      ...restored,
      ...resumed,
      ...(draftUnavailable ? { draftUnavailable } : {}),
      onDiscardDrafts() {
        void live.discardDrafts().catch(() => {});
      },
      onClose: close,
      onAppliedClose: openNativeCart,
      onSelectGroup(id) {
        const selection = live.selectionFor(id);
        if (!selection) return;
        void retryInitialization(async (signal) => {
          await live.discardDrafts();
          await show(selection, false, selection.productId, signal);
        });
      },
    });
    record = { frame, live };
    if (active && active !== record) discard(active);
    active = record;
    editable = !repair;
  }
  async function retryInitialization(work: (signal: AbortSignal) => Promise<void>) {
    pendingRead?.abort();
    pendingModal?.destroy();
    const reading = new AbortController();
    pendingRead = reading;
    const signal = AbortSignal.any([reading.signal, lifetime.signal]);
    const pending = createDesignerModal({
      locale: input.locale,
      onCancel: () => {
        reading.abort();
        selectionGeneration++;
        pending.destroy();
        close();
      },
      onRetry: () => {
        pending.destroy();
        void retryInitialization(work);
      },
    });
    pendingModal = pending;
    if (active) discard(active);
    try {
      await work(signal);
      pending.destroy();
    } catch {
      if (!signal.aborted) pending.failed();
      else pending.destroy();
    }
  }
  async function showOwned(signal = lifetime.signal) {
    if (!current() || signal.aborted) return;
    const generation = selectionGeneration;
    const probe = createLiveDesignerPorts({ ...input, productId: input.source.productId });
    try {
      const observed = await probe.observe(signal);
      if (!current() || generation !== selectionGeneration) return;
      const group = observed.groups.find((group) => group.productId === input.source.productId) ?? observed.groups[0];
      if (!group) throw new Error('Customized cart group unavailable');
      await show(group, false, group.productId, signal);
    } catch (error) {
      // No owned choices are disclosed. Only an explicit journalled removal of observed customization is available,
      // and lines an earlier session accepted can be kept as they are (#340).
      if (!current() || signal.aborted || generation !== selectionGeneration) return;
      const lines = earlierSessionCart(error);
      let canRemoveAll = false;
      try {
        canRemoveAll = (await probe.readCart()).customized.length > 0;
      } catch {
        /* Unknown cart contents. */
      }
      if (!current() || generation !== selectionGeneration) return;
      const modal = openingModal;
      openingModal = undefined;
      const frame = createDesignerFrame({
        modal,
        onInitializationRetry: () => retryInitialization(showOwned),
        title: input.source.title,
        ports: probe.ports,
        locale: input.locale,
        repair: lines ? { cause: 'earlier-session', lines, canRemoveAll } : { cause: 'unavailable', canRemoveAll },
        onClose: close,
        async onRepair(action) {
          if (action === 'cart') {
            openNativeCart();
            return;
          }
          if (action === 'retry') {
            const observed = await probe.observe();
            const group =
              observed.groups.find((group) => group.productId === input.source.productId) ?? observed.groups[0];
            if (!group) throw new Error('Owned customization unavailable');
            discard(record);
            active = undefined;
            await show(group);
            return;
          }
          if (action === 'remove-all') return probe.prepareRemoval();
          if (action !== 'confirm') throw new Error('Owned customization unavailable');
          await probe.confirmRemoval();
          frame.destroy();
          active = undefined;
          close();
          openNativeCart();
        },
      });
      const record = { frame, live: probe };
      active = record;
    }
  }
  // A visible editable Designer is about to need a session (upload, draft, quote). Cart repair
  // never warms one: a fresh session must not look like ownership of earlier accepted sets.
  let sessionWarmed = false;
  function warmSession() {
    if (sessionWarmed || initiallyHidden || input.repair || !editable || !current()) return;
    sessionWarmed = true;
    void api.warmSession();
  }
  if (input.repair) await showOwned();
  else await show();
  warmSession();
  return {
    get ready() {
      return !preparationFailed && active?.frame.initialized === true;
    },
    open() {
      if (preparationFailed) return false;
      initiallyHidden = false;
      const record = active;
      if (!record?.frame.open()) return false;
      warmSession();
      return true;
    },
    destroy() {
      destroyed = true;
      lifetime.abort();
      pendingRead?.abort();
      pendingModal?.destroy();
      if (active) discard(active);
    },
  };
}
