import type { ArtworkStorage, MerchantPreviewStore } from '@insignia/application';
import { type GeometryV1, validateGeometry } from '@insignia/visualizer/geometry';

type Scope = { shopId: string; installationGeneration: string };
export type FrozenPreviewReader = ReturnType<typeof createFrozenPreviewReader>;
/** Callers authenticate the buyer/merchant and select the revision server-side.
 * Only immutable revision bindings supply keys; live catalog URLs never fill missing history. */
export function createFrozenPreviewReader(input: {
  store: Pick<MerchantPreviewStore, 'getForRevision'>;
  storage: Pick<ArtworkStorage, 'presignRead'>;
  clock?: () => Date;
}) {
  const clock = input.clock ?? (() => new Date());
  return async (
    scope: Scope,
    target: { productId: string; revisionId: string; geometry: GeometryV1; retainUntil?: Date },
  ) => {
    const now = clock();
    const expiresAt = new Date(Math.min(+now + 60000, +(target.retainUntil ?? new Date(+now + 60000))));
    if (!Number.isFinite(+expiresAt) || +expiresAt <= +now) return {};
    const geometry = validateGeometry(target.geometry);
    const references = geometry.views.flatMap((view) => [
      ...(view.image ? [view.image] : []),
      ...view.variantImages.map((item) => item.image),
    ]);
    // Frozen product imagery is optional; no lookup authority means no image URL.
    const rows = await input.store
      .getForRevision(scope, {
        productId: target.productId,
        revisionId: target.revisionId,
      })
      .catch(() => []);
    const urls: Record<string, string> = {};
    for (const row of rows) {
      const refs = references.filter((ref) => ref.revisionId === row.imageRevisionId);
      if (
        row.shopId !== scope.shopId ||
        row.installationGeneration !== scope.installationGeneration ||
        row.productId !== target.productId ||
        row.state !== 'USABLE' ||
        row.claimId !== null ||
        !row.manifest ||
        !refs.length ||
        refs.some((ref) => ref.width !== row.manifest?.width || ref.height !== row.manifest?.height) ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(row.assetId) ||
        row.previewKey !==
          `previews/merchant-previews/${scope.shopId}/${scope.installationGeneration}/${row.assetId}.png`
      )
        continue;
      try {
        urls[row.imageRevisionId] = await input.storage.presignRead({ key: row.previewKey, expiresAt });
      } catch {
        // Optional display failure cannot block a valid configuration or purchase view.
      }
    }
    return urls;
  };
}
