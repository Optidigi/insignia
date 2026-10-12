import { randomUUID } from 'node:crypto';
import { ArtworkError, type ArtworkStorage, createArtworkService } from '@insignia/application';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { inspectArtwork } from '../../../apps/worker/dist/artwork/inspection.js';
import { createDurableCore } from '../src/index.js';

it.runIf(Boolean(process.env.DATABASE_URL) && process.env.M6_INSPECTION_INTEGRATION === '1')(
  'durably promotes actual isolated inspection bytes and fences tenant access through expiry and cleanup',
  async () => {
    const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL, statement_timeout: 10000 }));
    const shopId = randomUUID();
    const scope = { shopId, installationGeneration: '1', kind: 'merchant' as const };
    let now = new Date('2026-10-12T12:00:00Z');
    const objects = new Map<string, Uint8Array>();
    const original = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="8"><rect width="16" height="8" fill="red"/></svg>',
    );
    let quarantineKey = '';
    const storage: ArtworkStorage = {
      presignUpload: async ({ key, contentType }) => {
        quarantineKey = key;
        return { url: 'https://synthetic-storage.invalid/' + key, headers: { 'Content-Type': contentType } };
      },
      read: async ({ key, maxBytes }) => {
        const value = objects.get(key);
        if (!value) throw new ArtworkError('NOT_FOUND');
        if (value.byteLength > maxBytes) throw new ArtworkError('INVALID_INPUT');
        return new Uint8Array(value);
      },
      putImmutable: async ({ key, bytes }) => {
        if (objects.has(key)) throw new ArtworkError('CONFLICT');
        objects.set(key, new Uint8Array(bytes));
      },
      remove: async ({ key }) => {
        objects.delete(key);
      },
      presignRead: async ({ key, downloadFilename }) =>
        `https://synthetic-storage.invalid/${key}${downloadFilename ? '?attachment=' + downloadFilename : ''}`,
    };
    const service = createArtworkService({
      store: core.artwork,
      storage,
      clock: () => now,
      inspect: async (bytes, options) => {
        const inspected = await inspectArtwork(bytes, options);
        objects.set(quarantineKey, Buffer.from('<svg><script>wrong bytes</script></svg>'));
        return inspected;
      },
    });
    try {
      await core.transactions.run((tx) =>
        core.tenants.createShop(tx, { shopId, shopDomain: `${shopId}.myshopify.com` }),
      );
      const upload = await service.begin(scope, { contentType: 'image/svg+xml', byteLength: original.byteLength });
      const owned = await core.artwork.get(scope, upload.assetId);
      expect(owned).not.toBeNull();
      objects.set(quarantineKey, original);
      expect((await service.complete(scope, upload.assetId)).state).toBe('QUEUED');
      await expect(service.preview(scope, upload.assetId)).rejects.toMatchObject({ code: 'NOT_USABLE' });
      expect(await service.process(upload.assetId)).toBe('usable');
      expect(objects.get(owned!.originalKey)).toEqual(new Uint8Array(original));
      expect(objects.get(owned!.previewKey)?.subarray(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(objects.has(quarantineKey)).toBe(false);
      expect(await service.preview(scope, upload.assetId)).toMatchObject({ width: 16, height: 8 });
      expect((await service.download(scope, upload.assetId)).byteLength).toBe(original.byteLength);
      await expect(service.status({ ...scope, shopId: randomUUID() }, upload.assetId)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(
        service.download({ ...scope, kind: 'guest', ownerHash: owned!.ownerHash }, upload.assetId),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      now = new Date(Date.parse(upload.expiresAt));
      await expect(service.preview(scope, upload.assetId)).rejects.toMatchObject({ code: 'EXPIRED' });
      await service.cleanup();
      expect(objects.size).toBe(0);
    } finally {
      await core.close();
    }
  },
);
