import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { artworkManifest, artworkRow, artworkStorage, artworkStore } from '../../test/artwork-fixtures.js';
import { type ArtworkRecord, createArtworkService, createArtworkUsabilityPort } from './artwork.js';

function deferred() {
  let resolve: () => void = () => {
    throw new Error('Missing deferred');
  };
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('private artwork lifecycle at the application seam', () => {
  it('quote usability requires bound verified ownership even when another guest knows the UUID', async () => {
    const row = artworkRow({
      assetId: 'known-asset',
      ownerHash: 'a'.repeat(64),
      state: 'USABLE',
      manifest: artworkManifest,
      expiresAt: new Date('2026-10-19T12:00:00Z'),
    });
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
    const row = artworkRow({
      assetId: 'asset',
      declaredBytes: 3,
      declaredMime: 'image/png',
      quarantineKey: 'quarantine/key',
      originalKey: 'originals/key',
      previewKey: 'previews/key.png',
      manifest: null,
    });
    const objects = new Map<string, Uint8Array>([['quarantine/key', original]]);
    const requiredObject = (key: string) => {
      const value = objects.get(key);
      if (!value) throw new Error('Missing fixture object');
      return value;
    };
    const service = createArtworkService({
      store: artworkStore({
        claim: async () => row,
        prepare: async () => row,
        settle: async () => true,
        release: async () => {},
      }),
      storage: artworkStorage({
        read: async ({ key }: { key: string }) => new Uint8Array(requiredObject(key)),
        putImmutable: async ({ key, bytes }: { key: string; bytes: Uint8Array }) => {
          objects.set(key, new Uint8Array(bytes));
        },
        remove: async () => {
          throw new Error('storage cleanup unavailable');
        },
      }),
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
  it('overlaps independent promotion writes and readbacks without exposing partially verified bytes', async () => {
    const original = new Uint8Array([1, 2, 3]);
    const preview = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const row = artworkRow({ manifest: null });
    const writes: string[] = [],
      reads: string[] = [];
    const originalPut = deferred(),
      previewPut = deferred(),
      originalRead = deferred(),
      previewRead = deferred();
    const firstPut = deferred(),
      firstRead = deferred(),
      originalPutFinished = deferred(),
      originalReadFinished = deferred();
    let settled = 0;
    const service = createArtworkService({
      clock: () => new Date('2026-10-12T12:00:00Z'),
      store: artworkStore({
        claim: async () => row,
        prepare: async () => row,
        settle: async () => {
          settled++;
          return true;
        },
      }),
      storage: artworkStorage({
        putImmutable: async ({ key }) => {
          writes.push(key);
          firstPut.resolve();
          await (key === row.originalKey ? originalPut : previewPut).promise;
          if (key === row.originalKey) originalPutFinished.resolve();
        },
        read: async ({ key }) => {
          if (key === row.quarantineKey) return original;
          reads.push(key);
          firstRead.resolve();
          await (key === row.originalKey ? originalRead : previewRead).promise;
          if (key === row.originalKey) originalReadFinished.resolve();
          return key === row.originalKey ? original : preview;
        },
        remove: async () => {},
      }),
      inspect: async () => ({
        version: 'm6-inspection-v1',
        mimeType: 'image/png',
        width: 1,
        height: 1,
        originalSha256: createHash('sha256').update(original).digest('hex'),
        preview,
        previewMimeType: 'image/png',
      }),
    });
    const processing = service.process(row.assetId);
    try {
      await firstPut.promise;
      expect(writes).toEqual([row.originalKey, row.previewKey]);
      originalPut.resolve();
      await originalPutFinished.promise;
      expect(reads).toEqual([]);
      expect(settled).toBe(0);
      previewPut.resolve();
      await firstRead.promise;
      expect(reads).toEqual([row.originalKey, row.previewKey]);
      originalRead.resolve();
      await originalReadFinished.promise;
      expect(settled).toBe(0);
      previewRead.resolve();
      await expect(processing).resolves.toBe('usable');
      expect(settled).toBe(1);
    } finally {
      originalPut.resolve();
      previewPut.resolve();
      originalRead.resolve();
      previewRead.resolve();
      await Promise.allSettled([processing]);
    }
  });

  it.each(['write', 'read'] as const)(
    'drains the sibling %s before releasing a failed promotion claim',
    async (phase) => {
      const original = new Uint8Array([1, 2, 3]);
      const preview = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      const row = artworkRow({ manifest: null });
      const failed = deferred(),
        sibling = deferred();
      let siblingStarted = false,
        siblingFinished = false,
        settled = 0,
        released = 0;
      const failOrWait = async (key: string) => {
        if (key === row.originalKey) {
          failed.resolve();
          throw new Error('Synthetic storage unavailable');
        }
        siblingStarted = true;
        await sibling.promise;
        siblingFinished = true;
      };
      const service = createArtworkService({
        clock: () => new Date('2026-10-12T12:00:00Z'),
        store: artworkStore({
          claim: async () => row,
          prepare: async () => row,
          settle: async () => {
            settled++;
            return true;
          },
          release: async (_id, _claim, retryAt) => {
            released++;
            expect(siblingFinished).toBe(true);
            expect(retryAt).toEqual(new Date('2026-10-12T12:00:30Z'));
          },
        }),
        storage: artworkStorage({
          putImmutable: async ({ key }) => {
            if (phase === 'write') await failOrWait(key);
          },
          read: async ({ key }) => {
            if (key === row.quarantineKey) return original;
            if (phase === 'read') await failOrWait(key);
            return key === row.originalKey ? original : preview;
          },
        }),
        inspect: async () => ({
          version: 'm6-inspection-v1',
          mimeType: 'image/png',
          width: 1,
          height: 1,
          originalSha256: createHash('sha256').update(original).digest('hex'),
          preview,
          previewMimeType: 'image/png',
        }),
      });
      const processing = service.process(row.assetId);
      // Observe premature failure while the other storage operation is held.
      void processing.catch(() => {});
      try {
        await failed.promise;
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(siblingStarted).toBe(true);
        expect(siblingFinished).toBe(false);
        expect(released).toBe(0);
        expect(settled).toBe(0);
        sibling.resolve();
        await expect(processing).rejects.toMatchObject({ code: 'UNAVAILABLE' });
        expect(released).toBe(1);
        expect(settled).toBe(0);
      } finally {
        sibling.resolve();
        await Promise.allSettled([processing]);
      }
    },
  );

  it.each(['original', 'preview'] as const)(
    'rejects a mismatched %s readback while the other object verifies',
    async (mismatch) => {
      const original = new Uint8Array([1, 2, 3]);
      const preview = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      const row = artworkRow({ manifest: null });
      const rejected: string[] = [];
      let settled = 0;
      const service = createArtworkService({
        clock: () => new Date('2026-10-12T12:00:00Z'),
        store: artworkStore({
          claim: async () => row,
          prepare: async () => row,
          settle: async () => {
            settled++;
            return true;
          },
          reject: async (_id, _claim, reason) => {
            rejected.push(reason);
          },
        }),
        storage: artworkStorage({
          putImmutable: async () => {},
          remove: async () => {},
          read: async ({ key }) => {
            if (key === row.quarantineKey) return original;
            if (key === (mismatch === 'original' ? row.originalKey : row.previewKey)) return new Uint8Array([0]);
            return key === row.originalKey ? original : preview;
          },
        }),
        inspect: async () => ({
          version: 'm6-inspection-v1',
          mimeType: 'image/png',
          width: 1,
          height: 1,
          originalSha256: createHash('sha256').update(original).digest('hex'),
          preview,
          previewMimeType: 'image/png',
        }),
      });
      await expect(service.process(row.assetId)).resolves.toBe('rejected');
      expect(settled).toBe(0);
      expect(rejected).toEqual(['INSPECTION_REJECTED']);
    },
  );

  it('bounds missing upload retries by the grant deadline without inspecting absent bytes', async () => {
    let now = new Date('2026-10-12T12:00:00Z');
    const row = artworkRow({
      assetId: 'missing',
      manifest: null,
      quarantineKey: 'quarantine/missing',
      uploadUntil: new Date(+now + 300000),
    });
    const releases: Date[] = [],
      rejections: string[] = [];
    const service = createArtworkService({
      clock: () => now,
      store: artworkStore({
        claim: async () => row,
        release: async (_id: string, _claim: string, retryAt: Date) => {
          releases.push(retryAt);
        },
        reject: async (_id: string, _claim: string, reason: string) => {
          rejections.push(reason);
        },
      }),
      storage: artworkStorage({
        read: async () => {
          throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' });
        },
        remove: async () => {},
      }),
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
      artworkRow({
        assetId,
        quarantineKey: `quarantine/${assetId}`,
        originalKey: `originals/${assetId}`,
        previewKey: `previews/${assetId}`,
      });
    const service = createArtworkService({
      onCleanupError: (code) => {
        failures.push(code);
      },
      store: artworkStore({
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
      }),
      storage: artworkStorage({
        remove: async ({ key }: { key: string }) => {
          removed.push(key);
          if (key.includes('fails')) throw new Error('delete unavailable');
        },
      }),
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
      store: artworkStore({ create: async (row: ArtworkRecord) => row }),
      storage: artworkStorage({ presignUpload: async () => ({ url: 'https://storage.invalid/upload', headers: {} }) }),
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
  it.each(['merchant', 'guest'] as const)(
    'records trusted %s upload provenance before signing a private upload',
    async (kind) => {
      let created: ArtworkRecord | undefined;
      const service = createArtworkService({
        store: artworkStore({
          create: async (row: ArtworkRecord) => {
            created = row;
            return row;
          },
        }),
        storage: artworkStorage({
          presignUpload: async () => ({ url: 'https://storage.invalid/upload', headers: {} }),
        }),
        inspect: async () => {
          throw new Error('must not inspect');
        },
      });
      await service.begin(
        { shopId: 'shop', installationGeneration: '1', kind, ownerHash: 'a'.repeat(64) },
        { contentType: 'image/png', byteLength: 10 },
      );
      expect(created).toHaveProperty('ownerKind', kind);
    },
  );
  it('allows explicit policy-authorized logo-later intents while refusing arbitrary deferred ids', async () => {
    const service = createArtworkService({
      clock: () => new Date('2026-10-12T12:00:00Z'),
      store: artworkStore({ readUsability: async () => [] }),
      storage: artworkStorage({}),
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
      store: artworkStore({
        readUsability: async () => [
          artworkRow({
            assetId: 'asset',
            state: 'USABLE',
            manifest: artworkManifest,
            expiresAt: new Date('2026-10-19T00:00:00Z'),
          }),
        ],
      }),
      storage: artworkStorage({}),
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
      store: artworkStore({
        create: async () => {
          calls.push('admitted');
          throw new Error('inactive tenant');
        },
      }),
      storage: artworkStorage({
        presignUpload: async () => {
          calls.push('signed');
          return { url: 'https://storage.invalid', headers: {} };
        },
      }),
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

it('post-order authority bounds upload/original/preview expiry without extending the original resource deadline', async () => {
  const now = new Date('2026-11-05T12:00:00Z');
  const deadline = new Date(+now + 60000);
  const scope = {
    kind: 'guest' as const,
    shopId: 'shop',
    installationGeneration: '1',
    ownerHash: 'a'.repeat(64),
    authorityExpiresAt: deadline,
  };
  let created: ArtworkRecord | undefined;
  let uploadExpiry: Date | undefined;
  let previewExpiry: Date | undefined;
  const service = createArtworkService({
    clock: () => now,
    inspect: async () => {
      throw new Error('unused');
    },
    store: artworkStore({
      create: async (row) => {
        created = row;
        return row;
      },
      get: async () => artworkRow({ state: 'USABLE', manifest: artworkManifest, expiresAt: new Date(+now + 86400000) }),
    }),
    storage: artworkStorage({
      presignUpload: async (value) => {
        uploadExpiry = value.expiresAt;
        return { url: 'https://objects.example.test/upload', headers: {} };
      },
      presignRead: async (value) => {
        previewExpiry = value.expiresAt;
        return 'https://objects.example.test/preview';
      },
    }),
  });
  await service.begin(scope, { contentType: 'image/png', byteLength: 3 });
  expect(created?.expiresAt).toEqual(deadline);
  expect(uploadExpiry).toEqual(deadline);
  await service.preview(scope, 'asset');
  expect(previewExpiry).toEqual(deadline);
  await expect(
    service.begin({ ...scope, authorityExpiresAt: now }, { contentType: 'image/png', byteLength: 3 }),
  ).rejects.toMatchObject({ code: 'EXPIRED' });
});
