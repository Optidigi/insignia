import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { type ArtworkRecord, createArtworkService } from './artwork.js';

describe('private artwork lifecycle at the application seam', () => {
  it('promotes the inspected snapshot despite quarantine overwrite and preserves success when immediate cleanup is unavailable', async () => {
    const original = new Uint8Array([1, 2, 3]);
    const preview = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const row = {
      assetId: 'asset',
      declaredBytes: 3,
      declaredMime: 'image/png',
      quarantineKey: 'quarantine/key',
      originalKey: 'originals/key',
      previewKey: 'previews/key.png',
      manifest: null,
    } as ArtworkRecord;
    const objects = new Map<string, Uint8Array>([['quarantine/key', original]]);
    const service = createArtworkService({
      store: {
        claim: async () => row,
        prepare: async () => row,
        settle: async () => true,
        release: async () => {},
      } as never,
      storage: {
        read: async ({ key }: { key: string }) => new Uint8Array(objects.get(key)),
        putImmutable: async ({ key, bytes }: { key: string; bytes: Uint8Array }) => {
          objects.set(key, new Uint8Array(bytes));
        },
        remove: async () => {
          throw new Error('storage cleanup unavailable');
        },
      } as never,
      inspect: async (bytes) => {
        objects.set('quarantine/key', new Uint8Array([9, 9, 9]));
        return {
          version: 'm6-inspection-v1',
          mimeType: 'image/png',
          width: 1,
          height: 1,
          originalSha256: createHash('sha256').update(bytes).digest('hex'),
          preview,
          previewMimeType: 'image/png',
        };
      },
    });
    await expect(service.process('asset')).resolves.toBe('usable');
    expect(objects.get('originals/key')).toEqual(new Uint8Array([1, 2, 3]));
    expect(objects.get('previews/key.png')).toEqual(preview);
  });
  it('keeps the authenticated guest session owner instead of returning an unrelated capability', async () => {
    const service = createArtworkService({
      store: { create: async (row: ArtworkRecord) => row } as never,
      storage: { presignUpload: async () => ({ url: 'https://storage.invalid/upload', headers: {} }) } as never,
      inspect: async () => {
        throw new Error('must not inspect');
      },
    });
    const result = await service.begin(
      { shopId: 'shop', installationGeneration: '1', kind: 'guest', ownerHash: 'a'.repeat(64) },
      { contentType: 'image/png', byteLength: 10 },
    );
    expect(result).not.toHaveProperty('capability');
  });
  it('allows quote usability through the full local day immediately before midnight expiry', async () => {
    const service = createArtworkService({
      clock: () => new Date('2026-10-12T12:00:00Z'),
      store: {
        readUsability: async () => [
          { assetId: 'asset', state: 'USABLE', manifest: {}, expiresAt: new Date('2026-10-19T00:00:00Z') },
        ],
      } as never,
      storage: {} as never,
      inspect: async () => {
        throw new Error('must not inspect');
      },
    });
    const [result] = await service.quoteArtwork.readUsability({
      shopId: 'shop',
      installationGeneration: '1',
      shopTimezone: 'UTC',
      choices: [{ kind: 'revision', id: 'asset' }],
    });
    expect(result?.lastFullyUsableLocalDay).toBe(20744);
  });
  it('does not issue an upload before a bounded owned session is durably admitted', async () => {
    const calls: string[] = [];
    const service = createArtworkService({
      clock: () => new Date('2026-10-12T12:00:00Z'),
      store: {
        create: async () => {
          calls.push('admitted');
          throw new Error('inactive tenant');
        },
      } as never,
      storage: {
        presignUpload: async () => {
          calls.push('signed');
          return { url: 'https://storage.invalid', headers: {} };
        },
      } as never,
      inspect: async () => {
        throw new Error('must not inspect');
      },
    });
    await expect(
      service.begin(
        { shopId: 'shop', installationGeneration: '1', kind: 'merchant' },
        {
          contentType: 'image/png',
          byteLength: 10,
        },
      ),
    ).rejects.toThrow('inactive tenant');
    expect(calls).toEqual(['admitted']);
  });
});
