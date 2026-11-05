import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createMerchantPreviewCapture } from '@insignia/application';
import type { DurableCore } from '@insignia/database';
import type { AdminActor } from '../../../src/server/admin/contracts.js';
import { readGeometry } from './merchant-draft.mts';

/** Explicit synthetic image/inspection/storage ports, with real scoped PG capture lifecycle and revision bindings. */
export async function captureSyntheticPublicationPreviews(
  core: DurableCore,
  actor: Pick<AdminActor, 'tenantShopId' | 'installationGeneration'>,
  input: { productId: string; draft: { geometry: unknown } },
  assetIdentity: (imageRevisionId: string) => string = () => randomUUID(),
) {
  const geometry = readGeometry(input.draft.geometry);
  const images = new Map(
    geometry.views.flatMap((view) =>
      [...(view.image ? [view.image] : []), ...view.variantImages.map((value) => value.image)].map(
        (image) => [image.revisionId, image] as const,
      ),
    ),
  );
  const productId = input.productId.split('/').at(-1);
  assert(productId);
  const scope = {
    kind: 'merchant' as const,
    shopId: actor.tenantShopId,
    installationGeneration: actor.installationGeneration,
  };
  const bindings: { imageRevisionId: string; assetId: string }[] = [];
  for (const image of images.values()) {
    // The inspector is a declared boundary double; these tests exercise durable capture/publication, not decoding.
    const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const objects = new Map<string, Uint8Array>();
    const capture = createMerchantPreviewCapture({
      store: core.merchantPreviews,
      storage: {
        async putImmutable({ key, bytes }) {
          objects.set(key, Uint8Array.from(bytes));
        },
        async read({ key }) {
          const value = objects.get(key);
          assert(value);
          return value;
        },
        async remove({ key }) {
          objects.delete(key);
        },
      },
      async readImage(target, product, revision) {
        assert.deepEqual(target, scope);
        assert.equal(product, productId);
        assert.equal(revision, image.revisionId);
        return bytes;
      },
      async inspect(original) {
        return {
          version: 'm6-inspection-v1',
          mimeType: 'image/png',
          width: image.width,
          height: image.height,
          originalSha256: createHash('sha256').update(original).digest('hex'),
          preview: bytes,
          previewMimeType: 'image/png',
        };
      },
    });
    const assetId = assetIdentity(image.revisionId);
    const row = await capture.capture(scope, { productId, imageRevisionId: image.revisionId, assetId });
    assert(row);
    assert.equal(row.state, 'USABLE');
    assert.equal(row.claimId, null);
    bindings.push({ imageRevisionId: image.revisionId, assetId });
  }
  return bindings;
}
