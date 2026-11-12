import { BuyerDesignRestorationSchema, BuyerDesignResultSchema, type BuyerDesiredGroup } from '@insignia/contracts';
import { advisoryFingerprint } from '../buyer.ts';
import { desiredGroupKey } from './group-key.ts';

type Api = {
  private<T>(path: string, body: Record<string, unknown>, signal?: AbortSignal, method?: 'POST' | 'PUT'): Promise<T>;
};
type SharedStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
/**
 * A UUID hint locates an owned retained draft; storage never supplies ownership or a configuration snapshot.
 * Beside it, an unsalted SHA-256 of the cart quantities the draft was based on detects later native cart edits;
 * it reveals nothing beyond what /cart.js shows this origin and grants nothing.
 *
 * Hints keyed by a cart line's contents stay in this tab (`storage`). The quantity base and, per product, the
 * latest unfinished new design (its UUID and the buyer session it belongs to) live in `shared` storage beside
 * the buyer session (buyer-session.ts), so a reload, another page or another tab can offer to continue it (#347).
 */
export function createSelectedDesignCustody(input: {
  api: Api;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  namespace: string;
  /** Storage every tab shares; without it the base stays in `storage` and no latest design is kept. */
  shared?: SharedStorage;
  /** The current buyer session's ID, if this browser holds one. */
  session?: () => string | undefined;
}) {
  // Actor-local CAS metadata, never ownership or purchase authority. Restoration
  // always reads the server; changed writes still use its acknowledged version.
  const known = new Map<string, ReturnType<typeof BuyerDesignResultSchema.parse>>();
  const key = async (group: BuyerDesiredGroup) =>
    `insignia:selected-design:v1:${input.namespace}:${await advisoryFingerprint(desiredGroupKey(group, false, false))}`;
  // The cart quantities a draft was based on, as a SHA-256 of sorted [variantId, quantity] pairs. A cart that no longer has them
  // was edited natively since, and its quantities are the buyer's latest choice (#341).
  const baseKey = (id: string) => `insignia:selected-design-cart:v1:${input.namespace}:${id}`;
  const shared = input.shared;
  const baseStorage = shared ?? input.storage;
  // Shared storage can be full or blocked; a hint it cannot hold is simply absent.
  const attempt = (write: () => void) => {
    try {
      write();
    } catch {
      /* The draft itself is saved on the server. */
    }
  };
  const setBase = (id: string, value: string) =>
    attempt(() =>
      shared
        ? value
          ? shared.setItem(baseKey(id), value)
          : shared.removeItem(baseKey(id))
        : input.storage.setItem(baseKey(id), value),
    );
  // One per product under the App Proxy mount (a locale prefix shares it), like the buyer session.
  const latestKey = (productId: string) =>
    `insignia:selected-design-latest:v1:${input.namespace.slice(input.namespace.lastIndexOf('/apps/'))}:${productId}`;
  /** The latest unfinished design's UUID while it belongs to the current session; any other value is removed. */
  function latestId(productId: string) {
    if (!shared) return undefined;
    let value: unknown;
    try {
      value = JSON.parse(shared.getItem(latestKey(productId)) ?? 'null');
    } catch {
      value = undefined;
    }
    if (value === null) return undefined;
    const session = input.session?.();
    if (
      value &&
      typeof value === 'object' &&
      'session' in value &&
      'id' in value &&
      typeof value.id === 'string' &&
      session &&
      value.session === session
    )
      return value.id;
    attempt(() => shared.removeItem(latestKey(productId)));
    return undefined;
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
      if (baseStorage.getItem(baseKey(id))) setBase(id, '');
      forgetLatest(group.productId, id);
    },
    /** After Update cart the accepted cart line is the draft's new base. */
    async rebase(id: string, cart: BuyerDesiredGroup) {
      setBase(id, await quantities(cart));
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
      const base = baseStorage.getItem(baseKey(id));
      return { ...saved, cartQuantitiesChanged: !!base && base !== (await quantities(group)) };
    },
    async save(id: string, group: BuyerDesiredGroup, original: BuyerDesiredGroup | undefined, signal?: AbortSignal) {
      // Unknown UUIDs can only create with CAS0; they never overwrite a row.
      // Conflict/lost-response recovery performs the scoped ownership read.
      const saved = known.get(id);
      if (!saved || desiredGroupKey(saved.value) !== desiredGroupKey(group)) {
        try {
          const acknowledged = BuyerDesignResultSchema.parse(
            await input.api.private(`designs/${id}`, { expectedVersion: saved?.version ?? 0, group }, signal, 'PUT'),
          );
          known.set(id, acknowledged);
        } catch (error) {
          known.delete(id);
          if (signal?.aborted) throw error;
          // Lost acknowledgement is recovered through the same owned UUID, never an unconditional rewrite.
          const observed = await read(id, signal);
          if (!observed || desiredGroupKey(observed.value) !== desiredGroupKey(group)) throw error;
        }
      }
      const pointer = await key(group);
      const originalPointer = original ? await key(original) : undefined;
      const base = original ? await quantities(original) : '';
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      input.storage.setItem(pointer, id);
      if (originalPointer) input.storage.setItem(originalPointer, id);
      setBase(id, base);
      // A design not yet in the cart becomes the product's latest unfinished one, for this session only.
      const session = input.session?.();
      if (!original && shared && session)
        attempt(() => shared.setItem(latestKey(group.productId), JSON.stringify({ session, id })));
    },
  };
}
