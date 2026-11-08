import { BuyerDesignRestorationSchema, BuyerDesignResultSchema, type BuyerDesiredGroup } from '@insignia/contracts';
import { advisoryFingerprint } from '../buyer.ts';
import { desiredGroupKey } from './group-key.ts';

type Api = {
  private<T>(path: string, body: Record<string, unknown>, signal?: AbortSignal, method?: 'POST' | 'PUT'): Promise<T>;
};
/** A UUID hint locates an owned retained draft; storage never supplies ownership or a configuration snapshot. */
export function createSelectedDesignCustody(input: {
  api: Api;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  namespace: string;
}) {
  const key = async (group: BuyerDesiredGroup) =>
    `insignia:selected-design:v1:${input.namespace}:${await advisoryFingerprint(desiredGroupKey(group, false, false))}`;
  async function read(id: string, signal?: AbortSignal) {
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) return null;
    try {
      return BuyerDesignRestorationSchema.parse(await input.api.private(`designs/${id}/restore`, {}, signal));
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && error.status === 404) return null;
      throw error;
    }
  }
  return {
    async forget(id: string, group: BuyerDesiredGroup) {
      const pointer = await key(group);
      if (input.storage.getItem(pointer) === id) input.storage.setItem(pointer, '');
    },
    async restore(group: BuyerDesiredGroup, signal?: AbortSignal) {
      const id = input.storage.getItem(await key(group));
      if (!id) return null;
      return read(id, signal);
    },
    async save(id: string, group: BuyerDesiredGroup, original: BuyerDesiredGroup | undefined, signal?: AbortSignal) {
      const saved = await read(id, signal);
      if (!saved || desiredGroupKey(saved.value) !== desiredGroupKey(group)) {
        try {
          BuyerDesignResultSchema.parse(
            await input.api.private(`designs/${id}`, { expectedVersion: saved?.version ?? 0, group }, signal, 'PUT'),
          );
        } catch (error) {
          if (signal?.aborted) throw error;
          // Lost acknowledgement is recovered through the same owned UUID, never an unconditional rewrite.
          const observed = await read(id, signal);
          if (!observed || desiredGroupKey(observed.value) !== desiredGroupKey(group)) throw error;
        }
      }
      const pointer = await key(group);
      const originalPointer = original ? await key(original) : undefined;
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      input.storage.setItem(pointer, id);
      if (originalPointer) input.storage.setItem(originalPointer, id);
    },
  };
}
