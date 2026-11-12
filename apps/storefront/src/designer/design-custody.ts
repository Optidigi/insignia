import {
  BuyerDesignRestorationSchema,
  BuyerDesignResultSchema,
  type BuyerDesiredGroup,
  type BuyerDraftGroup,
} from '@insignia/contracts';
import { advisoryFingerprint } from '../buyer.ts';
import { desiredGroupKey } from './group-key.ts';

type Api = {
  private<T>(path: string, body: Record<string, unknown>, signal?: AbortSignal, method?: 'POST' | 'PUT'): Promise<T>;
};
type SharedStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
/**
 * A UUID hint locates an owned retained draft; storage never supplies ownership or a configuration snapshot.
 * Beside it, an unsalted SHA-256 of the cart quantities the draft was based on detects later native cart edits;
 * it reveals nothing beyond what /cart.js shows this origin and grants nothing.
 *
 * Those hints, keyed by a cart line's contents, and their bases stay in this tab (`storage`). Only the latest
 * unfinished new design per product (its UUID and the buyer session it belongs to) lives in `shared` storage beside
 * the buyer session (buyer-session.ts), so a reload, another page or another tab can offer to continue it (#347).
 * It expires with that session: a pointer of any other session is removed.
 */
export function createSelectedDesignCustody(input: {
  api: Api;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  namespace: string;
  /** Storage every tab shares; without it no latest design is kept. */
  shared?: SharedStorage;
  /** The current buyer session's ID, if this browser holds one. */
  session?: () => string | undefined;
}) {
  // Actor-local CAS metadata, never ownership or purchase authority. Restoration
  // always reads the server; changed writes still use its acknowledged version.
  const known = new Map<string, ReturnType<typeof BuyerDesignResultSchema.parse>>();
  // Per draft, the groups this tab sent whose writes were never acknowledged: the server may still have applied them.
  const unacknowledged = new Map<string, Set<string>>();
  // Per draft, the save in progress; the next save of that draft waits for it.
  const saving = new Map<string, Promise<void>>();
  const key = async (group: BuyerDesiredGroup) =>
    `insignia:selected-design:v1:${input.namespace}:${await advisoryFingerprint(desiredGroupKey(group, false, false))}`;
  // The cart quantities a draft was based on, as a SHA-256 of sorted [variantId, quantity] pairs. A cart that no longer has them
  // was edited natively since, and its quantities are the buyer's latest choice (#341).
  const baseKey = (id: string) => `insignia:selected-design-cart:v1:${input.namespace}:${id}`;
  const shared = input.shared;
  // Shared storage can be full or blocked; a hint it cannot hold is simply absent.
  const attempt = (write: () => void) => {
    try {
      write();
    } catch {
      /* The draft itself is saved on the server. */
    }
  };
  // One per product under the App Proxy mount (a locale prefix shares it), like the buyer session.
  const latestPrefix = `insignia:selected-design-latest:v1:${input.namespace.slice(input.namespace.lastIndexOf('/apps/'))}:`;
  const latestKey = (productId: string) => `${latestPrefix}${productId}`;
  /** A stored pointer's draft UUID while it belongs to the current session. */
  function current(value: string | null, session: string | undefined) {
    try {
      const parsed: unknown = JSON.parse(value ?? 'null');
      return session &&
        parsed &&
        typeof parsed === 'object' &&
        'session' in parsed &&
        parsed.session === session &&
        'id' in parsed &&
        typeof parsed.id === 'string'
        ? parsed.id
        : undefined;
    } catch {
      return undefined;
    }
  }
  /**
   * The latest unfinished design's UUID for this product. Every pointer of this mount that does not belong to the
   * current session is removed first, so products never reopened keep none either.
   */
  function latestId(productId: string) {
    if (!shared) return undefined;
    const session = input.session?.();
    attempt(() => {
      const stale: string[] = [];
      for (let index = 0; index < shared.length; index++) {
        const key = shared.key(index);
        if (key?.startsWith(latestPrefix) && !current(shared.getItem(key), session)) stale.push(key);
      }
      for (const key of stale) shared.removeItem(key);
    });
    try {
      return current(shared.getItem(latestKey(productId)), session);
    } catch {
      return undefined;
    }
  }
  function forgetLatest(productId: string, id: string) {
    if (shared && latestId(productId) === id) attempt(() => shared.removeItem(latestKey(productId)));
  }
  const quantities = (group: BuyerDesiredGroup) =>
    advisoryFingerprint(
      JSON.stringify(
        group.variants
          .map((variant) => [variant.variantId, variant.quantity] as const)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
      ),
    );
  async function read(id: string, signal?: AbortSignal) {
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) return null;
    try {
      const saved = BuyerDesignRestorationSchema.parse(await input.api.private(`designs/${id}/restore`, {}, signal));
      known.set(id, saved);
      return saved;
    } catch (error) {
      known.delete(id);
      if (error && typeof error === 'object' && 'status' in error && error.status === 404) return null;
      throw error;
    }
  }
  return {
    async forget(id: string, group: BuyerDesiredGroup) {
      const pointer = await key(group);
      if (input.storage.getItem(pointer) === id) input.storage.setItem(pointer, '');
      if (input.storage.getItem(baseKey(id))) input.storage.setItem(baseKey(id), '');
      forgetLatest(group.productId, id);
    },
    /** After Update cart the accepted cart line is the draft's new base. */
    async rebase(id: string, cart: BuyerDesiredGroup) {
      input.storage.setItem(baseKey(id), await quantities(cart));
    },
    /** Whether this product has an unfinished design of the current session to offer; reads no server. */
    hasLatest: (productId: string) => latestId(productId) !== undefined,
    /**
     * The product's latest unfinished new design, read from the server. Null, and the hint dropped, when it
     * belongs to another session or the server no longer has it; other failures reject and keep the hint.
     */
    async latest(productId: string, signal?: AbortSignal) {
      const id = latestId(productId);
      if (!id) return null;
      const saved = await read(id, signal);
      if (!saved || saved.value.productId !== productId) {
        forgetLatest(productId, id);
        return null;
      }
      return saved;
    },
    /** The design is in the cart now (or abandoned): it is no longer the product's unfinished design. */
    forgetLatest,
    async restore(group: BuyerDesiredGroup, signal?: AbortSignal, onHint?: (id: string) => void) {
      const id = input.storage.getItem(await key(group));
      if (!id) return null;
      // Track advisory custody even when its scoped read later enters repair.
      // This does not establish ownership or authorize deleting server data.
      onHint?.(id);
      const saved = await read(id, signal);
      if (!saved) return null;
      // Without a recorded base (an older draft) the draft keeps its quantities, as before. Only the
      // current quantities are compared: a draft at 4 on base 2 still wins after the cart goes
      // 2 -> 3 -> 2, since the cart again holds what the draft's edit started from. That is intended.
      const base = input.storage.getItem(baseKey(id));
      return { ...saved, cartQuantitiesChanged: !!base && base !== (await quantities(group)) };
    },
    /**
     * Saves of one draft run one after another, in call order, so a debounced autosave and a Review's save never
     * race each other's CAS version (#366). With `onlyChanges` (autosave), a design the server already holds writes
     * nothing at all: its hints and reopen pointer stay as they are, even if another tab has dropped the pointer.
     */
    save(
      id: string,
      group: BuyerDraftGroup,
      original: BuyerDesiredGroup | undefined,
      signal?: AbortSignal,
      options: { onlyChanges?: boolean } = {},
    ) {
      const run = (saving.get(id) ?? Promise.resolve()).then(() => {
        const saved = known.get(id);
        if (options.onlyChanges && saved && desiredGroupKey(saved.value) === desiredGroupKey(group)) return;
        return write(id, group, original, signal);
      });
      const settled = run.then(
        () => {},
        () => {},
      );
      saving.set(id, settled);
      void settled.then(() => {
        if (saving.get(id) === settled) saving.delete(id);
      });
      return run;
    },
  };
  async function write(
    id: string,
    group: BuyerDraftGroup,
    original: BuyerDesiredGroup | undefined,
    signal?: AbortSignal,
  ) {
    // Unknown UUIDs can only create with CAS0; they never overwrite a row.
    // Conflict/lost-response recovery performs the scoped ownership read.
    const saved = known.get(id);
    const wanted = desiredGroupKey(group);
    let expectedVersion = saved?.version ?? 0;
    if (!saved || desiredGroupKey(saved.value) !== wanted)
      for (let replaced = false; ; replaced = true) {
        try {
          const acknowledged = BuyerDesignResultSchema.parse(
            await input.api.private(`designs/${id}`, { expectedVersion, group }, signal, 'PUT'),
          );
          known.set(id, acknowledged);
          unacknowledged.delete(id);
          break;
        } catch (error) {
          known.delete(id);
          const sent = unacknowledged.get(id) ?? new Set<string>();
          unacknowledged.set(id, sent.add(wanted));
          if (signal?.aborted) throw error;
          // Lost acknowledgement is recovered through the same owned UUID, never an unconditional rewrite.
          const observed = await read(id, signal);
          if (observed && desiredGroupKey(observed.value) === wanted) {
            unacknowledged.delete(id);
            break;
          }
          // The owned draft holds a write this tab sent without an answer, typically a preparation cancelled
          // by the buyer's next edit (#371): it is older than this one, so replace it once at its version.
          if (replaced || !observed || !sent.has(desiredGroupKey(observed.value))) throw error;
          expectedVersion = observed.version;
        }
      }
    const pointer = await key(group);
    const originalPointer = original ? await key(original) : undefined;
    const base = original ? await quantities(original) : '';
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    input.storage.setItem(pointer, id);
    if (originalPointer) input.storage.setItem(originalPointer, id);
    input.storage.setItem(baseKey(id), base);
    // A design not yet in the cart becomes the product's latest unfinished one, for this session only.
    const session = input.session?.();
    if (!original && shared && session)
      attempt(() => shared.setItem(latestKey(group.productId), JSON.stringify({ session, id })));
  }
}
