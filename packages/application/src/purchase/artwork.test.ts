import { describe, expect, it, vi } from 'vitest';
import type { ArtworkRecord } from '../artwork/artwork.js';
import {
  attachPurchaseArtwork,
  lockPurchaseArtwork,
  purchaseArtworkDownload,
  purchaseArtworkPreview,
} from './artwork.js';

const purchaseId = '11111111-1111-4111-8111-111111111111';
const assetId = '22222222-2222-4222-8222-222222222222';
const merchant = { shopId: 'shop', installationGeneration: '1', kind: 'merchant' as const, ownerHash: 'a'.repeat(64) };
describe('merchant-only purchased artwork work', () => {
  it('appends a replacement with CAS without editing purchased economics or original collection deadlines', async () => {
    const appendArtwork = vi.fn(async () => ({ artworkVersion: 2 }));
    await attachPurchaseArtwork(
      merchant,
      { purchaseId, expectedVersion: 1, groupIndex: 0, placementId: 'front', assetId },
      { appendArtwork },
    );
    expect(appendArtwork).toHaveBeenCalledWith(merchant, {
      purchaseId,
      expectedVersion: 1,
      groupIndex: 0,
      placementId: 'front',
      assetId,
      ownerHash: merchant.ownerHash,
    });
  });
  it('denies a buyer capability before it reaches atomic artwork mutation', async () => {
    const appendArtwork = vi.fn();
    await expect(
      attachPurchaseArtwork(
        { ...merchant, kind: 'guest' } as never,
        { purchaseId, expectedVersion: 1, groupIndex: 0, placementId: 'front', assetId },
        { appendArtwork },
      ),
    ).rejects.toThrow('MERCHANT_REQUIRED');
    expect(appendArtwork).not.toHaveBeenCalled();
  });
  it('locks the ready attachment set using the atomic repository guard and has no unlock action', async () => {
    const lockArtwork = vi.fn(async () => ({ artworkState: 'ARTWORK_LOCKED' }));
    expect(await lockPurchaseArtwork(merchant, { purchaseId, expectedVersion: 2 }, { lockArtwork })).toEqual({
      artworkState: 'ARTWORK_LOCKED',
    });
  });
  it('downloads only an exact purchase-owned usable original with a lifetime capped by its original expiry', async () => {
    const clock = () => new Date('2026-10-20T10:00:00.000Z');
    const expiresAt = new Date('2026-10-20T10:02:00.000Z');
    const asset = {
      assetId,
      shopId: 'shop',
      installationGeneration: '1',
      state: 'USABLE',
      expiresAt,
      originalKey: 'private/original',
      manifest: { mimeType: 'image/svg+xml', sha256: 'b'.repeat(64), byteLength: 123 },
    } as ArtworkRecord;
    const getAuthorizedArtwork = vi.fn(async () => asset);
    const presignRead = vi.fn(async () => 'https://private.example/signed');
    const result = await purchaseArtworkDownload(
      merchant,
      { purchaseId, assetId },
      { getAuthorizedArtwork, storage: { presignRead }, clock },
    );
    expect(getAuthorizedArtwork).toHaveBeenCalledWith(merchant, { purchaseId, assetId });
    expect(presignRead).toHaveBeenCalledWith({
      key: 'private/original',
      expiresAt,
      downloadFilename: `artwork-${assetId}.svg`,
    });
    expect(result).toEqual({
      url: 'https://private.example/signed',
      expiresAt: expiresAt.toISOString(),
      sha256: 'b'.repeat(64),
      byteLength: 123,
    });
  });
  it('does not expose arbitrary same-tenant artwork', async () => {
    const presignRead = vi.fn();
    await expect(
      purchaseArtworkDownload(
        merchant,
        { purchaseId, assetId },
        { getAuthorizedArtwork: async () => null, storage: { presignRead } },
      ),
    ).rejects.toThrow('ARTWORK_UNAVAILABLE');
    expect(presignRead).not.toHaveBeenCalled();
  });
  it('previews only the purchase-owned safe PNG derivative and never the original SVG', async () => {
    const asset = {
      assetId,
      shopId: 'shop',
      state: 'USABLE',
      expiresAt: new Date('2026-10-20T10:02:00.000Z'),
      originalKey: 'private/original.svg',
      previewKey: 'private/preview.png',
      manifest: {
        mimeType: 'image/svg+xml',
        previewSha256: 'c'.repeat(64),
        previewByteLength: 456,
        width: 200,
        height: 100,
      },
    } as ArtworkRecord;
    const presignRead = vi.fn(async () => 'https://private.example/preview');
    const result = await purchaseArtworkPreview(
      merchant,
      { purchaseId, assetId },
      {
        getAuthorizedArtwork: async () => asset,
        storage: { presignRead },
        clock: () => new Date('2026-10-20T10:00:00.000Z'),
      },
    );
    expect(presignRead).toHaveBeenCalledWith({
      key: 'private/preview.png',
      expiresAt: new Date('2026-10-20T10:02:00.000Z'),
    });
    expect(result).toEqual({
      url: 'https://private.example/preview',
      expiresAt: '2026-10-20T10:02:00.000Z',
      sha256: 'c'.repeat(64),
      byteLength: 456,
      contentType: 'image/png',
      aspectRatio: 2,
    });
  });
  it('refuses a corrupt preview geometry before exposing a signed derivative URL', async () => {
    const asset = {
      assetId,
      shopId: 'shop',
      state: 'USABLE',
      expiresAt: new Date('2026-10-20T10:02:00.000Z'),
      previewKey: 'private/preview.png',
      manifest: { width: 200, height: 0 },
    } as ArtworkRecord;
    const presignRead = vi.fn();
    await expect(
      purchaseArtworkPreview(
        merchant,
        { purchaseId, assetId },
        {
          getAuthorizedArtwork: async () => asset,
          storage: { presignRead },
          clock: () => new Date('2026-10-20T10:00:00.000Z'),
        },
      ),
    ).rejects.toThrow('ARTWORK_UNAVAILABLE');
    expect(presignRead).not.toHaveBeenCalled();
  });
});
