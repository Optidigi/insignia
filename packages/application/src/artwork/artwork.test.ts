import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { type ArtworkRecord, createArtworkService, createArtworkUsabilityPort } from './artwork.js';

describe('private artwork lifecycle at the application seam', () => {
  it('quote usability requires bound verified ownership even when another guest knows the UUID', async () => {
    const row = {
      assetId: 'known-asset',
      ownerHash: 'a'.repeat(64),
      state: 'USABLE',
      manifest: {},
      expiresAt: new Date('2026-10-19T12:00:00Z'),
    } as ArtworkRecord;
    const store = { readUsability: async () => [row] };
    const request = {
      shopId: 'shop',
      installationGeneration: '1',
      shopTimezone: 'UTC',
      choices: [{ kind: 'revision' as const, id: row.assetId }],
    };
    const clock = () => new Date('2026-10-12T12:00:00Z');
    const scope = { shopId: 'shop', installationGeneration: '1', kind: 'guest' as const, ownerHash: 'b'.repeat(64) };
    expect((await createArtworkUsabilityPort(store, clock, scope).readUsability(request))[0]?.status).toBe(
      'unavailable',
    );
    expect((await createArtworkUsabilityPort(store, clock).readUsability(request))[0]?.status).toBe('unavailable');
    expect(
      (
        await createArtworkUsabilityPort(store, clock, { ...scope, ownerHash: 'a'.repeat(64) }).readUsability(request)
      )[0]?.status,
    ).toBe('usable');
  });

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
  it('bounds missing upload retries by the grant deadline without inspecting absent bytes', async () => {
    let now = new Date('2026-10-12T12:00:00Z');
    const row = {
      assetId: 'missing',
      manifest: null,
      quarantineKey: 'quarantine/missing',
      uploadUntil: new Date(+now + 300000),
    } as ArtworkRecord;
    const releases: Date[] = [],
      rejections: string[] = [];
    const service = createArtworkService({
      clock: () => now,
      store: {
        claim: async () => row,
        release: async (_id: string, _claim: string, retryAt: Date) => {
          releases.push(retryAt);
        },
        reject: async (_id: string, _claim: string, reason: string) => {
          rejections.push(reason);
        },
      } as never,
      storage: {
        read: async () => {
          throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' });
        },
        remove: async () => {},
      } as never,
      inspect: async () => {
        throw new Error('must not inspect');
      },
    });
    await expect(service.process('missing')).resolves.toBe('retry_scheduled');
    expect(releases).toEqual([new Date('2026-10-12T12:00:30Z')]);
    expect(rejections).toEqual([]);
    now = row.uploadUntil;
    await expect(service.process('missing')).resolves.toBe('rejected');
    expect(rejections).toEqual(['UPLOAD_MISSING']);
    expect(releases).toHaveLength(1);
  });
  it('continues unrelated erasure when quarantine and another expired asset fail', async () => {
    const removed: string[] = [],
      failures: string[] = [],
      finished: string[] = [],
      attempted: string[] = [];
    const row = (assetId: string) =>
      ({
        assetId,
        quarantineKey: `quarantine/${assetId}`,
        originalKey: `originals/${assetId}`,
        previewKey: `previews/${assetId}`,
      }) as ArtworkRecord;
    const service = createArtworkService({
      onCleanupError: (code) => {
        failures.push(code);
      },
      store: {
        selectQuarantineCleanup: async () => [row('quarantine-fails'), row('quarantine-ok')],
        markQuarantineCleanupAttempt: async (id: string) => {
          attempted.push(id);
          return true;
        },
        markQuarantineCleaned: async () => {},
        selectExpired: async () => [row('expired-fails'), row('expired-ok')],
        markDeleting: async (id: string) => row(id),
        finishDeleting: async (id: string) => {
          finished.push(id);
        },
      } as never,
      storage: {
        remove: async ({ key }: { key: string }) => {
          removed.push(key);
          if (key.includes('fails')) throw new Error('delete unavailable');
        },
      } as never,
      inspect: async () => {
        throw new Error('must not inspect');
      },
    });
    await expect(service.cleanup()).resolves.toBe(1);
    expect(attempted).toEqual(['quarantine-fails', 'quarantine-ok']);
    expect(finished).toEqual(['expired-ok']);
    expect(failures).toEqual(['ARTWORK_CLEANUP_UNAVAILABLE', 'ARTWORK_CLEANUP_UNAVAILABLE']);
    expect(removed).toContain('quarantine/quarantine-ok');
    expect(removed).toContain('previews/expired-ok');
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
  it('allows explicit policy-authorized logo-later intents while refusing arbitrary deferred ids', async () => {
    const service = createArtworkService({
      clock: () => new Date('2026-10-12T12:00:00Z'),
      store: { readUsability: async () => [] } as never,
      storage: {} as never,
      inspect: async () => {
        throw new Error('must not inspect');
      },
    });
    const request = {
      shopId: 'shop',
      installationGeneration: '1',
      shopTimezone: 'UTC',
      choices: [{ kind: 'deferred' as const, id: 'explicit-logo-later' }],
    };
    expect(
      (
        await service
          .quoteArtworkFor({ shopId: 'shop', installationGeneration: '1', kind: 'merchant' })
          .readUsability(request)
      )[0]?.status,
    ).toBe('unavailable');
    expect(
      (
        await service
          .quoteArtworkFor({ shopId: 'shop', installationGeneration: '1', kind: 'merchant' })
          .readUsability({ ...request, permittedDeferredIntentIds: ['other-intent'] })
      )[0]?.status,
    ).toBe('unavailable');
    const [accepted] = await service
      .quoteArtworkFor({ shopId: 'shop', installationGeneration: '1', kind: 'merchant' })
      .readUsability({
        ...request,
        permittedDeferredIntentIds: ['explicit-logo-later'],
      });
    expect(accepted?.status).toBe('usable');
    expect(accepted?.lastFullyUsableLocalDay).toBe(20740);
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
    const [result] = await service
      .quoteArtworkFor({ shopId: 'shop', installationGeneration: '1', kind: 'merchant' })
      .readUsability({
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
