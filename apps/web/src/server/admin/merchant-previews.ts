import { createHash } from 'node:crypto';
import {
  type ArtworkInspection,
  type ArtworkStorage,
  createMerchantPreviewCapture,
  type MerchantPreviewStore,
} from '@insignia/application';
import type { CatalogProduct } from '@insignia/shopify';
import type { GeometryV1 } from '@insignia/visualizer/geometry';
import type { createMerchantConfigService } from '../merchant-config.js';
import type { AdminActor } from './contracts.js';

export type PublicationPreviewCapture = NonNullable<
  Parameters<typeof createMerchantConfigService>[0]['capturePublicationPreviews']
>;
/** Authenticated server composition only. No browser URL/key/inspection authority. */
export function createMerchantPublicationCapture(input: {
  store: MerchantPreviewStore;
  storage(): Promise<ArtworkStorage>;
  current(actor: AdminActor): Promise<void>;
  readProduct(actor: AdminActor, productId: string): Promise<CatalogProduct | null>;
  readImage(product: CatalogProduct, imageRevisionId: string): Promise<Uint8Array | null>;
  inspect(bytes: Uint8Array): Promise<ArtworkInspection>;
}): PublicationPreviewCapture {
  return async (actor, request) => {
    const scope = {
      shopId: actor.tenantShopId,
      installationGeneration: actor.installationGeneration,
      kind: 'merchant' as const,
    };
    const deadline = Math.min(actor.expiresAtMs, Date.now() + 60_000);
    async function current() {
      if (
        !actor.canRead ||
        !actor.canEdit ||
        Date.now() >= deadline ||
        actor.tenantShopId !== scope.shopId ||
        actor.installationGeneration !== scope.installationGeneration
      )
        throw new Error('Publication preview authorization unavailable');
      await input.current(actor);
    }
    await current();
    const productId = /^gid:\/\/shopify\/Product\/([1-9][0-9]{0,19})$/.exec(request.productId)?.[1];
    if (!productId) throw new Error('Publication preview product unavailable');
    const images = new Map<string, { width: number; height: number }>();
    for (const view of (request.draft.geometry as GeometryV1).views) {
      for (const image of [...(view.image ? [view.image] : []), ...view.variantImages.map((v) => v.image)]) {
        const previous = images.get(image.revisionId);
        if (previous && (previous.width !== image.width || previous.height !== image.height))
          throw new Error('Publication preview dimensions conflict');
        images.set(image.revisionId, { width: image.width, height: image.height });
      }
    }
    if (!images.size) return [];
    const storage = await input.storage();
    await current();
    let product: Promise<CatalogProduct | null> | undefined;
    const bindings: { imageRevisionId: string; assetId: string }[] = [];
    // Fixed order and a deterministic command/image identity preserve partial-capture custody.
    for (const [imageRevisionId, dimensions] of [...images.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      await current();
      const hex = createHash('sha256')
        .update(
          JSON.stringify([
            'merchant-preview-v1',
            scope.shopId,
            scope.installationGeneration,
            request.configId,
            request.draftVersion,
            request.idempotencyKey,
            productId,
            imageRevisionId,
          ]),
        )
        .digest('hex')
        .slice(0, 32);
      const assetId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      const capture = createMerchantPreviewCapture({
        store: input.store,
        storage,
        readImage: async (owned, id, ref) => {
          if (
            owned.shopId !== scope.shopId ||
            owned.installationGeneration !== scope.installationGeneration ||
            id !== productId ||
            ref !== imageRevisionId
          )
            throw new Error('Publication preview scope changed');
          await current();
          product ??= input.readProduct(actor, request.productId);
          const source = await product;
          if (!source || source.id !== request.productId) throw new Error('Publication preview product unavailable');
          const bytes = await input.readImage(source, ref);
          await current();
          return bytes;
        },
        inspect: async (bytes) => {
          const result = await input.inspect(bytes);
          await current();
          if (result.width !== dimensions.width || result.height !== dimensions.height)
            throw new Error('Product image dimensions changed. Review the draft before publication.');
          return result;
        },
      });
      const row = await capture.capture(scope, { assetId, productId, imageRevisionId });
      await current();
      if (row) {
        if (row.manifest?.width !== dimensions.width || row.manifest.height !== dimensions.height)
          throw new Error('Publication preview dimensions conflict');
        bindings.push({ imageRevisionId, assetId });
      }
    }
    return bindings;
  };
}
