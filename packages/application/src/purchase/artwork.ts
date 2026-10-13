import type { ArtworkRecord, ArtworkStorage } from '../artwork/artwork.js';

/** Constructed from authenticated merchant session authority, never browser-supplied scope. */
export type PurchaseMerchant = { shopId: string; installationGeneration: string; kind: 'merchant'; ownerHash?: string };
export type PurchaseArtworkAttachment = {
  purchaseId: string;
  expectedVersion: number;
  groupIndex: number;
  placementId: string;
  assetId: string;
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function merchant(scope: PurchaseMerchant): void {
  if (scope.kind !== 'merchant' || !scope.shopId || !/^[1-9][0-9]*$/.test(scope.installationGeneration))
    throw new Error('MERCHANT_REQUIRED');
}
function versioned(input: { purchaseId: string; expectedVersion: number }): void {
  if (!uuid.test(input.purchaseId) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0)
    throw new Error('INVALID_ARTWORK_COMMAND');
}
/** The repository serializes CAS, asset ownership/usability and lock state in one transaction. */
export async function attachPurchaseArtwork<T>(
  scope: PurchaseMerchant,
  input: PurchaseArtworkAttachment,
  store: {
    appendArtwork(scope: PurchaseMerchant, input: PurchaseArtworkAttachment & { ownerHash: string }): Promise<T>;
  },
): Promise<T> {
  merchant(scope);
  versioned(input);
  if (
    !scope.ownerHash ||
    !/^[a-f0-9]{64}$/.test(scope.ownerHash) ||
    !uuid.test(input.assetId) ||
    !Number.isInteger(input.groupIndex) ||
    input.groupIndex < 0 ||
    input.groupIndex > 31 ||
    !input.placementId ||
    input.placementId.length > 128
  )
    throw new Error('INVALID_ARTWORK_COMMAND');
  return store.appendArtwork(scope, { ...input, ownerHash: scope.ownerHash });
}
export async function lockPurchaseArtwork<T>(
  scope: PurchaseMerchant,
  input: { purchaseId: string; expectedVersion: number },
  store: { lockArtwork(scope: PurchaseMerchant, input: { purchaseId: string; expectedVersion: number }): Promise<T> },
): Promise<T> {
  merchant(scope);
  versioned(input);
  return store.lockArtwork(scope, input);
}
export type PurchaseArtworkAccessPorts = {
  getAuthorizedArtwork(
    scope: PurchaseMerchant,
    input: { purchaseId: string; assetId: string },
  ): Promise<ArtworkRecord | null>;
  storage: Pick<ArtworkStorage, 'presignRead'>;
  clock?: () => Date;
};
async function purchasedAsset(
  scope: PurchaseMerchant,
  input: { purchaseId: string; assetId: string },
  ports: PurchaseArtworkAccessPorts,
) {
  merchant(scope);
  if (!uuid.test(input.purchaseId) || !uuid.test(input.assetId)) throw new Error('INVALID_ARTWORK_COMMAND');
  const asset = await ports.getAuthorizedArtwork(scope, input);
  const now = (ports.clock ?? (() => new Date()))();
  if (
    !asset ||
    asset.assetId !== input.assetId ||
    asset.shopId !== scope.shopId ||
    asset.state !== 'USABLE' ||
    !asset.manifest ||
    !Number.isFinite(+now) ||
    !Number.isFinite(+asset.expiresAt) ||
    asset.expiresAt <= now
  )
    throw new Error('ARTWORK_UNAVAILABLE');
  const expiresAt = new Date(Math.min(+now + 5 * 60_000, +asset.expiresAt));
  return { asset, manifest: asset.manifest, expiresAt };
}
/** Purchase-specific authorization permits original guest artwork only through its retained binding. */
export async function purchaseArtworkDownload(
  scope: PurchaseMerchant,
  input: { purchaseId: string; assetId: string },
  ports: PurchaseArtworkAccessPorts,
) {
  const { asset, manifest, expiresAt } = await purchasedAsset(scope, input, ports);
  const extension = manifest.mimeType === 'image/svg+xml' ? 'svg' : manifest.mimeType === 'image/png' ? 'png' : 'jpg';
  return {
    url: await ports.storage.presignRead({
      key: asset.originalKey,
      expiresAt,
      downloadFilename: `artwork-${asset.assetId}.${extension}`,
    }),
    expiresAt: expiresAt.toISOString(),
    sha256: manifest.sha256,
    byteLength: manifest.byteLength,
  };
}
/** Browser previews use the verified raster derivative; private SVG originals are download-only. */
export async function purchaseArtworkPreview(
  scope: PurchaseMerchant,
  input: { purchaseId: string; assetId: string },
  ports: PurchaseArtworkAccessPorts,
) {
  const { asset, manifest, expiresAt } = await purchasedAsset(scope, input, ports);
  if (
    !Number.isFinite(manifest.width) ||
    !Number.isFinite(manifest.height) ||
    manifest.width <= 0 ||
    manifest.height <= 0
  )
    throw new Error('ARTWORK_UNAVAILABLE');
  return {
    url: await ports.storage.presignRead({ key: asset.previewKey, expiresAt }),
    expiresAt: expiresAt.toISOString(),
    sha256: manifest.previewSha256,
    byteLength: manifest.previewByteLength,
    contentType: 'image/png' as const,
    aspectRatio: manifest.width / manifest.height,
  };
}
