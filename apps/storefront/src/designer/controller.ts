import type { BuyerConfig, DesiredGroup } from '../buyer';
import { createBuyerApi } from '../buyer';
import { createDesignerFrame } from './frame-host';
import { desiredGroupKey } from './group-key';
import { createLiveDesignerPorts } from './live-ports';
import { createDesignerModal } from './modal';
import { buildBuyerDesigner } from './published';

type DesignerRecord = {
  frame: ReturnType<typeof createDesignerFrame>;
  live: ReturnType<typeof createLiveDesignerPorts>;
};
/** One selected state machine; switching cart designs confirms discarding unfinished edits. */
export async function mountLiveDesigner(input: {
  source: BuyerConfig;
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
  const api = createBuyerApi({
    proxyBase: input.proxyBase,
    productId: input.source.productId,
    country: input.country,
    storage: input.storage,
  });
  const lifetime = new AbortController();
  let pendingModal: ReturnType<typeof createDesignerModal> | undefined;
  let pendingRead: AbortController | undefined;
  let active: DesignerRecord | undefined;
  let destroyed = false;
  let selectionGeneration = 0;
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
    let canStart = true;
    let cartTargetAvailable = true;
    if (group || reset) {
      try {
        const currentSource = await api.config(signal, group?.productId ?? targetProduct);
        source = currentSource;
      } catch {
        canStart = false;
      }
    }
    if (!current() || signal.aborted || generation !== selectionGeneration) return;
    const options = { locale: input.locale, storeName: input.storeName };
    let mapped: ReturnType<typeof buildBuyerDesigner> | undefined;
    try {
      if (canStart) mapped = buildBuyerDesigner(source, options);
    } catch {
      canStart = false;
    }
    let record: DesignerRecord;
    const refreshedPreviews = new Set<string>();
    const live = createLiveDesignerPorts({
      ...input,
      source,
      productId: source.productId,
      onNeedsReview(available, targetAvailable, canRemoveAll) {
        canStart = available;
        cartTargetAvailable = targetAvailable;
        record.frame.repair({ canStart: available, canRemoveGroup: !!group && targetAvailable, canRemoveAll });
      },
      onPriceRefresh(next) {
        record.frame.prices(buildBuyerDesigner(next, options).config, next.wording);
      },
      onReview(quote) {
        record.frame.review(quote);
      },
    });
    let restored:
      | {
          initialDesign: ReturnType<ReturnType<typeof buildBuyerDesigner>['restore']>;
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
        if (!canStart || !mapped) throw new Error('Current configuration unavailable');
        const retained = reset ? null : await live.restoreSaved(original, signal);
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
          : mapped.restore(retained?.value ?? original, id);
        live.registerDesign(initialDesign.id, original);
        restored = {
          initialDesign,
          initialArtworks: reset ? [] : await live.restoreArtwork(retained?.value ?? original, signal),
        };
      } catch {
        repair = true;
      }
    }
    let canRemoveAll = !!original;
    if (!current() || signal.aborted || generation !== selectionGeneration) return;
    if (repair && !original) {
      try {
        canRemoveAll = (await live.readCart()).customized.length > 0;
      } catch {
        /* Unknown cart contents confer no removal affordance. */
      }
    }
    if (!current() || signal.aborted || generation !== selectionGeneration) return;
    const frame = createDesignerFrame({
      ...(mapped ? { config: mapped.config } : {}),
      title: canStart ? source.title : undefined,
      onInitializationRetry: () => retryInitialization((signal) => show(group, reset, targetProduct, signal)),
      ...(repair ? { repair: { canStart: canStart && !!original, canRemoveGroup: !!original, canRemoveAll } } : {}),
      async onRepair(action) {
        if (action === 'retry') {
          if (repair) {
            discard(record);
            active = undefined;
            await show(group);
            return;
          }
          const latest = await api.config(undefined, source.productId);
          const observed = await live.observe();
          cartTargetAvailable =
            !group ||
            observed.groups.some(
              (candidate) => desiredGroupKey(candidate, false, false) === desiredGroupKey(group, false, false),
            );
          try {
            buildBuyerDesigner(latest, options);
            canStart = true;
          } catch {
            canStart = false;
          }
          if (
            latest.revisionId !== source.revisionId ||
            latest.contentHash !== source.contentHash ||
            !cartTargetAvailable
          ) {
            record.frame.repair({
              canStart,
              canRemoveGroup: !!group && cartTargetAvailable,
              canRemoveAll: observed.cart.customized.length > 0,
            });
            throw new Error('Explicit customization review required');
          }
          record.frame.repair();
          return;
        }
        if (action === 'start') {
          if (!canStart || (group && !original && cartTargetAvailable))
            throw new Error('Current customization unavailable');
          discard(record);
          active = undefined;
          await show(cartTargetAvailable ? (original ?? group) : undefined, true, source.productId);
          return;
        }
        if (action === 'remove-group') {
          const target = original ?? group;
          if (!target) throw new Error('Owned customization unavailable');
          return live.prepareRemoval(target);
        }
        if (action === 'remove-all') return live.prepareRemoval();
        await live.confirmRemoval();
        discard(record);
        close();
        openNativeCart();
      },

      wording: source.wording,
      onPreviewFailure(url) {
        if (refreshedPreviews.has(url)) return;
        refreshedPreviews.add(url);
        void api
          .config(undefined, source.productId)
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
    const generation = selectionGeneration;
    const probe = createLiveDesignerPorts({ ...input, productId: input.source.productId });
    try {
      const observed = await probe.observe(signal);
      if (!current() || generation !== selectionGeneration) return;
      const group = observed.groups.find((group) => group.productId === input.source.productId) ?? observed.groups[0];
      if (!group) throw new Error('Customized cart group unavailable');
      await show(group, false, group.productId, signal);
    } catch {
      // No owned choices are disclosed. Only an explicit journalled removal of observed customization is available.
      if (!current() || signal.aborted || generation !== selectionGeneration) return;
      let canRemoveAll = false;
      try {
        canRemoveAll = (await probe.readCart()).customized.length > 0;
      } catch {
        /* Unknown cart contents. */
      }
      if (!current() || generation !== selectionGeneration) return;
      const frame = createDesignerFrame({
        onInitializationRetry: () => retryInitialization(showOwned),
        title: input.source.title,
        ports: probe.ports,
        locale: input.locale,
        repair: { canStart: false, canRemoveGroup: false, canRemoveAll },
        onClose: close,
        async onRepair(action) {
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
  if (input.repair) await showOwned();
  else await show();
  return {
    open() {
      const record = active;
      if (!record?.frame.open()) return false;
      void record.live
        .savedChoices(lifetime.signal)
        .then((choices) => {
          if (current() && active === record) record.frame.savedChoices(choices);
        })
        .catch(() => {});
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
