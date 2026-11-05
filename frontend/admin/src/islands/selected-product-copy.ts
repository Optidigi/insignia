import { MerchantPreferencesViewSchema, placementProductSchema } from '@insignia/contracts';
import { z } from 'zod';
import type { PlacementSetupCopyPorts } from '../../examples/admin/support/placement-setup-copy-dialog.tsx';
import { authenticatedJson } from '../shared/admin-request.ts';
import type { ConfigView } from '../shared/admin-view.ts';
import { createSelectedProductClient } from './selected-product-client.ts';
import { selectedProductFromConfig } from './selected-product-view.ts';

type Request = (path: string, init?: RequestInit) => Promise<unknown>;
type Custody = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const catalogPage = z.object({
  products: z.array(z.object({ id: z.string().regex(/^gid:\/\/shopify\/Product\/[1-9][0-9]*$/) })).max(100),
  nextCursor: z.string().max(4096).nullable(),
});

/** Loads real snapshots and saves independent copies using each target's original CAS/journal. */
export function createSelectedProductCopyPorts(input: {
  storage: Custody;
  request?: Request;
}): PlacementSetupCopyPorts {
  const request = input.request ?? authenticatedJson;
  let scope: string | null = null;
  let authority: z.infer<typeof MerchantPreferencesViewSchema> | null = null;
  const entries = new Map<string, { view: ConfigView; client: ReturnType<typeof createSelectedProductClient> }>();
  const pendingIntentKey = (id: string) => `insignia:selected-copy-intent:v1:${scope}:${id}`;
  const copyCustody: Custody = {
    getItem: (key) => input.storage.getItem(`copy:${key}`),
    setItem: (key, value) => input.storage.setItem(`copy:${key}`, value),
    removeItem: (key) => input.storage.removeItem(`copy:${key}`),
  };
  const editorPending = (id: string) =>
    !!authority && !!input.storage.getItem(`insignia:selected-product-write:v1:${authority.shop}:${id}`);
  return {
    scope: () => scope,
    reportStorage: input.storage,
    async loadCatalog(signal) {
      authority = MerchantPreferencesViewSchema.parse(await request('/api/admin/preferences', { signal }));
      scope = `${authority.shop}:${authority.authority}`;
      entries.clear();
      const ids: string[] = [],
        seen = new Set<string>(),
        cursors = new Set<string>();
      let cursor: string | null = null;
      do {
        signal.throwIfAborted();
        const query = new URLSearchParams({ limit: '20' });
        if (cursor) query.set('cursor', cursor);
        const page = catalogPage.parse(await request(`/api/admin/products?${query}`, { signal }));
        for (const product of page.products) {
          if (seen.has(product.id)) throw new Error('Duplicate catalog product');
          seen.add(product.id);
          ids.push(product.id);
        }
        cursor = page.nextCursor;
        if (cursor && cursors.has(cursor)) throw new Error('Catalog cursor did not advance');
        if (cursor) cursors.add(cursor);
      } while (cursor);
      const capturedAuthority = authority;
      const scopedRequest: Request = (path, init) =>
        path === '/api/admin/preferences'
          ? Promise.resolve(capturedAuthority)
          : request(path, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal });
      let index = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, ids.length) }, async () => {
          while (index < ids.length) {
            const id = ids[index++];
            if (!id) break;
            signal.throwIfAborted();
            const client = createSelectedProductClient({ productId: id, storage: copyCustody, request: scopedRequest });
            const view = await client.load();
            entries.set(id, { view, client });
          }
        }),
      );
      return ids.map((id) => {
        const entry = entries.get(id);
        if (!entry) throw new Error('Catalog product unavailable');
        return selectedProductFromConfig(entry.view);
      });
    },
    inspect(product) {
      const entry = entries.get(product.id);
      if (!entry) return { product, readiness: 'unavailable' };
      if (editorPending(product.id)) return { product, readiness: 'unavailable' };
      if (entry.client.hasPending()) {
        if (!input.storage.getItem(pendingIntentKey(product.id))) return { product, readiness: 'unavailable' };
        // This represents only a resumable copy intent; save() may replay that exact request, never replace it.
        return { product: { ...product, views: [] }, readiness: 'ready' };
      }
      const value = selectedProductFromConfig(entry.view);
      const publication = entry.view.config?.publication;
      return {
        product: value,
        readiness:
          value.views.length || publication?.revisionId || publication?.activeRevisionId ? 'configured' : 'ready',
      };
    },
    async save(value, intent) {
      const product = placementProductSchema.parse(value);
      const entry = entries.get(product.id);
      if (!entry || !authority) throw new Error('Load the target before copying');
      const current = MerchantPreferencesViewSchema.parse(await request('/api/admin/preferences'));
      if (current.shop !== authority.shop || current.authority !== authority.authority)
        throw new Error('Copy authority changed; reopen the dialog');
      if (editorPending(product.id)) throw new Error('Reconcile the target editor write before copying');
      const signature = JSON.stringify(intent);
      if (entry.client.hasPending()) {
        if (input.storage.getItem(pendingIntentKey(product.id)) !== signature)
          throw new Error('Resolve the original copy intent before changing source or options');
        entry.view = await entry.client.retry();
        if (!entry.client.hasPending()) input.storage.removeItem(pendingIntentKey(product.id));
        return;
      }
      const before = selectedProductFromConfig(entry.view);
      if (
        before.views.length ||
        entry.view.config?.publication.revisionId ||
        entry.view.config?.publication.activeRevisionId
      )
        throw new Error('Target is already configured');
      input.storage.setItem(pendingIntentKey(product.id), signature);
      // Copy is an explicit independent snapshot, not inferred catalog inheritance.
      entry.view = await entry.client.save({ version: 'selected-product-setup-v1', product, methodBindings: {} });
      if (!entry.client.hasPending()) input.storage.removeItem(pendingIntentKey(product.id));
    },
  };
}
