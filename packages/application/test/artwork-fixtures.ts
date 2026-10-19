import type { ArtworkManifest, ArtworkRecord, ArtworkStorage, ArtworkStore } from '../src/artwork/artwork.js';

const unexpected = async (): Promise<never> => {
  throw new Error('Unexpected artwork fixture boundary');
};
export const artworkManifest: ArtworkManifest = {
  version: 'm6-inspection-v1',
  mimeType: 'image/png',
  byteLength: 3,
  sha256: 'a'.repeat(64),
  width: 1,
  height: 1,
  previewSha256: 'b'.repeat(64),
  previewByteLength: 8,
};
export function artworkRow(overrides: Partial<ArtworkRecord> = {}): ArtworkRecord {
  return {
    assetId: 'asset',
    shopId: 'shop',
    installationGeneration: '1',
    ownerHash: 'a'.repeat(64),
    declaredMime: 'image/png',
    declaredBytes: 3,
    state: 'USABLE',
    quarantineKey: 'quarantine/key',
    originalKey: 'originals/key',
    previewKey: 'previews/key.png',
    collectedAt: new Date('2026-10-12T12:00:00Z'),
    uploadUntil: new Date('2026-10-12T12:05:00Z'),
    expiresAt: new Date('2026-10-19T12:00:00Z'),
    claimId: null,
    manifest: null,
    rejection: null,
    ...overrides,
  };
}
export function artworkStore(overrides: Partial<ArtworkStore> = {}): ArtworkStore {
  return {
    create: unexpected,
    get: unexpected,
    complete: unexpected,
    claim: unexpected,
    prepare: unexpected,
    settle: unexpected,
    reject: unexpected,
    release: unexpected,
    selectPending: unexpected,
    selectExpired: unexpected,
    markDeleting: unexpected,
    finishDeleting: unexpected,
    selectQuarantineCleanup: unexpected,
    markQuarantineCleanupAttempt: unexpected,
    markQuarantineCleaned: unexpected,
    readUsability: unexpected,
    ...overrides,
  };
}
export function artworkStorage(overrides: Partial<ArtworkStorage> = {}): ArtworkStorage {
  return {
    presignUpload: unexpected,
    read: unexpected,
    putImmutable: unexpected,
    remove: unexpected,
    presignRead: unexpected,
    ...overrides,
  };
}
