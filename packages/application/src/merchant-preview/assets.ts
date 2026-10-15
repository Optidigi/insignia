import { createHash, randomUUID } from 'node:crypto';
import type { ArtworkInspection, ArtworkManifest, ArtworkStorage } from '../artwork/artwork.js';

export type MerchantPreviewScope = { shopId: string; installationGeneration: string; kind: 'merchant' };
export type MerchantPreviewState = 'PREPARING' | 'WRITING' | 'USABLE' | 'RETIRED' | 'DELETING' | 'DELETED';
export type MerchantPreviewRecord = {
  assetId: string;
  shopId: string;
  installationGeneration: string;
  productId: string;
  imageRevisionId: string;
  originalKey: string;
  previewKey: string;
  manifest: ArtworkManifest | null;
  collectedAt: Date;
  abandonAt: Date;
  state: MerchantPreviewState;
  claimId: string | null;
};
/** No expired lease may turn an unresolved storage writer into a cleanup candidate. */
export interface MerchantPreviewStore {
  getForRevision(
    scope: Pick<MerchantPreviewScope, 'shopId' | 'installationGeneration'>,
    target: { productId: string; revisionId: string },
  ): Promise<MerchantPreviewRecord[]>;
  get(scope: MerchantPreviewScope, assetId: string): Promise<MerchantPreviewRecord | null>;
  prepare(scope: MerchantPreviewScope, row: MerchantPreviewRecord): Promise<MerchantPreviewRecord>;
  beginCapture(scope: MerchantPreviewScope, assetId: string, claimId: string, now: Date): Promise<boolean>;
  finishCapture(
    scope: MerchantPreviewScope,
    assetId: string,
    claimId: string,
    now: Date,
  ): Promise<MerchantPreviewRecord>;
  selectCleanup(limit: number, now: Date): Promise<string[]>;
  markDeleting(assetId: string, now: Date): Promise<MerchantPreviewRecord | null>;
  readDeleting(assetId: string): Promise<MerchantPreviewRecord | null>;
  finishDeleting(assetId: string, now: Date): Promise<void>;
}
export class MerchantPreviewError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT' | 'UNRESOLVED' | 'UNAVAILABLE') {
    super(`Merchant preview: ${code}`);
  }
}
export type MerchantPreviewCaptureInputs = {
  store: MerchantPreviewStore;
  storage: Pick<ArtworkStorage, 'read' | 'putImmutable' | 'remove'>;
  readImage(scope: MerchantPreviewScope, productId: string, imageRevisionId: string): Promise<Uint8Array | null>;
  inspect(bytes: Uint8Array): Promise<ArtworkInspection>;
  clock?: () => Date;
  /** A host reporter enables independent per-row cleanup; unresolved rows retain custody. */
  onCleanupError?: (code: 'MERCHANT_PREVIEW_CLEANUP_UNAVAILABLE') => void;
};
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function fail(code: ConstructorParameters<typeof MerchantPreviewError>[0]): never {
  throw new MerchantPreviewError(code);
}
const pngHeader = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
function identity(
  scope: MerchantPreviewScope,
  request: { assetId: string; productId: string; imageRevisionId: string },
) {
  if (
    scope.kind !== 'merchant' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(scope.shopId) ||
    !/^[1-9][0-9]*$/.test(scope.installationGeneration) ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(request.assetId) ||
    !/^[1-9][0-9]{0,19}$/.test(request.productId) ||
    (request.imageRevisionId !== `product_${request.productId}` &&
      !/^variant_[1-9][0-9]{0,19}$/.test(request.imageRevisionId))
  )
    fail('INVALID_INPUT');
}
function keys(scope: Pick<MerchantPreviewScope, 'shopId' | 'installationGeneration'>, assetId: string) {
  const path = `merchant-previews/${scope.shopId}/${scope.installationGeneration}/${assetId}`;
  return { originalKey: `originals/${path}`, previewKey: `previews/${path}.png` };
}
function owned(row: MerchantPreviewRecord) {
  identity({ ...row, kind: 'merchant' }, row);
  const expected = keys(row, row.assetId);
  if (row.originalKey !== expected.originalKey || row.previewKey !== expected.previewKey || !row.manifest)
    fail('CONFLICT');
  return row.manifest;
}
/** Internal orchestration: authenticated catalog source and isolated inspector are injected ports.
 * A durable WRITING claim is never expired/replayed. Unknown writes remain explicit obligations.
 */
