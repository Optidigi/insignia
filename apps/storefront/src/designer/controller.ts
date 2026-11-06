import type { BuyerConfig, DesiredGroup } from '../buyer';
import { createBuyerApi } from '../buyer';
import { createDesignerFrame } from './frame-host';
import { desiredGroupKey } from './group-key';
import { createLiveDesignerPorts } from './live-ports';
import { buildBuyerDesigner } from './published';

type DesignerRecord = {
  frame: ReturnType<typeof createDesignerFrame>;
  live: ReturnType<typeof createLiveDesignerPorts>;
};
/** Each selected design retains its own state machine while full-cart quote rows select another design. */
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
  const originals = document.documentElement.style.overflow;
  const records = new Set<DesignerRecord>();
  const choices = new Map<string, DesignerRecord>();
  let active: DesignerRecord | undefined;
  let destroyed = false;
  let selectionGeneration = 0;
  const current = () => !destroyed && input.isCurrent();
  function close() {
    for (const record of records) record.frame.hide();
    document.documentElement.style.overflow = originals;
    input.onClose();
  }
  function discard(record: DesignerRecord) {
    record.frame.destroy();
    records.delete(record);
    for (const [key, value] of choices) if (value === record) choices.delete(key);
  }
  async function show(group?: DesiredGroup, reset = false, targetProduct = input.source.productId) {
    const generation = ++selectionGeneration;
    if (!current()) return;
    const key = group ? desiredGroupKey(group, false, false) : undefined;
    const existing = reset ? undefined : key ? choices.get(key) : active;
    if (existing) {
      for (const record of records) if (record !== existing) record.frame.hide();
      active = existing;
      existing.frame.open();
      return;
    }
    let source = input.source;
    let canStart = true;
    let cartTargetAvailable = true;
    if (group || reset) {
      try {
        const currentSource = await api.config(undefined, group?.productId ?? targetProduct);
        source = currentSource;
      } catch {
        canStart = false;
      }
    }
    const options = { locale: input.locale, storeName: input.storeName };
    let mapped: ReturnType<typeof buildBuyerDesigner> | undefined;
    try {
      if (canStart) mapped = buildBuyerDesigner(source, options);
    } catch {
      canStart = false;
    }
    let record: DesignerRecord;
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
      onApplied(groups) {
        for (const other of records)
          if (other !== record) {
            other.live.rebase(groups);
            other.frame.reviewed();
          }
      },
      onReview(quote) {
        const selection = live.currentSelection();
        if (selection) choices.set(desiredGroupKey(selection, false, false), record);
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
        const observed = await live.observe();
        const exact = observed.groups.filter(
          (candidate) => desiredGroupKey(candidate, false, false) === desiredGroupKey(group, false, false),
        );
        if (exact.length !== 1 || !exact[0]) throw new Error('Cart selection changed');
        original = exact[0];
        if (!canStart || !mapped) throw new Error('Current configuration unavailable');
        const retained = reset ? null : await live.restoreSaved(original);
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
          initialArtworks: reset ? [] : await live.restoreArtwork(retained?.value ?? original),
        };
      } catch {
        repair = true;
      }
    }
    let canRemoveAll = !!original;
    if (repair && !original) {
      try {
        canRemoveAll = (await live.readCart()).customized.length > 0;
      } catch {
        /* Unknown cart contents confer no removal affordance. */
      }
    }
    if (!current() || generation !== selectionGeneration) return;
    const frame = createDesignerFrame({
      ...(mapped ? { config: mapped.config } : {}),
      title: canStart ? source.title : undefined,
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
        active = [...records][0];
        if (!active) await show();
        close();
      },

      wording: source.wording,
      ports: live.ports,
      locale: options.locale,
      requiresCartReview: !!group,
      ...restored,
      onClose: close,
      onSelectGroup(id) {
        const selection = live.selectionFor(id);
        if (!selection) return;
        void show(selection).catch(() => {
          active?.frame.error();
          input.onError();
        });
      },
    });
    record = { frame, live };
    records.add(record);
    if (key && !repair) choices.set(key, record);
    for (const other of records) if (other !== record) other.frame.hide();
    active = record;
  }
  if (input.repair) {
    const probe = createLiveDesignerPorts({ ...input, productId: input.source.productId });
    try {
      const observed = await probe.observe();
      const group = observed.groups.find((group) => group.productId === input.source.productId) ?? observed.groups[0];
      if (!group) throw new Error('Customized cart group unavailable');
      await show(group);
    } catch {
      // No owned choices are disclosed. Only an explicit journalled removal of observed customization is available.
      let canRemoveAll = false;
      try {
        canRemoveAll = (await probe.readCart()).customized.length > 0;
      } catch {
        /* Unknown cart contents. */
      }
      if (!current()) return { open: () => false, destroy() {} };
      const frame = createDesignerFrame({
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
          records.delete(record);
          active = undefined;
          await show();
          close();
        },
      });
      const record = { frame, live: probe };
      records.add(record);
      active = record;
    }
  } else await show();
  return {
    open() {
      active?.frame.open();
      return !!active;
    },
    destroy() {
      destroyed = true;
      for (const record of records) record.frame.destroy();
      document.documentElement.style.overflow = originals;
    },
  };
}
