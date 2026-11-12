import { BuyerDesignRestorationSchema, BuyerDesignResultSchema, type BuyerDesiredGroup } from '@insignia/contracts';
import { advisoryFingerprint } from '../buyer.ts';
import { desiredGroupKey } from './group-key.ts';

type Api = {
  private<T>(path: string, body: Record<string, unknown>, signal?: AbortSignal, method?: 'POST' | 'PUT'): Promise<T>;
};
/**
 * A UUID hint locates an owned retained draft; storage never supplies ownership or a configuration snapshot.
 * Beside it, an opaque fingerprint of the cart quantities the draft was based on detects later native cart edits.
 */
export function createSelectedDesignCustody(input: {
  api: Api;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  namespace: string;
}) {
  // Actor-local CAS metadata, never ownership or purchase authority. Restoration
  // always reads the server; changed writes still use its acknowledged version.
  const known = new Map<string, ReturnType<typeof BuyerDesignResultSchema.parse>>();
  const key = async (group: BuyerDesiredGroup) =>
    `insignia:selected-design:v1:${input.namespace}:${await advisoryFingerprint(desiredGroupKey(group, false, false))}`;
  // The cart quantities a draft was based on, as an opaque fingerprint. A cart that no longer has them
  // was edited natively since, and its quantities are the buyer's latest choice (#341).
  const baseKey = (id: string) => `insignia:selected-design-cart:v1:${input.namespace}:${id}`;
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
      input.storage.setItem(baseKey(id), '');
    },
    /** After Update cart the accepted cart line is the draft's new base. */
    async rebase(id: string, cart: BuyerDesiredGroup) {
      input.storage.setItem(baseKey(id), await quantities(cart));
    },
    async restore(group: BuyerDesiredGroup, signal?: AbortSignal, onHint?: (id: string) => void) {
      const id = input.storage.getItem(await key(group));
      if (!id) return null;
      // Track advisory custody even when its scoped read later enters repair.
      // This does not establish ownership or authorize deleting server data.
      onHint?.(id);
      const saved = await read(id, signal);
      if (!saved) return null;
      // Without a recorded base (an older draft) the draft keeps its quantities, as before.
      const base = input.storage.getItem(baseKey(id));
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
      input.storage.setItem(baseKey(id), base);
    },
  };
}