export function createMerchantPreviewCapture(input: MerchantPreviewCaptureInputs) {
  const clock = input.clock ?? (() => new Date());
  async function bytes(key: string, maxBytes: number): Promise<Uint8Array | null> {
    try {
      return await input.storage.read({ key, maxBytes });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'NOT_FOUND') return null;
      return fail('UNAVAILABLE');
    }
  }
  async function absent(row: MerchantPreviewRecord) {
    const m = owned(row);
    for (const [key, maxBytes] of [
      [row.originalKey, m.byteLength],
      [row.previewKey, m.previewByteLength],
    ] as const)
      if (await bytes(key, maxBytes)) fail('UNRESOLVED');
  }
  return {
    async capture(
      scope: MerchantPreviewScope,
      request: { assetId: string; productId: string; imageRevisionId: string },
    ): Promise<MerchantPreviewRecord | null> {
      identity(scope, request);
      const prior = await input.store.get(scope, request.assetId);
      if (prior) {
        if (prior.productId !== request.productId || prior.imageRevisionId !== request.imageRevisionId)
          fail('CONFLICT');
        owned(prior);
        if (prior.state === 'USABLE') return prior;
        if (prior.state === 'WRITING') fail('UNRESOLVED');
        if (prior.state !== 'PREPARING') fail('CONFLICT');
      }
      const collectedAt = prior?.collectedAt ?? clock();
      if (!Number.isFinite(+collectedAt)) fail('INVALID_INPUT');
      const source = await input.readImage(scope, request.productId, request.imageRevisionId);
      if (source === null) return null;
      const original = Uint8Array.from(source);
      if (!original.byteLength || original.byteLength > 5 * 1024 * 1024) fail('INVALID_INPUT');
      const inspection = await input.inspect(Uint8Array.from(original));
      const preview = Uint8Array.from(inspection.preview);
      if (
        inspection.version !== 'm6-inspection-v1' ||
        inspection.originalSha256 !== hash(original) ||
        !['image/png', 'image/jpeg', 'image/svg+xml'].includes(inspection.mimeType) ||
        inspection.previewMimeType !== 'image/png' ||
        !Number.isSafeInteger(inspection.width) ||
        !Number.isSafeInteger(inspection.height) ||
        inspection.width < 1 ||
        inspection.height < 1 ||
        inspection.width > 12000 ||
        inspection.height > 12000 ||
        inspection.width * inspection.height > 40000000 ||
        preview.byteLength < 8 ||
        preview.byteLength > 2 * 1024 * 1024 ||
        !pngHeader.every((value, index) => preview[index] === value)
      )
        fail('UNAVAILABLE');
      const manifest: ArtworkManifest = {
        version: inspection.version,
        mimeType: inspection.mimeType,
        sha256: hash(original),
        byteLength: original.byteLength,
        width: inspection.width,
        height: inspection.height,
        previewSha256: hash(preview),
        previewByteLength: preview.byteLength,
      };
      const row = await input.store.prepare(scope, {
        shopId: scope.shopId,
        installationGeneration: scope.installationGeneration,
        ...request,
        ...keys(scope, request.assetId),
        manifest,
        collectedAt,
        abandonAt: prior?.abandonAt ?? new Date(+collectedAt + 7 * 86400000),
        state: 'PREPARING',
        claimId: null,
      });
      const claimId = randomUUID();
      if (!(await input.store.beginCapture(scope, row.assetId, claimId, clock()))) fail('CONFLICT');
      // Do not catch and reset the claim: either storage write may have an unresolved outcome.
      await input.storage.putImmutable({ key: row.originalKey, bytes: original, contentType: manifest.mimeType });
      await input.storage.putImmutable({ key: row.previewKey, bytes: preview, contentType: 'image/png' });
      const settled = await input.store.finishCapture(scope, row.assetId, claimId, clock());
      if (settled.state !== 'USABLE') fail('NOT_FOUND');
      return settled;
    },
    async cleanup(limit = 20): Promise<number> {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('INVALID_INPUT');
      let deleted = 0;
      for (const assetId of await input.store.selectCleanup(limit, clock())) {
        try {
          const row = await input.store.markDeleting(assetId, clock());
          if (!row) {
            const pending = await input.store.readDeleting(assetId);
            if (!pending) continue;
            // A previous crash/lost DELETE response only permits absence reconciliation, never redispatch.
            await absent(pending);
            await input.store.finishDeleting(assetId, clock());
            deleted++;
            continue;
          }
          const m = owned(row);
          for (const [key, length, expected] of [
            [row.originalKey, m.byteLength, m.sha256],
            [row.previewKey, m.previewByteLength, m.previewSha256],
          ] as const) {
            const observed = await bytes(key, length);
            if (observed && hash(observed) !== expected) fail('CONFLICT');
            if (observed) await input.storage.remove({ key });
          }
          await absent(row);
          await input.store.finishDeleting(assetId, clock());
          deleted++;
        } catch (error) {
          if (!input.onCleanupError) throw error;
          try {
            input.onCleanupError('MERCHANT_PREVIEW_CLEANUP_UNAVAILABLE');
          } catch {
            /* Reporting cannot starve unrelated rows. */
          }
        }
      }
      return deleted;
    },
  };
}
