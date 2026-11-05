import type { CustomerArtworkView, createCustomerArtworkLinks } from '@insignia/application';
import { MerchantPresentationSchema } from '@insignia/contracts';
import type { DurableCore } from '@insignia/database';
import { buyerGeometry } from '../merchant-preview/geometry.ts';
import type { FrozenPreviewReader } from '../merchant-preview/read.ts';
import { publicSelectedSetup } from '../merchant-preview/selected-public.ts';
import { canonicalCustomerArtworkPresentation } from './canonical-presentation.ts';
import { scopeCustomerArtworkGeometry, scopeCustomerArtworkPresentation } from './presentation.ts';

/** Frozen missing-slot projection only; customer authority never exposes economics or existing originals. */
export function createCustomerArtworkViewReader(input: {
  core: DurableCore;
  links: ReturnType<typeof createCustomerArtworkLinks>;
  previewImages: FrozenPreviewReader;
}) {
  return async function customerView(capability: string) {
    const view = await input.links.resolve(capability);
    const scope = await input.links.scope(capability);
    const purchase = await input.core.purchases.get(scope, view.purchaseId);
    if (!purchase) throw new Error('CUSTOMER_ARTWORK_UNAVAILABLE');
    const configurations = [];
    let groupIndex = 0;
    const unwrap = (value: unknown) => (value && typeof value === 'object' && 'value' in value ? value.value : value);
    for (const binding of purchase.bindings) {
      const payload = binding.designPayload;
      if (!payload) throw new Error('CUSTOMER_ARTWORK_UNAVAILABLE');
      for (const { group } of payload.request.groups) {
        const currentIndex = groupIndex++;
        const slots = view.slots.filter((slot) => slot.groupIndex === currentIndex);
        if (!slots.length) continue;
        const revision = payload.revisions.find((revision) => revision.revisionId === group.configRevisionId);
        const parsed = MerchantPresentationSchema.safeParse(unwrap(revision?.presentation));
        if (!revision || !parsed.success) throw new Error('CUSTOMER_ARTWORK_PREVIEW_UNAVAILABLE');
        const originalGeometry = buyerGeometry(unwrap(revision.geometry) as Parameters<typeof buyerGeometry>[0]);
        const base = scopeCustomerArtworkGeometry(originalGeometry, group, slots);
        const imageUrls = await input.previewImages(scope, {
          productId: group.productId,
          revisionId: group.configRevisionId,
          geometry: base.geometry,
          retainUntil: new Date(binding.payloadExpiresAt),
        });
        const scoped = parsed.data.selectedSetup
          ? scopeCustomerArtworkPresentation(parsed.data.selectedSetup, originalGeometry, group, slots)
          : canonicalCustomerArtworkPresentation({
              productId: group.productId,
              presentation: parsed.data,
              geometry: originalGeometry,
              group,
              slots,
              imageUrls,
            });
        const presentation =
          'selectedSetup' in scoped
            ? { selectedSetup: publicSelectedSetup(scoped.selectedSetup, scoped.geometry, imageUrls) }
            : { readProduct: scoped.readProduct, stepBindings: scoped.stepBindings };
        configurations.push({
          groupIndex: currentIndex,
          productId: group.productId,
          revisionId: group.configRevisionId,
          ...presentation,
          contentHash: group.revisionContentHash,
          geometry: scoped.geometry,
          variantIds: scoped.variantIds,
          positions: scoped.positions,
          slots,
        });
      }
    }
    const wording = await input.core.transactions.run((tx) => input.core.preferences.readWording(tx, scope));
    if (!wording) throw new Error('CUSTOMER_ARTWORK_UNAVAILABLE');
    return { ...view, currency: purchase.currency, wording, configurations };
  };
}
export type CustomerArtworkPublicView = CustomerArtworkView &
  Awaited<ReturnType<ReturnType<typeof createCustomerArtworkViewReader>>>;

/** Shared production binding: capability views require real immutable captured imagery. */
export async function createCustomerArtworkRuntimeView(input: {
  core: DurableCore;
  links: ReturnType<typeof createCustomerArtworkLinks>;
  env: NodeJS.ProcessEnv;
}) {
  if (!input.env.ARTWORK_STORAGE_PROFILE) return undefined;
  const { loadArtworkStorageProfile } = await import('@insignia/storage');
  const { createFrozenPreviewReader } = await import('../merchant-preview/read.ts');
  const storage = await loadArtworkStorageProfile(input.env.ARTWORK_STORAGE_PROFILE, {
    endpoint: input.env.ARTWORK_R2_ENDPOINT ?? '',
    bucket: input.env.ARTWORK_R2_BUCKET ?? '',
    prefix: input.env.ARTWORK_R2_PREFIX ?? '',
  });
  return createCustomerArtworkViewReader({
    core: input.core,
    links: input.links,
    previewImages: createFrozenPreviewReader({ store: input.core.merchantPreviews, storage }),
  });
}
